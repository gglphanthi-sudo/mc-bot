const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// ===== CẤU HÌNH =====
const OWNER_USERNAME = (process.env.OWNER_USERNAME || 'catnosaur').trim().toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'Tuanpro123';
const LOG_WEBHOOK = process.env.LOG_WEBHOOK || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.log('⚠️ Chưa đặt SESSION_SECRET — user sẽ bị logout khi restart.');
}

const SERVER_HOST = process.env.MC_HOST || 'kingmc.vn';
const SERVER_PORT = parseInt(process.env.MC_PORT || '25565', 10);
const SERVER_VERSION = process.env.MC_VERSION || '1.20.1';

const COOKIE_NAME = 'kingmc_auth';
const TOKEN_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

// ===== USERS =====
function loadUsers() {
  try { if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); }
  catch (e) { console.log('⚠️ Lỗi đọc users.json'); }
  return {};
}
let users = loadUsers();
let usersSaveTimer = null;
function saveUsers() {
  clearTimeout(usersSaveTimer);
  usersSaveTimer = setTimeout(() => {
    try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
    catch (e) { console.log('❌ Lỗi lưu users.json:', e.message); }
  }, 200);
}

function signToken(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!data.exp || Date.now() > data.exp || !data.u) return null;
    return data.u;
  } catch (e) { return null; }
}
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function isOwnerUser(u) {
  return !!u && !!OWNER_USERNAME && u.toLowerCase() === OWNER_USERNAME;
}

// ===== DATA =====
let clientData = {};
let proxyList = [];
let maintenance = {
  active: false,
  message: 'Hệ thống đang bảo trì. Vui lòng quay lại sau!',
  countdownEnd: null,
  lockdown: false,
  freezeProxy: false
};
const socketsByUser = new Map();

function loadData() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch (e) { console.log('⚠️ Lỗi đọc data.json'); }
  return {
    clientData: {},
    maintenance: { active: false, message: '', countdownEnd: null, lockdown: false, freezeProxy: false },
    proxyList: []
  };
}
function stripForSave(data) {
  const out = {};
  for (const u in data) {
    out[u] = {
      accounts: (data[u].accounts || []).map(acc => ({
        id: acc.id, username: acc.username, autoReconnect: acc.autoReconnect,
        status: 'OFFLINE', proxy: acc.proxy || null
      })),
      webhookUrl: data[u].webhookUrl || ''
    };
  }
  return out;
}
const saved = loadData();
clientData = saved.clientData || {};
for (const u in clientData) {
  clientData[u].bots = {};
  (clientData[u].accounts || []).forEach(acc => { if (!acc.password) acc.password = ''; });
}
if (saved.maintenance) maintenance = { ...maintenance, ...saved.maintenance };
proxyList = saved.proxyList || [];

let saveTimer = null;
function saveData() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        clientData: stripForSave(clientData), maintenance, proxyList
      }, null, 2));
    } catch (e) { console.log('❌ Lỗi lưu data:', e.message); }
  }, 250);
}

function publicAccount(acc) {
  return { id: acc.id, username: acc.username, autoReconnect: acc.autoReconnect, status: acc.status, proxy: acc.proxy || null };
}
function publicAccounts(list) { return (list || []).map(publicAccount); }

