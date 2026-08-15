const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================= BẢO MẬT & TÀI KHOẢN =================
const ADMIN_ACCOUNT = {
  user: 'admin',      // Tài khoản đăng nhập web
  pass: '123456'      // Mật khẩu đăng nhập web
};

// Cấu hình chặn IP (Nếu bật true thì chỉ các IP trong list mới truy cập/điều khiển được)
const RESTRICT_IP = false; // Đổi thành true nếu bạn muốn bật tính năng lọc IP
const ALLOWED_IPS = [
  '127.0.0.1',
  '::1'
  // Thêm IP của bạn vào đây nếu muốn chặn các IP khác, ví dụ: '113.161.x.x'
];
// =========================================================

const activeBots = {};
const authenticatedSockets = new Set();

io.use((socket, next) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  if (RESTRICT_IP) {
    const isAllowed = ALLOWED_IPS.some(ip => clientIp.includes(ip));
    if (!isAllowed) {
      return next(new Error('IP_BLOCKED'));
    }
  }
  next();
});

io.on('connection', (socket) => {
  // Xử lý Đăng Nhập
  socket.on('loginPanel', (data) => {
    if (data.user === ADMIN_ACCOUNT.user && data.pass === ADMIN_ACCOUNT.pass) {
      authenticatedSockets.add(socket.id);
      socket.emit('loginResult', { success: true, msg: 'Đăng nhập thành công!' });
    } else {
      socket.emit('loginResult', { success: false, msg: 'Tài khoản hoặc mật khẩu không chính xác!' });
    }
  });

  // Kiểm tra xác thực trước khi thực hiện các tác vụ
  const checkAuth = () => authenticatedSockets.has(socket.id);

  // Lệnh bật Bot từ Web
  socket.on('startBot', (data) => {
    if (!checkAuth()) return socket.emit('log', { msg: '[BẢO MẬT] Bạn cần đăng nhập để thao tác!' });
    const { username, password } = data;
    if (activeBots[username]) {
      socket.emit('log', { bot: username, msg: `Bot ${username} đang hoạt động hoặc đang kết nối!` });
      return;
    }
    createBot(username, password, socket);
  });

  // Lệnh tắt Bot từ Web
  socket.on('stopBot', (username) => {
    if (!checkAuth()) return socket.emit('log', { msg: '[BẢO MẬT] Bạn cần đăng nhập để thao tác!' });
    if (activeBots[username]) {
      activeBots[username].end();
      delete activeBots[username];
      socket.emit('log', { bot: username, msg: `Đã ngắt kết nối bot ${username}.` });
    }
  });

  // Gửi chat hoặc lệnh từ Web Panel
  socket.on('sendChat', (msg) => {
    if (!checkAuth()) return socket.emit('log', { msg: '[BẢO MẬT] Bạn cần đăng nhập để thao tác!' });
    Object.keys(activeBots).forEach((botName) => {
      if (activeBots[botName]) {
        activeBots[botName].chat(msg);
      }
    });
  });

  socket.on('disconnect', () => {
    authenticatedSockets.delete(socket.id);
  });
});

function createBot(username, password, socket) {
  socket.emit('log', { bot: username, msg: `[BOT ${username}] Đang kết nối tới kingmc.vn...` });

  const bot = mineflayer.createBot({
    host: 'kingmc.vn',
    port: 25565,
    username: username,
    version: '1.20.1',
    checkTimeoutInterval: 60 * 1000,
  });

  activeBots[username] = bot;

  bot.on('spawn', () => {
    socket.emit('log', { bot: username, msg: `[✓ ${username}] Đã xuất hiện ở Sảnh!` });
    
    setTimeout(() => {
      if (password) {
        bot.chat(`/dn ${password}`);
        socket.emit('log', { bot: username, msg: `[SYSTEM ${username}] Đã gửi lệnh đăng nhập game!` });
      }
    }, 3000);

    setTimeout(() => {
      bot.chat('/menu');
      socket.emit('log', { bot: username, msg: `[SYSTEM ${username}] Đã gõ /menu!` });
    }, 12000);
  });

  bot.on('message', (message) => {
    const text = message.toAnsi();
    socket.emit('log', { bot: username, msg: `[SERVER -> ${username}]: ${text}` });
  });

  bot.on('end', (reason) => {
    socket.emit('log', { bot: username, msg: `[! ${username}] Ngắt kết nối: ${reason}` });
    delete activeBots[username];
  });

  bot.on('error', (err) => {
    socket.emit('log', { bot: username, msg: `[X ${username}] Lỗi Bot: ${err.message}` });
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
