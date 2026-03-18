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

// ── Lấy thông tin user từ trang profile ─────────────────────────────────────
async function getUserInfo(username) {
  username = username.replace(/^@/, "").trim().toLowerCase();
  try {
    const r = await fetch(`https://www.tiktok.com/@${username}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "vi-VN,vi;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;
    const json = JSON.parse(match[1]);
    const ud = json?.["__DEFAULT_SCOPE__"]?.["webapp.user-detail"]?.userInfo;
    if (!ud) return null;
    const user  = ud.user  || {};
    const stats = ud.stats || {};
    return { user, stats };
  } catch(e) {
    console.error("getUserInfo:", e.message);
    return null;
  }
}

// ── Check LIVE trực tiếp qua API riêng ──────────────────────────────────────
async function checkLiveStatus(username) {
  username = username.replace(/^@/, "").trim().toLowerCase();
  try {
    // Gọi thẳng API check live của TikTok
    const url = `https://www.tiktok.com/api/live/detail/?aid=1988&roomID=${username}`;
    
    // Cách đáng tin hơn: check trang /live
    const r = await fetch(`https://www.tiktok.com/@${username}/live`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "vi-VN,vi;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    
    const finalUrl = r.url;
    const html = await r.text();
    
    // Nếu redirect về trang profile = không LIVE
    // Nếu ở lại trang /live = đang LIVE
    if (finalUrl.includes("/live")) {
      // Tìm thêm dấu hiệu LIVE trong HTML
      const isLive = html.includes('"isLive":true') || 
                     html.includes('"status":4') ||
                     html.includes('"liveRoomInfo"') ||
                     !finalUrl.includes(`/@${username}?`);
      return isLive;
    }
    return false;
  } catch(e) {
    console.error("checkLiveStatus:", e.message);
    return false;
  }
}

// ── Lấy đầy đủ thông tin TikTok ─────────────────────────────────────────────
async function getTikTokInfo(username) {
  username = username.replace(/^@/, "").trim().toLowerCase();

  // Chạy song song: lấy profile + check live
  const [profileData, isLive] = await Promise.all([
    getUserInfo(username),
    checkLiveStatus(username),
  ]);

  if (!profileData) return null;

  const { user, stats } = profileData;

  return {
    username:  user.uniqueId  || username,
    nickname:  user.nickname  || "",
    userId:    user.id        || "",
    followers: stats.followerCount  || 0,
    following: stats.followingCount || 0,
    likes:     stats.heartCount     || 0,
    videos:    stats.videoCount     || 0,
    friends:   stats.friendCount    || 0,
    isLive,
    avatar:    user.avatarLarger || user.avatarMedium || "",
    verified:  !!user.verified,
    private:   !!user.privateAccount,
    liveUrl:   isLive ? `https://www.tiktok.com/@${user.uniqueId || username}/live` : null,
  };
}

// ── Thử lấy thông tin kể cả khi profile bị chặn ─────────────────────────────
async function getTikTokInfoFallback(username) {
  username = username.replace(/^@/, "").trim().toLowerCase();
  
  // Thử lấy qua API search
  try {
    const r = await fetch(
      `https://www.tiktok.com/api/search/user/full/?keyword=${encodeURIComponent(username)}&aid=1988&app_language=vi-VN`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://www.tiktok.com/",
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const users = data?.user_list || [];
    const found = users.find(u => 
      u?.user_info?.unique_id?.toLowerCase() === username
    );
    if (!found) return null;
    const u = found.user_info;
    const isLive = await checkLiveStatus(username);
    return {
      username:  u.unique_id   || username,
      nickname:  u.nickname    || "",
      userId:    u.uid         || "",
      followers: u.follower_count  || 0,
      following: u.following_count || 0,
      likes:     u.total_favorited || 0,
      videos:    u.video_count     || 0,
      friends:   u.friend_count    || 0,
      isLive,
      avatar:    u.avatar_larger?.url_list?.[0] || "",
      verified:  !!u.custom_verify,
      private:   !!u.secret,
      liveUrl:   isLive ? `https://www.tiktok.com/@${u.unique_id}/live` : null,
    };
  } catch(e) {
    return null;
  }
}

async function getInfo(username) {
  let info = await getTikTokInfo(username);
  if (!info) info = await getTikTokInfoFallback(username);
  return info;
}

function buildMsg(info) {
  const now = new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const verified = info.verified ? " ✅" : "";
  const privacy  = info.private  ? "🔒 Private" : "🌐 Public";
  return (
    `📊 KẾT QUẢ KIỂM TRA TIKTOK\n` +
    `👤 Username: @${info.username}${verified}\n` +
    `📛 Tên: ${info.nickname}\n` +
    `🆔 ID: ${info.userId}\n` +
    `${privacy}\n\n` +
    `👥 Followers: ${fmtNum(info.followers)}\n` +
    `👣 Đang theo dõi: ${fmtNum(info.following)}\n` +
    `❤️ Lượt thích: ${fmtNum(info.likes)}\n` +
    `🎬 Số video: ${fmtNum(info.videos)}\n` +
    `👫 Bạn bè: ${fmtNum(info.friends)}\n\n` +
    `📡 Trạng thái: ${info.isLive ? "✅ LIVE" : "❌ Không LIVE"}\n` +
    `🕐 Cập nhật: ${now}` +
    (info.isLive ? `\n\n🔗 ${info.liveUrl}` : "")
  );
}

async function sendInfo(ctx, info, prefix = "") {
  const caption = (prefix ? prefix + "\n\n" : "") + buildMsg(info);
  try {
    if (info.avatar) {
      await ctx.replyWithPhoto(info.avatar, { caption });
    } else {
      await ctx.reply(caption);
    }
  } catch(e) {
    await ctx.reply(caption);
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────
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
  const loadMsg = await ctx.reply(`🔍 Đang kiểm tra @${username}...`);
  const info = await getInfo(username);
  await ctx.api.deleteMessage(ctx.chat.id, loadMsg.message_id).catch(() => {});
  if (!info) return ctx.reply(`💀 Tài khoản @${username} không tồn tại hoặc đã bị DIE!`);
  await sendInfo(ctx, info);
});

bot.command("addtiktok", async (ctx) => {
  const username = ctx.match?.trim().replace(/^@/, "").toLowerCase();
  if (!username) return ctx.reply("⚠️ Dùng: /addtiktok <username>");
  const chatId = String(ctx.chat.id);
  const loadMsg = await ctx.reply(`🔍 Đang kiểm tra @${username}...`);
  const info = await getInfo(username);
  await ctx.api.deleteMessage(ctx.chat.id, loadMsg.message_id).catch(() => {});
  if (!info) return ctx.reply(`💀 Tài khoản @${username} không tồn tại hoặc đã bị DIE!`);
  await redis.sadd(watchKey(chatId), username);
  await redis.set(statusKey(chatId, username), info.isLive ? "live" : "offline");
  const statusText = info.isLive
    ? `🔴 Đang LIVE! Bot sẽ thông báo khi kết thúc.`
    : `⭕ Chưa LIVE. Bot sẽ thông báo khi bắt đầu LIVE.`;
  await sendInfo(ctx, info,
    `✅ ĐÃ LƯU THÀNH CÔNG!\n🔔 Bạn sẽ nhận thông báo khi @${username} thay đổi!\n${statusText}`
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

// ── Vercel handler ───────────────────────────────────────────────────────────
let botReady = false;

module.exports = async (req, res) => {
  if (req.method === "GET") return res.status(200).send("Bot is running!");
  try {
    if (!botReady) { await bot.init(); botReady = true; }
    const buf = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end",  () => resolve(data));
      req.on("error", reject);
    });
    await bot.handleUpdate(JSON.parse(buf));
    res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).send("ok");
  }
};
