api/naver.js
/* /api/naver?cid=769209
   네이버웹툰 공개 JSON 을 서버에서 대신 불러옵니다 (브라우저 CORS 회피).
   반환: { ok, cid, title, genre, age, adult, weekday, ep, thumb }

   표지 이미지가 핫링크로 막힐 때만 쓰는 우회 경로도 이 파일에 같이 들어 있습니다.
   → /api/naver?img=<인코딩된 이미지 주소>

   ※ 이 파일은 저장소 최상위의 api/ 폴더에 그대로 두세요 → /api/naver 주소가 됩니다.
     CommonJS(module.exports)로 작성해서 package.json 이 없어도 동작합니다. */

const IMG_ALLOW = /^https:\/\/([a-z0-9-]+\.)*(pstatic\.net|naver\.(com|net))\//i;

const MEM = new Map();                 // 서버 메모리 캐시
const MEM_TTL = 6 * 60 * 60 * 1000;    // 6시간

const UA = "Mozilla/5.0";
const DAY = { MONDAY: "월", TUESDAY: "화", WEDNESDAY: "수", THURSDAY: "목",
              FRIDAY: "금", SATURDAY: "토", SUNDAY: "일" };

function head(cid) {
  return {
    "user-agent": UA,
    referer: "https://comic.naver.com/webtoon/list?titleId=" + cid,
    accept: "application/json",
    "accept-language": "ko-KR,ko;q=0.9",
  };
}

async function getJSON(url, cid) {
  const r = await fetch(url, { headers: head(cid) });
  if (!r.ok) throw new Error("네이버 응답 " + r.status);
  const t = await r.text();
  try { return JSON.parse(t); }
  catch (e) { throw new Error("네이버가 JSON 대신 다른 응답을 보냈습니다"); }
}

function pickGenre(info) {
  const list = info.curationTagList || [];
  const hit = list.find((t) => String(t.curationType || "").startsWith("GENRE_"));
  if (hit && hit.tagName) return String(hit.tagName).replace(/^#/, "");
  const g = info.gfpAdCustomParam && info.gfpAdCustomParam.genreTypes;
  return Array.isArray(g) && g[0] ? String(g[0]) : null;
}

function pickWeekday(info) {
  const w = info.gfpAdCustomParam && info.gfpAdCustomParam.weekdays;
  if (Array.isArray(w) && w[0]) return String(w[0]);
  const p = info.publishDayOfWeekList;
  if (Array.isArray(p) && p[0]) return DAY[String(p[0]).toUpperCase()] || String(p[0]);
  return null;
}

module.exports = async function handler(req, res) {
  const q = req.query || {};

  // 표지 이미지 우회 — /api/naver?img=...
  if (q.img) {
    const u = String(q.img);
    if (!IMG_ALLOW.test(u)) { res.status(400).send("허용되지 않은 주소"); return; }
    try {
      const r = await fetch(u, {
        headers: { "user-agent": UA, referer: "https://comic.naver.com/" },
      });
      if (!r.ok) { res.status(r.status).send("이미지 응답 " + r.status); return; }
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "public, s-maxage=2592000, max-age=86400, immutable");
      res.status(200).send(buf);
    } catch (e) { res.status(502).send("이미지 가져오기 실패"); }
    return;
  }

  const cid = String(q.cid || "").trim();

  // 연결 확인용 — /api/naver?ping=1
  if (!cid && q.ping) {
    res.status(200).json({ ok: true, ping: true, node: process.version });
    return;
  }
  if (!/^\d+$/.test(cid)) {
    res.status(400).json({ ok: false, error: "cid(네이버 titleId)를 숫자로 넣어 주세요." });
    return;
  }

  const cached = MEM.get(cid);
  if (cached && Date.now() - cached.t < MEM_TTL) {
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
    res.status(200).json(cached.v);
    return;
  }

  try {
    const info = await getJSON("https://comic.naver.com/api/article/list/info?titleId=" + cid, cid);

    // 회차 수 — 목록 엔드포인트의 총 개수. 실패해도 나머지는 그대로 돌려준다.
    let ep = null;
    try {
      const l = await getJSON("https://comic.naver.com/api/article/list?titleId=" + cid + "&page=1", cid);
      const n = l.totalCount != null ? l.totalCount
              : (l.pageInfo && (l.pageInfo.totalRows != null ? l.pageInfo.totalRows : l.pageInfo.totalPages));
      if (typeof n === "number") ep = n;
    } catch (_) {}

    const age = info.age || {};
    const out = {
      ok: true,
      cid: cid,
      title: info.titleName || info.title || null,
      genre: pickGenre(info),
      age: age.description || null,
      adult: /RATE_(19|18)/.test(String(age.type || "")) || !!info.adult,
      weekday: pickWeekday(info),
      ep: ep,
      thumb: info.thumbnailUrl || info.posterThumbnailUrl || info.sharedThumbnailUrl || null,
      // dailyPass 는 '매일+ 이용권 대상 여부'라 연재 형태로 쓰면 안 됩니다. 참고용으로만 내려줍니다.
      dailyPass: !!info.dailyPass,
      finished: !!info.finished,
    };

    MEM.set(cid, { v: out, t: Date.now() });
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
    res.status(200).json(out);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ ok: false, cid: cid, error: String((e && e.message) || e) });
  }
};
