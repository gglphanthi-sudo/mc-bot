require('dotenv').config();
const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const { logMessage, broadcastBots } = require('./logger');
const { sendWebhook } = require('./webhook');

let bots = {}; // Lưu danh sách bot theo username

// Tự kết nối lại khi bot bị rớt mạng (bật/tắt bằng AUTO_RECONNECT trong .env)
const AUTO_RECONNECT = process.env.AUTO_RECONNECT !== 'false';
// Đếm số lần reconnect liên tiếp theo username (để tăng thời gian chờ dần - backoff)
const reconnectAttempts = {};

function scheduleReconnect(username) {
    const entry = bots[username];
    if (!entry) return;
    entry.status = 'reconnecting';
    broadcastBots(getBotStatuses());

    const attempt = (reconnectAttempts[username] || 0) + 1;
    reconnectAttempts[username] = attempt;
    // 5s -> 10s -> 20s -> 40s -> 60s (cap)
    const delay = Math.min(5000 * Math.pow(2, Math.min(attempt - 1, 3)), 60000);

    logMessage(`[RECONNECT] ${username} sẽ thử kết nối lại sau ${Math.round(delay / 1000)}s (lần ${attempt})...`, 'yellow');
    entry.reconnectTimer = setTimeout(() => {
        if (!bots[username]) return;
        const { host, port, password, proxy } = entry;
        delete entry.reconnectTimer;
        delete bots[username];
        startBot(host, port, username, password, proxy);
    }, delay);
}

