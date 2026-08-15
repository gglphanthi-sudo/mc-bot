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

// Database lưu tài khoản Panel
const usersDatabase = {
  'admin': '123456'
};

const activeBots = {}; // Lưu instance của bot đang chạy
const botInfo = {}; // Lưu thông tin mật khẩu & trạng thái tự động kết nối lại
const authenticatedSockets = new Set();

io.on('connection', (socket) => {

  // Xử lý Đăng Ký Panel
  socket.on('registerPanel', (data) => {
    const { user, pass } = data;
    if (!user || !pass) {
      return socket.emit('registerResult', { success: false, msg: 'Tài khoản và mật khẩu không được trống!' });
    }
    if (usersDatabase[user]) {
      return socket.emit('registerResult', { success: false, msg: 'Tài khoản này đã tồn tại!' });
    }

    usersDatabase[user] = pass;
    socket.emit('registerResult', { success: true, msg: 'Đăng ký thành công! Hãy đăng nhập ngay.' });
  });

  // Xử lý Đăng Nhập Panel
  socket.on('loginPanel', (data) => {
    const { user, pass } = data;
    if (usersDatabase[user] && usersDatabase[user] === pass) {
      authenticatedSockets.add(socket.id);
      socket.emit('loginResult', { success: true, msg: 'Đăng nhập thành công!' });
    } else {
      socket.emit('loginResult', { success: false, msg: 'Tài khoản hoặc mật khẩu không chính xác!' });
    }
  });

  const checkAuth = () => authenticatedSockets.has(socket.id);

  // Lệnh Bật Bot
  socket.on('startBot', (data) => {
    if (!checkAuth()) return socket.emit('log', { msg: '[BẢO MẬT] Bạn cần đăng nhập để thao tác!' });
    const { username, password } = data;

    // Lưu thông tin để phục vụ Auto Reconnect
    botInfo[username] = { password, autoReconnect: true };

    if (activeBots[username]) {
      socket.emit('log', { bot: username, msg: `Bot ${username} đang hoạt động hoặc đang kết nối!` });
      return;
    }

    createBot(username, password, socket);
  });

  // Lệnh Tắt Bot
  socket.on('stopBot', (username) => {
    if (!checkAuth()) return socket.emit('log', { msg: '[BẢO MẬT] Bạn cần đăng nhập để thao tác!' });
    
    // Tắt tính năng tự động kết nối lại khi chủ động dừng Bot
    if (botInfo[username]) {
      botInfo[username].autoReconnect = false;
    }

    if (activeBots[username]) {
      activeBots[username].end();
      delete activeBots[username];
      socket.emit('log', { bot: username, msg: `[STOP] Đã chủ động ngắt kết nối bot ${username}.` });
    }
  });

  // Gửi Chat cho tất cả Bot
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

    // Xử lý Auto Reconnect nếu không phải do chủ động tắt
    if (botInfo[username] && botInfo[username].autoReconnect) {
      socket.emit('log', { bot: username, msg: `[AUTO-RECONNECT] Sẽ thử kết nối lại sau 10 giây...` });
      setTimeout(() => {
        if (botInfo[username] && botInfo[username].autoReconnect && !activeBots[username]) {
          createBot(username, botInfo[username].password, socket);
        }
      }, 10000);
    }
  });

  bot.on('error', (err) => {
    socket.emit('log', { bot: username, msg: `[X ${username}] Lỗi Bot: ${err.message}` });
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
