// api/cron.js
// Vercel Cron Job — chạy mỗi phút (xem vercel.json)
// Nhiệm vụ: scan toàn bộ tài khoản đang được theo dõi,
//           so sánh trạng thái mới vs cũ, gửi thông báo nếu thay đổi

const redis = require("../lib/redis");
const { getTikTokInfo, buildInfoMessage } = require("../lib/tiktok");

const BOT_TOKEN  = process.env.BOT_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET || "";   // optional security

// ─── Gửi tin nhắn Telegram qua Bot API ───────────────────────────────────────
async function sendTelegramMessage(chatId, text, options = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", ...options }),
  });
}

// ─── Lấy tất cả chat đang theo dõi từ Redis ──────────────────────────────────
async function getAllWatchEntries() {
  // Tìm tất cả key có dạng "watch:*"
  const keys = await redis.keys("watch:*");
  if (!keys || keys.length === 0) return [];

  const entries = [];
  for (const key of keys) {
    // key = "watch:{chatId}"
    const chatId  = key.replace("watch:", "");
    const members = await redis.smembers(key);
    if (members && members.length > 0) {
      entries.push({ chatId, usernames: members });
    }
  }
  return entries;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Bảo mật: Vercel tự gọi cron job, nhưng ta có thể thêm secret nếu muốn
  if (CRON_SECRET && req.headers["x-cron-secret"] !== CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("[CRON] Bắt đầu kiểm tra trạng thái TikTok...");

  try {
    const entries = await getAllWatchEntries();

    if (entries.length === 0) {
      console.log("[CRON] Không có tài khoản nào đang theo dõi.");
      return res.status(200).json({ ok: true, checked: 0 });
    }

    let totalChecked = 0;
    let totalNotified = 0;

    for (const { chatId, usernames } of entries) {
      for (const username of usernames) {
        try {
          // Lấy thông tin hiện tại từ TikTok
          const info = await getTikTokInfo(username);
          if (!info) {
            console.warn(`[CRON] Không lấy được info @${username}`);
            continue;
          }

          const newStatus  = info.isLive ? "live" : "offline";
          const statusKey  = `status:${chatId}:${username}`;
          const prevStatus = await redis.get(statusKey);

          totalChecked++;

          // Nếu trạng thái thay đổi → thông báo
          if (prevStatus !== null && prevStatus !== newStatus) {
            console.log(`[CRON] @${username} | ${prevStatus} → ${newStatus} | chat: ${chatId}`);

            if (newStatus === "live") {
              // Bắt đầu LIVE
              await sendTelegramMessage(
                chatId,
                `🔴🔴🔴 *@${info.username} VỪA BẮT ĐẦU LIVE!* 🔴🔴🔴\n\n` +
                buildInfoMessage(info) +
                `\n\n👆 Nhấn vào link trên để xem ngay!`,
                { disable_web_page_preview: false }
              );
            } else {
              // Kết thúc LIVE
              await sendTelegramMessage(
                chatId,
                `⭕ *@${info.username} đã kết thúc LIVE.*\n\n` +
                `Bot sẽ tiếp tục theo dõi và thông báo khi LIVE lại.`
              );
            }

            totalNotified++;
          } else if (prevStatus === null) {
            // Lần đầu gặp, chỉ lưu trạng thái, không notify
            console.log(`[CRON] Lần đầu lưu trạng thái @${username}: ${newStatus}`);
          }

          // Cập nhật trạng thái mới vào Redis
          await redis.set(statusKey, newStatus);

          // Tránh spam TikTok API quá nhanh
          await new Promise((r) => setTimeout(r, 500));

        } catch (err) {
          console.error(`[CRON] Lỗi khi xử lý @${username}:`, err.message);
        }
      }
    }

    console.log(`[CRON] Hoàn thành. Checked: ${totalChecked}, Notified: ${totalNotified}`);
    return res.status(200).json({ ok: true, checked: totalChecked, notified: totalNotified });

  } catch (err) {
    console.error("[CRON] Lỗi nghiêm trọng:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
