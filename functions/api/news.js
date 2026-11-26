// Cloudflare Pages Function: GET /api/news?topic=ozone|daegu|climate
// 제목·언론사·날짜·링크만 JSON으로 돌려준다. 기사 본문·이미지는 가져오지 않는다. 결과는 30분 동안 캐시한다.
// 출처는 세 단계로 시도한다(앞 단계가 안 되면 다음 단계).
//   1. 구글 뉴스 검색 RSS: 이 컴퓨터에서는 되지만 Cloudflare 서버 요청은 503으로 거절되는 일이 많다.
//   2. 네이버 뉴스 검색: NAVER API HUB 키(비밀값 NCP_API_KEY_ID·NCP_API_KEY, 네이버클라우드 콘솔에서 발급) 또는 옛 개발자센터 키(NAVER_CLIENT_ID·NAVER_CLIENT_SECRET)가 있을 때. 있으면 가장 먼저 쓴다.
//   3. 언론사 공개 RSS 여러 개를 읽어 주제어로 거른다(경향, 한겨레, 뉴시스, 환경일보, 대구일보, 그린포스트코리아, 연합뉴스TV).
// 세 단계가 모두 비면 502를 돌려주고, 사이트는 배포 때 저장한 목록(news-snapshot.json)을 보여 준다.
const TOPICS = {
  ozone: { label: '오존', q: '오존 (주의보 OR 농도 OR 오염 OR 노출 OR 예보 OR 대기) when:90d', naver: '오존 주의보 농도', must: /오존/, not: /O3ohn|오존층|오존 구멍|오존 홀/ },
  daegu: { label: '대구 환경', q: '대구 (오존 OR 폭염 OR 대기질 OR 미세먼지 OR 탄소중립 OR 기후) when:60d', naver: ['대구 탄소중립', '대구 환경 기후 대기', '대구 폭염'], must: /대구|대프리카/, also: /오존|폭염|대기|미세먼지|탄소|기후|환경|에너지|태양광/ },
  climate: { label: '기후·대기', q: '(폭염 OR 기후위기 OR 대기오염 OR 미세먼지) (건강 OR 대책 OR 정책 OR 발령) when:30d', naver: '기후위기 대기오염 폭염', must: /폭염|기후|대기|오염|미세먼지|탄소/ },
};
const FEEDS = [
  ['경향신문', 'https://www.khan.co.kr/rss/rssdata/total_news.xml'], ['한겨레', 'https://www.hani.co.kr/rss/'], ['뉴시스', 'https://newsis.com/RSS/society.xml'],
  ['환경일보', 'http://www.hkbs.co.kr/rss/allArticle.xml'], ['대구일보', 'https://www.idaegu.co.kr/rss/allArticle.xml'], ['그린포스트코리아', 'https://www.greenpostkorea.co.kr/rss/allArticle.xml'],
  ['연합뉴스TV', 'https://www.yonhapnewstv.co.kr/browse/feed/'],
];
const UA = 'Mozilla/5.0 (compatible; daegu-ozone-timetable)';

