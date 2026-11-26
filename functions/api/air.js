// Cloudflare Pages Function: GET /api/air?mode=now|hist
// 한국환경공단 에어코리아 대기오염정보(공공데이터포털 15073861)를 서버에서 받아 키를 숨기고, KV(CACHE)에 저장해
// 하루 호출 수(개발계정 500회)를 넘지 않게 한다.
//   now  : 대구 전체 측정소의 최신 1시간 값(시도별 실시간, 1회 호출). 20분 동안 다시 받지 않는다.
//          새로 받을 때 에어코리아가 6초 넘게 걸리면 저장해 둔 값을 stale 표시와 함께 먼저 주고, 새 값은 뒤에서 마저 저장한다.
//   hist : AI 예보에 쓰는 19개 측정소의 최근 48시간 값(측정소별 1회씩). 3시간마다, 그리고 11시 값이 나온 직후 한 번 새로 받는다.
// 예보 계산은 브라우저가 사이트의 학습 모델(data.js)과 같은 코드(ozone-core.js)로 한다.

const BASE = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/';
// 학습 자료(대구시 보건환경연구원 측정소 20곳)와 이름이 같은 측정소만 예보에 쓴다. 노원동은 에어코리아 목록에 없다.
export const STATIONS = ['남산1동', '수창동', '지산동', '서호동', '이현동', '대명동', '신암동', '태전동', '산격동', '만촌동', '호림동', '유가읍', '시지동', '진천동', '다사읍', '본동', '내당동', '침산동', '화원읍'];
const NOW_TTL = 20 * 60e3, HIST_TTL = 3 * 3600e3, FAIL_PAUSE = 10 * 60e3;
const NOW_WAIT = 6000, NOW_FAIL_PAUSE = 5 * 60e3; // now: 6초 안에 새 값이 안 오면 저장값을 먼저 준다

