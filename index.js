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

// ===== CẤU HÌNH ADMIN & DISCORD =====
const ADMIN_IP = '1.53.131.94'; 
const ADMIN_PASSWORD = 'AlphaZo2026';
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1538470405952503858/hM5XP_ON421U53VXbBnwdLdNIEZE5_2q2LwTCq2xDciF_hpfNxWQ8UNR6X6yDNnfubVB';

// HÀM GỬI THÔNG BÁO DISCORD
function sendDiscord(username, message, color = 0x00ff88) {
    if (!DISCORD_WEBHOOK_URL) return;
    fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            embeds: [{
                title: `🤖 TÀI KHOẢN: ${username}`,
                description: message,
                color: color,
                timestamp: new Date().toISOString()
            }]
        })
    }).catch(err => console.log('⚠️ Lỗi gửi Webhook Discord:', err.message));
}

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
//  SOCKET.IO & BOT MINEFLAYER LOGIC TẦNG BƯỚC
// ================================================================
io.on('connection', (socket) => {
    let rawIp = socket.handshake.headers['x-forwarded-for'] 
        ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim() 
        : socket.handshake.address;
    if (rawIp && rawIp.includes('::1')) rawIp = '127.0.0.1';
    const clientIp = rawIp;

    if (!clientData[clientIp]) {
        clientData[clientIp] = { accounts: [], bots: {} };
        saveData();
    }

    socket.emit('init_accounts', clientData[clientIp].accounts);
    socket.emit('sync_collected_data', globalCollectedData);
    socket.emit('maintenance_status', isMaintenance);

    socket.on('add_account', (data) => {
        const { username, password } = data;
        if (!username) return;
        const id = 'acc_' + Date.now() + Math.floor(Math.random() * 1000);
        clientData[clientIp].accounts.push({
            id, username: username.trim(), password: password ? password.trim() : 'caigicungdc',
            autoReconnect: true, status: 'OFFLINE', color: '#ff4444'
        });
        saveData();
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
    });

    socket.on('delete_account', (id) => {
        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
            delete clientData[clientIp].bots[id];
        }
        clientData[clientIp].accounts = clientData[clientIp].accounts.filter(acc => acc.id !== id);
        saveData();
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
    });

    socket.on('toggle_auto_reconnect', (id) => {
        const acc = clientData[clientIp].accounts.find(a => a.id === id);
        if (acc) { acc.autoReconnect = !acc.autoReconnect; saveData(); io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts); }
    });

    // BƯỚC 0: Người dùng bấm Start Bot
    socket.on('start_bot', (id) => {
        const account = clientData[clientIp].accounts.find(acc => acc.id === id);
        if (!account) return;

        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
            delete clientData[clientIp].bots[id];
        }

        const logSystem = (msg, isErr = false) => {
            socket.emit('log', `[${account.username}] ${msg}`);
            if (isErr) sendDiscord(account.username, `❌ ${msg}`, 0xff0000);
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
        
        // BƯỚC 1: Kết nối
        botState.step = 1;
        logSystem(`🔄 Đang kết nối tới kingmc.vn...`);
        sendDiscord(account.username, "🚀 Đang khởi động và kết nối vào server...", 0x3498db);

        try {
            const bot = mineflayer.createBot({
                host: 'kingmc.vn',
                port: 25565,
                username: account.username,
                password: account.password,
                auth: 'offline',
                version: false,          // 👈 Tự động dò phiên bản tương thích với server
                skipValidation: true,    // 👈 Bỏ qua bước xác thực để tránh lỗi socketClosed
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
                // BƯỚC 2: Vào Sảnh Chính
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

                // BƯỚC 3: Xử lý Đăng Ký / Đăng Nhập
                if (!botState.isLoggedIn) {
                    if (msgLower.includes('/register') || msgLower.includes('/dk')) {
                        botState.step = 3;
                        setTimeout(() => bot.chat(`/dk ${account.password} ${account.password}`), 2000);
                    } else if (msgLower.includes('/login') || msgLower.includes('/dn')) {
                        botState.step = 3;
                        setTimeout(() => bot.chat(`/dn ${account.password}`), 1000);
                        setTimeout(() => { if (!botState.isLoggedIn) bot.chat(`/dn ${account.password}`); }, 4000);
                    }
                }

                // BƯỚC 4: Đăng nhập thành công
                if (!botState.isLoggedIn && (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {
                    botState.isLoggedIn = true;
                    botState.step = 4;
                    logSystem(`✅ Đã đăng nhập thành công! Đợi 5s gõ /menu...`);
                    sendDiscord(account.username, "✅ Đăng nhập server thành công!", 0x2ecc71);

                    // BƯỚC 5: Mở Menu chính
                    setTimeout(() => {
                        if (bot && !botState.isInKingSMP) {
                            botState.step = 5;
                            logSystem(`📋 Đang gõ /menu...`);
                            bot.chat('/menu');
                        }
                    }, 5000);
                }

                if (botState.isLoggedIn && !botState.isInKingSMP && msgLower.includes('kingsmp') && msgLower.includes('chào mừng')) {
                    botState.isInKingSMP = true;
                    account.status = 'ONLINE / KINGSMP';
                    account.color = '#00ff88';
                    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                    logSystem(`✅ ĐÃ VÀO KINGSMP!`);
                    sendDiscord(account.username, "🌍 Đã chuyển sang cụm KingSMP thành công!", 0x9b59b6);
                    
                    // BƯỚC 7: Gõ lệnh /afk
                    setTimeout(() => {
                        if (bot && !botState.isAfk) {
                            botState.step = 7;
                            logSystem(`💤 Gửi lệnh /afk...`);
                            bot.chat('/afk');
                        }
                    }, 3000);
                }
            });

            bot.on('windowOpen', (window) => {
                const rawTitle = JSON.stringify(window.title || '').toLowerCase();
                
                if (rawTitle.includes('menu') || rawTitle.includes('sảnh') || rawTitle.includes('afk') || rawTitle.includes('treo')) {
                    logSystem(`📂 Menu mở: ${rawTitle}`);
                }

                // BƯỚC 6: Click Slot 24 Chọn KingSMP
                if (botState.step === 5 || (!botState.isInKingSMP && (rawTitle.includes('sảnh') || rawTitle.includes('lobby') || rawTitle.includes('menu')))) {
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) return;
                        botState.step = 6;
                        logSystem(`🖱️ Click Slot 24 chọn KingSMP...`);

                        bot.clickWindow(24, 0, 0).then(() => {
                            logSystem(`✅ Click Slot 24 thành công!`);
                            setTimeout(() => { try { bot.closeWindow(window); } catch(e){} }, 500);
                        }).catch(() => {});
                    }, 2000);
                }

                // Nhận diện Menu AFK
                if (botState.step >= 7 && !botState.isAfk && (rawTitle.includes('afk') || rawTitle.includes('tự động') || rawTitle.includes('treo'))) {
                    
                    // BƯỚC 8: Đợi 2.5 giây khi menu AFK mở
                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) return;
                        
                        // BƯỚC 9: Click Slot 1
                        botState.step = 9;
                        logSystem(`🖱️ Click Slot 1 chọn AFK...`);

                        bot.clickWindow(1, 0, 0).then(() => {
                            // BƯỚC 10: HOÀN THÀNH
                            botState.isAfk = true;
                            botState.step = 10;
                            logSystem(`🎉 BOT ĐÃ HOẠT ĐỘNG AFK THÀNH CÔNG!`);
                            sendDiscord(account.username, "🎉 Đã hoàn tất treo máy vào chế độ AFK thành công!", 0xf1c40f);
                            setTimeout(() => { try { bot.closeWindow(window); } catch(e){} }, 500);
                        }).catch(() => {});

                    }, 2500);
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
                if (err.code === 'EPIPE') logSystem(`⚠️ Mất kết nối server, đang thử lại...`, true);
                else if (err.code === 'ECONNREFUSED') logSystem(`❌ Không thể kết nối tới server!`, true);
                else logSystem(`❌ Lỗi: ${err.message}`, true);
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
});

server.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`🔔 Đã cấu hình Webhook Discord thành công!`);
});
