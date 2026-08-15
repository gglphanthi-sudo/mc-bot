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

// Danh sách tài khoản hệ thống (Mặc định có tài khoản admin)
const systemUsers = {
  'admin': '123456'
};

const activeBots = {};
const authenticatedSockets = new Set();

io.on('connection', (socket) => {
  // Xử lý Đăng Ký
  socket.on('registerPanel', (data) => {
    const { user, pass } = data;
    if (!user || !pass) {
      return socket.emit('authResult', { success: false, msg: 'Tài khoản và mật khẩu không được trống!' });
    }
    if (systemUsers[user]) {
      return socket.emit('authResult', { success: false, msg: 'Tài khoản này đã tồn tại!' });
    }
    
    // Lưu tài khoản mới
    systemUsers[user] = pass;
    authenticatedSockets.add(socket.id);
    socket.emit('authResult', { success: true, action: 'register', msg: 'Đăng ký thành công! Đã tự động đăng nhập.' });
  });

  // Xử lý Đăng Nhập
  socket.on('loginPanel', (data) => {
    const { user, pass } = data;
    if (systemUsers[user] && systemUsers[user] === pass) {
      authenticatedSockets.add(socket.id);
      socket.emit('authResult', { success: true, action: 'login', msg: 'Đăng nhập thành công!' });
    } else {
      socket.emit('authResult', { success: false, msg: 'Tài khoản hoặc mật khẩu không chính xác!' });
    }
  });

  const checkAuth = () => authenticatedSockets.has(socket.id);

  // Lệnh bật Bot
  socket.on('startBot', (data) => {
    if (!checkAuth()) return socket.emit('log', { msg: '[BẢO MẬT] Bạn cần đăng nhập để thao tác!' });
    const { username, password } = data;
    if (activeBots[username]) {
      socket.emit('log', { bot: username, msg: `Bot ${username} đang hoạt động hoặc đang kết nối!` });
      return;
    }
    createBot(username, password, socket);
  });

  // Lệnh tắt Bot
  socket.on('stopBot', (username) => {
    if (!checkAuth()) return socket.emit('log', { msg: '[BẢO MẬT] Bạn cần đăng nhập để thao tác!' });
    if (activeBots[username]) {
      activeBots[username].end();
      delete activeBots[username];
      socket.emit('log', { bot: username, msg: `Đã ngắt kết nối bot ${username}.` });
    }
  });

  // Gửi chat / lệnh
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
