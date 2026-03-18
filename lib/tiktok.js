// lib/tiktok.js
// Kiểm tra trạng thái TikTok user (LIVE hay không, followers, ...)

/**
 * Lấy thông tin TikTok user qua web API không chính thức
 * @param {string} username - TikTok username (không cần @)
 * @returns {object|null}
 */
async function getTikTokInfo(username) {
  username = username.replace(/^@/, "").trim();

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    Referer: "https://www.tiktok.com/",
  };

  try {
    // API web TikTok - lấy thông tin user
    const url = `https://www.tiktok.com/api/user/detail/?uniqueId=${encodeURIComponent(username)}&aid=1988&app_language=vi-VN&app_name=tiktok_web&device_platform=web_pc`;

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const data = await res.json();
    const userInfo = data?.userInfo;
    if (!userInfo) return null;

    const user  = userInfo.user  || {};
    const stats = userInfo.stats || {};

    // Nếu có roomId => đang LIVE
    const isLive  = !!user.roomId && user.roomId !== "0" && user.roomId !== "";
    const roomId  = user.roomId || "";

    return {
      username:  user.uniqueId  || username,
      nickname:  user.nickname  || "",
      userId:    user.id        || "",
      followers: stats.followerCount  || 0,
      following: stats.followingCount || 0,
      likes:     stats.heartCount     || 0,
      videos:    stats.videoCount     || 0,
      isLive,
      roomId,
      verified:  !!user.verified,
      private:   !!user.privateAccount,
      liveUrl:   isLive ? `https://www.tiktok.com/@${user.uniqueId}/live` : null,
    };
  } catch (err) {
    console.error(`[TikTok] Lỗi khi check @${username}:`, err.message);
    return null;
  }
}

/**
 * Format số: 6600 → 6.6K
 */
function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Tạo tin nhắn hiển thị thông tin TikTok
 */
function buildInfoMessage(info) {
  const liveStatus = info.isLive ? "🔴 *ĐANG LIVE*" : "⭕ Không LIVE";
  const verified   = info.verified ? " ✅" : "";
  const privacy    = info.private  ? "🔒 Private" : "🌐 Public";
  const now        = new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

  let msg =
    `📊 *KẾT QUẢ KIỂM TRA TIKTOK*\n` +
    `${"─".repeat(28)}\n` +
    `👤 Username: @${info.username}${verified}\n` +
    `📛 Tên: ${info.nickname}\n` +
    `🆔 ID: \`${info.userId}\`\n` +
    `${privacy}\n\n` +
    `👥 Followers: *${fmtNum(info.followers)}*\n` +
    `👣 Đang theo dõi: ${fmtNum(info.following)}\n` +
    `❤️ Lượt thích: ${fmtNum(info.likes)}\n` +
    `🎬 Số video: ${fmtNum(info.videos)}\n\n` +
    `📡 Trạng thái: ${liveStatus}\n` +
    `🕐 Cập nhật: ${now}`;

  if (info.isLive && info.liveUrl) {
    msg += `\n\n🔗 [Xem LIVE ngay](${info.liveUrl})`;
  }

  return msg;
}

module.exports = { getTikTokInfo, buildInfoMessage, fmtNum };
