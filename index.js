const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let bot = null;

io.on('connection', (socket) => {
    socket.on('startBot', (data) => {
        if (bot) return socket.emit('log', { msg: 'Bot đã đang chạy!' });

        socket.emit('log', { msg: `Đang kết nối ${data.username} tới kingmc.vn...` });
        
        bot = mineflayer.createBot({
            host: 'kingmc.vn',
            port: 25565,
            username: data.username,
            version: '1.20.1'
        });

        bot.on('spawn', () => {
            socket.emit('log', { msg: 'Đã vào Sảnh!' });
            if (data.password) {
                setTimeout(() => bot.chat(`/dn ${data.password}`), 3000);
            }
        });

        bot.on('message', (msg) => {
            socket.emit('log', { msg: msg.toString() });
        });

        bot.on('end', () => {
            socket.emit('log', { msg: 'Bot đã ngắt kết nối.' });
            bot = null;
        });
    });

    socket.on('stopBot', () => {
        if (bot) {
            bot.end();
            bot = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
