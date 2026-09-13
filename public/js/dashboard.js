const socket = io();
let logs = [];
let accountsCache = []; // dùng để tra mật khẩu theo username

// ---------- Logs realtime ----------
socket.on('log', (msg) => {
    logs.push(msg);
    if (logs.length > 100) logs.shift();
    const logsDiv = document.getElementById('logs');
    logsDiv.innerHTML = logs.map(l => `<div>${escapeHtml(l)}</div>`).join('');
    logsDiv.scrollTop = logsDiv.scrollHeight;
});

// ---------- Danh sách bot realtime ----------
socket.on('bots', (botList) => {
    renderBotList(botList);
    renderTargetSelects(botList);
});

function renderBotList(botList) {
    const container = document.getElementById('botList');
    if (!botList || botList.length === 0) {
        container.innerHTML = '<p style="color:var(--text-dim); font-size: 13px;">Chưa có bot nào online.</p>';
        return;
    }
    container.innerHTML = botList.map(b => `
        <div class="box" style="background: #000; margin-bottom: 5px; padding: 10px;">
            <div class="flex-between">
                <div>
                    <b>${escapeHtml(b.username)}</b>
                    <span style="color:var(--text-dim); font-size:11px;"> ${escapeHtml(b.host)}:${b.port}</span>
                    ${b.proxy ? '<span class="status-online" style="background:#333;color:#fff;border:1px solid #555;">PROXY</span>' : ''}
                    <span class="status-online">${b.status === 'online' ? 'ONLINE' : 'ĐANG KẾT NỐI'}</span>
                </div>
                <div>
                    <button class="btn-gray" style="padding: 4px 8px; font-size: 11px;" onclick="viewPassword('${escapeAttr(b.username)}')">👁 MK</button>
                    <button class="btn-blue" style="padding: 4px 8px; font-size: 11px;" onclick="joinKingSmp('${escapeAttr(b.username)}')">🧭 La bàn</button>
                    <button class="btn-red" style="padding: 4px 8px; font-size: 11px;" onclick="removeAccount('${escapeAttr(b.username)}')">✖ Ngắt</button>
                </div>
            </div>
        </div>
    `).join('');
}

function renderTargetSelects(botList) {
    const names = (botList || []).map(b => b.username);
    ['cmdTarget', 'payTarget'].forEach(id => {
        const select = document.getElementById(id);
        const current = select.value;
        select.innerHTML = '<option value="all">Tất cả bot</option>' +
            names.map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');
        if (names.includes(current)) select.value = current;
    });
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
function escapeAttr(str) {
    return String(str).replace(/'/g, "\\'");
}

// ---------- Webhook ----------
async function loadWebhook() {
    const res = await fetch('/api/webhook');
    const data = await res.json();
    if (data.url) {
        document.getElementById('webhookUrl').value = data.url;
        document.getElementById('webhookStatus').innerText = '✅ Đã cấu hình Webhook';
        document.getElementById('webhookStatus').style.color = '#ffffff';
    }
}
loadWebhook();

async function saveWebhook() {
    const url = document.getElementById('webhookUrl').value.trim();
    if (!url) return alert('Nhập URL đi!');
    const res = await fetch('/api/webhook/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });
    const data = await res.json();
    alert(data.message);
    if (data.success) {
        document.getElementById('webhookStatus').innerText = '✅ Đã cấu hình Webhook';
        document.getElementById('webhookStatus').style.color = '#ffffff';
    }
}

async function testWebhook() {
    const res = await fetch('/api/webhook/test', { method: 'POST' });
    const data = await res.json();
    alert(data.message);
}

// ---------- IP Server ----------
async function loadServerIp() {
    const res = await fetch('/api/server');
    const data = await res.json();
    document.getElementById('serverHost').value = data.host || '';
    document.getElementById('serverPort').value = data.port || 25565;
}
loadServerIp();

async function saveServerIp() {
    const host = document.getElementById('serverHost').value.trim();
    const port = document.getElementById('serverPort').value.trim() || '25565';
    if (!host) return alert('Nhập IP server!');
    const res = await fetch('/api/server/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port })
    });
    const data = await res.json();
    alert(data.message);
}

async function joinServerIp() {
    const host = document.getElementById('serverHost').value.trim();
    const port = document.getElementById('serverPort').value.trim() || '25565';
    if (!host) return alert('Nhập IP server!');
    if (!confirm(`Cho tất cả acc đã lưu kết nối tới ${host}:${port}?`)) return;
    const res = await fetch('/api/server/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port })
    });
    const data = await res.json();
    alert(data.message);
}

// ---------- Account / Bot ----------
async function loadBots() {
    const res = await fetch('/api/bots');
    const data = await res.json();
    accountsCache = data.accounts || [];
    renderBotList(data.bots);
    renderTargetSelects(data.bots);
}
loadBots();

async function addAccount() {
    const host = document.getElementById('accHost').value.trim();
    const port = document.getElementById('accPort').value.trim();
    const username = document.getElementById('accUser').value.trim();
    const password = document.getElementById('accPass').value.trim();
    const proxy = document.getElementById('accProxy').value.trim();
    if (!username || !password) return alert('Nhập đủ username và mật khẩu!');

    const res = await fetch('/api/account/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, host, port, proxy })
    });
    const data = await res.json();
    alert(data.message);
    if (data.success) {
        document.getElementById('accUser').value = '';
        document.getElementById('accPass').value = '';
        document.getElementById('accProxy').value = '';
        loadBots();
    }
}

async function removeAccount(username) {
    if (!confirm(`Ngắt & xóa acc ${username}?`)) return;
    const res = await fetch('/api/account/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
    });
    const data = await res.json();
    alert(data.message);
}

async function stopAll() {
    if (!confirm('Ngắt tất cả bot?')) return;
    const res = await fetch('/api/bots/stop-all', { method: 'POST' });
    const data = await res.json();
    alert(data.message);
}

function viewPassword(username) {
    const acc = accountsCache.find(a => a.username === username);
    if (!acc) return alert('Không tìm thấy acc này!');
    alert(`Username: ${acc.username}\nMật khẩu: ${acc.password}`);
}

// ---------- La bàn (join map KingSMP) ----------
async function joinKingSmp(target) {
    const res = await fetch('/api/bots/join-kingsmp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target })
    });
    const data = await res.json();
    alert(data.message);
}

async function joinKingSmpAll() {
    return joinKingSmp('all');
}

// ---------- Lệnh / chat ----------
async function sendCommand() {
    const target = document.getElementById('cmdTarget').value;
    const cmd = document.getElementById('cmdInput').value.trim();
    if (!cmd) return;
    const res = await fetch('/api/command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, target })
    });
    const data = await res.json();
    alert(data.message);
    document.getElementById('cmdInput').value = '';
}

// ---------- Chuyển tiền ----------
async function sendPay() {
    const target = document.getElementById('payTarget').value;
    const player = document.getElementById('payPlayer').value.trim();
    const amount = document.getElementById('payAmount').value.trim();
    if (!player || !amount) return alert('Nhập đủ thông tin!');
    const res = await fetch('/api/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, player, amount })
    });
    const data = await res.json();
    alert(data.message);
}

function clearLogs() {
    logs = [];
    document.getElementById('logs').innerHTML = '';
}
