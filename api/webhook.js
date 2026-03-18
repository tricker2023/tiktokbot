// api/webhook.js
// Vercel Serverless Function — nhận tin nhắn Telegram qua Webhook
// Bot nhận các lệnh: /start /addtiktok /removetiktok /list /check

const { Bot, webhookCallback } = require("grammy");
const redis = require("../lib/redis");
const { getTikTokInfo, buildInfoMessage } = require("../lib/tiktok");

// ─── Khởi tạo bot ───────────────────────────────────────────────────────────
const bot = new Bot(process.env.BOT_TOKEN);

// ─── Prefix key Redis ───────────────────────────────────────────────────────
// Lưu danh sách theo dõi theo từng chat:
//   watch:{chatId}  → Set của các username đang theo dõi
//   status:{chatId}:{username} → "live" | "offline"
const watchKey  = (chatId)          => `watch:${chatId}`;
const statusKey = (chatId, uname)   => `status:${chatId}:${uname}`;

// ─── /start ─────────────────────────────────────────────────────────────────
bot.command("start", (ctx) =>
  ctx.reply(
    `👋 Chào mừng bạn đến với *TikTok LIVE Monitor Bot!*\n\n` +
    `Các lệnh có thể dùng:\n` +
    `➕ /addtiktok \\<username\\> — Theo dõi tài khoản TikTok\n` +
    `➖ /removetiktok \\<username\\> — Bỏ theo dõi\n` +
    `📋 /list — Danh sách đang theo dõi\n` +
    `🔍 /check \\<username\\> — Kiểm tra nhanh 1 tài khoản\n\n` +
    `Bot sẽ tự động thông báo khi tài khoản *bắt đầu LIVE* hoặc *kết thúc LIVE* 🔴`,
    { parse_mode: "MarkdownV2" }
  )
);

// ─── /check <username> ───────────────────────────────────────────────────────
bot.command("check", async (ctx) => {
  const args = ctx.match?.trim();
  if (!args) return ctx.reply("⚠️ Dùng: /check <username>\nVí dụ: /check tramhuonglethat68");

  const username = args.replace(/^@/, "");
  const loadMsg  = await ctx.reply(`🔍 Đang kiểm tra @${username}...`);

  const info = await getTikTokInfo(username);
  if (!info) {
    return ctx.api.editMessageText(
      ctx.chat.id, loadMsg.message_id,
      `❌ Không tìm thấy tài khoản *@${username}*\\. Kiểm tra lại username nhé\\!`,
      { parse_mode: "MarkdownV2" }
    );
  }

  await ctx.api.editMessageText(
    ctx.chat.id, loadMsg.message_id,
    buildInfoMessage(info),
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );
});

// ─── /addtiktok <username> ───────────────────────────────────────────────────
bot.command("addtiktok", async (ctx) => {
  const args = ctx.match?.trim();
  if (!args) return ctx.reply("⚠️ Dùng: /addtiktok <username>\nVí dụ: /addtiktok tramhuonglethat68");

  const username = args.replace(/^@/, "").toLowerCase();
  const chatId   = String(ctx.chat.id);

  const loadMsg = await ctx.reply(`🔍 Đang kiểm tra @${username}...`);

  // Kiểm tra tài khoản tồn tại không
  const info = await getTikTokInfo(username);
  if (!info) {
    return ctx.api.editMessageText(
      ctx.chat.id, loadMsg.message_id,
      `❌ Không tìm thấy @${username}. Kiểm tra lại username nhé!`
    );
  }

  // Thêm vào danh sách theo dõi
  await redis.sadd(watchKey(chatId), username);

  // Lưu trạng thái hiện tại
  const currentStatus = info.isLive ? "live" : "offline";
  await redis.set(statusKey(chatId, username), currentStatus);

  const statusText = info.isLive
    ? `🔴 Hiện đang *LIVE*! Bot sẽ thông báo khi kết thúc.`
    : `⭕ Hiện không LIVE. Bot sẽ thông báo khi bắt đầu LIVE.`;

  await ctx.api.editMessageText(
    ctx.chat.id, loadMsg.message_id,
    `✅ *Đã thêm theo dõi!*\n\n` +
    buildInfoMessage(info) +
    `\n\n${statusText}`,
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );
});

// ─── /removetiktok <username> ────────────────────────────────────────────────
bot.command("removetiktok", async (ctx) => {
  const args = ctx.match?.trim();
  if (!args) return ctx.reply("⚠️ Dùng: /removetiktok <username>");

  const username = args.replace(/^@/, "").toLowerCase();
  const chatId   = String(ctx.chat.id);

  const removed = await redis.srem(watchKey(chatId), username);
  await redis.del(statusKey(chatId, username));

  if (removed === 0) {
    return ctx.reply(`⚠️ @${username} không có trong danh sách theo dõi.`);
  }
  ctx.reply(`🗑 Đã bỏ theo dõi *@${username}*`, { parse_mode: "Markdown" });
});

// ─── /list ───────────────────────────────────────────────────────────────────
bot.command("list", async (ctx) => {
  const chatId  = String(ctx.chat.id);
  const members = await redis.smembers(watchKey(chatId));

  if (!members || members.length === 0) {
    return ctx.reply(
      "📋 Chưa theo dõi tài khoản nào\\.\n\nDùng /addtiktok \\<username\\> để thêm\\.",
      { parse_mode: "MarkdownV2" }
    );
  }

  // Lấy trạng thái từng tài khoản từ Redis cache
  const lines = await Promise.all(
    members.map(async (u) => {
      const st = await redis.get(statusKey(chatId, u));
      const icon = st === "live" ? "🔴 LIVE" : "⭕ Offline";
      return `• @${u} — ${icon}`;
    })
  );

  ctx.reply(
    `📋 *Danh sách đang theo dõi (${members.length}):*\n\n${lines.join("\n")}\n\n` +
    `_Bot tự check mỗi phút và thông báo khi trạng thái thay đổi_`,
    { parse_mode: "Markdown" }
  );
});

// ─── Export webhook handler ──────────────────────────────────────────────────
module.exports = webhookCallback(bot, "https");
