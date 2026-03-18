// api/tiktok.js
// Vercel API thay thế https://info-tiktok-user.vercel.app/tiktok?input=
// Trả về HTML chứa userInfo block để bot.py parse bằng regex
// Usage: GET /api/tiktok?input=username

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");

  const username = (req.query.input || "").replace(/^@/, "").trim().toLowerCase();
  if (!username) {
    return res.status(400).send("Missing ?input=username");
  }

  try {
    const result = await fetchTikTokProfile(username);

    if (!result) {
      // Trả về HTML giả có statusCode DIE để bot.py nhận ra
      return res.status(200).json({ data: { statusCode: 10221 } });
    }

    // Trả về HTML chứa userInfo block y hệt TikTok gốc
    // Bot.py dùng regex: r'userInfo"\s*:\s*({.*?})\s*,\s*"itemList"'
    const fakeHtml = buildFakeHtml(result);
    return res.status(200).send(fakeHtml);

  } catch (err) {
    console.error("[tiktok api] error:", err.message);
    return res.status(200).json({ data: { statusCode: 10221 } });
  }
};

// ── Scrape TikTok profile ────────────────────────────────────────────────────
async function fetchTikTokProfile(username) {
  const url = `https://www.tiktok.com/@${username}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    "Referer": "https://www.tiktok.com/",
  };

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  if (!res.ok) return null;
  const html = await res.text();

  // Parse JSON từ script tag
  const match = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) return null;

  let json;
  try { json = JSON.parse(match[1]); } catch { return null; }

  const ud = json?.["__DEFAULT_SCOPE__"]?.["webapp.user-detail"]?.userInfo;
  if (!ud) return null;

  const user  = ud.user  || {};
  const stats = ud.stats || {};

  if (!user.uniqueId) return null;

  // Check LIVE qua roomId
  const isLive = !!user.roomId && user.roomId !== "0" && user.roomId !== "";

  return {
    id:            user.id           || "",
    uniqueId:      user.uniqueId     || username,
    nickname:      user.nickname     || "",
    avatarLarger:  user.avatarLarger || user.avatarMedium || user.avatarThumb || "",
    createTime:    user.createTime   || 0,
    privateAccount: !!user.privateAccount,
    roomId:        user.roomId       || "",
    isLive,
    followerCount:  stats.followerCount  || 0,
    followingCount: stats.followingCount || 0,
    heartCount:     stats.heartCount     || 0,
    videoCount:     stats.videoCount     || 0,
    friendCount:    stats.friendCount    || 0,
  };
}

// ── Tạo HTML fake chứa userInfo block để bot.py parse ───────────────────────
function buildFakeHtml(d) {
  // Bot.py dùng regex tìm: userInfo":({...}),"itemList"
  // Nên ta nhúng đúng format đó vào HTML
  const userInfoBlock = JSON.stringify({
    user: {
      id:             d.id,
      uniqueId:       d.uniqueId,
      nickname:       d.nickname,
      avatarLarger:   d.avatarLarger,
      avatarMedium:   d.avatarLarger,
      avatarThumb:    d.avatarLarger,
      createTime:     d.createTime,
      privateAccount: d.privateAccount,
      roomId:         d.roomId,
    },
    stats: {
      followerCount:  d.followerCount,
      followingCount: d.followingCount,
      heartCount:     d.heartCount,
      videoCount:     d.videoCount,
      friendCount:    d.friendCount,
    }
  });

  // Nhúng vào HTML y hệt format TikTok gốc mà bot.py đang parse
  return `<html><body><script>
window.__INIT_PROPS__ = {
  "userInfo":${userInfoBlock},"itemList":[]
}
</script></body></html>`;
}