const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const pick = (it, tag) => { const m = it.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>')); return m ? decode(m[1]) : ''; };

// 같은 사건을 다룬 비슷한 제목(두 글자 이상 낱말이 40% 이상 겹침)은 가장 최근 것 하나만 남긴다.
const words = s => new Set(s.replace(/[^가-힣a-zA-Z0-9]+/g, ' ').split(' ').filter(w => w.length >= 2));
const similar = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.max(1, Math.min(a.size, b.size)) >= 0.4; };
function distinct(items) {
  const kept = [];
  for (const n of items) { const w = words(n.title); if (!kept.some(k => similar(w, k.w))) kept.push({ n, w }); }
  return kept.map(k => k.n);
}
const fits = (t, title) => t.must.test(title) && !(t.not && t.not.test(title)) && !(t.also && !t.also.test(title));
const finish = (items, topic) => distinct(items.filter(n => n.title && /^https?:\/\//.test(n.link) && fits(TOPICS[topic], n.title)).sort((a, b) => (b.time || '').localeCompare(a.time || ''))).slice(0, 20);

export function parseFeed(xml, topic) {
  return finish([...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map(m => {
    const it = m[1], source = pick(it, 'source');
    let title = pick(it, 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const time = Date.parse(pick(it, 'pubDate'));
    const outlet = source.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').split(' - ')[0].replace(/^[^가-힣A-Za-z0-9]+|[^가-힣A-Za-z0-9.]+$/g, '').trim();
    return { title, source: outlet, link: pick(it, 'link'), time: Number.isFinite(time) ? new Date(time).toISOString() : null };
  }), topic);
}
// 언론사 RSS 하나(언론사 이름은 목록에서 준다)
function parseOutlet(xml, outlet) {
  return [...xml.slice(0, 160000).matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map(m => {
    const it = m[1], time = Date.parse(pick(it, 'pubDate') || pick(it, 'dc:date'));
    return { title: pick(it, 'title'), source: outlet, link: pick(it, 'link') || (it.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '', time: Number.isFinite(time) ? new Date(time).toISOString() : null };
  });
}
// 문서 머리에 적힌 인코딩(euc-kr 등)으로 읽는다. 지원하지 않는 인코딩이면 utf-8로 읽는다.
async function textOf(r) {
  const buf = await r.arrayBuffer(), head = new TextDecoder('utf-8').decode(buf.slice(0, 300));
  const enc = /encoding=["']?([\w-]+)/i.exec(head);
  try { return new TextDecoder(enc ? enc[1].toLowerCase() : 'utf-8').decode(buf); } catch (e) { return new TextDecoder('utf-8').decode(buf); }
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function fromGoogle(topic) {
  const r = await withTimeout(fetch('https://news.google.com/rss/search?q=' + encodeURIComponent(TOPICS[topic].q) + '&hl=ko&gl=KR&ceid=KR:ko', { headers: { 'User-Agent': UA } }), 8000);
  if (!r.ok) throw new Error('google HTTP ' + r.status);
  return { items: parseFeed(await r.text(), topic), source: 'Google 뉴스 검색 RSS' };
}
// 네이버 뉴스 검색: NAVER API HUB(네이버클라우드, 2026년 이후 신규 신청은 여기) 또는 옛 개발자센터 키. 응답 형식은 같다.
async function fromNaver(topic, env) {
  const hub = env.NCP_API_KEY_ID && env.NCP_API_KEY;
  const headers = hub ? { 'X-NCP-APIGW-API-KEY-ID': env.NCP_API_KEY_ID, 'X-NCP-APIGW-API-KEY': env.NCP_API_KEY } : { 'X-Naver-Client-Id': env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET };
  // 주제에 검색어가 여러 개면(대구) 각각 검색해 합친다. 네이버 검색은 낱말을 모두 포함한 기사만 돌려줘서 한 검색어로는 적게 걸린다.
  const queries = [].concat(TOPICS[topic].naver);
  const settled = await Promise.allSettled(queries.map(async q => {
    const url = hub
      ? 'https://naverapihub.apigw.ntruss.com/search/v1/news?' + new URLSearchParams({ query: q, display: 100, sort: 'date', format: 'json' })
      : 'https://openapi.naver.com/v1/search/news.json?' + new URLSearchParams({ query: q, display: 100, sort: 'date' });
    const r = await withTimeout(fetch(url, { headers }), 8000);
    if (!r.ok) throw new Error((hub ? 'naver hub' : 'naver') + ' HTTP ' + r.status);
    return (await r.json()).items || [];
  }));
  const pages = settled.filter(s => s.status === 'fulfilled').map(s => s.value);
  if (!pages.length) throw settled[0].reason || new Error('naver: 응답 없음');
  const seen = new Set();
  const items = pages.flat().filter(it => { const k = it.originallink || it.link; if (seen.has(k)) return false; seen.add(k); return true; }).map(it => {
    const link = it.originallink || it.link, time = Date.parse(it.pubDate);
    let outlet = ''; try { outlet = new URL(link).hostname.replace(/^www\./, ''); } catch (e) { /* 그대로 */ }
    return { title: decode(it.title || ''), source: outlet, link, time: Number.isFinite(time) ? new Date(time).toISOString() : null };
  });
  return { items: finish(items, topic), source: hub ? '네이버 뉴스 검색(NAVER API HUB)' : '네이버 뉴스 검색 API' };
}
async function fromOutlets(topic) {
  const got = await Promise.allSettled(FEEDS.map(async ([name, url]) => { const r = await withTimeout(fetch(url, { headers: { 'User-Agent': UA } }), 7000); if (!r.ok) throw new Error(name + ' HTTP ' + r.status); return parseOutlet(await textOf(r), name); }));
  const items = got.flatMap(g => (g.status === 'fulfilled' ? g.value : []));
  const okFeeds = got.filter(g => g.status === 'fulfilled').length;
  if (!okFeeds) throw new Error('언론사 RSS를 하나도 읽지 못했습니다');
  return { items: finish(items, topic), source: `언론사 RSS ${okFeeds}곳(${FEEDS.filter((_, i) => got[i].status === 'fulfilled').map(f => f[0]).join(', ')})` };
}

const json = (body, status, maxAge) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` },
});

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const topic = TOPICS[url.searchParams.get('topic')] ? url.searchParams.get('topic') : 'ozone';
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const cacheKey = new Request(url.origin + '/api/news?topic=' + topic + '&v=2'); // v를 올리면 이전 배포의 캐시를 버린다
  if (cache) { const hit = await cache.match(cacheKey); if (hit) return hit; }
  const tried = [];
  const hasNaver = env && ((env.NCP_API_KEY_ID && env.NCP_API_KEY) || (env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET));
  // 네이버 키가 있으면 네이버를 먼저 쓴다(검색어 기준 실시간). 없으면 구글 → 언론사 RSS.
  const tiers = [...(hasNaver ? [['naver', () => fromNaver(topic, env)]] : []), ['google', () => fromGoogle(topic)], ['outlets', () => fromOutlets(topic)]];
  for (const [name, fn] of tiers) {
    try {
      const { items, source } = await fn();
      if (!items.length) { tried.push(name + ': 0건'); continue; }
      const res = json({ ok: true, topic, label: TOPICS[topic].label, fetched: new Date().toISOString(), source, tier: name, tried, items }, 200, 1800);
      if (cache) await cache.put(cacheKey, res.clone());
      return res;
    } catch (e) { tried.push(name + ': ' + String(e && e.message || e)); }
  }
  return json({ ok: false, topic, error: tried.join(' / '), items: [] }, 502, 60);
}
