const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Cấu hình IP Admin của bạn
const ADMIN_IP = '1.53.131.94'; 

// Lưu trữ danh sách tài khoản và bot phân theo IP của người dùng
const clientData = {};

app.use(express.static('public'));

// API kiểm tra quyền Admin dựa trên IP (Tối ưu cho Proxy của Render)
app.get('/api/check-admin', (req, res) => {
    let clientIp = req.headers['x-forwarded-for'] 
        ? req.headers['x-forwarded-for'].split(',')[0].trim() 
        : req.socket.remoteAddress;

    if (clientIp && clientIp.includes('::1')) clientIp = '127.0.0.1';
    
    const isAdmin = (clientIp === ADMIN_IP || clientIp === '127.0.0.1' || clientIp.includes('192.168.'));
    res.json({ isAdmin, ip: clientIp });
});

// Bắt lỗi toàn cục chống sập server
process.on('uncaughtException', (err) => console.log('[LỖI HỆ THỐNG]:', err.message));
process.on('unhandledRejection', (reason) => console.log('[LỖI PROMISE]:', reason?.message || reason));

io.on('connection', (socket) => {
    // Lấy IP chuẩn qua proxy của Render khi socket kết nối
    let rawIp = socket.handshake.headers['x-forwarded-for'] 
        ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim() 
        : socket.handshake.address;

    if (rawIp && rawIp.includes('::1')) rawIp = '127.0.0.1';
    const clientIp = rawIp;

    if (!clientData[clientIp]) {
        clientData[clientIp] = {
            accounts: [], // [{ id, username, password, autoReconnect, status, color }]
            bots: {}      // id -> mineflayer instance
        };
    }

    // Gửi danh sách tài khoản riêng của IP này về client
    socket.emit('init_accounts', clientData[clientIp].accounts);

    // Thêm tài khoản mới vào Multi-Account
    socket.on('add_account', (data) => {
        const { username, password } = data;
        if (!username) return;
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
        socket.emit('log', `[SYSTEM] Đã thêm tài khoản: ${username}`);
    });

    // Xóa tài khoản
    socket.on('delete_account', (id) => {
        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
            delete clientData[clientIp].bots[id];
        }
        clientData[clientIp].accounts = clientData[clientIp].accounts.filter(acc => acc.id !== id);
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
    });

    // Bật Auto Reconnect toggle cho từng tài khoản
    socket.on('toggle_auto_reconnect', (id) => {
        const acc = clientData[clientIp].accounts.find(a => a.id === id);
        if (acc) {
            acc.autoReconnect = !acc.autoReconnect;
            io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        }
    });

    // Khởi động Bot cho tài khoản chỉ định
    socket.on('start_bot', (id) => {
        const account = clientData[clientIp].accounts.find(acc => acc.id === id);
        if (!account) return;

        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
        }

        account.status = 'CONNECTING...';
        account.color = 'yellow';
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        socket.emit('log', `[${account.username}] Đang kết nối tới kingmc.vn...`);

        try {
            const bot = mineflayer.createBot({
                host: 'kingmc.vn',
                port: 25565,
                username: account.username,
                password: account.password,
                auth: 'offline',
                version: false, 
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
                socket.emit('log', `[${account.username}] Bắt tay thành công! Đang vào Sảnh...`);
            });

            bot.on('spawn', () => {
                if (hasJoinedKingSMP) {
                    account.status = 'ONLINE / KINGSMP';
                    account.color = '#00ff88';
                    socket.emit('log', `[${account.username}] ĐÃ SANG KINGSMP THÀNH CÔNG!`);
                    if (!hasExecutedAFK) {
                        setTimeout(() => {
                            if (clientData[clientIp].bots[id]) {
                                bot.chat('/afk');
                                socket.emit('log', `[${account.username}] Gửi lệnh /afk`);
                            }
                        }, 4000);
                    }
                } else {
                    account.status = 'ONLINE / LOBBY';
                    account.color = '#00ff88';
                    socket.emit('log', `[${account.username}] Đã xuất hiện ở Sảnh chính!`);
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

                if (!hasJoinedKingSMP && !isLoggedIn && (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {
                    isLoggedIn = true;
                    setTimeout(() => {
                        if (bot && !hasJoinedKingSMP) {
                            bot.chat('/menu');
                            socket.emit('log', `[${account.username}] Đang mở /menu...`);
                        }
                    }, 4000);
                }
            });

            bot.on('windowOpen', (window) => {
                if (!hasJoinedKingSMP) {
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) return;
                        hasJoinedKingSMP = true;
                        bot.clickWindow(24, 0, 0).catch(() => {});
                        setTimeout(() => { try { bot.closeWindow(window); } catch(e){} }, 500);
                    }, 2000);
                } else if (hasJoinedKingSMP && !hasExecutedAFK) {
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) return;
                        hasExecutedAFK = true;
                        bot.clickWindow(1, 0, 0).catch(() => {});
                        setTimeout(() => { try { bot.closeWindow(window); } catch(e){} }, 500);
                    }, 1500);
                }
            });

            bot.on('end', (reason) => {
                socket.emit('log', `[${account.username}] Ngắt kết nối: ${reason}`);
                account.status = 'OFFLINE';
                account.color = '#ff4444';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                delete clientData[clientIp].bots[id];

                if (account.autoReconnect) {
                    socket.emit('log', `[${account.username}] Tự động kết nối lại sau 6 giây...`);
                    setTimeout(() => {
                        if (!clientData[clientIp].bots[id] && account.autoReconnect) {
                            socket.emit('restart_internal_bot', id);
                        }
                    }, 6000);
                }
            });

            bot.on('error', (err) => {
                socket.emit('log', `[${account.username} Lỗi]: ${err.message}`);
            });

        } catch (e) {
            socket.emit('log', `[Lỗi khởi tạo ${account.username}]: ${e.message}`);
            account.status = 'ERROR';
            account.color = '#ff4444';
            io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        }
    });

    // Dừng Bot
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
        socket.emit('log', `[SYSTEM] Đã dừng bot: ${account ? account.username : id}`);
    });

    // Gửi chat lệnh tới bot cụ thể
    socket.on('send_chat', ({ id, cmd }) => {
        const bot = clientData[clientIp].bots[id];
        if (bot) {
            bot.chat(cmd);
            socket.emit('log', `[ĐÃ GỬI LỆNH]: ${cmd}`);
        } else {
            socket.emit('log', `[⚠️] Bot này chưa online để nhận lệnh!`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 GTT Store Panel đang chạy tại: http://localhost:${PORT}`);
});
