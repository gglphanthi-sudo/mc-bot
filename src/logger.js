const chalk = require('chalk');
let io = null;

function setSocket(serverIo) {
    io = serverIo;
}

function logMessage(message, color = 'white') {
    const time = new Date().toLocaleTimeString('vi-VN');
    const formatted = `[${time}] ${message}`;
    console.log(chalk[color] ? chalk[color](formatted) : formatted);

    if (io) {
        io.emit('log', formatted);
    }
}

// Phát danh sách bot hiện tại tới mọi client (dùng để cập nhật dashboard realtime)
function broadcastBots(botList) {
    if (io) {
        io.emit('bots', botList);
    }
}

module.exports = { logMessage, setSocket, broadcastBots };
