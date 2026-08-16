<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cat Tool Panel - AFK Bot</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --bg-color: #120a05;
            --panel-bg: #1a0f07;
            --border-color: #ff6600;
            --text-color: #ffcc99;
            --accent-color: #ff5500;
            --button-hover: #ff7722;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body {
            background-color: var(--bg-color);
            color: var(--text-color);
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            width: 100%;
            max-width: 650px;
            background: var(--panel-bg);
            border: 2px solid var(--border-color);
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 0 20px rgba(255, 102, 0, 0.3);
            position: relative;
        }
        .header {
            text-align: center;
            margin-bottom: 20px;
        }
        .header h3 { font-size: 12px; color: #cc6600; letter-spacing: 2px; }
        .header h1 { font-size: 24px; color: #ff8833; margin: 5px 0; text-shadow: 0 0 10px rgba(255,136,51,0.5); }
        .header p { font-size: 13px; color: #aa7755; }

        /* Discord Logo & Link Style */
        .discord-btn {
            position: absolute;
            top: 20px;
            right: 20px;
            background: #5865F2;
            color: white;
            padding: 8px 12px;
            border-radius: 8px;
            text-decoration: none;
            font-size: 14px;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: 0.3s;
            box-shadow: 0 0 10px rgba(88, 101, 242, 0.5);
        }
        .discord-btn:hover { background: #4752C4; }

        .form-group {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }
        input {
            flex: 1;
            padding: 10px 15px;
            background: #0d0603;
            border: 1px solid #663300;
            border-radius: 6px;
            color: #fff;
            outline: none;
            font-size: 14px;
        }
        input:focus { border-color: var(--border-color); }
        button {
            padding: 10px 20px;
            background: linear-gradient(to bottom, #ff7700, #cc4400);
            border: none;
            border-radius: 6px;
            color: white;
            font-weight: bold;
            cursor: pointer;
            transition: 0.2s;
        }
        button:hover { background: linear-gradient(to bottom, #ff8822, #dd5500); }

        .log-box {
            width: 100%;
            height: 220px;
            background: #080301;
            border: 1px solid #442200;
            border-radius: 6px;
            padding: 10px;
            overflow-y: scroll;
            font-family: monospace;
            font-size: 13px;
            color: #00ff88;
            margin-bottom: 15px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .control-panel {
            background: #140b05;
            border: 1px solid #662200;
            border-radius: 8px;
            padding: 15px;
            margin-top: 15px;
        }
        .control-panel h3 {
            font-size: 15px;
            color: #ff8833;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .chat-box {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }
        .status-bar {
            text-align: center;
            font-size: 13px;
            margin-top: 15px;
            color: #888;
        }
    </style>
</head>
<body>

    <div class="container">
        <!-- Nút và Logo Discord -->
        <a id="discordLink" href="#" target="_blank" class="discord-btn">
            <i class="fa-brands fa-discord"></i> Discord
        </a>

        <div class="header">
            <h3>CAT TOOL — BY MEOVANCAT & GIANANDAY</h3>
            <h1>Cat Tool Panel</h1>
            <p>Hệ thống AFK Bot chuyên nghiệp • Multi-Account độc lập theo IP</p>
        </div>

        <!-- Khung Thêm Tài Khoản -->
        <div class="form-group">
            <input type="text" id="usernameInput" placeholder="Nhập tên tài khoản Minecraft...">
            <input type="password" id="passwordInput" placeholder="Mật khẩu (để trống nếu dùng mỏ)">
            <button id="addBtn"><i class="fa-solid fa-plus"></i> Thêm Bot</button>
        </div>

        <!-- Khung Nhật Ký -->
        <div style="font-size: 13px; margin-bottom: 5px; color: #bb8855;">Nhật ký hệ thống:</div>
        <div class="log-box" id="logBox">
            <div>[System] Đang chờ kết nối tới Server điều khiển...</div>
        </div>

        <!-- Bảng Điều Khiển Quản Trị -->
        <div class="control-panel">
            <h3><i class="fa-solid fa-lock"></i> BẢNG ĐIỀU KHIỂN QUẢN TRỊ</h3>
            <div style="display: flex; gap: 10px; align-items: center;">
                <input type="password" value="********" readonly style="max-width: 150px;">
                <button style="background: #cc3300;"><i class="fa-solid fa-lock-open"></i> Mở Khóa</button>
                <button style="background: #444;"><i class="fa-solid fa-power-off"></i> Đóng</button>
            </div>
            
            <div style="margin-top: 12px;">
                <button id="toggleReconnectBtn" style="background: #333; border: 1px solid #777;"><i class="fa-solid fa-rotate"></i> Tự động kết nối lại: TẮT</button>
                <button id="startAllBtn" style="background: #008844;"><i class="fa-solid fa-play"></i> Chạy Tất Cả</button>
                <button id="stopAllBtn" style="background: #aa2222;"><i class="fa-solid fa-stop"></i> Dừng Tất Cả</button>
            </div>

            <div style="margin-top: 15px; font-size: 13px; color: #cc8855;">💬 Chat từ xa vào bot</div>
            <div class="chat-box">
                <input type="text" id="chatInput" placeholder="Lệnh (VD: /afk, /home)...">
                <button id="sendChatBtn">Gửi</button>
            </div>
        </div>

        <div class="status-bar">
            🔒 2026 Cat Tool. Uy tín làm nên thương hiệu.
        </div>
    </div>

    <!-- Socket.io Client Script -->
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();

        const logBox = document.getElementById('logBox');
        const usernameInput = document.getElementById('usernameInput');
        const passwordInput = document.getElementById('passwordInput');
        const addBtn = document.getElementById('addBtn');
        const chatInput = document.getElementById('chatInput');
        const sendChatBtn = document.getElementById('sendChatBtn');
        const toggleReconnectBtn = document.getElementById('toggleReconnectBtn');
        const startAllBtn = document.getElementById('startAllBtn');
        const stopAllBtn = document.getElementById('stopAllBtn');
        const discordLink = document.getElementById('discordLink');

        // Nhận cấu hình khởi tạo từ Server (bao gồm cả link Discord)
        socket.on('init', (data) => {
            if (data.discordUrl) {
                discordLink.href = data.discordUrl;
            }
            if (data.autoReconnect) {
                toggleReconnectBtn.innerHTML = `<i class="fa-solid fa-rotate"></i> Tự động kết nối lại: BẬT`;
                toggleReconnectBtn.style.background = '#006622';
            }
        });

        // Nhận log từ Server đẩy lên
        socket.on('log', (msg) => {
            const div = document.createElement('div');
            div.textContent = msg;
            logBox.appendChild(div);
            logBox.scrollTop = logBox.scrollHeight; // Tự động cuộn xuống dưới cùng
        });

        // Thêm tài khoản khi bấm nút
        addBtn.addEventListener('click', () => {
            const username = usernameInput.value.trim();
            const password = passwordInput.value.trim();
            if (!username) {
                alert('Vui lòng nhập tên tài khoản Minecraft!');
                return;
            }
            socket.emit('add_account', { username, password });
            usernameInput.value = '';
            passwordInput.value = '';
        });

        // Gửi lệnh chat/command
        sendChatBtn.addEventListener('click', () => {
            const cmd = chatInput.value.trim();
            if (cmd) {
                socket.emit('send_chat', cmd);
                chatInput.value = '';
            }
        });

        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatBtn.click();
        });

        // Các nút điều khiển khác
        toggleReconnectBtn.addEventListener('click', () => {
            socket.emit('toggle_auto_reconnect');
        });

        socket.on('auto_reconnect_status', (status) => {
            if (status) {
                toggleReconnectBtn.innerHTML = `<i class="fa-solid fa-rotate"></i> Tự động kết nối lại: BẬT`;
                toggleReconnectBtn.style.background = '#006622';
            } else {
                toggleReconnectBtn.innerHTML = `<i class="fa-solid fa-rotate"></i> Tự động kết nối lại: TẮT`;
                toggleReconnectBtn.style.background = '#333';
            }
        });

        startAllBtn.addEventListener('click', () => {
            socket.emit('start_farm');
        });

        stopAllBtn.addEventListener('click', () => {
            socket.emit('stop_farm');
        });
    </script>
</body>
</html>
