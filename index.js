const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Cấu hình chung hoặc danh sách tài khoản đa luồng
let CONFIG = {
    host: 'kingmc.vn',
    port: 25565,
    username: '',
    password: ''
};

// Hỗ trợ lưu trữ nhiều tài khoản (Multi-Account)
let accounts = []; // Mạng lưu các tài khoản được add từ UI
let activeBots = {}; // Quản lý các bot đang chạy theo username

let autoReconnect = false;

app.use(express.static('public'));

function logToUI(msg) {
    console.log(msg);
    io.emit('log', msg);
}

function updateStatus(status, color) {
    io.emit('status', { status, color });
}

// Bắt sạch lỗi hệ thống để tránh sập CMD
process.on('uncaughtException', (err) => {
    console.log('[SỜI, ĐÃ BẮT LỖI]:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.log('[SỜI, ĐÃ BẮT REJECTION]:', reason?.message || reason);
});

function startBotForAccount(acc) {
    const username = acc.username;
    if (activeBots[username]) return;

    logToUI(`[BOT] Đang kết nối tài khoản ${username} tới ${CONFIG.host}...`);

    try {
        const bot = mineflayer.createBot({
            host: CONFIG.host,
            port: CONFIG.port,
            username: username,
            password: acc.password || '',
            auth: 'offline',
            version: '1.16.5',
            checkTimeoutInterval: 120000
        });

        activeBots[username] = {
            bot,
            isFarming: false,
            hasJoinedKingSMP: false,
            hasExecutedAFK: false,
            isLoggedIn: false
        };

        const currentBotSession = activeBots[username];

        bot.on('login', () => {
            logToUI(`[✔] [${username}] Bắt tay thành công! Đang vào Sảnh...`);
        });

        bot.on('spawn', () => {
            currentBotSession.isFarming = true;
            if (currentBotSession.hasJoinedKingSMP) {
                logToUI(`[🎉] [${username}] BOT ĐÃ SANG KINGSMP THÀNH CÔNG!`);
                
                if (!currentBotSession.hasExecutedAFK) {
                    setTimeout(() => {
                        if (activeBots[username]?.bot) {
                            logToUI(`[SYSTEM] [${username}] Gửi lệnh /afk...`);
                            bot.chat('/afk');
                        }
                    }, 4000);
                }
            } else {
                logToUI(`[✔] [${username}] Bot đã xuất hiện ở Sảnh!`);
            }
        });

        bot.on('messagestr', (message) => {
            logToUI(`[SERVER - ${username}]: ${message}`);

            const msgLower = message.toLowerCase();
            
            if (msgLower.includes('/register') || msgLower.includes('/dk')) {
                setTimeout(() => { if (activeBots[username]?.bot) bot.chat(`/dk ${acc.password} ${acc.password}`); }, 2000);
            } else if (msgLower.includes('/login') || msgLower.includes('/dn')) {
                setTimeout(() => { if (activeBots[username]?.bot) bot.chat(`/dn ${acc.password}`); }, 2000);
            }

            if (!currentBotSession.hasJoinedKingSMP && !currentBotSession.isLoggedIn && 
                (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {
                
                currentBotSession.isLoggedIn = true;
                logToUI(`[SYSTEM] [${username}] Đã đăng nhập! Đợi 5s gõ /menu...`);
                setTimeout(() => {
                    if (activeBots[username]?.bot && !currentBotSession.hasJoinedKingSMP) {
                        logToUI(`[SYSTEM] [${username}] Đang gõ /menu...`);
                        bot.chat('/menu');
                    }
                }, 5000);
            }
        });

        bot.on('windowOpen', (window) => {
            const rawTitle = JSON.stringify(window.title || '').toLowerCase();
            logToUI(`[SYSTEM] [${username}] Menu mở: ${rawTitle}`);

            if (!currentBotSession.hasJoinedKingSMP) {
                setTimeout(() => {
                    if (!activeBots[username]?.bot || !bot.currentWindow) return;
                    logToUI(`[SYSTEM] [${username}] Đang click Slot 24 chọn KingSMP...`);
                    currentBotSession.hasJoinedKingSMP = true;

                    bot.clickWindow(24, 0, 0)
                        .then(() => logToUI(`[✔] [${username}] Click Slot 24 thành công!`))
                        .catch(() => logToUI(`[⚠️] [${username}] Bỏ qua cảnh báo transaction của server`));

                    setTimeout(() => {
                        try { bot.closeWindow(window); } catch(e){}
                    }, 500);

                }, 2500);
            } 
            else if (currentBotSession.hasJoinedKingSMP && !currentBotSession.hasExecutedAFK) {
                setTimeout(() => {
                    if (!activeBots[username]?.bot || !bot.currentWindow) return;
                    logToUI(`[SYSTEM] [${username}] Đang click Slot 1 chọn chế độ AFK...`);
                    currentBotSession.hasExecutedAFK = true;

                    bot.clickWindow(1, 0, 0)
                        .then(() => logToUI(`[🎉] [${username}] ĐÃ CLICK SLOT 1 VÀ VÀO CHẾ ĐỘ AFK THÀNH CÔNG!`))
                        .catch(() => logToUI(`[⚠️] [${username}] Bỏ qua cảnh báo transaction AFK`));

                    setTimeout(() => {
                        try { bot.closeWindow(window); } catch(e){}
                    }, 500);

                }, 1500);
            }
        });

        bot.on('end', (reason) => {
            logToUI(`[!] [${username}] Ngắt kết nối: ${reason || 'Mất kết nối từ Server'}`);
            delete activeBots[username];

            if (autoReconnect) {
                logToUI(`[SYSTEM] [${username}] Tự động kết nối lại sau 5 giây...`);
                setTimeout(() => {
                    if (autoReconnect && !activeBots[username]) {
                        startBotForAccount(acc);
                    }
                }, 5000);
            }
        });

        bot.on('error', (err) => {
            logToUI(`[❌] [${username}] Lỗi Bot: ${err.message}`);
        });

    } catch (e) {
        logToUI(`[❌] Lỗi khởi tạo cho ${username}: ${e.message}`);
    }
}

function stopAllBots() {
    autoReconnect = false;
    io.emit('auto_reconnect_status', false);
    for (let username in activeBots) {
        if (activeBots[username].bot) {
            activeBots[username].bot.quit();
        }
    }
    activeBots = {};
    logToUI('[SYSTEM] Đã dừng toàn bộ Bot.');
}

io.on('connection', (socket) => {
    // Gửi thông tin khởi tạo kèm đường dẫn Discord (ví dụ link Discord của bạn)
    socket.emit('init', { 
        server: CONFIG.host, 
        autoReconnect,
        discordUrl: 'https://discord.gg/invite_của_bạn' // <-- Thay link Discord của bạn vào đây
    });

    // Xử lý sự kiện Thêm tài khoản từ giao diện Web
    socket.on('add_account', (data) => {
        if (!data || !data.username) {
            logToUI(`[⚠️] Tên tài khoản không hợp lệ!`);
            return;
        }

        const newAcc = {
            username: data.username.trim(),
            password: data.password ? data.password.trim() : ''
        };

        // Kiểm tra xem tài khoản đã tồn tại trong danh sách chưa
        const exists = accounts.find(acc => acc.username === newAcc.username);
        if (!exists) {
            accounts.push(newAcc);
            logToUI(`[✔] Đã thêm tài khoản thành công: ${newAcc.username}`);
            // Tự động khởi động bot cho tài khoản vừa add
            startBotForAccount(newAcc);
        } else {
            logToUI(`[⚠️] Tài khoản ${newAcc.username} đã tồn tại trong hệ thống!`);
        }
    });

    socket.on('start_farm', () => { 
        accounts.forEach(acc => {
            if (!activeBots[acc.username]) {
                startBotForAccount(acc);
            }
        });
    });

    socket.on('stop_farm', () => { 
        stopAllBots(); 
    });

    socket.on('toggle_auto_reconnect', () => {
        autoReconnect = !autoReconnect;
        socket.emit('auto_reconnect_status', autoReconnect);
    });

    // Nhận câu chat/lệnh gửi từ giao diện Web
    socket.on('send_chat', (cmd) => {
        for (let username in activeBots) {
            if (activeBots[username].bot) {
                activeBots[username].bot.chat(cmd);
            }
        }
        logToUI(`[ĐÃ GỬI CHAT TỚI TẤT CẢ]: ${cmd}`);
    });

    // Click thủ công Slot từ Web UI nếu cần
    socket.on('click_slot', (slot) => {
        for (let username in activeBots) {
            if (activeBots[username].bot && activeBots[username].bot.currentWindow) {
                activeBots[username].bot.clickWindow(slot, 0, 0).catch(() => {});
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
});
