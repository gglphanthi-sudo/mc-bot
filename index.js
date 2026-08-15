const express = require('express');

const http = require('http');

const { Server } = require('socket.io');

const mineflayer = require('mineflayer');



const app = express();

const server = http.createServer(app);

const io = new Server(server);



const PORT = 3000;

const SERVER_HOST = 'kingmc.vn';

const SERVER_PORT = 25565;



// Quản lý danh sách bot

const accounts = []; // { id, username, password, status, color, botInstance, autoReconnect, hasJoinedKingSMP, hasExecutedAFK, isLoggedIn }



app.use(express.static('public'));



function logToUI(msg) {

    console.log(msg);

    io.emit('log', msg);

}



function emitAccountsUpdate() {

    const list = accounts.map(acc => ({

        id: acc.id,

        username: acc.username,

        status: acc.status,

        color: acc.color,

        autoReconnect: acc.autoReconnect

    }));

    io.emit('accounts_update', list);

}



process.on('uncaughtException', (err) => {

    console.log('[SỜI, ĐÃ BẮT LỖI]:', err.message);

});



process.on('unhandledRejection', (reason) => {

    console.log('[SỜI, ĐÃ BẮT REJECTION]:', reason?.message || reason);

});



function startBotForAccount(acc) {

    if (acc.botInstance) return;



    acc.hasJoinedKingSMP = false;

    acc.hasExecutedAFK = false;

    acc.isLoggedIn = false;

    acc.status = 'CONNECTING...';

    acc.color = 'yellow';

    emitAccountsUpdate();



    logToUI(`[BOT ${acc.username}] Đang kết nối tới ${SERVER_HOST}...`);



    try {

        const bot = mineflayer.createBot({

            host: SERVER_HOST,

            port: SERVER_PORT,

            username: acc.username,

            password: acc.password,

            auth: 'offline',

            version: '1.16.5',

            checkTimeoutInterval: 120000

        });



        acc.botInstance = bot;



        bot.on('login', () => {

            logToUI(`[✔ ${acc.username}] Bắt tay thành công! Đang vào Sảnh...`);

            acc.status = 'LOGGING IN...';

            acc.color = 'orange';

            emitAccountsUpdate();

        });



        bot.on('spawn', () => {

            if (acc.hasJoinedKingSMP) {

                logToUI(`[🎉 ${acc.username}] ĐÃ SANG KINGSMP THÀNH CÔNG!`);

                acc.status = 'ONLINE / KINGSMP';

                acc.color = '#00ff88';



                if (!acc.hasExecutedAFK) {

                    setTimeout(() => {

                        if (acc.botInstance) {

                            logToUI(`[SYSTEM ${acc.username}] Gửi lệnh /afk...`);

                            acc.botInstance.chat('/afk');

                        }

                    }, 4000);

                }

            } else {

                logToUI(`[✔ ${acc.username}] Đã xuất hiện ở Sảnh!`);

                acc.status = 'ONLINE / LOBBY';

                acc.color = '#00ff88';

            }

            emitAccountsUpdate();

        });



        bot.on('messagestr', (message) => {

            logToUI(`[SERVER -> ${acc.username}]: ${message}`);

            const msgLower = message.toLowerCase();



            if (msgLower.includes('/register') || msgLower.includes('/dk')) {

                setTimeout(() => { if (acc.botInstance) acc.botInstance.chat(`/dk ${acc.password} ${acc.password}`); }, 2000);

            } else if (msgLower.includes('/login') || msgLower.includes('/dn')) {

                setTimeout(() => { if (acc.botInstance) acc.botInstance.chat(`/dn ${acc.password}`); }, 2000);

            }



            if (!acc.hasJoinedKingSMP && !acc.isLoggedIn && 

                (msgLower.includes('đăng nhập thành công') || msgLower.includes('bạn đã đăng nhập'))) {

                

                acc.isLoggedIn = true;

                logToUI(`[SYSTEM ${acc.username}] Đã đăng nhập! Đợi 5s gõ /menu...`);

                setTimeout(() => {

                    if (acc.botInstance && !acc.hasJoinedKingSMP) {

                        logToUI(`[SYSTEM ${acc.username}] Đang gõ /menu...`);

                        acc.botInstance.chat('/menu');

                    }

                }, 5000);

            }

        });



        bot.on('windowOpen', (window) => {

            const rawTitle = JSON.stringify(window.title || '').toLowerCase();

            logToUI(`[SYSTEM ${acc.username}] Menu mở: ${rawTitle}`);



            if (!acc.hasJoinedKingSMP) {

                setTimeout(async () => {

                    if (!acc.botInstance || !acc.botInstance.currentWindow) return;

                    logToUI(`[SYSTEM ${acc.username}] Đang click Slot 24 chọn KingSMP...`);



                    try {

                        await acc.botInstance.clickWindow(24, 0, 0);

                        acc.hasJoinedKingSMP = true;

                        logToUI(`[✔ ${acc.username}] Gửi lệnh chọn Slot 24 thành công!`);

                    } catch (err) {

                        logToUI(`[⚠️ ${acc.username}] Bỏ qua cảnh báo click: ${err.message}`);

                    }

                }, 3500);

            } else if (acc.hasJoinedKingSMP && !acc.hasExecutedAFK) {

                setTimeout(async () => {

                    if (!acc.botInstance || !acc.botInstance.currentWindow) return;

                    logToUI(`[SYSTEM ${acc.username}] Đang click Slot 1 chọn chế độ AFK...`);



                    try {

                        await acc.botInstance.clickWindow(1, 0, 0);

                        acc.hasExecutedAFK = true;

                        logToUI(`[🎉 ${acc.username}] ĐÃ CHỌN AFK THÀNH CÔNG!`);

                    } catch (err) {

                        logToUI(`[⚠️ ${acc.username}] Bỏ qua cảnh báo AFK: ${err.message}`);

                    }

                }, 2000);

            }

        });



        bot.on('end', (reason) => {

            logToUI(`[! ${acc.username}] Ngắt kết nối: ${reason || 'Mất kết nối từ Server'}`);

            acc.botInstance = null;

            acc.status = 'OFFLINE';

            acc.color = '#ff4444';

            acc.hasJoinedKingSMP = false;

            acc.hasExecutedAFK = false;

            acc.isLoggedIn = false;

            emitAccountsUpdate();



            if (acc.autoReconnect) {

                logToUI(`[SYSTEM ${acc.username}] Tự động kết nối lại sau 5 giây...`);

                setTimeout(() => {

                    if (acc.autoReconnect && !acc.botInstance) startBotForAccount(acc);

                }, 5000);

            }

        });



        bot.on('error', (err) => {

            logToUI(`[❌ ${acc.username}] Lỗi Bot: ${err.message}`);

        });



    } catch (e) {

        logToUI(`[❌ ${acc.username}] Lỗi khởi tạo: ${e.message}`);

        acc.status = 'OFFLINE';

        acc.color = '#ff4444';

        emitAccountsUpdate();

    }

}



