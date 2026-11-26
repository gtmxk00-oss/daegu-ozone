/* 대구 오존 시간표 — 분석 핵심 계산(브라우저·Node 공용).
   analysis/analyze.cjs와 사이트의 '내 데이터 분석' 탭이 같은 코드를 쓴다. 고치면 두 곳 결과가 함께 바뀐다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OzoneCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 기준값 — 출처는 사이트의 '자료·출처'에 적는다.
  const T = {
    bad: 0.091,   // 통합대기환경지수 오존 '나쁨' 하한(1시간, ppm)
    std1h: 0.1,   // 대기환경기준 1시간 평균 0.1ppm 이하 → 초과는 > 0.1
    alert: 0.12,  // 오존주의보 발령 수준(1시간 평균 0.12ppm 이상)
    std8h: 0.06,  // 대기환경기준 8시간 평균 0.06ppm 이하 → 초과는 > 0.06
    who8h: 0.051, // WHO 2021 8시간 권고 100µg/m³ ≈ 0.051ppm(25℃, 1기압, 1ppb = 1.96µg/m³)
    pmBad: 36,    // 초미세먼지 '나쁨' 하한(µg/m³)
  };

  // ---------- 공통 도구 ----------
  const num = s => { const v = parseFloat(s); return Number.isFinite(v) ? v : NaN; };
  const round = (v, d = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
  const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const dayIndex = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 864e5); // 1970-01-01부터 날 수
  const dateOf = idx => { const t = new Date(idx * 864e5); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() }; };
  const iso = idx => { const { y, m, d } = dateOf(idx); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // UTF-8로 읽고 깨지면 EUC-KR로 다시 읽는다(공공데이터포털 CSV는 대부분 EUC-KR).
  function decode(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let t = new TextDecoder('utf-8').decode(u8);
    if (t.includes('�')) { try { t = new TextDecoder('euc-kr').decode(u8); } catch (e) { /* 그대로 둔다 */ } }
    return t.replace(/^﻿/, '');
  }

  // 따옴표 안의 쉼표·줄바꿈을 처리하는 CSV 파서
  function parseCSV(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  // ---------- 열 찾기: 대구시 자료(측정소명,년,월,일,시,…)와 에어코리아식(측정소명,측정일시,O3,…)을 모두 받는다 ----------
  const ALIASES = {
    st: ['측정소명', '측정소', '측정소이름', 'station', 'stationname'],
    y: ['년', '연도', 'year'], m: ['월', 'month'], d: ['일', 'day'], h: ['시', '시간', 'hour'],
    dt: ['측정일시', '일시', '측정시간', 'datetime', 'date', 'time', '날짜'],
    o3: ['오존', 'o3', 'ozone'], no2: ['이산화질소', 'no2'], pm25: ['초미세먼지', 'pm25', 'pm2.5', 'pm2_5'], co: ['일산화탄소', 'co'],
  };
  const normHead = s => String(s || '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/\s/g, '').toLowerCase();
  function detectColumns(header) {
    const h = header.map(normHead), map = {};
    for (const [k, names] of Object.entries(ALIASES)) {
      const i = h.findIndex(x => names.includes(x));
      if (i >= 0) map[k] = i;
    }
    const hasYMDH = ['y', 'm', 'd', 'h'].every(k => map[k] != null);
    const missing = [];
    if (map.o3 == null) missing.push('오존(O3)');
    if (!hasYMDH && map.dt == null) missing.push('시각(년·월·일·시 또는 측정일시)');
    if (hasYMDH) delete map.dt;
    return { map, missing, ok: !missing.length, timeFormat: hasYMDH ? '년·월·일·시' : '측정일시' };
  }

  function toRecords(rows, map) {
    const notes = [];
    const getYMDH = r => {
      if (map.dt != null) { const s = String(r[map.dt] || '').replace(/[^0-9]/g, ''); return s.length >= 10 ? [+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8), +s.slice(8, 10)] : null; }
      return [+r[map.y], +r[map.m], +r[map.d], +r[map.h]];
    };
    let zero = false, has24 = false;
    for (const r of rows) { const t = getYMDH(r); if (t && t[3] === 0) zero = true; if (t && t[3] === 24) has24 = true; }
    const shift = zero && !has24 ? 1 : 0;
    if (shift) notes.push('시각이 0~23시 형식이라 1~24시(그 시각까지의 1시간 평균) 형식으로 바꿨습니다.');
    const recs = [];
    let skipped = 0;
    for (const r of rows) {
      const t = getYMDH(r);
      if (!t) { skipped++; continue; }
      const [y, m, d] = t, h = t[3] + shift;
      if (!y || !m || !d || !(h >= 1 && h <= 24)) { skipped++; continue; }
      const di = dayIndex(y, m, d);
      recs.push({
        st: map.st != null ? String(r[map.st]).trim() : '전체', di, h, t: di * 24 + (h - 1), y, m,
        o3: num(r[map.o3]), no2: map.no2 != null ? num(r[map.no2]) : NaN, pm25: map.pm25 != null ? num(r[map.pm25]) : NaN, co: map.co != null ? num(r[map.co]) : NaN,
      });
    }
    // 단위 확인: 중앙값이 1보다 크면 ppb로 보고 ppm으로 바꾼다(ppm이면 오존·이산화질소는 보통 0.1 미만).
    for (const k of ['o3', 'no2']) {
      const v = recs.map(r => r[k]).filter(Number.isFinite).sort((a, b) => a - b);
      if (v.length && v[v.length >> 1] > 1) { recs.forEach(r => { r[k] /= 1000; }); notes.push(`${k === 'o3' ? '오존' : '이산화질소'} 값이 ppb 단위로 보여 1,000으로 나눠 ppm으로 바꿨습니다.`); }
    }
    if (map.st == null) notes.push('측정소 열이 없어 모든 행을 한 측정소(전체)로 계산했습니다.');
    if (map.pm25 == null) notes.push('초미세먼지 열이 없어 숨쉬기 좋은 시간과 일부 AI 입력값을 계산하지 않습니다.');
    if (map.no2 == null) notes.push('이산화질소 열이 없어 일변화·주말 효과 일부와 AI 입력값을 계산하지 않습니다.');
    return { recs, skipped, notes };
  }

  // ---------- 도시 전체 시간별 집계(측정소 평균·최댓값) ----------
  const cityCache = new WeakMap();
  function cityIndex(recs) {
    if (cityCache.has(recs)) return cityCache.get(recs);
    const city = new Map();
    for (const r of recs) {
      let c = city.get(r.t);
      if (!c) city.set(r.t, c = { o3s: 0, o3n: 0, o3max: -1, no2s: 0, no2n: 0, pm25s: 0, pm25n: 0, cos: 0, con: 0 });
      if (!isNaN(r.o3)) { c.o3s += r.o3; c.o3n++; if (r.o3 > c.o3max) c.o3max = r.o3; }
      if (!isNaN(r.no2)) { c.no2s += r.no2; c.no2n++; }
      if (!isNaN(r.pm25)) { c.pm25s += r.pm25; c.pm25n++; }
      if (!isNaN(r.co)) { c.cos += r.co; c.con++; }
    }
    const api = {
      mean: (t, k) => { const c = city.get(t); if (!c) return NaN; const n = c[k + 'n']; return n ? c[k + 's'] / n : NaN; },
      o3Max: t => { const c = city.get(t); return c && c.o3n ? c.o3max : NaN; },
      get: t => city.get(t),
    };
    cityCache.set(recs, api);
    return api;
  }

  function bootDiff(a, b, seed) { // mean(a) - mean(b), 부트스트랩 4,000회 95% 구간
    const R = rng(seed), it = 4000, diffs = [];
    for (let k = 0; k < it; k++) {
      let sa = 0, sb = 0;
      for (let i = 0; i < a.length; i++) sa += a[(R() * a.length) | 0];
      for (let i = 0; i < b.length; i++) sb += b[(R() * b.length) | 0];
      diffs.push(sa / a.length - sb / b.length);
    }
    diffs.sort((x, y) => x - y);
    return { diff: mean(a) - mean(b), lo: diffs[Math.floor(it * 0.025)], hi: diffs[Math.floor(it * 0.975)] };
  }

  // ---------- 요약 분석 ----------
  function summarize(recs, t = T) {
    if (!recs.length) throw new Error('읽을 수 있는 행이 없습니다.');
    const city = cityIndex(recs);
    const stations = [...new Set(recs.map(r => r.st))];
    let firstDay = Infinity, lastDay = -Infinity;
    for (const r of recs) { if (r.di < firstDay) firstDay = r.di; if (r.di > lastDay) lastDay = r.di; }
    const years = [...new Set(recs.map(r => r.y))].sort((a, b) => a - b);

    // 개요
    const valid = recs.filter(r => !isNaN(r.o3));
    const badRecs = valid.filter(r => r.o3 >= t.bad);
    const badDays = new Set(badRecs.map(r => r.di));
    const alertDays = new Set(valid.filter(r => r.o3 >= t.alert).map(r => r.di));
    const std8Days = new Set(), who8Days = new Set();
    let std8StationDays = 0;
    for (const st of stations) { // 8시간 이동평균(8개 중 6개 이상 유효할 때만)
      const series = new Map(recs.filter(r => r.st === st && !isNaN(r.o3)).map(r => [r.t, r.o3]));
      const ts = [...series.keys()].sort((a, b) => a - b);
      const exceed = new Set();
      for (const tt of ts) {
        let s = 0, n = 0;
        for (let k = 0; k < 8; k++) { const v = series.get(tt - k); if (v !== undefined) { s += v; n++; } }
        if (n >= 6 && s / n > t.std8h) exceed.add(Math.floor(tt / 24));
        if (n >= 6 && s / n > t.who8h) who8Days.add(Math.floor(tt / 24));
      }
      std8StationDays += exceed.size;
      for (const d of exceed) std8Days.add(d);
    }
    const maxO3 = valid.reduce((m, r) => (r.o3 > m ? r.o3 : m), 0);
    const maxRec = valid.find(r => r.o3 === maxO3);
    const overview = {
      start: iso(firstDay), end: iso(lastDay), years,
      stations: stations.length, rows: recs.length,
      o3Valid: valid.length, o3Missing: recs.length - valid.length,
      badHours: badRecs.length, over1hHours: valid.filter(r => r.o3 > t.std1h).length, alertHours: valid.filter(r => r.o3 >= t.alert).length,
      badDays: badDays.size, alertDays: alertDays.size,
      std8Days: std8Days.size, std8StationDays, who8Days: who8Days.size,
      std8ByYear: years.map(y => [...std8Days].filter(d => dateOf(d).y === y).length),
      who8ByYear: years.map(y => [...who8Days].filter(d => dateOf(d).y === y).length),
      maxO3,
      maxAt: maxRec ? { station: maxRec.st, date: iso(maxRec.di), hour: maxRec.h } : null,
    };

    // 달×시
    const MH = Array.from({ length: 12 }, () => Array.from({ length: 24 }, () => ({ o3n: 0, o3s: 0, o3bad: 0, pmn: 0, pmbad: 0, bothn: 0, either: 0 })));
    for (const r of recs) {
      const c = MH[r.m - 1][r.h - 1], o = !isNaN(r.o3), p = !isNaN(r.pm25);
      if (o) { c.o3n++; c.o3s += r.o3; if (r.o3 >= t.bad) c.o3bad++; }
      if (p) { c.pmn++; if (r.pm25 >= t.pmBad) c.pmbad++; }
      if (o && p) { c.bothn++; if (r.o3 >= t.bad || r.pm25 >= t.pmBad) c.either++; }
    }
    const monthHour = MH.map(row => row.map(c => ({ o3Mean: round(c.o3s / c.o3n, 4), o3Bad: round(c.o3bad / c.o3n * 100, 2), pmBad: round(c.pmbad / c.pmn * 100, 2), either: round(c.either / c.bothn * 100, 2), n: c.o3n })));

    // 연×월 나쁨 날 수
    const ym = {};
    for (const d of badDays) { const { y, m } = dateOf(d); ym[`${y}-${m}`] = (ym[`${y}-${m}`] || 0) + 1; }
    const yearMonth = years.map(y => Array.from({ length: 12 }, (_, i) => ym[`${y}-${i + 1}`] || 0));

    // 일변화(5~6월, 없으면 자료가 있는 모든 달)
    const months = recs.some(r => r.m === 5 || r.m === 6) ? [5, 6] : [...new Set(recs.map(r => r.m))].sort((a, b) => a - b);
    const diurnal = Array.from({ length: 24 }, (_, i) => {
      const h = i + 1, sel = recs.filter(r => months.includes(r.m) && r.h === h);
      const avg = k => round(mean(sel.filter(r => !isNaN(r[k])).map(r => r[k])), k === 'pm25' ? 1 : 4);
      return { h, o3: avg('o3'), no2: avg('no2'), pm25: avg('pm25') };
    });

    // 측정소별(4~9월)
    const season = r => r.m >= 4 && r.m <= 9;
    const stationStats = stations.map(st => {
      const sel = recs.filter(r => r.st === st && season(r) && !isNaN(r.o3));
      const ys = [...new Set(recs.filter(r => r.st === st).map(r => r.y))].sort();
      const bad = sel.filter(r => r.o3 >= t.bad).length;
      return { name: st, years: `${ys[0]}–${ys[ys.length - 1]}`, yearCount: ys.length, seasonHours: sel.length, badHours: bad, badShare: round(bad / sel.length * 100, 2), meanO3: round(mean(sel.map(r => r.o3)), 4) };
    }).sort((a, b) => (b.badShare ?? -1) - (a.badShare ?? -1));

    // 주말 효과(4~9월, 도시 일평균)
    const stDay = new Map();
    for (const r of recs) {
      if (!season(r)) continue;
      const k = r.st + '|' + r.di;
      let s = stDay.get(k);
      if (!s) stDay.set(k, s = { di: r.di, o3: [], no2: [] });
      if (!isNaN(r.o3)) s.o3.push(r.o3);
      if (!isNaN(r.no2)) s.no2.push(r.no2);
    }
    const cityDay = new Map();
    for (const s of stDay.values()) {
      let c = cityDay.get(s.di);
      if (!c) cityDay.set(s.di, c = { o3max: [], no2: [] });
      if (s.o3.length >= 18) c.o3max.push(Math.max(...s.o3));
      if (s.no2.length >= 18) c.no2.push(mean(s.no2));
    }
    const days = [...cityDay.entries()].map(([di, c]) => ({ di, dow: dateOf(di).dow, o3: mean(c.o3max), no2: mean(c.no2) })).filter(d => Number.isFinite(d.o3) && Number.isFinite(d.no2));
    const byDow = Array.from({ length: 7 }, (_, dow) => { const sel = days.filter(d => d.dow === dow); return { dow, n: sel.length, o3: round(mean(sel.map(d => d.o3)), 4), no2: round(mean(sel.map(d => d.no2)), 4) }; });
    const sun = days.filter(d => d.dow === 0), wkd = days.filter(d => d.dow >= 1 && d.dow <= 5);
    const effect = (k, seed) => { const b = bootDiff(sun.map(d => d[k]), wkd.map(d => d[k]), seed), base = mean(wkd.map(d => d[k])); return { ...b, pct: b.diff / base * 100, loPct: b.lo / base * 100, hiPct: b.hi / base * 100 }; };
    const weekend = sun.length >= 5 && wkd.length >= 20 ? { byDow, o3: effect('o3', 7), no2: effect('no2', 11), sunDays: sun.length, weekdayDays: wkd.length } : null;

    // 날마다 도시 최고 오존(줄무늬)
    const stripes = [];
    for (let di = firstDay; di <= lastDay; di++) {
      let mx = -1;
      for (let h = 0; h < 24; h++) { const v = city.o3Max(di * 24 + h); if (v > mx) mx = v; }
      stripes.push(mx >= 0 ? round(mx, 3) : null);
    }

    return { overview, monthHour, yearMonth, diurnal, diurnalMonths: months, stations: stationStats, weekend, stripes, stripesStart: iso(firstDay), firstDay, lastDay };
  }

  // ---------- AI 예보 입력값: 11시까지의 자료로 그날 13~18시 '나쁨' 여부 ----------
  const FEATURES = [
    { key: 'o3At11', label: '11시 오존 평균(측정소 평균)', unit: 'ppm' },
    { key: 'o3Max11', label: '11시 오존 최고(측정소 중 최고)', unit: 'ppm' },
    { key: 'o3Rise', label: '8시→11시 오존 상승폭', unit: 'ppm' },
    { key: 'no2Morning', label: '6~9시 이산화질소 평균', unit: 'ppm' },
    { key: 'pmMorning', label: '6~11시 초미세먼지 평균', unit: 'µg/m³' },
    { key: 'coMorning', label: '6~11시 일산화탄소 평균', unit: 'ppm' },
    { key: 'yMax', label: '전날 오존 최고값', unit: 'ppm' },
    { key: 'yBad', label: '전날 오후 나쁨 여부', unit: '0/1' },
    { key: 'doySin', label: '계절(연중 위치, 사인)', unit: '' },
    { key: 'doyCos', label: '계절(연중 위치, 코사인)', unit: '' },
    { key: 'weekend', label: '주말 여부', unit: '0/1' },
  ];
  // 하루치 입력값과 오후 판정을 만드는 도구. 학습(buildSamples)과 실시간 예보(dayFeatures)가 같은 식을 쓴다.
  function dayTools(recs, t, opts) {
    const city = cityIndex(recs);
    const hourMean = (di, hours, k) => { const v = hours.map(h => city.mean(di * 24 + h - 1, k)).filter(Number.isFinite); return v.length >= Math.ceil(hours.length * 0.75) ? mean(v) : NaN; };
    const afternoonBad = di => { // 13~18시, 측정소 minStations곳 이상 유효한 시간이 4개 이상일 때만 판정
      let ok = 0, bad = 0;
      for (let h = 13; h <= 18; h++) { const c = city.get(di * 24 + h - 1); if (c && c.o3n >= (opts.minStations || 8)) { ok++; if (c.o3max >= t.bad) bad = 1; } }
      return ok >= 4 ? bad : null;
    };
    const dayMax = di => { let mx = NaN; for (let h = 0; h < 24; h++) { const v = city.o3Max(di * 24 + h); if (Number.isFinite(v) && !(v <= mx)) mx = v; } return mx; };
    const features = di => {
      const { y, m, d, dow } = dateOf(di);
      const doy = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5;
      return {
        o3At11: city.mean(di * 24 + 10, 'o3'),
        o3Max11: city.o3Max(di * 24 + 10),
        o3Rise: city.mean(di * 24 + 10, 'o3') - city.mean(di * 24 + 7, 'o3'),
        no2Morning: hourMean(di, [6, 7, 8, 9], 'no2'),
        pmMorning: hourMean(di, [6, 7, 8, 9, 10, 11], 'pm25'),
        coMorning: hourMean(di, [6, 7, 8, 9, 10, 11], 'co'),
        yMax: dayMax(di - 1), yBad: afternoonBad(di - 1),
        doySin: Math.sin(2 * Math.PI * doy / 365.25), doyCos: Math.cos(2 * Math.PI * doy / 365.25),
        weekend: dow === 0 || dow === 6 ? 1 : 0,
      };
    };
    return { afternoonBad, features };
  }
  function buildSamples(recs, t = T, opts = {}) {
    const { afternoonBad, features } = dayTools(recs, t, opts);
    let firstDay = Infinity, lastDay = -Infinity;
    for (const r of recs) { if (r.di < firstDay) firstDay = r.di; if (r.di > lastDay) lastDay = r.di; }
    const samples = [], skipped = { label: 0, features: 0 };
    for (let di = firstDay + 1; di <= lastDay; di++) {
      const { y, m } = dateOf(di);
      if (m < 4 || m > 9) continue;
      const yv = afternoonBad(di), prev = afternoonBad(di - 1);
      if (yv === null || prev === null) { skipped.label++; continue; }
      const f = features(di);
      if (FEATURES.some(F => !Number.isFinite(f[F.key]))) { skipped.features++; continue; }
      samples.push({ di, date: iso(di), y, m, label: yv, f });
    }
    return opts.withSkipped ? { samples, skipped } : samples;
  }
  // 실시간 예보용: 하루(di)의 입력값, 빠진 입력값 목록, 그날 오후 실제 판정(아직 없으면 null)
  function dayFeatures(recs, di, t = T, opts = {}) {
    const { afternoonBad, features } = dayTools(recs, t, opts);
    const f = features(di);
    return { f, missing: FEATURES.filter(F => !Number.isFinite(f[F.key])).map(F => F.key), actual: afternoonBad(di) };
  }

  // 학습된 모델(params)로 확률 계산 — 사이트의 AI 예보와 같은 식
  function predict(params, f) { // params.features가 있으면 그 입력값 순서(기상 추가 모델), 없으면 FEATURES
    const keys = params.features || FEATURES.map(F => F.key);
    if (params.type === 'gbm') {
      const x = keys.map(k => f[k]); let z = params.base;
      for (let tr of params.trees) { while (tr.j !== undefined) tr = x[tr.j] <= tr.t ? tr.l : tr.r; z += params.lr * tr.v; }
      return 1 / (1 + Math.exp(-z));
    }
    let z = params.bias; keys.forEach((k, j) => { z += params.w[j] * (f[k] - params.mu[j]) / params.sd[j]; });
    return 1 / (1 + Math.exp(-z));
  }
  function scores(rows, preds) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    rows.forEach((r, i) => { const p = preds[i]; if (p && r.label) tp++; else if (p && !r.label) fp++; else if (!p && r.label) fn++; else tn++; });
    const precision = tp / (tp + fp) || 0, recall = tp / (tp + fn) || 0;
    const fb = b => ((1 + b * b) * precision * recall) / (b * b * precision + recall) || 0;
    return { tp, fp, fn, tn, accuracy: round((tp + tn) / rows.length, 3), precision: round(precision, 3), recall: round(recall, 3), f1: round(fb(1), 3), f2: round(fb(2), 3) };
  }
  function auc(rows, probs) {
    const pos = [], neg = [];
    rows.forEach((r, i) => (r.label ? pos : neg).push(probs[i]));
    if (!pos.length || !neg.length) return null;
    let s = 0; for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0;
    return round(s / (pos.length * neg.length), 3);
  }

  return { T, num, round, mean, dayIndex, dateOf, iso, rng, decode, parseCSV, detectColumns, toRecords, cityIndex, bootDiff, summarize, FEATURES, buildSamples, dayFeatures, predict, scores, auc };
});
