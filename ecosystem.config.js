// Cấu hình chạy bằng PM2 trên hosting/server:
//   npm install -g pm2
//   pm2 start ecosystem.config.js
//   pm2 save
module.exports = {
    apps: [{
        name: 'bot-afk-mc',
        script: 'index.js',
        instances: 1,
        autorestart: true,
        max_memory_restart: '512M',
        env: {
            NODE_ENV: 'production'
        }
    }]
};