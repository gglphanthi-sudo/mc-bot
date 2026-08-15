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

// TÀI KHOẢN & MẬT KHẨU TRANG PANEL (Thay đổi tại đây)
const ADMIN_ACCOUNT = {
  user: 'admin',
  pass: '123456'
};

const activeBots = {};

io.on('connection', (socket) => {
  // Xử lý đăng nhập Web Panel
  socket.on('loginPanel', (data) => {
    if (data.user === ADMIN_ACCOUNT.user && data.pass === ADMIN_ACCOUNT.pass) {
      socket.emit('loginResult', { success: true, msg: 'Đăng nhập thành công!' });
    } else {
      socket.emit('loginResult', { success: false, msg: 'Tài khoản hoặc mật khẩu Panel không chính xác!' });
    }
  });

  // Lệnh bật Bot từ Web
  socket.on('startBot', (data) => {
    const { username, password } = data;
    if (activeBots[username]) {
      socket.emit('log', { bot: username, msg: `Bot ${username} đang hoạt động hoặc đang kết nối!` });
      return;
    }
    createBot(username, password, socket);
  });

  // Lệnh tắt Bot từ Web
  socket.on('stopBot', (username) => {
    if (activeBots[username]) {
      activeBots[username].end();
      delete activeBots[username];
      socket.emit('log', { bot: username, msg: `Đã ngắt kết nối bot ${username}.` });
    }
  });

  // Gửi chat hoặc lệnh từ Web Panel
  socket.on('sendChat', (msg) => {
    Object.keys(activeBots).forEach((botName) => {
      if (activeBots[botName]) {
        activeBots[botName].chat(msg);
      }
    });
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
