// Cloudflare Pages Function: GET /api/wx
// 대구 현재 기온·습도·풍속·풍향·일사량을 서버에서 받아 KV(CACHE)에 10분 저장한다. 방문자의 브라우저나 통신망과 상관없이 같은 값을 준다.
// 출처는 순서대로 시도한다(앞이 안 되면 다음).
//   1. Open-Meteo 예측값: 일사량까지 준다. 가끔 서버가 응답하지 않는다(2026-11-13 확인).
//   2. 기상청 초단기실황(공공데이터포털 15084084): DATA_GO_KR_KEY로 활용신청이 되어 있을 때만. 일사량은 없다.
//   3. MET Norway Locationforecast 예측값(CC BY 4.0): 일사량은 없다.
// 셋 다 안 되면 마지막으로 저장한 값을 stale 표시와 함께 돌려준다. 일사량을 못 받으면 마지막으로 받은 일사량과 그 시각을 따로 알려 준다.
const LAT = 35.8714, LON = 128.6014; // 대구광역시청 부근
const TTL = 10 * 60e3;
const UA = 'daegu-ozone-timetable/1.0 (https://daegu-ozone.pages.dev)';

const json = (body, status = 200, maxAge = 60) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` },
});
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const kstHM = ms => new Date(ms + 9 * 3600e3).toISOString().slice(11, 16);
const mem = new Map(); // KV가 없는 로컬 미리보기용

// 해의 고도(도). 일사량을 주지 않는 출처를 쓸 때 낮·밤만 가린다(천문 계산, 측정값 아님).
export function sunElevation(ms, lat = LAT, lon = LON) {
  const rad = Math.PI / 180, d = ms / 864e5 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}

async function fromOpenMeteo() {
  const r = await withTimeout(fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,shortwave_radiation,is_day&timezone=Asia%2FSeoul&wind_speed_unit=ms`, { headers: { 'User-Agent': UA } }), 5000);
  if (!r.ok) throw new Error('open-meteo HTTP ' + r.status);
  const c = (await r.json()).current;
  if (!c || typeof c.temperature_2m !== 'number') throw new Error('open-meteo 응답 형식');
  return { source: 'open-meteo', label: 'Open-Meteo 예측값', time: c.time.slice(11, 16), temp: c.temperature_2m, hum: c.relative_humidity_2m, ws: c.wind_speed_10m, wd: c.wind_direction_10m, sun: c.shortwave_radiation, isDay: !!c.is_day };
}
async function fromKma(key) {
  const t = new Date(Date.now() + 9 * 3600e3 - 45 * 60e3); // 초단기실황은 매시 40분 무렵 나온다
  const q = new URLSearchParams({ serviceKey: key, numOfRows: 20, pageNo: 1, dataType: 'JSON', base_date: t.toISOString().slice(0, 10).replace(/-/g, ''), base_time: t.toISOString().slice(11, 13) + '00', nx: 89, ny: 90 }); // 격자 89,90 = 대구 중구
  const r = await withTimeout(fetch('https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?' + q), 5000);
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch (e) { throw new Error('kma 응답 형식'); }
  if (!j.response) throw Object.assign(new Error('kma 활용신청 안 됨'), { unauthorized: true });
  if (j.response.header.resultCode !== '00') throw new Error('kma ' + j.response.header.resultMsg);
  const v = {}; for (const it of j.response.body.items.item) v[it.category] = parseFloat(it.obsrValue);
  if (!Number.isFinite(v.T1H)) throw new Error('kma 값 없음');
  return { source: 'kma', label: '기상청 초단기실황', time: t.toISOString().slice(11, 13) + ':00', temp: v.T1H, hum: v.REH, ws: v.WSD, wd: v.VEC, sun: null, isDay: sunElevation(Date.now()) > 0 };
}
async function fromMetNo() {
  const r = await withTimeout(fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`, { headers: { 'User-Agent': UA } }), 6000);
  if (!r.ok) throw new Error('met.no HTTP ' + r.status);
  const ts = (await r.json()).properties.timeseries, now = Date.now();
  const cur = ts.reduce((a, x) => (Math.abs(Date.parse(x.time) - now) < Math.abs(Date.parse(a.time) - now) ? x : a), ts[0]); // 지금과 가장 가까운 시각
  const d = cur.data.instant.details;
  return { source: 'met-norway', label: 'MET Norway 예측값', time: kstHM(Date.parse(cur.time)), temp: d.air_temperature, hum: d.relative_humidity, ws: d.wind_speed, wd: d.wind_from_direction, sun: null, isDay: sunElevation(now) > 0 };
}

export async function onRequest({ env }) {
  const kv = (env && env.CACHE) || { get: async k => mem.get(k) || null, put: async (k, v) => { mem.set(k, v); } };
  const read = async k => { const v = await kv.get(k); return v ? JSON.parse(v) : null; };
  const write = (k, v, ttl) => kv.put(k, JSON.stringify(v), { expirationTtl: ttl });
  const now = Date.now(), c = await read('wx:v1');
  if (c && now - c.fetched < TTL) return json({ ok: true, cached: true, ...c });
  const tried = [], key = env && env.DATA_GO_KR_KEY;
  const kmaOff = key ? await read('wx:kma-off') : true; // 활용신청이 안 된 키면 6시간 동안 다시 묻지 않는다
  const tiers = [['open-meteo', fromOpenMeteo], ...(key && !kmaOff ? [['kma', () => fromKma(key)]] : []), ['met-norway', fromMetNo]];
  for (const [name, fn] of tiers) {
    try {
      const d = await fn();
      // 일사량을 못 받은 출처면 마지막으로 받은 일사량과 그 시각을 함께 준다
      const lastSun = d.sun != null ? { v: d.sun, at: now, time: d.time } : (c && c.lastSun) || null;
      const body = { fetched: now, tried, ...d, lastSun };
      await write('wx:v1', body, 3 * 86400);
      return json({ ok: true, cached: false, ...body });
    } catch (e) {
      tried.push(name + ': ' + String(e && e.message || e));
      if (e && e.unauthorized) await write('wx:kma-off', { at: now }, 6 * 3600);
    }
  }
  if (c) return json({ ok: true, cached: true, stale: true, tried, ...c });
  return json({ ok: false, error: tried.join(' / ') }, 502, 30);
}
