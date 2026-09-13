require('dotenv').config();
const chalk = require('chalk');
const boxen = require('boxen');
const figlet = require('figlet');
const { startBot, getAllBots, stopBot } = require('./src/minecraft');
const { startServer } = require('./src/webServer');
const { getWebhookUrl, getDefaultServer } = require('./src/webhook');
const { getAccounts, addAccount, getEnvBots } = require('./src/accounts');
const { logMessage } = require('./src/logger');

console.log(chalk.red(figlet.textSync('HXTEKO', { horizontalLayout: 'full' })));

// Merge acc khai báo trong .env vào data/accounts.json (cùng username thì cập nhật, không trùng)
const envBots = getEnvBots();
envBots.forEach(bot => {
    addAccount({
        username: bot.username,
        password: bot.password,
        proxy: bot.proxy || '',
        host: bot.host || '',
        port: bot.port || undefined
    });
});
if (envBots.length > 0) {
    logMessage(`[ENV] Đã nạp ${envBots.length} acc từ .env`, 'cyan');
}

const accounts = getAccounts();
const defaultServer = getDefaultServer();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 3000;
const webhookStatus = getWebhookUrl() ? chalk.green('Đã cấu hình ✅') : chalk.red('Chưa cấu hình ❌');
const cliBox = boxen(
    chalk.yellow.bold('♦ BOT AFK MINECRAFT ♦\n') +
    chalk.white('CONTROL PANEL • BY HXTEKO • RECODE BY SIRIN\n\n') +
    chalk.cyan('🌐 Dashboard: ') + chalk.underline(`http://${host}:${port}\n`) +
    chalk.cyan('🖥 Server: ') + chalk.white(`${defaultServer.host}:${defaultServer.port} (1.20.1)\n`) +
    chalk.cyan('👤 accounts: ') + chalk.white(`${accounts.length} acc\n`) +
    chalk.cyan('🔔 Webhook: ') + webhookStatus,
    { padding: 1, margin: 1, borderStyle: 'double', borderColor: 'red' }
);
console.log(cliBox);
console.log(chalk.gray('Mở web trên để thêm acc • ngắt KN • pay • xem log'));

// Chống sập cả process khi có lỗi async không ai bắt (quan trọng khi chạy trên hosting)
process.on('unhandledRejection', (reason) => {
    console.error(chalk.red('[CRASH] Unhandled Rejection:'), reason);
});
process.on('uncaughtException', (err) => {
    console.error(chalk.red('[CRASH] Uncaught Exception:'), err.message);
    console.error(err.stack);
});

// Tắt bot sạch sẽ khi nhận SIGINT/SIGTERM (Ctrl+C, PM2 stop/restart...)
function shutdown() {
    console.log(chalk.yellow('\n⚠️  Đang tắt bot... ngắt kết nối tất cả acc '));
    getAllBots().forEach(name => stopBot(name));
    setTimeout(() => process.exit(0), 1000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();

// Tự động đăng nhập lại các acc đã lưu khi khởi động
if (accounts.length > 0) {
    setTimeout(() => {
        accounts.forEach(acc => {
            startBot(
                acc.host || defaultServer.host,
                acc.port || defaultServer.port,
                acc.username,
                acc.password,
                acc.proxy
            );
        });
    }, 2000);
} else {
    console.log(chalk.gray('Chưa có acc nào. Khai báo acc trong file .env hoặc mở dashboard để thêm acc mới.'));
}