const json = (body, status = 200, maxAge = 120) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` },
});
const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const kst = () => new Date(Date.now() + 9 * 3600e3); // getUTC* 값이 한국 시각
const mem = new Map(); // KV가 없는 로컬 미리보기용

async function call(key, op, params) {
  const r = await fetch(BASE + op + '?' + new URLSearchParams({ serviceKey: key, returnType: 'json', ver: '1.0', ...params }));
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`에어코리아 응답 형식 오류(HTTP ${r.status})`); }
  const h = j.response && j.response.header;
  if (!h || h.resultCode !== '00') throw new Error('에어코리아 ' + ((h && h.resultMsg) || '오류'));
  return (j.response.body && j.response.body.items) || [];
}
// 행: [측정시각, 오존 ppm, 이산화질소 ppm, 초미세먼지 µg/m³, 일산화탄소 ppm, 미세먼지 µg/m³]
const row = it => [it.dataTime, num(it.o3Value), num(it.no2Value), num(it.pm25Value), num(it.coValue), num(it.pm10Value)];

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: String(e.message || e) }; } } }));
  return out;
}

export async function onRequest(ctx) {
  const { request, env } = ctx;
  // 응답을 보낸 뒤에도 남은 작업(늦게 온 값을 저장)을 끝까지 하게 한다. 로컬 미리보기에는 waitUntil이 없다.
  const keep = p => { const q = p.catch(() => {}); try { if (ctx.waitUntil) ctx.waitUntil(q); } catch (e) { /* 없으면 그냥 둔다 */ } };
  const mode = new URL(request.url).searchParams.get('mode') || 'hist';
  const key = env && env.DATA_GO_KR_KEY;
  if (!key) return json({ ok: false, error: '서버에 에어코리아 키가 아직 연결되지 않았습니다.' }, 503, 60);
  const kv = (env && env.CACHE) || { get: async k => mem.get(k) || null, put: async (k, v) => { mem.set(k, v); } };
  const read = async k => { const v = await kv.get(k); return v ? JSON.parse(v) : null; };
  const write = (k, v) => kv.put(k, JSON.stringify(v), { expirationTtl: 3 * 86400 });
  const now = Date.now();

  if (mode === 'now') {
    const c = await read('now:v1');
    if (c && now - c.fetched < NOW_TTL) return json({ ok: true, cached: true, ...c });
    const stale = () => json({ ok: true, cached: true, stale: true, ...c }, 200, 30);
    const lastFail = await read('now:fail'); // 에어코리아가 막 실패했으면 5분 동안은 다시 묻지 않는다(하루 호출 수 보호)
    if (lastFail && now - lastFail.at < NOW_FAIL_PAUSE) return c ? stale() : json({ ok: false, error: '에어코리아 응답이 없어 잠시 쉬는 중입니다.' }, 502, 60);
    const refresh = (async () => {
      try {
        const items = await call(key, 'getCtprvnRltmMesureDnsty', { sidoName: '대구', numOfRows: 100, pageNo: 1 });
        if (!items.length) throw new Error('에어코리아 값 없음');
        const body = { fetched: now, source: '한국환경공단 에어코리아(시도별 실시간 측정정보)', stations: items.map(it => ({ st: it.stationName, row: row(it) })) };
        await write('now:v1', body);
        return body;
      } catch (e) { await write('now:fail', { at: now }); throw e; }
    })();
    if (!c) { // 저장해 둔 값이 없으면 끝까지 기다린다
      try { return json({ ok: true, cached: false, ...(await refresh) }); } catch (e) { return json({ ok: false, error: String(e.message || e) }, 502, 60); }
    }
    // 에어코리아가 늦으면 저장해 둔 값을 먼저 주고, 새 값은 뒤에서 마저 받아 저장한다(다음 요청부터 새 값)
    const first = await Promise.race([refresh.then(body => ({ body }), () => ({ failed: true })), new Promise(res => setTimeout(() => res({ slow: true }), NOW_WAIT))]);
    if (first.body) return json({ ok: true, cached: false, ...first.body });
    if (first.slow) keep(refresh);
    return stale();
  }

  if (mode === 'hist') {
    const c = await read('hist:v1');
    const t = kst(), today11 = `${t.toISOString().slice(0, 10)} 11:00`;
    const after11 = t.getUTCHours() * 60 + t.getUTCMinutes() >= 11 * 60 + 20; // 11시 값은 보통 11시 15분 전후에 나온다
    const retryWindow = after11 && t.getUTCHours() < 14; // 11시 값이 늦으면 14시까지 30분 간격으로만 다시 본다
    const need = !c || now - c.fetched > HIST_TTL || (retryWindow && (c.latest || '') < today11 && now - c.fetched > 30 * 60e3);
    if (!need) return json({ ok: true, cached: true, ...c });
    const lastFail = await read('hist:fail');
    if (lastFail && now - lastFail.at < FAIL_PAUSE) return c ? json({ ok: true, cached: true, stale: true, ...c }) : json({ ok: false, error: '에어코리아 응답이 없어 잠시 쉬는 중입니다. 몇 분 뒤 다시 열어 주세요.' }, 502, 60);
    const got = await pool(STATIONS, 5, st => call(key, 'getMsrstnAcctoRltmMesureDnsty', { stationName: st, dataTerm: 'MONTH', numOfRows: 48, pageNo: 1 }));
    const stations = {}; let latest = '';
    got.forEach((items, i) => { if (Array.isArray(items) && items.length) { stations[STATIONS[i]] = items.map(row); if (items[0].dataTime > latest) latest = items[0].dataTime; } });
    if (Object.keys(stations).length < 10) {
      await write('hist:fail', { at: now });
      if (c) return json({ ok: true, cached: true, stale: true, ...c });
      return json({ ok: false, error: '측정소 자료를 충분히 받지 못했습니다.' }, 502, 60);
    }
    const body = { fetched: now, latest, source: '한국환경공단 에어코리아(측정소별 실시간 측정정보)', stations };
    await write('hist:v1', body);
    return json({ ok: true, cached: false, ...body });
  }
  if (mode === 'month') {
    // '내 데이터 분석'의 최근 30일 분석용: 측정소 19곳의 최근 한 달 시간값. 12시간에 한 번만 새로 받는다(하루 최대 38회 호출).
    const c = await read('month:v1');
    if (c && now - c.fetched < 12 * 3600e3) return json({ ok: true, cached: true, ...c });
    const lastFail = await read('month:fail');
    if (lastFail && now - lastFail.at < FAIL_PAUSE) return c ? json({ ok: true, cached: true, stale: true, ...c }) : json({ ok: false, error: '에어코리아 응답이 없어 잠시 쉬는 중입니다. 몇 분 뒤 다시 열어 주세요.' }, 502, 60);
    const got = await pool(STATIONS, 4, st => call(key, 'getMsrstnAcctoRltmMesureDnsty', { stationName: st, dataTerm: 'MONTH', numOfRows: 744, pageNo: 1 }));
    const stations = {}; let latest = '';
    got.forEach((items, i) => { if (Array.isArray(items) && items.length) { stations[STATIONS[i]] = items.map(row); if (items[0].dataTime > latest) latest = items[0].dataTime; } });
    if (Object.keys(stations).length < 10) {
      await write('month:fail', { at: now });
      if (c) return json({ ok: true, cached: true, stale: true, ...c });
      return json({ ok: false, error: '측정소 자료를 충분히 받지 못했습니다.' }, 502, 60);
    }
    const body = { fetched: now, latest, source: '한국환경공단 에어코리아(측정소별 실시간 측정정보, 최근 1개월)', stations };
    await write('month:v1', body);
    return json({ ok: true, cached: false, ...body });
  }
  return json({ ok: false, error: 'mode는 now, hist, month 중 하나' }, 400, 60);
}
