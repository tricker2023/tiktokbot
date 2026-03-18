// api/tiktok.js
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const username = (req.query.input || "").replace(/^@/, "").trim().toLowerCase();
  if (!username) return res.status(400).send("Missing ?input=username");

  try {
    const result = await fetchTikTokProfile(username);
    if (!result) return res.status(200).json({ data: { statusCode: 10221 } });
    return res.status(200).send(buildFakeHtml(result));
  } catch (err) {
    console.error("[tiktok api] error:", err.message);
    return res.status(200).json({ data: { statusCode: 10221 } });
  }
};

async function fetchTikTokProfile(username) {
  const url = `https://www.tiktok.com/@${username}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      "Referer": "https://www.tiktok.com/",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  if (!res.ok) return null;
  const html = await res.text();

  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;

  let json;
  try { json = JSON.parse(match[1]); } catch { return null; }

  const ud = json?.["__DEFAULT_SCOPE__"]?.["webapp.user-detail"]?.userInfo;
  if (!ud) return null;

  const user  = ud.user  || {};
  const stats = ud.stats || {};
  if (!user.uniqueId) return null;

  return {
    id:             user.id             || "",
    uniqueId:       user.uniqueId       || username,
    nickname:       user.nickname       || "",
    avatarLarger:   user.avatarLarger   || user.avatarMedium || user.avatarThumb || "",
    createTime:     user.createTime     || 0,
    privateAccount: !!user.privateAccount,
    roomId:         user.roomId         || "",
    followerCount:  stats.followerCount  || 0,
    followingCount: stats.followingCount || 0,
    heartCount:     stats.heartCount     || 0,
    videoCount:     stats.videoCount     || 0,
    friendCount:    stats.friendCount    || 0,
  };
}

function buildFakeHtml(d) {
  // Bot Python parse bằng regex: r'userInfo"\s*:\s*({.*?})\s*,\s*"itemList"'
  // Cần có "userInfo":{...},"itemList" đúng format
  const userBlock = JSON.stringify({
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

  // QUAN TRỌNG: phải có ,"itemList" ngay sau block để regex match được
  return `<html><body><script>
window.__INIT_PROPS__ = {"userInfo":${userBlock},"itemList":[]}</script></body></html>`;
}
