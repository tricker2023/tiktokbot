// api/tiktok.js — v2: fallback chain + retry + cache 30s
// Format response GIỮ NGUYÊN 100% — bot Python không cần sửa.
// Bot Python parse regex: r'userInfo"\s*:\s*({.*?})\s*,\s*"itemList"'

// ---- In-memory cache (sống trong warm function instance) ----
const _cache = new Map(); // username -> { data, ts }
const CACHE_TTL_MS = 30_000;

function cacheGet(username) {
  const item = _cache.get(username);
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL_MS) {
    _cache.delete(username);
    return null;
  }
  return item.data;
}
function cacheSet(username, data) {
  _cache.set(username, { data, ts: Date.now() });
  // Soft cap để không leak khi function chạy lâu
  if (_cache.size > 500) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
}

// ---- User agents pool — rotate để giảm CAPTCHA ----
const UA_POOL = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];
const pickUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

// ---- Sleep helper ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Source 1: HTML scrape /@user (giống cũ, đã giữ) ----
async function trySourceProfile(username) {
  const url = `https://www.tiktok.com/@${username}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": pickUA(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      "Referer": "https://www.tiktok.com/",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(12_000),
    redirect: "follow",
  });
  if (!r.ok) return null;
  const html = await r.text();
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let json;
  try { json = JSON.parse(m[1]); } catch { return null; }
  const ud = json?.["__DEFAULT_SCOPE__"]?.["webapp.user-detail"]?.userInfo;
  if (!ud) return null;
  const user = ud.user || {};
  const stats = ud.stats || {};
  if (!user.uniqueId) return null;
  return mapUserStats(username, user, stats);
}

// ---- Source 2: HTML scrape /@user/live ----
async function trySourceLive(username) {
  const url = `https://www.tiktok.com/@${username}/live`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": pickUA(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9",
      "Referer": "https://www.tiktok.com/",
    },
    signal: AbortSignal.timeout(12_000),
    redirect: "follow",
  });
  if (!r.ok) return null;
  const html = await r.text();
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let json;
  try { json = JSON.parse(m[1]); } catch { return null; }

  // Trang /live có cấu trúc khác — thử nhiều scope
  const scope = json?.["__DEFAULT_SCOPE__"] || {};
  const ud =
    scope?.["webapp.user-detail"]?.userInfo ||
    scope?.["webapp.live-room"]?.userInfo ||
    null;
  if (!ud) return null;
  const user = ud.user || {};
  const stats = ud.stats || {};
  if (!user.uniqueId) return null;
  return mapUserStats(username, user, stats);
}

// ---- Source 3: TikTok search API (fallback cuối, đã có sẵn trong webhook.js) ----
async function trySourceSearch(username) {
  const url = `https://www.tiktok.com/api/search/user/full/?keyword=${encodeURIComponent(username)}&aid=1988&app_language=vi-VN`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": pickUA(),
      "Referer": "https://www.tiktok.com/",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  let data;
  try { data = await r.json(); } catch { return null; }
  const users = data?.user_list || [];
  const found = users.find(
    (u) => (u?.user_info?.unique_id || "").toLowerCase() === username
  );
  if (!found) return null;
  const u = found.user_info || {};
  // Map từ search API về format chuẩn
  return {
    id:             String(u.uid || ""),
    uniqueId:       u.unique_id || username,
    nickname:       u.nickname || "",
    avatarLarger:   u.avatar_larger?.url_list?.[0] || u.avatar_medium?.url_list?.[0] || u.avatar_thumb?.url_list?.[0] || "",
    createTime:     0,
    privateAccount: !!u.secret,
    roomId:         u.room_id ? String(u.room_id) : "",
    followerCount:  u.follower_count || 0,
    followingCount: u.following_count || 0,
    heartCount:     u.total_favorited || 0,
    videoCount:     u.video_count || 0,
    friendCount:    u.friend_count || 0,
  };
}

// ---- Mapper ----
function mapUserStats(username, user, stats) {
  return {
    id:             user.id || "",
    uniqueId:       user.uniqueId || username,
    nickname:       user.nickname || "",
    avatarLarger:   user.avatarLarger || user.avatarMedium || user.avatarThumb || "",
    createTime:     user.createTime || 0,
    privateAccount: !!user.privateAccount,
    roomId:         user.roomId || "",
    followerCount:  stats.followerCount || 0,
    followingCount: stats.followingCount || 0,
    heartCount:     stats.heartCount || 0,
    videoCount:     stats.videoCount || 0,
    friendCount:    stats.friendCount || 0,
  };
}

// ---- Orchestrator: thử 3 source, mỗi source có 2 attempt ----
async function fetchTikTokProfile(username) {
  const sources = [
    { name: "profile", fn: trySourceProfile, retries: 2 },
    { name: "live",    fn: trySourceLive,    retries: 1 },
    { name: "search",  fn: trySourceSearch,  retries: 1 },
  ];
  let lastErr = null;
  for (const src of sources) {
    for (let attempt = 0; attempt < src.retries; attempt++) {
      try {
        const data = await src.fn(username);
        if (data) return data;
      } catch (e) {
        lastErr = e;
      }
      // Backoff: 400ms, 800ms — tránh hammer
      if (attempt < src.retries - 1) await sleep(400 * (attempt + 1));
    }
  }
  if (lastErr) console.error("[tiktok api] all sources failed:", lastErr.message);
  return null;
}

// ---- Build HTML format giữ nguyên cho bot Python parse ----
function buildFakeHtml(d) {
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
  return `<html><body><script>
window.__INIT_PROPS__ = {"userInfo":${userBlock},"itemList":[]}</script></body></html>`;
}

// ---- HTTP handler ----
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const username = (req.query.input || "").replace(/^@/, "").trim().toLowerCase();
  if (!username) return res.status(400).send("Missing ?input=username");

  // Validate username — TikTok cho phép a-z 0-9 . _
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return res.status(200).json({ data: { statusCode: 10221 } });
  }

  try {
    // Cache hit → trả ngay (tiết kiệm Vercel quota + không spam TikTok)
    const cached = cacheGet(username);
    if (cached) return res.status(200).send(buildFakeHtml(cached));

    const result = await fetchTikTokProfile(username);
    if (!result) {
      // Tất cả source đều fail → coi là DIE
      return res.status(200).json({ data: { statusCode: 10221 } });
    }

    cacheSet(username, result);
    return res.status(200).send(buildFakeHtml(result));
  } catch (err) {
    console.error("[tiktok api] fatal:", err && err.message);
    return res.status(200).json({ data: { statusCode: 10221 } });
  }
};
