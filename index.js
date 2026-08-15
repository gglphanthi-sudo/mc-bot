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

// Cấu trúc database lưu tài khoản (Mật khẩu admin: 676767)
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
      return socket.emit('registerResult', { success: false, msg: 'Vui lòng điền đầy đủ tất cả thông tin!' });
    }

    if (pass !== confirmPass) {
      return socket.emit('registerResult', { success: false, msg: 'Xác nhận mật khẩu không trùng khớp!' });
    }

    if (usersDatabase[user]) {
      return socket.emit('registerResult', { success: false, msg: 'Tài khoản này đã tồn tại!' });
    }

    // Tạo tài khoản mới với quyền user
    usersDatabase[user] = { pass: pass, role: 'user', active: true };
    socket.emit('registerResult', { success: true, msg: 'Đăng ký thành công! Hãy chuyển sang đăng nhập.' });
  });

  // Xử lý Đăng Nhập (Phân biệt rõ tài khoản không tồn tại vs Sai mật khẩu)
  socket.on('loginPanel', (data) => {
    const { user, pass } = data;
    const account = usersDatabase[user];

    if (!account) {
      return socket.emit('loginResult', { success: false, msg: 'Tài khoản không tồn tại!' });
    }

    if (account.pass !== pass) {
      return socket.emit('loginResult', { success: false, msg: 'Mật khẩu không chính xác!' });
    }

    if (!account.active) {
      return socket.emit('loginResult', { success: false, msg: 'Tài khoản của bạn đã bị khóa bởi Admin!' });
    }

    userSessions[socket.id] = { user, role: account.role };
    socket.emit('loginResult', { 
      success: true, 
      msg: 'Đăng nhập thành công!',
      role: account.role 
    });
  });

  const getSession = () => userSessions[socket.id];

  // ===== TÍNH NĂNG DÀNH CHO ADMIN =====

  // Lấy danh sách toàn bộ người dùng
  socket.on('adminGetUsers', () => {
    const session = getSession();
    if (!session || session.role !== 'admin') {
      return socket.emit('log', { msg: '[BẢO MẬT] Bạn không có quyền Admin!' });
    }

    const userList = Object.keys(usersDatabase).map(u => ({
      username: u,
      role: usersDatabase[u].role,
      active: usersDatabase[u].active
    }));

    socket.emit('adminUserList', userList);
  });

  // Bật / Khóa trạng thái tài khoản
  socket.on('adminToggleUserStatus', (targetUser) => {
    const session = getSession();
    if (!session || session.role !== 'admin') return;

    if (usersDatabase[targetUser] && targetUser !== 'admin') {
      usersDatabase[targetUser].active = !usersDatabase[targetUser].active;
      
      const statusText = usersDatabase[targetUser].active ? 'Kích hoạt' : 'Khóa';
      socket.emit('log', { msg: `[ADMIN] Đã ${statusText} tài khoản: ${targetUser}` });

      if (!usersDatabase[targetUser].active && activeBots[targetUser]) {
        if (botInfo[targetUser]) botInfo[targetUser].autoReconnect = false;
        activeBots[targetUser].end();
        delete activeBots[targetUser];
      }
    }
  });

  // Đổi mật khẩu tài khoản người dùng
  socket.on('adminResetPassword', (data) => {
    const session = getSession();
    if (!session || session.role !== 'admin') return;

    const { targetUser, newPass } = data;
    if (usersDatabase[targetUser] && newPass) {
      usersDatabase[targetUser].pass = newPass;
      socket.emit('log', { msg: `[ADMIN] Đã đổi mật khẩu cho tài khoản ${targetUser} thành công.` });
    }
  });

  // ===== BẬT / TẮT BOT =====
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

    if (botInfo[username]) botInfo[username].autoReconnect = false;

    if (activeBots[username]) {
      activeBots[username].end();
      delete activeBots[username];
      socket.emit('log', { bot: username, msg: `[STOP] Đã dừng bot ${username}.` });
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
