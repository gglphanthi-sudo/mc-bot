require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ACCOUNTS_PATH = path.join(__dirname, '../data/accounts.json');

// Đọc danh sách acc khai báo trong .env
// Mỗi acc dùng các biến BOT_<n>_USERNAME / _PASSWORD / _PROXY / _HOST / _PORT (điền theo số thứ tự)
function getEnvBots() {
    const bots = [];
    let i = 1;
    while (true) {
        const usernameRaw = process.env[`BOT_${i}_USERNAME`];
        if (!usernameRaw) break;
        const username = String(usernameRaw).trim();
        const password = String(process.env[`BOT_${i}_PASSWORD`] || '').trim();
        if (!username || !password) { i++; continue; }
        bots.push({
            username,
            password,
            proxy: String(process.env[`BOT_${i}_PROXY`] || '').trim(),
            host: String(process.env[`BOT_${i}_HOST`] || '').trim(),
            port: process.env[`BOT_${i}_PORT`] ? Number(process.env[`BOT_${i}_PORT`]) : undefined
        });
        i++;
    }
    return bots;
}

function getAccounts() {
    if (fs.existsSync(ACCOUNTS_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8'));
        } catch (e) {
            return [];
        }
    }
    return [];
}

function saveAccounts(accounts) {
    fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

function addAccount(account) {
    const accounts = getAccounts();
    // Tránh thêm trùng username
    const exists = accounts.find(a => a.username === account.username);
    if (exists) {
        Object.assign(exists, account);
    } else {
        accounts.push(account);
    }
    saveAccounts(accounts);
    return accounts;
}

function removeAccount(username) {
    const accounts = getAccounts().filter(a => a.username !== username);
    saveAccounts(accounts);
    return accounts;
}

module.exports = { getAccounts, saveAccounts, addAccount, removeAccount, getEnvBots };
