// api/webhook.js
const { Bot } = require("grammy");
const redis = require("../lib/redis");
const { getTikTokInfo, buildInfoMessage } = require("../lib/tiktok");

const bot = new Bot(process.env.BOT_TOKEN);

const watchKey  = (chatId)        => `watch:${chatId}`;
const statusKey = (chatId, uname) => `status:${chatId}:${uname}`;

bot.command("start", (ctx) =>
  ctx.reply(
    `👋 Chào mừng đến với TikTok LIVE Monitor Bot!\n\n` +
    `Các lệnh có thể dùng:\n` +
    `➕ /addtiktok <username> — Theo dõi tài khoản TikTok\n` +
    `➖ /removetiktok <username> — Bỏ theo dõi\n` +
    `📋 /list — Danh sách đang theo dõi\n` +
    `🔍 /check <username> — Kiểm tra nhanh 1 tài khoản\n\n` +
    `Bot sẽ tự động thông báo khi tài khoản bắt đầu LIVE hoặc kết thúc LIVE 🔴`
  )
);

bot.command("check", async (ctx) => {
  const args = ctx.match?.trim();
  if (!args) return ctx.reply("⚠️ Dùng: /check <username>\nVí dụ: /check tramhuonglethat68");

  const username = args.replace(/^@/, "");
  const loadMsg  = await ctx.reply(`🔍 Đang kiểm tra @${username}...`);

  const info = await getTikTokInfo(username);
  if (!info) {
    return ctx.api.editMessageText(
      ctx.chat.id, loadMsg.message_id,
      `❌ Không tìm thấy tài khoản @${username}. Kiểm tra lại username nhé!`
    );
  }

  await ctx.api.editMessageText(
    ctx.chat.id, loadMsg.message_id,
    buildInfoMessage(info),
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );
});

bot.command("addtiktok", async (ctx) => {
  const args = ctx.match?.trim();
  if (!args) return ctx.reply("⚠️ Dùng: /addtiktok <username>\nVí dụ: /addtiktok tramhuonglethat68");

  const username = args.replace(/^@/, "").toLowerCase();
  const chatId   = String(ctx.chat.id);
  const loadMsg  = await ctx.reply(`🔍 Đang kiểm tra @${username}...`);

  const info = await getTikTokInfo(username);
  if (!info) {
    return ctx.api.editMessageText(
      ctx.chat.id, loadMsg.message_id,
      `❌ Không tìm thấy @${username}. Kiểm tra lại username nhé!`
    );
  }

  await redis.sadd(watchKey(chatId), username);
  await redis.set(statusKey(chatId, username), info.isLive ? "live" : "offline");

  const statusText = info.isLive
    ? `🔴 Hiện đang LIVE! Bot sẽ thông báo khi kết thúc.`
    : `⭕ Hiện không LIVE. Bot sẽ thông báo khi bắt đầu LIVE.`;

  await ctx.api.editMessageText(
    ctx.chat.id, loadMsg.message_id,
    `✅ Đã thêm theo dõi!\n\n` + buildInfoMessage(info) + `\n\n${statusText}`,
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );
});

bot.command("removetiktok", async (ctx) => {
  const args = ctx.match?.trim();
  if (!args) return ctx.reply("⚠️ Dùng: /removetiktok <username>");

  const username = args.replace(/^@/, "").toLowerCase();
  const chatId   = String(ctx.chat.id);

  const removed = await redis.srem(watchKey(chatId), username);
  await redis.del(statusKey(chatId, username));

  if (removed === 0) return ctx.reply(`⚠️ @${username} không có trong danh sách theo dõi.`);
  ctx.reply(`🗑 Đã bỏ theo dõi @${username}`);
});

bot.command("list", async (ctx) => {
  const chatId  = String(ctx.chat.id);
  const members = await redis.smembers(watchKey(chatId));

  if (!members || members.length === 0) {
    return ctx.reply("📋 Chưa theo dõi tài khoản nào.\n\nDùng /addtiktok <username> để thêm.");
  }

  const lines = await Promise.all(
    members.map(async (u) => {
      const st   = await redis.get(statusKey(chatId, u));
      const icon = st === "live" ? "🔴 LIVE" : "⭕ Offline";
      return `• @${u} — ${icon}`;
    })
  );

  ctx.reply(`📋 Danh sách đang theo dõi (${members.length}):\n\n${lines.join("\n")}\n\nBot tự check và thông báo khi trạng thái thay đổi.`);
});

// Handler cho Vercel
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, message: "TikTok Live Bot is running! 🤖" });
  }
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
    await bot.handleUpdate(body);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).json({ ok: false, error: err.message });
  }
};