function stopBotForAccount(acc) {

    acc.autoReconnect = false;

    acc.hasJoinedKingSMP = false;

    acc.hasExecutedAFK = false;

    acc.isLoggedIn = false;

    if (acc.botInstance) {

        acc.botInstance.quit();

        acc.botInstance = null;

    }

    acc.status = 'STOPPED';

    acc.color = '#ff4444';

    emitAccountsUpdate();

    logToUI(`[SYSTEM ${acc.username}] Đã dừng Bot.`);

}



io.on('connection', (socket) => {

    emitAccountsUpdate();



    socket.on('add_account', ({ username, password }) => {

        if (!username || !password) return;

        const id = Date.now().toString();

        const newAcc = {

            id,

            username,

            password,

            status: 'OFFLINE',

            color: '#ff4444',

            botInstance: null,

            autoReconnect: false,

            hasJoinedKingSMP: false,

            hasExecutedAFK: false,

            isLoggedIn: false

        };

        accounts.push(newAcc);

        emitAccountsUpdate();

        logToUI(`[SYSTEM] Đã thêm tài khoản: ${username}`);

    });



    socket.on('delete_account', (id) => {

        const index = accounts.findIndex(a => a.id === id);

        if (index !== -1) {

            const acc = accounts[index];

            stopBotForAccount(acc);

            accounts.splice(index, 1);

            emitAccountsUpdate();

            logToUI(`[SYSTEM] Đã xóa tài khoản ID: ${id}`);

        }

    });



    socket.on('start_acc', (id) => {

        const acc = accounts.find(a => a.id === id);

        if (acc) startBotForAccount(acc);

    });



    socket.on('stop_acc', (id) => {

        const acc = accounts.find(a => a.id === id);

        if (acc) stopBotForAccount(acc);

    });



    socket.on('toggle_auto_reconnect', (id) => {

        const acc = accounts.find(a => a.id === id);

        if (acc) {

            acc.autoReconnect = !acc.autoReconnect;

            emitAccountsUpdate();

        }

    });



    socket.on('send_chat', (cmd) => {

        accounts.forEach(acc => {

            if (acc.botInstance) {

                acc.botInstance.chat(cmd);

                logToUI(`[CHAT -> ${acc.username}]: ${cmd}`);

            }

        });

    });

});



server.listen(PORT, () => {

    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);

}); 

