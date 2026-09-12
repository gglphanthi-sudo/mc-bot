const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ===== CẤU HÌNH OWNER (đọc từ biến môi trường, KHÔNG hardcode trong code) =====
// Đặt các giá trị này trong file .env hoặc biến môi trường của hệ thống trước khi chạy:
//   OWNER_IP=xxx.xxx.xxx.xxx
//   OWNER_PASSWORD=mat_khau_manh_cua_ban
//   LOG_WEBHOOK=https://discord.com/api/webhooks/...
const OWNER_IP = process.env.OWNER_IP || '';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || '';
const LOG_WEBHOOK = process.env.LOG_WEBHOOK || '';

// ===== CẤU HÌNH SERVER MINECRAFT =====
const SERVER_HOST = process.env.MC_HOST || 'kingmc.vn';
const SERVER_PORT = parseInt(process.env.MC_PORT || '25565', 10);
const SERVER_VERSION = process.env.MC_VERSION || '1.20.1';

// ===== DỮ LIỆU TOÀN CỤC =====
// LƯU Ý QUAN TRỌNG VỀ QUYỀN RIÊNG TƯ:
// Mật khẩu tài khoản Minecraft của người dùng CHỈ được giữ trong bộ nhớ (RAM)
// để bot có thể tự đăng nhập (/dn, /login...). Mật khẩu KHÔNG BAO GIỜ được:
//   - ghi vào file data.json
//   - gửi qua webhook Discord
//   - hiển thị cho bất kỳ ai khác ngoài chính chủ tài khoản (kể cả owner)
// Nếu bạn cần đổi hành vi này, hãy cân nhắc rủi ro bảo mật cho người dùng cuối.
let clientData = {};        // { ip: { accounts: [...], bots: {} } }
let isMaintenance = false;
let ownerSocketId = null;
let proxyList = [];
let webhookUrl = '';

// ===== ĐỌC / LƯU (không bao giờ lưu password xuống đĩa) =====
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) { console.log('⚠️ Lỗi đọc data, tạo mới'); }
  return { clientData: {}, isMaintenance: false, proxyList: [], webhookUrl: '' };
}

function stripPasswordsForSave(clientDataObj) {
  // Tạo bản sao để lưu xuống đĩa, KHÔNG chứa password và KHÔNG chứa các bot instance (không serialize được)
  const out = {};
  for (const ip in clientDataObj) {
    out[ip] = {
      accounts: (clientDataObj[ip].accounts || []).map(acc => ({
        id: acc.id,
        username: acc.username,
        autoReconnect: acc.autoReconnect,
        status: 'OFFLINE', // khi khởi động lại, mọi bot coi như offline cho tới khi user bấm start
        proxy: acc.proxy || null
      }))
    };
  }
  return out;
}

const saved = loadData();
// Khi load lại, không có password (vì chưa từng lưu) -> gán rỗng, user cần nhập lại khi bấm "Login lại"
clientData = saved.clientData || {};
for (const ip in clientData) {
  clientData[ip].bots = {};
  (clientData[ip].accounts || []).forEach(acc => { if (!acc.password) acc.password = ''; });
}
isMaintenance = saved.isMaintenance || false;
proxyList = saved.proxyList || [];
webhookUrl = saved.webhookUrl || '';

let saveTimer = null;
function saveData() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        clientData: stripPasswordsForSave(clientData),
        isMaintenance, proxyList, webhookUrl
      }, null, 2));
    } catch (e) {
      console.log('❌ Lỗi lưu data:', e.message);
    }
  }, 300);
}

// Dữ liệu gửi ra client KHÔNG bao giờ chứa password
function publicAccount(acc) {
  return {
    id: acc.id,
    username: acc.username,
    autoReconnect: acc.autoReconnect,
    status: acc.status,
    proxy: acc.proxy || null
  };
}
function publicAccounts(list) { return (list || []).map(publicAccount); }

// ===== GỬI WEBHOOK (chỉ log sự kiện trạng thái, không log mật khẩu) =====
async function sendLogWebhook(content) {
  if (!LOG_WEBHOOK) return;
  try {
    await axios.post(LOG_WEBHOOK, {
      content, username: 'KingMC Logger', avatar_url: 'https://i.imgur.com/4M34hi2.png'
    });
  } catch (e) { console.log('❌ Lỗi gửi log webhook:', e.message); }
}

async function sendUserWebhook(content) {
  if (!webhookUrl) return;
  try {
    await axios.post(webhookUrl, {
      content, username: 'KingMC AFK Bot', avatar_url: 'https://i.imgur.com/4M34hi2.png'
    });
  } catch (e) { console.log('❌ Lỗi gửi user webhook:', e.message); }
}

