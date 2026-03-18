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
  username = username.replace(/^@/, "").trim();
  try {
    const url = `https://www.tiktok.com/api/user/detail/?uniqueId=${encodeURIComponent(username)}&aid=1988&app_language=vi-VN&app_name=tiktok_web`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.tiktok.com/",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const user  = data?.userInfo?.user  || {};
    const stats = data?.userInfo?.stats || {};
    if (!user.uniqueId) return null;
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
  } catch (e) {
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
  if (!info) return ctx.reply(`❌ Không tìm thấy @${username}`);
  ctx.reply(buildMsg(info));
});

bot.command("addtiktok", async (ctx) => {
  const username = ctx.match?.trim().replace(/^@/, "").toLowerCase();
  if (!username) return ctx.reply("⚠️ Dùng: /addtiktok <username>");
  const chatId = String(ctx.chat.id);
  await ctx.reply(`🔍 Đang kiểm tra @${username}...`);
  const info = await getTikTokInfo(username);
  if (!info) return ctx.reply(`❌ Không tìm thấy @${username}`);
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

module.exports = async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).send("Bot is running!");
  }
  try {
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
    console.error(err);
    res.status(200).send("ok");
  }
};