function ensureUserBucket(u) {
  if (!clientData[u]) clientData[u] = { accounts: [], bots: {}, webhookUrl: '' };
  return clientData[u];
}
function trackSocket(u, id) {
  if (!socketsByUser.has(u)) socketsByUser.set(u, new Set());
  socketsByUser.get(u).add(id);
}
function untrackSocket(u, id) {
  if (socketsByUser.has(u)) {
    socketsByUser.get(u).delete(id);
    if (socketsByUser.get(u).size === 0) socketsByUser.delete(u);
  }
}
function emitToUser(u, event, payload) {
  const set = socketsByUser.get(u);
  if (!set) return;
  set.forEach(id => io.to(id).emit(event, payload));
}
function ownerSummary() {
  return Object.keys(clientData).map(u => {
    const accs = clientData[u].accounts || [];
    return {
      username: users[u] ? users[u].username : u,
      accountCount: accs.length,
      onlineCount: accs.filter(a => (a.status || '').includes('ONLINE')).length,
      online: socketsByUser.has(u)
    };
  });
}
function broadcastOwnerSummary() { emitToUser(OWNER_USERNAME, 'owner_summary', ownerSummary()); }
function registeredUsersList() {
  return Object.values(users).map(u => ({ username: u.username, createdAt: u.createdAt }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

// ===== WEBHOOK =====
async function sendLogWebhook(content) {
  if (!LOG_WEBHOOK) return;
  try { await axios.post(LOG_WEBHOOK, { content, username: 'KingMC Logger' }); }
  catch (e) { console.log('❌ Log webhook lỗi:', e.message); }
}
async function sendUserWebhook(url, content) {
  if (!url) return;
  try { await axios.post(url, { content, username: 'KingMC AFK Bot' }); }
  catch (e) { console.log('❌ User webhook lỗi:', e.message); }
}

// ===== PROXY =====
function getProxyFor(account) {
  if (account.proxy && proxyList.includes(account.proxy)) return account.proxy;
  return null;
}
function createProxyAgent(url) {
  if (!url) return null;
  try {
    if (url.startsWith('socks')) return new SocksProxyAgent(url);
    if (url.startsWith('http')) return new HttpsProxyAgent(url);
  } catch (e) { return null; }
  return null;
}
async function testProxy(url) {
  const agent = createProxyAgent(url);
  if (!agent) return { ok: false, error: 'URL proxy không hợp lệ' };
  try {
    const res = await axios.get('https://api.ipify.org?format=json', { httpAgent: agent, httpsAgent: agent, timeout: 8000 });
    return { ok: true, ip: res.data && res.data.ip };
  } catch (e) { return { ok: false, error: e.message }; }
}

app.use(express.static(path.join(__dirname, 'public')));

process.on('uncaughtException', (e) => console.log('[LỖI HỆ THỐNG]', e.message));
process.on('unhandledRejection', (r) => console.log('[LỖI PROMISE]', r && r.message ? r.message : r));

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  let rawIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
  if (rawIp === '::1') rawIp = '127.0.0.1';
  const clientIp = rawIp;

  let username = null;
  let displayName = null;
  let adminUnlocked = false;

  socket.emit('maintenance_status', maintenance);

  function bindUser(uLower, uDisplay) {
    username = uLower;
    displayName = uDisplay;
    trackSocket(username, socket.id);
    ensureUserBucket(username);
    const owner = isOwnerUser(username);
    socket.emit('auth_status', { authenticated: true, username: displayName, isOwner: owner });
    socket.emit('init_accounts', publicAccounts(clientData[username].accounts));
    socket.emit('proxy_list', proxyList);
    socket.emit('webhook_url', clientData[username].webhookUrl || '');
    if (owner) {
      socket.emit('owner_summary', ownerSummary());
      socket.emit('registered_users', registeredUsersList());
    }
  }

  const cookies = parseCookies(socket.handshake.headers.cookie);
  const cookieUserDisplay = verifyToken(cookies[COOKIE_NAME]);
  if (cookieUserDisplay && users[cookieUserDisplay.toLowerCase()]) {
    bindUser(cookieUserDisplay.toLowerCase(), users[cookieUserDisplay.toLowerCase()].username);
  } else {
    socket.emit('auth_status', { authenticated: false });
  }

  // ---- REGISTER ----
  socket.on('auth_register', async ({ username: u, password: p }) => {
    if (maintenance.lockdown) {
      socket.emit('auth_result', { ok: false, mode: 'register', error: 'Hệ thống đang lockdown, không thể đăng ký.' });
      return;
    }
    u = (u || '').trim();
    p = (p || '').trim();
    if (u.length < 3 || p.length < 3) {
      socket.emit('auth_result', { ok: false, mode: 'register', error: 'Tên và mật khẩu phải từ 3 ký tự.' });
      return;
    }
    const key = u.toLowerCase();
    if (users[key]) {
      socket.emit('auth_result', { ok: false, mode: 'register', error: 'Tên đã tồn tại.' });
      return;
    }
    const passwordHash = await bcrypt.hash(p, 10);
    users[key] = { username: u, passwordHash, createdAt: Date.now() };
    saveUsers();
    const token = signToken(u);
    bindUser(key, u);
    socket.emit('auth_result', { ok: true, mode: 'register', username: u, token });
    sendLogWebhook(`🆕 **Đăng ký**\nUser: \`${u}\`\nIP: \`${clientIp}\``);
  });

  // ---- LOGIN ----
  socket.on('auth_login', async ({ username: u, password: p }) => {
    u = (u || '').trim();
    p = (p || '').trim();
    const key = u.toLowerCase();
    const rec = users[key];
    if (!rec) {
      socket.emit('auth_result', { ok: false, mode: 'login', error: 'Tài khoản không tồn tại.' });
      return;
    }
    const match = await bcrypt.compare(p, rec.passwordHash);
    if (!match) {
      socket.emit('auth_result', { ok: false, mode: 'login', error: 'Sai mật khẩu.' });
      sendLogWebhook(`⚠️ **Login sai**\nUser: \`${u}\`\nIP: \`${clientIp}\``);
      return;
    }
    const token = signToken(rec.username);
    bindUser(key, rec.username);
    socket.emit('auth_result', { ok: true, mode: 'login', username: rec.username, token });
    sendLogWebhook(`🔓 **Đăng nhập**\nUser: \`${rec.username}\`\nIP: \`${clientIp}\``);
  });

  socket.on('auth_change_password', async ({ oldPassword, newPassword }) => {
    if (!username) return;
    const rec = users[username];
    if (!rec) return;
    const ok = await bcrypt.compare(oldPassword || '', rec.passwordHash);
    if (!ok) { socket.emit('log', '❌ Mật khẩu cũ không đúng.'); return; }
    if (!newPassword || newPassword.trim().length < 3) { socket.emit('log', '⚠️ Mật khẩu mới ≥3 ký tự.'); return; }
    rec.passwordHash = await bcrypt.hash(newPassword.trim(), 10);
    saveUsers();
    socket.emit('log', '✅ Đã đổi mật khẩu.');
  });

  socket.on('auth_logout', () => {
    if (username) untrackSocket(username, socket.id);
    username = null; displayName = null; adminUnlocked = false;
    socket.emit('auth_status', { authenticated: false });
  });

  function requireAuth() {
    if (!username) { socket.emit('log', '⚠️ Vui lòng đăng nhập.'); return false; }
    return true;
  }
  function requireAdmin() {
    if (!adminUnlocked && !isOwnerUser(username)) {
      socket.emit('log', '⛔ Bạn không có quyền.');
      return false;
    }
    return true;
  }

  // ===== ADMIN =====
  socket.on('admin_login', (pass) => {
    if (!isOwnerUser(username)) { socket.emit('admin_login_result', false); return; }
    if (OWNER_PASSWORD && pass === OWNER_PASSWORD) {
      adminUnlocked = true;
      socket.emit('admin_login_result', true);
      socket.emit('log', '👑 Đã mở khoá admin!');
      socket.emit('owner_summary', ownerSummary());
      socket.emit('registered_users', registeredUsersList());
    } else {
      socket.emit('admin_login_result', false);
    }
  });

  socket.on('admin_toggle_maintenance', ({ active, message, countdownMinutes }) => {
    if (!requireAdmin()) return;
    maintenance.active = !!active;
    if (typeof message === 'string' && message.trim()) maintenance.message = message.trim();
    if (maintenance.active && countdownMinutes > 0) {
      maintenance.countdownEnd = Date.now() + countdownMinutes * 60 * 1000;
    } else {
      maintenance.countdownEnd = null;
    }
    saveData();
    io.emit('maintenance_status', maintenance);
    sendLogWebhook(`🛠️ **BẢO TRÌ ${maintenance.active ? 'BẬT' : 'TẮT'}**\nMessage: \`${maintenance.message}\`\nCountdown: \`${countdownMinutes || 0} phút\``);
  });

  socket.on('admin_toggle_lockdown', (active) => {
    if (!requireAdmin()) return;
    maintenance.lockdown = !!active;
    saveData();
    io.emit('maintenance_status', maintenance);
    sendLogWebhook(`🔒 **Lockdown ${maintenance.lockdown ? 'BẬT' : 'TẮT'}**`);
  });

  socket.on('admin_toggle_freeze_proxy', (active) => {
    if (!requireAdmin()) return;
    maintenance.freezeProxy = !!active;
    saveData();
    io.emit('maintenance_status', maintenance);
    sendLogWebhook(`🧊 **Freeze Proxy ${maintenance.freezeProxy ? 'BẬT' : 'TẮT'}**`);
  });

  socket.on('admin_kick_all', () => {
    if (!requireAdmin()) return;
    let kicked = 0;
    socketsByUser.forEach((set, key) => {
      if (isOwnerUser(key)) return;
      set.forEach(id => {
        io.to(id).emit('force_logout', 'Server đang bảo trì, bạn đã bị đăng xuất.');
        const s = io.sockets.sockets.get(id);
        if (s) s.disconnect(true);
        kicked++;
      });
    });
    socket.emit('log', `👢 Đã kick ${kicked} phiên.`);
    sendLogWebhook(`👢 **KICK ALL** — Đã kick ${kicked} phiên`);
  });

  socket.on('admin_broadcast', (message) => {
    if (!requireAdmin()) return;
    message = (message || '').trim();
    if (!message) return;
    io.emit('announcement', { message, ts: Date.now() });
    sendLogWebhook(`📢 **Broadcast**: \`${message}\``);
  });

  socket.on('admin_kick_user', (targetUsername) => {
    if (!requireAdmin()) return;
    const key = (targetUsername || '').toLowerCase();
    const set = socketsByUser.get(key);
    if (set) {
      set.forEach(id => {
        io.to(id).emit('force_logout', 'Bạn đã bị admin đăng xuất.');
        const s = io.sockets.sockets.get(id);
        if (s) s.disconnect(true);
      });
      socket.emit('log', `👢 Đã kick ${targetUsername}`);
    }
  });

  socket.on('admin_get_user_accounts', (targetUsername) => {
    if (!requireAdmin()) return;
    const key = (targetUsername || '').toLowerCase();
    let foundKey = key;
    if (!clientData[foundKey]) {
      for (const k in clientData) {
        if (users[k] && users[k].username === targetUsername) { foundKey = k; break; }
      }
    }
    const bucket = clientData[foundKey];
    if (!bucket) {
      socket.emit('admin_user_accounts', { username: targetUsername, accounts: [] });
      return;
    }
    const accounts = (bucket.accounts || []).map(a => ({
      username: a.username,
      status: a.status || 'OFFLINE',
      proxy: a.proxy || null
    }));
    socket.emit('admin_user_accounts', { username: targetUsername, accounts });
  });

  // ---- WEBHOOK ----
  socket.on('set_webhook', (url) => {
    if (!requireAuth()) return;
    clientData[username].webhookUrl = (url || '').trim();
    saveData();
    socket.emit('webhook_url', clientData[username].webhookUrl);
    socket.emit('log', '🔗 Đã lưu webhook');
    sendLogWebhook(`🔗 **Webhook mới**\nUser: \`${username}\`\nURL: \`${url}\``);
  });
  socket.on('test_webhook', async () => {
    if (!requireAuth()) return;
    await sendUserWebhook(clientData[username].webhookUrl, `🔔 **Test Webhook**\n${new Date().toLocaleString()}`);
    socket.emit('log', '✅ Đã gửi test webhook!');
  });

  // ---- PROXY ----
  socket.on('add_proxy', (proxy) => {
    if (!requireAuth()) return;
    if (maintenance.freezeProxy && !isOwnerUser(username)) {
      socket.emit('log', '🧊 Proxy đang bị đóng băng bởi admin.');
      return;
    }
    proxy = (proxy || '').trim();
    if (!proxy) return;
    if (!proxyList.includes(proxy)) { proxyList.push(proxy); saveData(); }
    io.emit('proxy_list', proxyList);
    socket.emit('log', `🌐 Đã thêm proxy`);
    sendLogWebhook(`🌐 **Proxy mới**\nUser: \`${username}\`\nProxy: \`${proxy}\``);
  });
  socket.on('remove_proxy', (idx) => {
    if (!requireAuth()) return;
    if (idx >= 0 && idx < proxyList.length) { proxyList.splice(idx, 1); saveData(); }
    io.emit('proxy_list', proxyList);
  });
  socket.on('test_proxy', async (proxy) => {
    if (!requireAuth()) return;
    const result = await testProxy(proxy);
    socket.emit('proxy_test_result', { proxy, ...result });
  });
  socket.on('assign_proxy', ({ id, proxy }) => {
    if (!requireAuth()) return;
    const acc = (clientData[username].accounts || []).find(a => a.id === id);
    if (!acc) return;
    acc.proxy = proxy || null;
    saveData();
    socket.emit('init_accounts', publicAccounts(clientData[username].accounts));
  });

  // ---- ACCOUNT MC ----
  let lastAddAt = 0;
  socket.on('add_account', (data) => {
    if (!requireAuth()) return;
    const now = Date.now();
    if (now - lastAddAt < 2000) { socket.emit('log', '⏳ Đợi vài giây.'); return; }
    lastAddAt = now;
    const mcUsername = (data && data.username || '').trim();
    const mcPassword = (data && data.password || '').trim();
    if (!mcUsername) return;

    const id = 'acc_' + Date.now() + '_' + Math.floor(Math.random() * 999);
    clientData[username].accounts.push({
      id, username: mcUsername, password: mcPassword,
      autoReconnect: true, status: 'OFFLINE', proxy: null
    });
    saveData();
    socket.emit('init_accounts', publicAccounts(clientData[username].accounts));
    socket.emit('log', `➕ Đã thêm acc: ${mcUsername}`);
    sendLogWebhook(`➕ **Acc MC mới**\nUser: \`${username}\`\nMC: \`${mcUsername}\`\nIP: \`${clientIp}\``);
    if (isOwnerUser(username)) broadcastOwnerSummary();
  });

  socket.on('delete_account', (id) => {
    if (!requireAuth()) return;
    if (clientData[username].bots[id]) {
      try { clientData[username].bots[id].quit(); } catch (e) {}
      delete clientData[username].bots[id];
    }
    clientData[username].accounts = clientData[username].accounts.filter(acc => acc.id !== id);
    saveData();
    socket.emit('init_accounts', publicAccounts(clientData[username].accounts));
  });

  socket.on('toggle_auto_reconnect', (id) => {
    if (!requireAuth()) return;
    const acc = clientData[username].accounts.find(a => a.id === id);
    if (acc) { acc.autoReconnect = !acc.autoReconnect; saveData(); socket.emit('init_accounts', publicAccounts(clientData[username].accounts)); }
  });

  socket.on('get_accounts', () => { if (requireAuth()) socket.emit('init_accounts', publicAccounts(clientData[username].accounts)); });

  // ---- CHAT / PAY ----
  socket.on('send_chat', ({ id, cmd }) => {
    if (!requireAuth()) return;
    const bot = clientData[username].bots[id];
    if (bot) { bot.chat(cmd); socket.emit('log', `[💬 ĐÃ GỬI]: ${cmd}`); }
    else socket.emit('log', `[⚠️] Bot chưa online!`);
  });
  socket.on('send_pay', ({ id, target, amount }) => {
    if (!requireAuth()) return;
    const bot = clientData[username].bots[id];
    if (bot) { bot.chat(`/pay ${target} ${amount}`); socket.emit('log', `[💰 PAY]: ${target} - ${amount}`); }
    else socket.emit('log', `[⚠️] Bot chưa online!`);
  });

  // ===== START BOT =====
  function startBotForAccount(id) {
    const account = clientData[username].accounts.find(acc => acc.id === id);
    if (!account) return;
    if (!account.password) {
      socket.emit('log', `[${account.username}] ⚠️ Chưa có mật khẩu trong RAM. Nhập lại.`);
      socket.emit('need_password', { id, username: account.username });
      return;
    }
    if (maintenance.active && !isOwnerUser(username)) {
      socket.emit('log', `⚠️ Bảo trì: ${maintenance.message}`);
      return;
    }
    if (clientData[username].bots[id]) {
      try { clientData[username].bots[id].quit(); } catch (e) {}
      delete clientData[username].bots[id];
    }

    const log = (msg) => emitToUser(username, 'log', `[${account.username}] ${msg}`);
    const pushAccounts = () => emitToUser(username, 'init_accounts', publicAccounts(clientData[username].accounts));

    let hasJoinedKingSMP = false, hasExecutedAFK = false, isProcessing = false, reconnectAttempts = 0;
    const MAX_RECONNECT = 10;

    account.status = 'CONNECTING...';
    pushAccounts();
    log(`🔄 Kết nối ${SERVER_HOST}:${SERVER_PORT} (v${SERVER_VERSION})...`);

    try {
      const proxyUrl = getProxyFor(account);
      const proxyAgent = createProxyAgent(proxyUrl);
      if (proxyAgent && proxyUrl) log(`🌐 Dùng proxy`);
      else log(`🌐 Không dùng proxy`);

      const botOptions = {
        host: SERVER_HOST, port: SERVER_PORT, username: account.username, password: account.password,
        auth: 'offline', version: SERVER_VERSION, checkTimeoutInterval: 180000, connectTimeout: 60000,
        keepAlive: true, hideErrors: false, clientSideRendering: false, viewDistance: 'tiny'
      };
      if (proxyAgent) botOptions.agent = proxyAgent;

      const bot = mineflayer.createBot(botOptions);
      clientData[username].bots[id] = bot;

      bot.on('login', () => {
        reconnectAttempts = 0;
        account.status = 'LOGGING IN...';
        pushAccounts();
        setTimeout(() => { if (!hasJoinedKingSMP && bot) bot.chat(`/dn ${account.password}`); }, 5000);
        setTimeout(() => { if (!hasJoinedKingSMP && bot) bot.chat(`/dn ${account.password}`); }, 12000);
        setTimeout(() => { if (!hasJoinedKingSMP && bot) bot.chat('/menu'); }, 20000);
      });

      bot.on('spawn', () => {
        reconnectAttempts = 0;
        if (hasJoinedKingSMP) {
          account.status = 'ONLINE / KINGSMP';
          log(`✅ Đã vào KINGSMP!`);
          if (!hasExecutedAFK) setTimeout(() => { if (bot) bot.chat('/afk'); }, 4000);
        } else {
          account.status = 'ONLINE / LOBBY';
          log(`✅ Đã vào sảnh`);
        }
        pushAccounts();
        sendUserWebhook(clientData[username].webhookUrl, `✅ **Bot online**\nUser: \`${account.username}\``);
        if (isOwnerUser(username)) broadcastOwnerSummary();
      });

      bot.on('messagestr', (message) => {
        const msg = message.toLowerCase();
        emitToUser(username, 'chat_log', { username: account.username, message });

        if (msg.includes('địa chỉ ip') || msg.includes('ip chỉ được') || msg.includes('cùng lúc')) {
          log(`🚨 Giới hạn IP: ${message}`);
          emitToUser(username, 'ip_limit_error', { username: account.username, message });
        }
        if (msg.includes('số dư') || msg.includes('balance') || msg.includes('bal')) {
          const m = message.match(/(\d[\d,.]*)/);
          if (m) {
            log(`💰 Số dư: ${m[1]}`);
            sendUserWebhook(clientData[username].webhookUrl, `💰 **Số dư**\nBot: \`${account.username}\`\nSố dư: \`${m[1]}\``);
          }
        }
        if (!hasJoinedKingSMP && (msg.includes('bạn đã đăng nhập') || msg.includes('đăng nhập thành công'))) {
          log(`✅ Xác thực OK, mở menu...`);
          setTimeout(() => { if (bot && !hasJoinedKingSMP) bot.chat('/menu'); }, 5000);
        }
        if (!hasJoinedKingSMP && msg.includes('chào mừng') && msg.includes('kingsmp')) {
          hasJoinedKingSMP = true;
          account.status = 'ONLINE / KINGSMP';
          pushAccounts();
          log(`✅ ĐÃ VÀO KINGSMP!`);
          setTimeout(() => { if (bot && !hasExecutedAFK) { log(`💤 /afk`); bot.chat('/afk'); } }, 3000);
        }
      });

      bot.on('windowOpen', (window) => {
        const title = JSON.stringify(window.title || '').toLowerCase();
        log(`📂 Menu: ${title}`);
        if (!hasJoinedKingSMP && (title.includes('menu') || title.includes('sảnh') || title.includes('lobby'))) {
          if (isProcessing) return;
          isProcessing = true;
          setTimeout(() => {
            if (!bot || !bot.currentWindow) { isProcessing = false; return; }
            let slot = -1;
            for (let i = 0; i < bot.inventory.slots.length; i++) {
              const item = bot.inventory.slots[i];
              if (item && (item.displayName || item.name || '').toLowerCase().includes('kingsmp')) { slot = i; break; }
            }
            if (slot === -1) { log(`⚠️ Không thấy KingSMP, thử slot 24`); slot = 24; }
            hasJoinedKingSMP = true;
            log(`🖱️ Click slot ${slot + 1}`);
            bot.clickWindow(slot, 0, 0).catch(() => {});
            setTimeout(() => { try { bot.closeWindow(window); } catch (e) {} isProcessing = false; }, 500);
          }, 1500);
        }
        if (hasJoinedKingSMP && !hasExecutedAFK && (title.includes('afk') || title.includes('chọn khu'))) {
          if (isProcessing) return;
          isProcessing = true;
          setTimeout(() => {
            if (!bot || !bot.currentWindow) { isProcessing = false; return; }
            let slot = -1;
            for (let i = 0; i < bot.inventory.slots.length; i++) {
              const item = bot.inventory.slots[i];
              if (item && (item.displayName || item.name || '').toLowerCase().includes('1')) { slot = i; break; }
            }
            if (slot === -1) slot = 0;
            hasExecutedAFK = true;
            log(`🖱️ Click slot ${slot + 1} vào AFK`);
            bot.clickWindow(slot, 0, 0).catch(() => {});
            setTimeout(() => { try { bot.closeWindow(window); } catch (e) {} isProcessing = false; }, 500);
          }, 2000);
        }
      });

      bot.on('end', (reason) => {
        log(`⚠️ Mất kết nối: ${reason || 'unknown'}`);
        account.status = 'OFFLINE';
        pushAccounts();
        delete clientData[username].bots[id];
        if (isOwnerUser(username)) broadcastOwnerSummary();

        if (account.autoReconnect && reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          const delay = Math.min(5000 * reconnectAttempts, 30000);
          log(`🔄 Reconnect ${reconnectAttempts}/${MAX_RECONNECT} sau ${delay / 1000}s`);
          setTimeout(() => { if (!clientData[username].bots[id] && account.autoReconnect) startBotForAccount(id); }, delay);
        } else if (reconnectAttempts >= MAX_RECONNECT) {
          log(`❌ Đã thử ${MAX_RECONNECT} lần, dừng.`);
          account.status = 'FAILED';
          pushAccounts();
        }
      });

      bot.on('error', (err) => {
        if (err.code === 'ETIMEDOUT') log(`⏰ Timeout`);
        else if (err.code === 'ECONNREFUSED') log(`🚫 Server từ chối`);
        else log(`❌ Lỗi: ${err.message}`);
      });
      bot.on('kicked', (reason) => log(`👢 Bị kick: ${JSON.stringify(reason)}`));

    } catch (e) {
      log(`❌ Lỗi: ${e.message}`);
      account.status = 'ERROR';
      pushAccounts();
    }
  }

  socket.on('start_bot', (id) => { if (requireAuth()) startBotForAccount(id); });

  socket.on('set_account_password', ({ id, password }) => {
    if (!requireAuth()) return;
    const acc = clientData[username].accounts.find(a => a.id === id);
    if (acc) {
      acc.password = (password || '').trim();
      socket.emit('log', `🔑 Đã cập nhật mật khẩu cho ${acc.username} (RAM only)`);
    }
  });

  socket.on('stop_bot', (id) => {
    if (!requireAuth()) return;
    const account = clientData[username].accounts.find(a => a.id === id);
    if (account) { account.status = 'STOPPING...'; socket.emit('init_accounts', publicAccounts(clientData[username].accounts)); }
    if (clientData[username].bots[id]) {
      try { clientData[username].bots[id].quit(); } catch (e) {}
      delete clientData[username].bots[id];
    }
    if (account) {
      setTimeout(() => {
        if (!clientData[username].bots[id]) {
          account.status = 'OFFLINE';
          emitToUser(username, 'init_accounts', publicAccounts(clientData[username].accounts));
        }
      }, 1000);
    }
    saveData();
  });

  socket.on('disconnect', () => {
    if (username) untrackSocket(username, socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
  if (OWNER_USERNAME) console.log(`👑 Owner: ${OWNER_USERNAME}`);
});
