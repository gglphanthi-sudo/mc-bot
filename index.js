const express = require('express');

const http = require('http');

const { Server } = require('socket.io');

const mineflayer = require('mineflayer');



const app = express();

const server = http.createServer(app);

const io = new Server(server);



const PORT = 3000;



const CONFIG = {

    host: 'kingmc.vn',

    port: 25565,

    username: 'Catnosaur',

    password: 'caigicungdc'

};



let bot = null;

let isFarming = false;

let autoReconnect = false;

let hasJoinedKingSMP = false;

let hasExecutedAFK = false;

let isLoggedIn = false;



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



function startBot() {

    if (bot) return;



    hasJoinedKingSMP = false;

    hasExecutedAFK = false;

    isLoggedIn = false;

    logToUI(`[BOT] Đang kết nối tới ${CONFIG.host}...`);

    updateStatus('CONNECTING...', 'yellow');



    try {

        bot = mineflayer.createBot({

            host: CONFIG.host,

            port: CONFIG.port,

            username: CONFIG.username,

            password: CONFIG.password,

            auth: 'offline',

            version: '1.16.5',

            checkTimeoutInterval: 120000

        });



        bot.on('login', () => {

            logToUI('[✔] Bắt tay thành công! Đang vào Sảnh...');

            updateStatus('LOGGING IN...', 'orange');

        });



        bot.on('spawn', () => {

            isFarming = true;

            if (hasJoinedKingSMP) {

                logToUI(`[🎉] BOT ĐÃ SANG KINGSMP THÀNH CÔNG!`);

                updateStatus('ONLINE / KINGSMP', '#00ff88');



                // Khi đã vào KingSMP, chờ 4 giây để tải map rồi gõ /afk

                if (!hasExecutedAFK) {

                    setTimeout(() => {

                        if (bot) {

                            logToUI('[SYSTEM] Gửi lệnh /afk...');

                            bot.chat('/afk');

                        }

                    }, 4000);

                }

            } else {

                logToUI(`[✔] Bot đã xuất hiện ở Sảnh!`);

                updateStatus('ONLINE / LOBBY', '#00ff88');

            }

        });



        bot.on('messagestr', (message) => {

            logToUI(`[SERVER]: ${message}`);



            const msgLower = message.toLowerCase();

            

            if (msgLower.includes('/register') || msgLower.includes('/dk')) {

                setTimeout(() => { if (bot) bot.chat(`/dk ${CONFIG.password} ${CONFIG.password}`); }, 2000);

            } else if (msgLower.includes('/login') || msgLower.includes('/dn')) {

                setTimeout(() => { if (bot) bot.chat(`/dn ${CONFIG.password}`); }, 2000);

            }



            if (!hasJoinedKingSMP && !isLoggedIn && 

                (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {

                

                isLoggedIn = true;

                logToUI('[SYSTEM] Đã đăng nhập! Đợi 5s gõ /menu...');

                setTimeout(() => {

                    if (bot && !hasJoinedKingSMP) {

                        logToUI('[SYSTEM] Đang gõ /menu...');

                        bot.chat('/menu');

                    }

                }, 5000);

            }

        });



        bot.on('windowOpen', (window) => {

            const rawTitle = JSON.stringify(window.title || '').toLowerCase();

            logToUI(`[SYSTEM] Menu mở: ${rawTitle}`);



            // BƯỚC 1: Chọn KingSMP từ Menu Sảnh (Slot 24)

            if (!hasJoinedKingSMP) {

                setTimeout(() => {

                    if (!bot || !bot.currentWindow) return;

                    logToUI(`[SYSTEM] Đang click Slot 24 chọn KingSMP...`);

                    hasJoinedKingSMP = true;



                    bot.clickWindow(24, 0, 0)

                        .then(() => logToUI(`[✔] Click Slot 24 thành công!`))

                        .catch(() => logToUI(`[⚠️] Bỏ qua cảnh báo transaction của server`));



                    setTimeout(() => {

                        try { bot.closeWindow(window); } catch(e){}

                    }, 500);



                }, 2500);

            } 

            // BƯỚC 2: Chọn Slot 1 trong Menu AFK

            else if (hasJoinedKingSMP && !hasExecutedAFK) {

                setTimeout(() => {

                    if (!bot || !bot.currentWindow) return;

                    logToUI(`[SYSTEM] Đang click Slot 1 chọn chế độ AFK...`);

                    hasExecutedAFK = true;



                    bot.clickWindow(1, 0, 0)

                        .then(() => logToUI(`[🎉] ĐÃ CLICK SLOT 1 VÀ VÀO CHẾ ĐỘ AFK THÀNH CÔNG!`))

                        .catch(() => logToUI(`[⚠️] Bỏ qua cảnh báo transaction AFK`));



                    setTimeout(() => {

                        try { bot.closeWindow(window); } catch(e){}

                    }, 500);



                }, 1500);

            }

        });



        bot.on('end', (reason) => {

            logToUI(`[!] Ngắt kết nối: ${reason || 'Mất kết nối từ Server'}`);

            updateStatus('OFFLINE', '#ff4444');

            bot = null;

            isFarming = false;

            hasJoinedKingSMP = false;

            hasExecutedAFK = false;

            isLoggedIn = false;



            if (autoReconnect) {

                logToUI(`[SYSTEM] Tự động kết nối lại sau 5 giây...`);

                setTimeout(() => { if (autoReconnect && !bot) startBot(); }, 5000);

            }

        });



        bot.on('error', (err) => {

            logToUI(`[❌] Lỗi Bot: ${err.message}`);

        });



    } catch (e) {

        logToUI(`[❌] Lỗi khởi tạo: ${e.message}`);

        updateStatus('OFFLINE', '#ff4444');

    }

}



function stopBot() {

    autoReconnect = false;

    hasJoinedKingSMP = false;

    hasExecutedAFK = false;

    isLoggedIn = false;

    io.emit('auto_reconnect_status', false);

    if (bot) {

        bot.quit();

        bot = null;

    }

    isFarming = false;

    updateStatus('STOPPED', '#ff4444');

    logToUI('[SYSTEM] Đã dừng Bot.');

}



io.on('connection', (socket) => {

    socket.emit('init', { server: CONFIG.host, botName: CONFIG.username, autoReconnect });

    socket.on('start_farm', () => { if (!isFarming) startBot(); });

    socket.on('stop_farm', () => { stopBot(); });

    socket.on('toggle_auto_reconnect', () => {

        autoReconnect = !autoReconnect;

        socket.emit('auto_reconnect_status', autoReconnect);

    });



    // Nhận câu chat/lệnh gửi từ giao diện Web

    socket.on('send_chat', (cmd) => {

        if (bot) {

            bot.chat(cmd);

            logToUI(`[ĐÃ GỬI CHAT]: ${cmd}`);

        } else {

            logToUI(`[⚠️] Bot chưa online để gửi chat!`);

        }

    });



    // Click thủ công Slot từ Web UI nếu cần

    socket.on('click_slot', (slot) => {

        if (bot && bot.currentWindow) {

            bot.clickWindow(slot, 0, 0).catch(() => {});

        }

    });

});



server.listen(PORT, () => {

    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);

});
