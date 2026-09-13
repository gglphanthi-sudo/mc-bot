# Bot AFK KingMC — chạy localhost hoặc hosting, cấu hình qua .env

Dashboard chạy **không cần đăng nhập** (bỏ hẳn Google Cloud / email mật khẩu).
Toàn bộ acc bot được khai báo trong file `.env`. Khi bot bị rớt mạng sẽ **tự kết nối lại**,
app có hỗ trợ PM2 để chạy ổn định trên server/hosting.

## 1. Cài thư viện

```bash
npm install
```

## 2. Tạo file `.env`

Sao chép `.env.example` thành `.env`:

```bash
copy .env.example .env
```

Sửa các dòng theo nhu cầu:

- `PORT` / `HOST` — cổng và địa chỉ chạy dashboard.
  - Chạy local: `HOST=127.0.0.1`
  - Deploy hosting / mở ngoài mạng: `HOST=0.0.0.0` (dashboard không có đăng nhập,
    chỉ mở nếu bạn chấp nhận rủi ro, không nên expose ra Internet công khai).
- `AUTO_RECONNECT` — `true`/`false`, tự kết nối lại khi bot bị rớt mạng hoặc server restart.
- `SERVER_HOST` / `SERVER_PORT`: IP và port server mặc định (mặc định `kingmc.vn:25565`).
- `BOT_1_USERNAME` / `BOT_1_PASSWORD` / `BOT_1_PROXY` ...: cấu hình từng acc
  **theo số thứ tự**, điền lần lượt `BOT_1`, `BOT_2`, `BOT_3`...
  - `BOT_<n>_USERNAME` — tên nhân vật trong game (đã có username mới tính là có acc)
  - `BOT_<n>_PASSWORD` — mật khẩu `/dn`
  - `BOT_<n>_PROXY` — (tùy chọn) proxy riêng cho acc, bỏ trống nếu không dùng.
    Định dạng: `socks5://[user:pass@]host:port` (hỗ trợ SOCKS4/SOCKS5)
  - `BOT_<n>_HOST`, `BOT_<n>_PORT` — (tùy chọn) server riêng cho acc đó; bỏ trống thì dùng `SERVER_HOST/PORT`

Ví dụ:

```env
PORT=3000
HOST=0.0.0.0
AUTO_RECONNECT=true

SERVER_HOST=kingmc.vn
SERVER_PORT=25565

BOT_1_USERNAME=bot1
BOT_1_PASSWORD=mk1
BOT_1_PROXY=

BOT_2_USERNAME=bot2
BOT_2_PASSWORD=mk2
BOT_2_PROXY=socks5://user:pass@1.2.3.4:1080
```

- `DISCORD_WEBHOOK_URL` — (tùy chọn) URL webhook Discord để nhận thông báo khi bot vào/ra.

## 3. Chạy

```bash
npm start
```

- Khi khởi động, các acc trong `.env` sẽ được nạp vào `data/accounts.json`
  (cùng username thì cập nhật, không trùng) rồi **tự đăng nhập**.
- Mở dashboard để điều khiển: thêm acc, ngắt kết nối, gửi `/pay`, bấm la bàn vào KingSMP,
  xem log realtime. Acc thêm trên dashboard cũng được lưu và chạy tương tự (có ô proxy).
- Bot bị rớt mạng sẽ tự đợi (5s → 10s → 20s → 40s → tối đa 60s giữa các lần) và kết nối lại.
  Bấm nút **Ngắt** trên dashboard sẽ ngắt hẳn, không tự reconnect.

## 4. Chạy trên hosting bằng PM2 (khuyên dùng)

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save          # lưu để tự động chạy lại sau khi restart server
pm2 logs bot-afk-mc   # xem log
pm2 restart bot-afk-mc
pm2 stop bot-afk-mc
```

App có sẵn xử lý `SIGTERM`/`SIGINT`: khi PM2 stop/restart sẽ ngắt toàn bộ bot một cách
sạch sẽ. Nếu hosting gán sẵn một cổng (VD: PORT=8080), chỉ cần set `PORT` trong `.env`.

## Lưu ý

- Không commit file `.env`, `data/accounts.json`, `data/config.json` lên git công khai —
  chứa mật khẩu bot và webhook Discord.
- Dashboard **không có đăng nhập**: nếu đặt `HOST=0.0.0.0` và mở port ra ngoài thì
  ai cũng điều khiển được (kể cả xem mật khẩu). Chỉ dùng trong nội bộ / máy nhà
  hoặc phía sau lớp bảo vệ riêng của hosting.