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

// Database lưu tài khoản Panel (Đã cập nhật mật khẩu admin: 676767)
const usersDatabase = {
  'admin': { pass: '676767', role: 'admin', active: true }
};

const activeBots = {}; // Lưu instance của bot đang chạy
const botInfo = {}; // Lưu thông tin mật khẩu & trạng thái tự động kết nối lại
const userSessions = {}; // Lưu thông tin phiên kết nối socket -> user

io.on('connection', (socket) => {

  // Xử lý Đăng Ký Panel (Mặc định tài khoản mới có role là 'user')
  socket.on('registerPanel', (data) => {
    const { user, pass } = data;
    if (!user || !pass) {
      return socket.emit('registerResult', { success: false, msg: 'Tài khoản và mật khẩu không được trống!' });
    }
    if (usersDatabase[user]) {
      return socket.emit('registerResult', { success: false, msg: 'Tài khoản này đã tồn tại!' });
    }

    usersDatabase[user] = { pass: pass, role: 'user', active: true };
    socket.emit('registerResult', { success: true, msg: 'Đăng ký thành công! Hãy đăng nhập ngay.' });
  });

  // Xử lý Đăng Nhập Panel
  socket.on('loginPanel', (data) => {
    const { user, pass } = data;
    const account = usersDatabase[user];

    if (account && account.pass === pass) {
      if (!account.active) {
        return socket.emit('loginResult', { success: false, msg: 'Tài khoản của bạn đã bị khóa bởi Admin!' });
      }

      userSessions[socket.id] = { user, role: account.role };
      socket.emit('loginResult', { 
        success: true, 
        msg: 'Đăng nhập thành công!',
        role: account.role 
      });
    } else {
      socket.emit('loginResult', { success: false, msg: 'Tài khoản hoặc mật khẩu không chính xác!' });
    }
  });

  // Kiểm tra xác thực socket
  const getSession = () => userSessions[socket.id];

  // ===== TÍNH NĂNG DÀNH CHO ADMIN =====

  // Admin lấy danh sách tất cả tài khoản người dùng
  socket.on('adminGetUsers', () => {
    const session = getSession();
    if (!session || session.role !== 'admin') {
      return socket.emit('log', { msg: '[BẢO MẬT] Bạn không có quyền Admin!' });
    }

    // Trả về danh sách tài khoản
    const userList = Object.keys(usersDatabase).map(u => ({
      username: u,
      role: usersDatabase[u].role,
      active: usersDatabase[u].active
    }));

    socket.emit('adminUserList', userList);
  });

  // Admin bật / khóa trạng thái tài khoản
  socket.on('adminToggleUserStatus', (targetUser) => {
    const session = getSession();
    if (!session || session.role !== 'admin') return;

    if (usersDatabase[targetUser] && targetUser !== 'admin') {
      usersDatabase[targetUser].active = !usersDatabase[targetUser].active;
      
      const statusText = usersDatabase[targetUser].active ? 'Kích hoạt' : 'Khóa';
      socket.emit('log', { msg: `[ADMIN] Đã ${statusText} tài khoản: ${targetUser}` });

      // Nếu bị khóa, ngắt các bot đang chạy của user đó
      if (!usersDatabase[targetUser].active && activeBots[targetUser]) {
        if (botInfo[targetUser]) botInfo[targetUser].autoReconnect = false;
        activeBots[targetUser].end();
        delete activeBots[targetUser];
      }
    }
  });

  // Admin đặt lại mật khẩu mới cho người dùng
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
      socket.emit('log', { bot: username, msg: `Bot ${username} đang hoạt động hoặc đang kết nối!` });
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
      socket.emit('log', { bot: username, msg: `[STOP] Đã chủ động ngắt kết nối bot ${username}.` });
    }
  });

  socket.on('sendChat', (msg) => {
    const session = getSession();
    if (!session) return socket.emit('log', { msg: '[BẢO MẬT] Bạn cần đăng nhập để thao tác!' });

    Object.keys(activeBots).forEach((botName) => {
      if (activeBots[botName]) {
        activeBots[botName].chat(msg);
      }
    });
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
