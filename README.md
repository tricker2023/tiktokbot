# 🤖 TikTok LIVE Monitor Bot (Telegram + Vercel)

Bot Telegram theo dõi trạng thái LIVE TikTok, chạy **hoàn toàn miễn phí** trên Vercel.

## 🏗️ Kiến trúc

```
Telegram User
     │
     ▼ (gửi lệnh)
┌─────────────┐        ┌─────────────────┐
│  Vercel     │        │  Upstash Redis  │
│  Webhook    │◄──────►│  (lưu danh sách │
│  /api/webhook│        │   & trạng thái) │
└─────────────┘        └─────────────────┘
      ▲
      │ (mỗi phút)
┌─────────────┐        ┌─────────────────┐
│  Vercel     │        │  TikTok Web API │
│  Cron Job   │◄──────►│  (check LIVE)   │
│  /api/cron  │        │                 │
└─────────────┘        └─────────────────┘
      │
      ▼ (nếu có thay đổi)
Telegram Notification
```

## 🚀 Hướng dẫn deploy (từng bước)

### Bước 1: Tạo Telegram Bot

1. Mở Telegram, tìm **@BotFather**
2. Gõ `/newbot` → đặt tên → đặt username
3. Copy **BOT_TOKEN** (dạng: `123456789:ABCdef...`)

---

### Bước 2: Tạo Upstash Redis (miễn phí)

1. Truy cập [console.upstash.com](https://console.upstash.com)
2. Đăng ký / đăng nhập
3. Click **"Create Database"** → chọn **Redis**
4. Đặt tên, chọn region gần nhất (Singapore)
5. Sau khi tạo → vào tab **REST API**
6. Copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

---

### Bước 3: Deploy lên Vercel

#### Cách A: Qua GitHub (khuyên dùng)

1. Tạo repo GitHub mới, push toàn bộ code lên
2. Truy cập [vercel.com](https://vercel.com) → **Add New Project**
3. Import repo GitHub vừa tạo
4. Trong **Environment Variables**, thêm:
   ```
   BOT_TOKEN           = <token từ BotFather>
   UPSTASH_REDIS_REST_URL   = <URL từ Upstash>
   UPSTASH_REDIS_REST_TOKEN = <Token từ Upstash>
   ```
5. Click **Deploy** → đợi ~1 phút

#### Cách B: Qua Vercel CLI

```bash
npm i -g vercel
vercel login
vercel                    # deploy lần đầu
vercel env add BOT_TOKEN
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN
vercel --prod             # redeploy với env vars
```

---

### Bước 4: Đăng ký Webhook

Sau khi deploy xong, mở trình duyệt và truy cập:

```
https://YOUR-PROJECT.vercel.app/api/setup
```

Nếu thấy `"success": true` là thành công! ✅

---

## 📱 Cách dùng bot

| Lệnh | Chức năng |
|------|-----------|
| `/start` | Hướng dẫn sử dụng |
| `/addtiktok tramhuonglethat68` | Theo dõi @tramhuonglethat68 |
| `/removetiktok tramhuonglethat68` | Bỏ theo dõi |
| `/list` | Xem danh sách đang theo dõi |
| `/check tramhuonglethat68` | Kiểm tra nhanh (không theo dõi) |

---

## ⚙️ Cấu trúc file

```
tiktok-live-bot/
├── api/
│   ├── webhook.js   # Nhận lệnh Telegram
│   ├── cron.js      # Tự động check mỗi phút
│   └── setup.js     # Đăng ký webhook (chạy 1 lần)
├── lib/
│   ├── redis.js     # Kết nối Upstash Redis
│   └── tiktok.js    # Check TikTok API
├── vercel.json      # Config cron job
├── package.json
└── .env.example
```

## ⚠️ Lưu ý

- **Vercel Free**: Cron job chạy **tối thiểu mỗi phút** (không thể nhanh hơn)
- **Upstash Free**: 10,000 requests/ngày — đủ dùng cho ~6 tài khoản theo dõi liên tục
- TikTok có thể chặn nếu check quá nhiều tài khoản — nên giới hạn <10 tài khoản