// Chuyển chuỗi proxy (socks5://[user:pass@]host:port | host:port) thành config cho SocksClient
function parseProxy(proxy) {
    if (!proxy) return null;
    try {
        let urlStr = proxy.trim();
        if (!/^socks\d?:\/\//i.test(urlStr)) urlStr = 'socks5://' + urlStr;
        const url = new URL(urlStr);
        const type = url.protocol === 'socks4:' ? 4 : 5;
        const config = {
            host: url.hostname,
            port: Number(url.port) || 1080,
            type
        };
        if (url.username) config.userId = decodeURIComponent(url.username);
        if (url.password) config.password = decodeURIComponent(url.password);
        return config;
    } catch (e) {
        logMessage(`[PROXY] Không parse được proxy: ${proxy}`, 'red');
        return null;
    }
}

// Dùng proxy cho kết nối TCP tới server (SOCKS4/SOCKS5)
function buildConnect(proxyConfig, username, host, port) {
    return (client) => {
        SocksClient.createConnection({
            proxy: proxyConfig,
            command: 'connect',
            destination: { host, port: Number(port) }
        }, (err, info) => {
            if (err) {
                logMessage(`[PROXY] ${username} kết nối proxy lỗi: ${err.message}`, 'red');
                return;
            }
            client.setSocket(info.socket);
            client.emit('connect');
        });
    };
}

// ====== Cấu hình tự gõ lệnh đăng nhập (AuthMe kiểu /dn, /dk) ======
const FIRST_LOGIN_DELAY_MS = 1500;    // Đợi bao lâu sau khi spawn rồi mới gõ lệnh /dn lần đầu
const LOGIN_RETRY_MS = 4000;          // Nếu chưa xác nhận đăng nhập thành công, gõ lại sau bao lâu
const LOGIN_MAX_RETRIES = 5;
const LOGIN_COMMAND = (password) => `/dn ${password}`;   // Lệnh đăng nhập
const REGISTER_COMMAND = (password) => `/dk ${password} ${password}`; // Lệnh đăng ký (thử nếu server báo chưa có tài khoản)

// Các từ khoá nhận diện phản hồi từ server (không phân biệt hoa/thường, đã bỏ dấu tiếng Việt)
const LOGIN_SUCCESS_KEYWORDS = ['dang nhap thanh cong', 'logged in', 'you are now logged in', 'da dang nhap'];
const NOT_REGISTERED_KEYWORDS = ['chua dang ky', 'not registered', 'chua co tai khoan'];
const WRONG_PASSWORD_KEYWORDS = ['sai mat khau', 'incorrect password', 'wrong password'];

// ====== Cấu hình auto-join server con qua menu (right-click item) ======
const MENU_HOTBAR_SLOT = 5;      // Ô hotbar (1-9) chứa item mở menu chọn server
const TARGET_SERVER_NAME = 'KingSMP'; // Tên hiển thị trong menu cần bấm vào
const TARGET_SERVER_SLOT = 25;        // Số thứ tự ô chứa "KingSMP" trong menu, đếm từ trên xuống - trái sang phải, bắt đầu từ 1 (dùng khi không match được theo tên)
const MENU_AFTER_LOGIN_DELAY_MS = 1000; // Đợi bao nhiêu sau khi xác nhận login xong rồi mới bấm la bàn
const MENU_FALLBACK_DELAY_MS = 12000;   // Nếu không detect được login thành công, vẫn cứ thử mở menu sau tối đa bằng này
const MENU_RETRY_MS = 5000;             // Nếu chưa thấy menu mở, thử bấm lại sau bao lâu
const MENU_MAX_RETRIES = 3;

function stripColorCodes(text) {
    return String(text).replace(/§./g, '');
}

// Bỏ dấu tiếng Việt + hạ chữ thường, để so khớp từ khoá cho chắc (server ghi có dấu hay không đều bắt được)
function normalizeText(text) {
    return String(text)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function containsKeyword(text, keywords) {
    const norm = normalizeText(text);
    return keywords.some(k => norm.includes(k));
}

function flattenTextComponent(comp) {
    if (comp === null || comp === undefined) return '';
    if (typeof comp === 'string') return comp;
    if (Array.isArray(comp)) return comp.map(flattenTextComponent).join('');
    let out = comp.text || '';
    if (comp.extra) out += comp.extra.map(flattenTextComponent).join('');
    return out;
}

// Lấy tên hiển thị "thật" (custom name) của 1 item trong menu, kể cả khi tên
// được set qua NBT dạng JSON text component (kiểu server thường dùng cho GUI).
function extractItemName(item) {
    if (!item) return '';
    try {
        const nameTag = item.nbt && item.nbt.value && item.nbt.value.display &&
            item.nbt.value.display.value && item.nbt.value.display.value.Name &&
            item.nbt.value.display.value.Name.value;
        if (nameTag) {
            let text = nameTag;
            const trimmed = nameTag.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                text = flattenTextComponent(JSON.parse(trimmed));
            }
            return stripColorCodes(text);
        }
    } catch (e) {
        // bỏ qua lỗi parse NBT, fallback xuống dưới
    }
    return stripColorCodes(item.displayName || item.name || '');
}

// ---------------- Đăng nhập tự động (/dn, fallback /dk) ----------------
function sendLoginCommand(bot, username, password, attempt) {
    if (!bots[username] || bots[username].authLoggedIn) return;
    logMessage(`[LOGIN] ${username} đang gõ /dn (lần ${attempt})...`, 'cyan');
    bot.chat(LOGIN_COMMAND(password));

    bots[username].loginRetryTimeout = setTimeout(() => {
        if (!bots[username] || bots[username].authLoggedIn) return;
        if (attempt < LOGIN_MAX_RETRIES) {
            sendLoginCommand(bot, username, password, attempt + 1);
        } else if (attempt === LOGIN_MAX_RETRIES) {
            // /dn không có phản hồi rõ ràng sau nhiều lần -> có thể acc mới chưa đăng ký,
            // thử /dk 1 lần rồi quay lại /dn thêm vài lần nữa trước khi bỏ cuộc.
            logMessage(`[LOGIN] ${username} gõ /dn ${LOGIN_MAX_RETRIES} lần không thấy phản hồi, thử /dk phòng acc mới...`, 'yellow');
            bot.chat(REGISTER_COMMAND(password));
            bots[username].loginRetryTimeout = setTimeout(() => sendLoginCommand(bot, username, password, attempt + 1), 2000);
        } else if (attempt < LOGIN_MAX_RETRIES * 2) {
            sendLoginCommand(bot, username, password, attempt + 1);
        } else {
            logMessage(`[LOGIN] ${username} đã thử đăng nhập nhiều lần, vẫn chưa xác nhận. Sẽ vẫn thử mở la bàn.`, 'red');
        }
    }, LOGIN_RETRY_MS);
}

function startAutoLogin(bot, username, password) {
    bots[username].authLoggedIn = false;

    // Gõ /dn (đăng nhập) trước tiên - đúng cho acc đã có tài khoản (trường hợp phổ biến nhất).
    // Nếu server báo "chưa có tài khoản" thì watchServerMessages() sẽ tự chuyển sang gõ /dk.
    setTimeout(() => {
        sendLoginCommand(bot, username, password, 1);
    }, FIRST_LOGIN_DELAY_MS);

    // Dù không detect được thông báo thành công (server dùng title/actionbar thay vì chat),
    // vẫn cứ thử mở la bàn sau 1 khoảng thời gian để không bị kẹt mãi mãi.
    setTimeout(() => {
        if (bots[username] && !bots[username].authLoggedIn) {
            logMessage(`[LOGIN] ${username} không thấy phản hồi rõ ràng, thử mở la bàn luôn...`, 'yellow');
            markLoggedInAndOpenMenu(bot, username);
        }
    }, MENU_FALLBACK_DELAY_MS);
}

function markLoggedInAndOpenMenu(bot, username) {
    if (!bots[username] || bots[username].authLoggedIn) return;
    bots[username].authLoggedIn = true;
    if (bots[username].loginRetryTimeout) clearTimeout(bots[username].loginRetryTimeout);
    setTimeout(() => tryAutoJoinServer(bot, username), MENU_AFTER_LOGIN_DELAY_MS);
}

// Theo dõi mọi tin nhắn hệ thống từ server (thông báo lệnh /dn, /dk, v.v.) để biết đăng nhập thành công hay chưa,
// đồng thời log lại toàn bộ để dễ debug mà không cần chụp ảnh màn hình.
function watchServerMessages(bot, username, password) {
    bot.on('message', (jsonMsg) => {
        const text = jsonMsg.toString();
        if (!text || !text.trim()) return;
        logMessage(`[SERVER] ${username} <- ${text}`, 'magenta');

        if (!bots[username] || bots[username].authLoggedIn) return;

        if (containsKeyword(text, LOGIN_SUCCESS_KEYWORDS)) {
            logMessage(`[LOGIN] ${username} đăng nhập thành công!`, 'green');
            markLoggedInAndOpenMenu(bot, username);
        } else if (containsKeyword(text, NOT_REGISTERED_KEYWORDS)) {
            logMessage(`[LOGIN] ${username} chưa có tài khoản, thử đăng ký (/dk)...`, 'yellow');
            if (bots[username].loginRetryTimeout) clearTimeout(bots[username].loginRetryTimeout);
            bot.chat(REGISTER_COMMAND(password));
            bots[username].loginRetryTimeout = setTimeout(() => sendLoginCommand(bot, username, password, 1), 2000);
        } else if (containsKeyword(text, WRONG_PASSWORD_KEYWORDS)) {
            logMessage(`[LOGIN] ${username} SAI MẬT KHẨU! Kiểm tra lại mật khẩu đã thêm cho acc này.`, 'red');
        }
    });
}

// ---------------- Auto-join map KingSMP qua la bàn ----------------

// Bấm chuột phải vào item trong hotbar để mở menu chọn server
function openServerMenu(bot, username) {
    bot.setQuickBarSlot(MENU_HOTBAR_SLOT - 1);
    const heldItem = bot.heldItem || (bot.inventory && bot.inventory.slots[36 + (MENU_HOTBAR_SLOT - 1)]);
    const heldName = heldItem ? extractItemName(heldItem) : '(trống / chưa rõ)';
    logMessage(`[MENU] ${username} đang bấm item mở menu chọn server (ô ${MENU_HOTBAR_SLOT}, đang cầm: "${heldName}")...`, 'cyan');
    bot.activateItem();
}

// Gắn listener xử lý khi 1 GUI (window) mở ra: tìm ô có tên trùng TARGET_SERVER_NAME rồi bấm vào
function watchForServerMenu(bot, username) {
    bot.on('windowOpen', (window) => {
        const itemNames = window.slots
            .filter(it => it)
            .map(it => `[${it.slot}] "${extractItemName(it)}"`);
        logMessage(`[MENU] ${username} mở window "${stripColorCodes(flattenTextComponent(window.title) || '')}" (id ${window.id}) - items: ${itemNames.join(', ') || '(trống)'}`, 'cyan');

        const match = window.slots.find(it => it && extractItemName(it).toLowerCase().includes(TARGET_SERVER_NAME.toLowerCase()));
        const fallbackSlot = window.slots[TARGET_SERVER_SLOT - 1]; // TARGET_SERVER_SLOT đếm từ 1, mảng slots đếm từ 0
        const targetSlotNumber = match ? match.slot : (fallbackSlot ? fallbackSlot.slot : null);

        if (match) {
            logMessage(`[MENU] ${username} thấy "${TARGET_SERVER_NAME}" trong menu (ô ${match.slot}), đang bấm vào...`, 'green');
        } else if (fallbackSlot) {
            logMessage(`[MENU] ${username} không match được tên "${TARGET_SERVER_NAME}", dùng ô cố định số ${TARGET_SERVER_SLOT} (ô ${fallbackSlot.slot}: "${extractItemName(fallbackSlot)}"), đang bấm vào...`, 'yellow');
        } else {
            logMessage(`[MENU] ${username} mở 1 menu khác, không tìm thấy "${TARGET_SERVER_NAME}" và cũng không có ô số ${TARGET_SERVER_SLOT}`, 'yellow');
        }

        if (targetSlotNumber !== null) {
            setTimeout(() => {
                try {
                    bot.clickWindow(targetSlotNumber, 0, 0);
                    // Coi như đã bấm thành công -> dừng việc tự bấm lại item mở menu
                    if (bots[username]) {
                        bots[username].joinedTargetServer = true;
                        if (bots[username].menuRetryTimeout) clearTimeout(bots[username].menuRetryTimeout);
                    }
                } catch (e) {
                    logMessage(`[MENU] ${username} bấm menu lỗi: ${e.message}`, 'red');
                }
            }, 500);
        }
    });
}

// Thử bấm item mở menu, có retry vài lần phòng trường hợp bấm quá sớm lúc chưa spawn xong
function tryAutoJoinServer(bot, username, attempt = 1) {
    if (!bots[username] || bots[username].joinedTargetServer) return;
    openServerMenu(bot, username);

    bots[username].menuRetryTimeout = setTimeout(() => {
        if (!bots[username] || bots[username].joinedTargetServer) return;
        if (attempt < MENU_MAX_RETRIES) {
            logMessage(`[MENU] ${username} chưa vào được "${TARGET_SERVER_NAME}", thử lại lần ${attempt + 1}...`, 'yellow');
            tryAutoJoinServer(bot, username, attempt + 1);
        } else {
            logMessage(`[MENU] ${username} đã thử ${MENU_MAX_RETRIES} lần vẫn chưa vào được "${TARGET_SERVER_NAME}"`, 'red');
        }
    }, MENU_RETRY_MS);
}

// ---------------- Quản lý bot ----------------
function startBot(host, port, username, password, proxy) {
    if (bots[username]) {
        logMessage(`[WARN] Bot ${username} đã đang chạy rồi, bỏ qua!`, 'yellow');
        return bots[username];
    }

    logMessage(`[START] Đang khởi tạo bot ${username}${proxy ? ' (qua proxy)' : ''}...`, 'cyan');

    const options = {
        host: host,
        port: port,
        username: username,
        password: password,
        version: '1.20.1',
        auth: 'offline' // Đổi thành 'microsoft' nếu dùng acc bản quyền
    };

    const proxyConfig = parseProxy(proxy);
    if (proxyConfig) {
        options.connect = buildConnect(proxyConfig, username, host, port);
    }

    const bot = mineflayer.createBot(options);

    bots[username] = { bot, host, port, proxy: proxyConfig ? proxy : null, password, status: 'connecting', joinedTargetServer: false, authLoggedIn: false, autoReconnect: true };
    broadcastBots(getBotStatuses());

    watchForServerMenu(bot, username);
    watchServerMessages(bot, username, password);

    bot.on('login', () => {
        reconnectAttempts[username] = 0;
        bots[username].status = 'online';
        logMessage(`[MSG] ${username} -> Đã kết nối, đang chờ spawn...`, 'green');
        sendWebhook(`🟢 **${username}** đã vào server **${host}:${port}**`);
        broadcastBots(getBotStatuses());
    });

    // Chờ spawn xong (nhân vật đã vào world) rồi mới bắt đầu gõ lệnh đăng nhập -
    // an toàn hơn nhiều so với gõ ngay sau 'login' vì lúc đó thế giới có thể chưa tải xong.
    bot.once('spawn', () => {
        logMessage(`[MSG] ${username} -> Đã spawn vào world!`, 'green');
        startAutoLogin(bot, username, password);

        // Anti-AFK
        bots[username].afkInterval = setInterval(() => {
            if (bot && bot.entity) {
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 500);
                logMessage(`[AFK] ${username} đã nhảy chống AFK`, 'yellow');
            }
        }, 30000);
    });

    bot.on('chat', (chatUsername, message) => {
        if (chatUsername === bot.username) return;
        logMessage(`[CHAT] ${chatUsername}: ${message}`, 'white');
    });

    bot.on('kicked', (reason) => logMessage(`[KICK] ${username} bị kick: ${reason}`, 'red'));
    bot.on('error', (err) => logMessage(`[ERROR] ${username}: ${err.message}`, 'red'));
    bot.on('end', () => {
        logMessage(`[END] ${username} đã ngắt kết nối!`, 'red');
        const entry = bots[username];
        if (entry) {
            if (entry.afkInterval) clearInterval(entry.afkInterval);
            if (entry.menuRetryTimeout) clearTimeout(entry.menuRetryTimeout);
            if (entry.loginRetryTimeout) clearTimeout(entry.loginRetryTimeout);
        }
        // Nếu được phép (auto reconnect bật + không phải do người dùng ngắt) thì tự kết nối lại
        if (entry && AUTO_RECONNECT && entry.autoReconnect !== false) {
            scheduleReconnect(username);
            return;
        }
        delete bots[username];
        delete reconnectAttempts[username];
        sendWebhook(`🔴 **${username}** đã thoát khỏi server!`);
        broadcastBots(getBotStatuses());
    });
}