// ===== PROXY HELPER =====
function getProxyFor(account) {
  // Nếu account đã có proxy cố định (do user chọn), ưu tiên dùng
  if (account.proxy && proxyList.includes(account.proxy)) return account.proxy;
  if (!proxyList.length) return null;
  return proxyList[Math.floor(Math.random() * proxyList.length)];
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
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

app.use(express.static(path.join(__dirname, 'public')));

process.on('uncaughtException', (e) => console.log('[LỖI HỆ THỐNG]', e.message));
process.on('unhandledRejection', (r) => console.log('[LỖI PROMISE]', r && r.message ? r.message : r));

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  let rawIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
  if (rawIp === '::1') rawIp = '127.0.0.1';
  const clientIp = rawIp;
  console.log(`[${new Date().toLocaleString()}] 🔌 Client: ${clientIp}`);

  const isOwner = !!OWNER_IP && (clientIp === OWNER_IP || clientIp === '127.0.0.1');

  if (!clientData[clientIp]) {
    clientData[clientIp] = { accounts: [], bots: {} };
    saveData();
  }

  socket.emit('is_admin', isOwner);
  socket.emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
  socket.emit('proxy_list', proxyList);
  socket.emit('webhook_url', webhookUrl);
  socket.emit('maintenance_status', isMaintenance);

  if (isOwner) {
    ownerSocketId = socket.id;
    // Owner chỉ thấy TỔNG SỐ acc theo từng IP, KHÔNG thấy username/password của người khác
    const summary = Object.keys(clientData).map(ip => ({
      ip,
      accountCount: (clientData[ip].accounts || []).length,
      onlineCount: (clientData[ip].accounts || []).filter(a => (a.status || '').includes('ONLINE')).length
    }));
    socket.emit('owner_summary', summary);
    console.log(`👑 Owner đã kết nối: ${clientIp}`);
  }

  // ---- LOGIN ADMIN ----
  socket.on('login', (pass) => {
    if (!isOwner) { socket.emit('login_success', false); return; }
    if (OWNER_PASSWORD && pass === OWNER_PASSWORD) {
      socket.emit('login_success', true);
      socket.emit('log', '👑 Chào mừng!');
      sendLogWebhook(`👑 **Owner đăng nhập**\nIP: \`${clientIp}\``);
    } else {
      socket.emit('login_success', false);
    }
  });

  // ---- WEBHOOK CỦA USER ----
  socket.on('set_webhook', (url) => {
    webhookUrl = (url || '').trim();
    saveData();
    socket.emit('webhook_url', webhookUrl);
    socket.emit('log', `🔗 Đã lưu webhook`);
  });

  socket.on('test_webhook', async () => {
    await sendUserWebhook(`🔔 **Test Webhook**\n${new Date().toLocaleString()}`);
    socket.emit('log', '✅ Đã gửi test webhook!');
  });

  // ---- BẢO TRÌ ----
  socket.on('toggle_maintenance', (status) => {
    if (!isOwner) return;
    isMaintenance = !!status;
    saveData();
    io.emit('maintenance_status', isMaintenance);
  });

  // ---- PROXY ----
  socket.on('add_proxy', async (proxy) => {
    proxy = (proxy || '').trim();
    if (!proxy) return;
    if (!proxyList.includes(proxy)) {
      proxyList.push(proxy);
      saveData();
    }
    io.emit('proxy_list', proxyList);
    socket.emit('log', `🌐 Đã thêm proxy: ${proxy}`);
  });

  socket.on('remove_proxy', (idx) => {
    if (idx >= 0 && idx < proxyList.length) { proxyList.splice(idx, 1); saveData(); }
    io.emit('proxy_list', proxyList);
  });

  socket.on('get_proxy_list', () => socket.emit('proxy_list', proxyList));

  socket.on('test_proxy', async (proxy) => {
    const result = await testProxy(proxy);
    socket.emit('proxy_test_result', { proxy, ...result });
    if (result.ok) socket.emit('log', `✅ Proxy OK, IP ra ngoài: ${result.ip}`);
    else socket.emit('log', `❌ Proxy lỗi: ${result.error}`);
  });

  socket.on('assign_proxy', ({ id, proxy }) => {
    const acc = (clientData[clientIp].accounts || []).find(a => a.id === id);
    if (!acc) return;
    acc.proxy = proxy || null;
    saveData();
    io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
  });

  // ---- ACCOUNT ----
  // Mật khẩu chỉ giữ trong RAM cho phiên này, không log, không lưu file, không gửi cho owner.
  socket.on('add_account', (data) => {
    const username = (data && data.username || '').trim();
    const password = (data && data.password || '').trim();
    if (!username) return;

    const id = 'acc_' + Date.now() + '_' + Math.floor(Math.random() * 999);
    clientData[clientIp].accounts.push({
      id,
      username,
      password, // chỉ trong bộ nhớ
      autoReconnect: true,
      status: 'OFFLINE',
      proxy: null
    });
    saveData();
    io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
    socket.emit('log', `➕ Đã thêm acc: ${username}`);
  });

  socket.on('delete_account', (id) => {
    if (clientData[clientIp].bots[id]) {
      try { clientData[clientIp].bots[id].quit(); } catch (e) {}
      delete clientData[clientIp].bots[id];
    }
    clientData[clientIp].accounts = clientData[clientIp].accounts.filter(acc => acc.id !== id);
    saveData();
    io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
  });

  socket.on('toggle_auto_reconnect', (id) => {
    const acc = clientData[clientIp].accounts.find(a => a.id === id);
    if (acc) {
      acc.autoReconnect = !acc.autoReconnect;
      saveData();
      io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
    }
  });

  socket.on('get_accounts', () => socket.emit('init_accounts', publicAccounts(clientData[clientIp].accounts)));

  // ---- CHAT ----
  socket.on('send_chat', ({ id, cmd }) => {
    const bot = clientData[clientIp].bots[id];
    if (bot) {
      bot.chat(cmd);
      socket.emit('log', `[💬 ĐÃ GỬI]: ${cmd}`);
    } else {
      socket.emit('log', `[⚠️] Bot chưa online!`);
    }
  });

  // ---- PAY ----
  socket.on('send_pay', ({ id, target, amount }) => {
    const bot = clientData[clientIp].bots[id];
    if (bot) {
      bot.chat(`/pay ${target} ${amount}`);
      socket.emit('log', `[💰 PAY]: ${target} - ${amount}`);
    } else {
      socket.emit('log', `[⚠️] Bot chưa online!`);
    }
  });

  // ===== START BOT =====
  function startBotForAccount(id) {
    const account = clientData[clientIp].accounts.find(acc => acc.id === id);
    if (!account) return;
    if (!account.password) {
      socket.emit('log', `[${account.username}] ⚠️ Chưa có mật khẩu trong phiên này. Bấm "Login lại" và nhập lại mật khẩu.`);
      socket.emit('need_password', { id, username: account.username });
      return;
    }
    if (isMaintenance && !isOwner) {
      socket.emit('log', `⚠️ Hệ thống đang bảo trì, vui lòng thử lại sau.`);
      return;
    }

    if (clientData[clientIp].bots[id]) {
      try { clientData[clientIp].bots[id].quit(); } catch (e) {}
      delete clientData[clientIp].bots[id];
    }

    const log = (msg) => socket.emit('log', `[${account.username}] ${msg}`);

    let hasJoinedKingSMP = false;
    let hasExecutedAFK = false;
    let isProcessing = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 10;

    account.status = 'CONNECTING...';
    io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
    log(`🔄 Kết nối tới ${SERVER_HOST}:${SERVER_PORT} (v${SERVER_VERSION})...`);

    try {
      const proxyUrl = getProxyFor(account);
      const proxyAgent = createProxyAgent(proxyUrl);
      if (proxyAgent && proxyUrl) { log(`🌐 Dùng proxy: ${proxyUrl}`); account.proxy = proxyUrl; }
      else { log(`🌐 Không dùng proxy`); }

      const botOptions = {
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: account.username,
        password: account.password,
        auth: 'offline',
        version: SERVER_VERSION,
        checkTimeoutInterval: 180000,
        connectTimeout: 60000,
        keepAlive: true,
        hideErrors: false,
        clientSideRendering: false,
        viewDistance: 'tiny'
      };
      if (proxyAgent) botOptions.agent = proxyAgent;

      const bot = mineflayer.createBot(botOptions);
      clientData[clientIp].bots[id] = bot;

      bot.on('login', () => {
        reconnectAttempts = 0;
        account.status = 'LOGGING IN...';
        io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
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
          log(`✅ Đã vào sảnh chính`);
        }
        io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
        sendUserWebhook(`✅ **Bot online**\nUser: \`${account.username}\``);
      });

      bot.on('messagestr', (message) => {
        const msg = message.toLowerCase();
        socket.emit('chat_log', { username: account.username, message });

        if (msg.includes('địa chỉ ip') || msg.includes('ip chỉ được') || msg.includes('cùng lúc') ||
            msg.includes('ip limit') || msg.includes('too many')) {
          log(`🚨 LỖI IP: Server đã chặn/giới hạn IP này!`);
          log(`💡 Gợi ý: Thêm proxy ở tab Proxy rồi gán proxy cho acc này.`);
          socket.emit('ip_limit_error', { username: account.username, message });
        }

        if (msg.includes('số dư') || msg.includes('balance')) {
          const balanceMatch = message.match(/(\d[\d,.]*)/);
          if (balanceMatch) {
            log(`💰 Số dư: ${balanceMatch[1]}`);
            sendUserWebhook(`💰 **Số dư**\nBot: \`${account.username}\`\nSố dư: \`${balanceMatch[1]}\``);
          }
        }

        if (!hasJoinedKingSMP && (msg.includes('bạn đã đăng nhập') || msg.includes('đăng nhập thành công'))) {
          log(`✅ Xác thực thành công, mở menu...`);
          setTimeout(() => { if (bot && !hasJoinedKingSMP) bot.chat('/menu'); }, 5000);
        }
        if (!hasJoinedKingSMP && msg.includes('chào mừng') && msg.includes('kingsmp')) {
          hasJoinedKingSMP = true;
          account.status = 'ONLINE / KINGSMP';
          io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
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
              if (item) {
                const name = (item.displayName || item.name || '').toLowerCase();
                if (name.includes('kingsmp')) { slot = i; break; }
              }
            }
            if (slot === -1) { log(`⚠️ Không thấy KingSMP, thử slot 24`); slot = 24; }
            hasJoinedKingSMP = true;
            log(`🖱️ Click slot ${slot + 1} chọn KingSMP`);
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
              if (item) {
                const name = (item.displayName || item.name || '').toLowerCase();
                if (name.includes('1')) { slot = i; break; }
              }
            }
            if (slot === -1) slot = 0;
            hasExecutedAFK = true;
            log(`🖱️ Click slot ${slot + 1} vào AFK`);
            bot.clickWindow(slot, 0, 0).catch(() => {});
            setTimeout(() => { try { bot.closeWindow(window); } catch (e) {} isProcessing = false; }, 500);
          }, 2000);
        }
      });

      // ===== FIX LỖI RECONNECT (bug gốc: emit('start_bot') gọi lại chính event handler
      // trên socket của client thay vì gọi thẳng hàm -> có thể không chạy nếu client mất kết nối,
      // và không cần vòng qua network layer trong cùng 1 process) =====
      bot.on('end', (reason) => {
        log(`⚠️ Mất kết nối: ${reason || 'unknown'}`);
        account.status = 'OFFLINE';
        io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
        delete clientData[clientIp].bots[id];

        if (account.autoReconnect && reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          const delay = Math.min(5000 * reconnectAttempts, 30000);
          log(`🔄 Reconnect lần ${reconnectAttempts}/${MAX_RECONNECT} sau ${delay / 1000}s`);
          setTimeout(() => {
            if (!clientData[clientIp].bots[id] && account.autoReconnect) startBotForAccount(id);
          }, delay);
        } else if (reconnectAttempts >= MAX_RECONNECT) {
          log(`❌ Đã thử ${MAX_RECONNECT} lần, dừng. Bấm "Login lại" để thử lại thủ công.`);
          account.status = 'FAILED';
          io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
        }
      });

      bot.on('error', (err) => {
        if (err.code === 'ETIMEDOUT') log(`⏰ Timeout`);
        else if (err.code === 'ECONNREFUSED') log(`🚫 Server từ chối kết nối`);
        else log(`❌ Lỗi: ${err.message}`);
      });

      bot.on('kicked', (reason) => {
        log(`👢 Bị kick: ${JSON.stringify(reason)}`);
      });

    } catch (e) {
      log(`❌ Lỗi khởi tạo: ${e.message}`);
      account.status = 'ERROR';
      io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
    }
  }

  socket.on('start_bot', (id) => startBotForAccount(id));

  // Nhập lại mật khẩu khi restart server / mất phiên (KHÔNG lưu xuống đĩa)
  socket.on('set_account_password', ({ id, password }) => {
    const acc = clientData[clientIp].accounts.find(a => a.id === id);
    if (acc) {
      acc.password = (password || '').trim();
      socket.emit('log', `🔑 Đã cập nhật mật khẩu cho ${acc.username} (chỉ lưu tạm trong phiên này)`);
    }
  });

  socket.on('stop_bot', (id) => {
    const account = clientData[clientIp].accounts.find(a => a.id === id);
    if (account) { account.status = 'STOPPING...'; io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts)); }
    if (clientData[clientIp].bots[id]) {
      try { clientData[clientIp].bots[id].quit(); } catch (e) {}
      delete clientData[clientIp].bots[id];
    }
    if (account) {
      setTimeout(() => {
        if (!clientData[clientIp].bots[id]) {
          account.status = 'OFFLINE';
          io.to(socket.id).emit('init_accounts', publicAccounts(clientData[clientIp].accounts));
        }
      }, 1000);
    }
    saveData();
  });

  socket.on('disconnect', () => {
    console.log(`[${new Date().toLocaleString()}] 🔌 Client rời: ${clientIp}`);
    if (isOwner) ownerSocketId = null;
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
  if (OWNER_IP) console.log(`👑 Owner IP: ${OWNER_IP}`);
  else console.log(`ℹ️ Chưa cấu hình OWNER_IP — đặt biến môi trường để bật quyền admin.`);
});
