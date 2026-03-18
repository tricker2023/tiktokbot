const { Bot } = require("grammy");
const { Redis } = require("@upstash/redis");

const bot = new Bot(process.env.BOT_TOKEN);
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const watchKey  = (chatId)        => `watch:${chatId}`;
const statusKey = (chatId, uname) => `status:${chatId}:${uname}`;

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n/1_000).toFixed(1)}K`;
  return String(n);
}

async function getTikTokInfo(username) {
  username = username.replace(/^@/, "").trim().toLowerCase();
  try {
    // Dùng Tikhub API (không bị chặn bởi TikTok)
    const url = `https://api.tikhub.io/api/v1/tiktok/app/v3/fetch_user_profile?username=${encodeURIComponent(username)}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${process.env.TIKHUB_TOKEN || ""}`,
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      const user  = data?.data?.userInfo?.user  || {};
      const stats = data?.data?.userInfo?.stats || {};
      if (user.uniqueId) {
        const isLive = !!user.roomId && user.roomId !== "0";
        return {
          username:  user.uniqueId,
          nickname:  user.nickname  || "",
          userId:    user.id        || "",
          followers: stats.followerCount  || 0,
          following: stats.followingCount || 0,
          likes:     stats.heartCount     || 0,
          videos:    stats.videoCount     || 0,
          isLive,
          liveUrl: isLive ? `https://www.tiktok.com/@${user.uniqueId}/live` : null,
        };
      }
    }

    // Fallback: scrape trang profile TikTok
    const profileUrl = `https://www.tiktok.com/@${username}`;
    const r2 = await fetch(profileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html",
        "Accept-Language": "vi-VN,vi;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!r2.ok) return null;
    const html = await r2.text();

    // Tìm JSON data trong HTML
    const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;

    const json = JSON.parse(match[1]);
    const userData = json?.["__DEFAULT_SCOPE__"]?.["webapp.user-detail"]?.userInfo;
    if (!userData) return null;

    const user2  = userData.user  || {};
    const stats2 = userData.stats || {};
    const isLive2 = !!user2.roomId && user2.roomId !== "0";

    return {
      username:  user2.uniqueId  || username,
      nickname:  user2.nickname  || "",
      userId:    user2.id        || "",
      followers: stats2.followerCount  || 0,
      following: stats2.followingCount || 0,
      likes:     stats2.heartCount     || 0,
      videos:    stats2.videoCount     || 0,
      isLive:    isLive2,
      liveUrl:   isLive2 ? `https://www.tiktok.com/@${user2.uniqueId}/live` : null,
    };
  } catch (e) {
    console.error("getTikTokInfo error:", e.message);
    return null;
  }
}

function buildMsg(info) {
  const now = new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  return (
    `📊 KẾT QUẢ KIỂM TRA TIKTOK\n` +
    `👤 Username: @${info.username}\n` +
    `📛 Tên: ${info.nickname}\n` +
    `🆔 ID: ${info.userId}\n\n` +
    `👥 Followers: ${fmtNum(info.followers)}\n` +
    `👣 Đang theo dõi: ${fmtNum(info.following)}\n` +
    `❤️ Lượt thích: ${fmtNum(info.likes)}\n` +
    `🎬 Số video: ${fmtNum(info.videos)}\n\n` +
    `📡 Trạng thái: ${info.isLive ? "🔴 ĐANG LIVE" : "⭕ Không LIVE"}\n` +
    `🕐 Cập nhật: ${now}` +
    (info.isLive ? `\n\n🔗 ${info.liveUrl}` : "")
  );
}

bot.command("start", (ctx) =>
  ctx.reply(
    `👋 Chào mừng đến với TikTok LIVE Monitor Bot!\n\n` +
    `➕ /addtiktok <username> — Theo dõi tài khoản\n` +
    `➖ /removetiktok <username> — Bỏ theo dõi\n` +
    `📋 /list — Danh sách đang theo dõi\n` +
    `🔍 /check <username> — Kiểm tra nhanh\n\n` +
    `Bot sẽ thông báo khi bắt đầu hoặc kết thúc LIVE 🔴`
  )
);

bot.command("check", async (ctx) => {
  const username = ctx.match?.trim().replace(/^@/, "");
  if (!username) return ctx.reply("⚠️ Dùng: /check <username>");
  await ctx.reply(`🔍 Đang kiểm tra @${username}...`);
  const info = await getTikTokInfo(username);
  if (!info) return ctx.reply(`❌ Không tìm thấy @${username}\n\nHãy kiểm tra lại username có đúng không.`);
  ctx.reply(buildMsg(info));
});

bot.command("addtiktok", async (ctx) => {
  const username = ctx.match?.trim().replace(/^@/, "").toLowerCase();
  if (!username) return ctx.reply("⚠️ Dùng: /addtiktok <username>");
  const chatId = String(ctx.chat.id);
  await ctx.reply(`🔍 Đang kiểm tra @${username}...`);
  const info = await getTikTokInfo(username);
  if (!info) return ctx.reply(`❌ Không tìm thấy @${username}\n\nHãy kiểm tra lại username có đúng không.`);
  await redis.sadd(watchKey(chatId), username);
  await redis.set(statusKey(chatId, username), info.isLive ? "live" : "offline");
  ctx.reply(
    `✅ Đã thêm theo dõi!\n\n` + buildMsg(info) +
    `\n\n${info.isLive ? "🔴 Đang LIVE! Sẽ báo khi kết thúc." : "⭕ Chưa LIVE. Sẽ báo khi bắt đầu."}`
  );
});

bot.command("removetiktok", async (ctx) => {
  const username = ctx.match?.trim().replace(/^@/, "").toLowerCase();
  if (!username) return ctx.reply("⚠️ Dùng: /removetiktok <username>");
  const chatId = String(ctx.chat.id);
  const removed = await redis.srem(watchKey(chatId), username);
  await redis.del(statusKey(chatId, username));
  if (removed === 0) return ctx.reply(`⚠️ @${username} không có trong danh sách.`);
  ctx.reply(`🗑 Đã bỏ theo dõi @${username}`);
});

bot.command("list", async (ctx) => {
  const chatId  = String(ctx.chat.id);
  const members = await redis.smembers(watchKey(chatId));
  if (!members || members.length === 0)
    return ctx.reply("📋 Chưa theo dõi ai.\n\nDùng /addtiktok <username> để thêm.");
  const lines = await Promise.all(
    members.map(async (u) => {
      const st = await redis.get(statusKey(chatId, u));
      return `• @${u} — ${st === "live" ? "🔴 LIVE" : "⭕ Offline"}`;
    })
  );
  ctx.reply(`📋 Đang theo dõi (${members.length}):\n\n${lines.join("\n")}`);
});

let botReady = false;

module.exports = async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).send("Bot is running!");
  }
  try {
    if (!botReady) {
      await bot.init();
      botReady = true;
    }
    const buf = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
    const update = JSON.parse(buf);
    await bot.handleUpdate(update);
    res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).send("ok");
  }
};
