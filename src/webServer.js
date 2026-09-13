require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { getWebhookUrl, saveWebhookUrl, sendWebhook, getDefaultServer, saveDefaultServer } = require('./webhook');
const { getBot, getAllBots, getBotStatuses, startBot, stopBot, joinKingSMPNow } = require('./minecraft');
const { setSocket, logMessage } = require('./logger');
const { getAccounts, addAccount, removeAccount, saveAccounts } = require('./accounts');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

setSocket(io);

app.use(express.json());

// Các file tĩnh dùng cho dashboard (css/js)
app.use(express.static(path.join(__dirname, '../public')));

// ---------- Dashboard ----------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

// Gửi ngay danh sách bot hiện tại cho client vừa kết nối
io.on('connection', (socket) => {
    socket.emit('bots', getBotStatuses());
});

// API Webhook
app.get('/api/webhook', (req, res) => res.json({ url: getWebhookUrl() }));
app.post('/api/webhook/save', (req, res) => {
    const { url } = req.body;
    if (!url || !url.startsWith('https://discord.com/api/webhooks/')) {
        return res.status(400).json({ success: false, message: 'URL không hợp lệ!' });
    }
    saveWebhookUrl(url);
    res.json({ success: true, message: '✅ Đã lưu Webhook!' });
});
app.post('/api/webhook/test', async (req, res) => {
    if (!getWebhookUrl()) return res.status(400).json({ success: false, message: '❌ Chưa cấu hình Webhook!' });
    await sendWebhook('🔔 **Test Webhook** - Bot đã kết nối!');
    res.json({ success: true, message: '✅ Đã gửi test!' });
});

// API Server IP mặc định (dùng để tự điền + Join hàng loạt)
app.get('/api/server', (req, res) => res.json(getDefaultServer()));
app.post('/api/server/save', (req, res) => {
    const { host, port } = req.body;
    if (!host) return res.status(400).json({ success: false, message: 'Thiếu IP server!' });
    saveDefaultServer(host, Number(port) || 25565);
    res.json({ success: true, message: '✅ Đã lưu IP server!' });
});

// API Join: cho tất cả acc đã lưu kết nối tới IP vừa nhập (đổi IP + reconnect nếu đang chạy)
app.post('/api/server/join', (req, res) => {
    const { host, port } = req.body;
    if (!host) return res.status(400).json({ success: false, message: 'Thiếu IP server!' });
    const finalPort = Number(port) || 25565;
    saveDefaultServer(host, finalPort);

    const accounts = getAccounts();
    if (accounts.length === 0) {
        return res.status(400).json({ success: false, message: 'Chưa có acc nào, hãy thêm acc trước!' });
    }

    accounts.forEach(acc => { acc.host = host; acc.port = finalPort; });
    saveAccounts(accounts);

    // Ngắt bot đang chạy rồi kết nối lại với IP mới
    getAllBots().forEach(name => stopBot(name));
    setTimeout(() => {
        accounts.forEach(acc => startBot(host, finalPort, acc.username, acc.password, acc.proxy));
    }, 1000);

    logMessage(`[JOIN] Đang kết nối tất cả acc tới ${host}:${finalPort}`, 'cyan');
    res.json({ success: true, message: `🔌 Đang kết nối tất cả acc tới ${host}:${finalPort}` });
});

// API Danh sách bot đang chạy (dùng để dựng dashboard/select)
app.get('/api/bots', (req, res) => {
    res.json({ bots: getBotStatuses(), accounts: getAccounts() });
});

// API Bấm la bàn ngay lập tức (mở menu -> vào map KingSMP), không cần đợi lịch tự động
app.post('/api/bots/join-kingsmp', (req, res) => {
    const { target } = req.body;
    const names = target === 'all' || !target ? getAllBots() : [target];
    if (names.length === 0) return res.status(400).json({ success: false, message: 'Không có bot nào online!' });
    names.forEach(name => joinKingSMPNow(name));
    res.json({ success: true, message: `🧭 Đã bấm la bàn cho ${names.length} bot` });
});

// API Thêm account mới + tự login
app.post('/api/account/add', (req, res) => {
    const { username, password, host, port, proxy } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Thiếu username hoặc password!' });
    }
    const defaultServer = getDefaultServer();
    const finalHost = host || defaultServer.host;
    const finalPort = Number(port) || defaultServer.port;

    addAccount({ username, password, host: finalHost, port: finalPort, proxy: proxy || '' });
    startBot(finalHost, finalPort, username, password, proxy);
    logMessage(`[ADD] Đã thêm và khởi động acc ${username}`, 'cyan');

    res.json({ success: true, message: `✅ Đã thêm & đăng nhập ${username}!` });
});

// API Ngắt kết nối 1 bot / xóa account
app.post('/api/account/remove', (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, message: 'Thiếu username!' });
    stopBot(username);
    removeAccount(username);
    res.json({ success: true, message: `Đã ngắt & xóa ${username}` });
});

// API Ngắt tất cả bot
app.post('/api/bots/stop-all', (req, res) => {
    getAllBots().forEach(name => stopBot(name));
    res.json({ success: true, message: 'Đã ngắt tất cả bot' });
});

// API Gửi lệnh
app.post('/api/command', (req, res) => {
    const { command, target } = req.body;
    if (!command) return res.status(400).json({ success: false, message: 'Thiếu lệnh!' });
    if (target === 'all') {
        const botNames = getAllBots();
        botNames.forEach(name => getBot(name) && getBot(name).chat(command));
        res.json({ success: true, message: `Đã gửi lệnh tới tất cả bot` });
    } else {
        const bot = getBot(target);
        if (bot) {
            bot.chat(command);
            res.json({ success: true, message: `Đã gửi lệnh tới ${target}` });
        } else {
            res.status(400).json({ success: false, message: 'Bot không online!' });
        }
    }
});

// API Chuyển tiền
app.post('/api/pay', (req, res) => {
    const { target, player, amount } = req.body;
    if (!player || !amount) return res.status(400).json({ success: false, message: 'Thiếu thông tin /pay!' });
    const command = `/pay ${player} ${amount}`;
    if (target === 'all') {
        getAllBots().forEach(name => getBot(name) && getBot(name).chat(command));
        res.json({ success: true, message: `Đã gửi /pay tới tất cả bot` });
    } else {
        const bot = getBot(target);
        if (bot) {
            bot.chat(command);
            res.json({ success: true, message: `Đã gửi /pay từ ${target}` });
        } else {
            res.status(400).json({ success: false, message: 'Bot không online!' });
        }
    }
});

function startServer() {
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '127.0.0.1';
    server.listen(port, host, () => {
        console.log(`🌐 Web Dashboard: http://${host}:${port}`);
    });
}

module.exports = { startServer, io };