function stopBot(username) {
    const entry = bots[username];
    if (!entry) return false;
    // Chặn auto-reconnect khi người dùng chủ động ngắt bot
    entry.autoReconnect = false;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    if (entry.afkInterval) clearInterval(entry.afkInterval);
    if (entry.menuRetryTimeout) clearTimeout(entry.menuRetryTimeout);
    if (entry.loginRetryTimeout) clearTimeout(entry.loginRetryTimeout);
    entry.bot.quit();
    delete bots[username];
    delete reconnectAttempts[username];
    broadcastBots(getBotStatuses());
    return true;
}

// Bấm la bàn (mở menu -> bấm KingSMP) ngay lập tức theo yêu cầu (nút trên dashboard),
// không cần đợi lịch tự động sau khi login.
function joinKingSMPNow(username) {
    const entry = bots[username];
    if (!entry) return false;
    if (entry.menuRetryTimeout) clearTimeout(entry.menuRetryTimeout);
    entry.joinedTargetServer = false;
    tryAutoJoinServer(entry.bot, username);
    return true;
}

function getBot(username) {
    return bots[username] ? bots[username].bot : null;
}

function getAllBots() {
    return Object.keys(bots);
}

function getBotStatuses() {
    return Object.entries(bots).map(([username, entry]) => ({
        username,
        host: entry.host,
        port: entry.port,
        proxy: entry.proxy,
        status: entry.status
    }));
}

module.exports = { startBot, stopBot, getBot, getAllBots, getBotStatuses, joinKingSMPNow };
