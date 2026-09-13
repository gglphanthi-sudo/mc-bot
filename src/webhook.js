const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../data/config.json');

function readConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (e) {
            return {};
        }
    }
    return {};
}

function writeConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getWebhookUrl() {
    return readConfig().webhookUrl || '';
}

function saveWebhookUrl(url) {
    const config = readConfig();
    config.webhookUrl = url;
    writeConfig(config);
}

// Server IP/port mặc định (dùng để tự điền form thêm acc + nút "Join" hàng loạt)
function getDefaultServer() {
    const config = readConfig();
    return {
        host: config.defaultHost || 'kingmc.vn',
        port: config.defaultPort || 25565
    };
}

function saveDefaultServer(host, port) {
    const config = readConfig();
    config.defaultHost = host;
    config.defaultPort = port;
    writeConfig(config);
}

async function sendWebhook(message) {
    const url = getWebhookUrl();
    if (!url) return;
    try {
        await axios.post(url, { content: message, username: "Bot AFK Minecraft" });
    } catch (error) {
        console.error('❌ Lỗi gửi Webhook:', error.message);
    }
}

module.exports = { getWebhookUrl, saveWebhookUrl, getDefaultServer, saveDefaultServer, sendWebhook };
