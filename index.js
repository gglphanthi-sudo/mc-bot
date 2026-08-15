<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>MC Panel - Điều khiển Bot</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    /* CSS giữ nguyên phong cách cũ */
    body { background: #0c0714; color: #fff; font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #160d21; border: 1px solid #ff2a8d; border-radius: 12px; padding: 25px; width: 400px; text-align: center; }
    input { width: 100%; padding: 10px; margin-bottom: 10px; background: #231634; border: 1px solid #382252; color: #fff; border-radius: 5px; }
    button { width: 100%; padding: 10px; background: #ff2a8d; border: none; color: #fff; font-weight: bold; cursor: pointer; border-radius: 5px; margin-top: 5px; }
    #logArea { background: #000; height: 150px; overflow-y: scroll; font-size: 12px; text-align: left; padding: 10px; margin-top: 10px; border: 1px solid #333; color: #0f0; }
  </style>
</head>
<body>

  <!-- FORM ĐĂNG NHẬP -->
  <div class="card" id="loginCard">
    <h2>ĐĂNG NHẬP PANEL</h2>
    <input type="text" id="loginUser" placeholder="Tài khoản">
    <input type="password" id="loginPass" placeholder="Mật khẩu">
    <button onclick="handleLogin()">ĐĂNG NHẬP</button>
  </div>

  <!-- GIAO DIỆN PANEL (Mặc định ẩn) -->
  <div class="card" id="panelCard" style="display: none;">
    <h2>ĐIỀU KHIỂN BOT</h2>
    <input type="text" id="botName" placeholder="Tên Bot (Username)">
    <input type="password" id="botPass" placeholder="Mật khẩu Bot">
    <div style="display: flex; gap: 5px;">
        <button onclick="startBot()">BẬT BOT</button>
        <button onclick="stopBot()" style="background: #666;">DỪNG BOT</button>
    </div>
    <div id="logArea"></div>
  </div>

  <script>
    const socket = io();

    function handleLogin() {
      const user = document.getElementById('loginUser').value;
      const pass = document.getElementById('loginPass').value;
      socket.emit('loginPanel', { user, pass });
    }

    socket.on('loginResult', (data) => {
      if (data.success) {
        document.getElementById('loginCard').style.display = 'none';
        document.getElementById('panelCard').style.display = 'block';
      } else {
        alert(data.msg);
      }
    });

    // Lệnh điều khiển Bot
    function startBot() {
      const username = document.getElementById('botName').value;
      const password = document.getElementById('botPass').value;
      socket.emit('startBot', { username, password });
    }

    function stopBot() {
      const username = document.getElementById('botName').value;
      socket.emit('stopBot', username);
    }

    // Hiển thị Log từ server
    socket.on('log', (data) => {
      const logArea = document.getElementById('logArea');
      logArea.innerHTML += `<div>${data.msg}</div>`;
      logArea.scrollTop = logArea.scrollHeight;
    });
  </script>
</body>
</html>
