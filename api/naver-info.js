// 숏애니 작품 제작 리스트 · 네이버웹툰 작품 정보 (줄거리·태그·장르·화수)
// 기존 api/naver.js 는 그대로 두고, 이 파일을 같은 api 폴더에 추가합니다.
// 호출: /api/naver-info?cid=850266
const GENRE = { PURE: "로맨스", ROMANCE: "로맨스", FANTASY: "판타지", ACTION: "액션", DRAMA: "드라마",
  DAILY: "일상", COMIC: "개그", THRILL: "스릴러", HISTORICAL: "무협/사극", SENSIBILITY: "감성", SPORTS: "스포츠" };
const GENRE_KO = ["로맨스", "판타지", "액션", "드라마", "일상", "개그", "스릴러", "무협/사극", "감성", "스포츠"];

module.exports = async (req, res) => {
  const cid = String((req.query && req.query.cid) || "").replace(/\D/g, "");
  if (!cid) return res.status(400).json({ ok: false, error: "cid required" });
  const H = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "Referer": `https://comic.naver.com/webtoon/list?titleId=${cid}`,
    "Accept": "application/json, text/plain, */*",
  };
  try {
    const r = await fetch(`https://comic.naver.com/api/article/list/info?titleId=${cid}`, { headers: H });
    if (!r.ok) throw new Error(`네이버 응답 ${r.status}`);
    const j = await r.json();
    const tags = (j.curationTagList || []).map(t => t && (t.tagName || t.name)).filter(Boolean);
    const types = (j.gfpAdCustomParam && j.gfpAdCustomParam.genreTypes) || j.genreTypes || [];
    let genre = types.map(t => GENRE[String(t).toUpperCase()]).find(Boolean)
             || tags.find(t => GENRE_KO.includes(t)) || null;
    let ep = null;
    try {
      const r2 = await fetch(`https://comic.naver.com/api/article/list?titleId=${cid}&page=1&sort=DESC`, { headers: H });
      if (r2.ok) { const k = await r2.json(); ep = k.totalCount ?? (k.articleList && k.articleList[0] && k.articleList[0].no) ?? null; }
    } catch (e) {}
    const age = j.age || {};
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      ok: true, cid: Number(cid),
      title: j.titleName || null,
      synopsis: (j.synopsis || "").replace(/\s+/g, " ").trim(),
      tags, genre, genreTypes: types,
      age: age.description || null,
      adult: !!j.adult || age.type === "RATE_18",
      thumb: j.thumbnailUrl || j.sharedThumbnailUrl || null,
      weekday: j.publishDescription || null,
      finished: !!j.finished, rest: !!j.rest,
      ep,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
