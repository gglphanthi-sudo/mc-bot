const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = path = require('path');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cơ sở dữ liệu lưu tài khoản
const usersDatabase = {
  'admin': { pass: '676767', role: 'admin', active: true }
};

const activeBots = {};
const botInfo = {};
const userSessions = {};

io.on('connection', (socket) => {

  // Xử lý Đăng Ký
  socket.on('registerPanel', (data) => {
    const { user, pass, confirmPass } = data;

    if (!user || !pass || !confirmPass) {
      return socket.emit('registerResult', { success: false, msg: 'Vui lòng điền đầy đủ thông tin!' });
    }
    if (pass !== confirmPass) {
      return socket.emit('registerResult', { success: false, msg: 'Mật khẩu xác nhận không trùng khớp!' });
    }
    if (usersDatabase[user]) {
      return socket.emit('registerResult', { success: false, msg: 'Tài khoản này đã tồn tại!' });
    }

    usersDatabase[user] = { pass: pass, role: 'user', active: true };
    socket.emit('registerResult', { success: true, msg: 'Đăng ký thành công! Vui lòng đăng nhập.' });
  });

  // Xử lý Đăng Nhập
  socket.on('loginPanel', (data) => {
    const { user, pass } = data;
    
    if (!user || !pass) {
      return socket.emit('loginResult', { success: false, msg: 'Vui lòng nhập tài khoản và mật khẩu!' });
    }

    const account = usersDatabase[user];

    // Kiểm tra tài khoản tồn tại
    if (!account) {
      return socket.emit('loginResult', { success: false, msg: 'Tài khoản không tồn tại!' });
    }

    // Kiểm tra mật khẩu
    if (account.pass !== pass) {
      return socket.emit('loginResult', { success: false, msg: 'Sai mật khẩu!' });
    }

    // Kiểm tra trạng thái khóa
    if (!account.active) {
      return socket.emit('loginResult', { success: false, msg: 'Tài khoản của bạn đã bị khóa bởi Admin!' });
    }

    userSessions[socket.id] = { user, role: account.role };
    socket.emit('loginResult', { 
      success: true, 
      msg: 'Đăng nhập thành công!',
      username: user,
      role: account.role 
    });
  });

  const getSession = () => userSessions[socket.id];

  // ===== TÍNH NĂNG ADMIN =====
  socket.on('adminGetUsers', () => {
    const session = getSession();
    if (!session || session.role !== 'admin') return;

    const userList = Object.keys(usersDatabase).map(u => ({
      username: u,
      role: usersDatabase[u].role,
      active: usersDatabase[u].active
    }));

    socket.emit('adminUserList', userList);
  });

  socket.on('adminToggleUserStatus', (targetUser) => {
    const session = getSession();
    if (!session || session.role !== 'admin') return;

    if (usersDatabase[targetUser] && targetUser !== 'admin') {
      usersDatabase[targetUser].active = !usersDatabase[targetUser].active;
      
      if (!usersDatabase[targetUser].active && activeBots[targetUser]) {
        if (botInfo[targetUser]) botInfo[targetUser].autoReconnect = false;
        activeBots[targetUser].end();
        delete activeBots[targetUser];
      }
    }
  });

  // ===== QUẢN LÝ BOT =====
  socket.on('startBot', (data) => {
    const session = getSession();
    if (!session) return socket.emit('log', { msg: '[BẢO MẬT] Bạn cần đăng nhập để thao tác!' });

    const { username, password } = data;
    botInfo[username] = { password, autoReconnect: true };

    if (activeBots[username]) {
      socket.emit('log', { bot: username, msg: `Bot ${username} đang hoạt động!` });
      return;
    }

    createBot(username, password, socket);
  });

  socket.on('stopBot', (username) => {
    const session = getSession();
    if (!session) return socket.emit('log', { msg: '[BẢO MẬT] Bạn cần đăng nhập để thao tác!' });

    if (botInfo[username]) {
      botInfo[username].autoReconnect = false;
    }

    if (activeBots[username]) {
      activeBots[username].end();
      delete activeBots[username];
      socket.emit('log', { bot: username, msg: `[STOP] Đã tắt bot ${username}.` });
    }
  });

  socket.on('disconnect', () => {
    delete userSessions[socket.id];
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
    socket.emit('log', { bot: username, msg: `[✓ ${username}] Đã vào Sảnh!` });
    setTimeout(() => {
      if (password) bot.chat(`/dn ${password}`);
    }, 3000);
    setTimeout(() => {
      bot.chat('/menu');
    }, 12000);
  });

  bot.on('message', (message) => {
    socket.emit('log', { bot: username, msg: `[SERVER -> ${username}]: ${message.toAnsi()}` });
  });

  bot.on('end', (reason) => {
    socket.emit('log', { bot: username, msg: `[! ${username}] Ngắt kết nối: ${reason}` });
    delete activeBots[username];

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
