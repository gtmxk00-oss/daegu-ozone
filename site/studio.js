/* 분석 작업대(데이터 분석 Tool): 올린 자료를 산업용 분석 도구처럼 살핀다.
 * 진단과 개선 방향(좋은 편인지 나쁜 편인지, 이 자료에서 나온 할 일), 필터(기간·측정소·항목·집계·기준선), 시계열 탐색(확대·십자선·픽셀 단위 요약), 초과 사건 목록, 측정소 비교표, 자료 품질 점검, 원자료 표,
 * 내보내기(표 CSV, 그림 PNG, 요약 그림). 계산은 ozone-core.js, 그래프 도구는 app.js가 넘겨 준다. 자료는 브라우저 밖으로 나가지 않는다. */
(function () {
  'use strict';
  const POLL = [
    { key: 'o3', label: '오존', unit: 'ppm', d: 3, bad: 0.091, max: 0.3 },
    { key: 'no2', label: '이산화질소', unit: 'ppm', d: 3, max: 0.5 },
    { key: 'pm25', label: '초미세먼지', unit: 'µg/m³', d: 0, bad: 36, max: 500 },
    { key: 'co', label: '일산화탄소', unit: 'ppm', d: 1, max: 20 },
  ];
  const O3LINES = { bad: { v: 0.091, label: '나쁨 0.091' }, alert: { v: 0.12, label: '주의보 0.12' }, std8: { v: 0.06, label: '8시간 기준 0.06' }, who8: { v: 0.051, label: 'WHO 8시간 0.051' } };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const STORE = 'ozone-studio-v1';
  const PAGE = 100;
  let H, Core, D, M, S;
  const $ = id => document.getElementById(id);
  const pollOf = key => POLL.find(p => p.key === key);
  const fmtV = (v, p) => (Number.isFinite(v) ? `${H.nf(v, p.d)}${p.unit === 'ppm' ? 'ppm' : p.unit === '%' ? '%' : ' ' + p.unit}` : '없음');
  const pad2 = n => String(n).padStart(2, '0');
  const isoDay = di => Core.iso(di);
  const dayOfT = t => Math.floor(t / 24);
  const fmtT = t => `${isoDay(dayOfT(t))} ${H.HR((t % 24) + 1)}`; // '2024-06-13 13~14시'
  const dtOf = t => `${isoDay(dayOfT(t))} ${pad2((t % 24) + 1)}`; // 에어코리아 측정일시 표기(HH시 = 전 1시간 평균)
  const diOfInput = s => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? Core.dayIndex(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)) : null);
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const pctl = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1)))); return s[i]; };
  const niceCeil = v => { if (!(v > 0)) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); const m = v / e; const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10; return n * e; };
  const debounce = (fn, ms) => { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; };

  function fresh() {
    return {
      recs: null, grid: null, label: '', info: null, filters: null, view: null, dirty: {},
      pane: 'overview', pollutant: 'o3', agg: 'hour', lines: { bad: true, alert: true, std8: false, who8: false },
      series: 'cmax', series2: '', zoom: null, drag: null,
      ev: { th: 'bad', custom: '', sort: 'peak', dir: -1, page: 0 },
      pivot: { cols: 'month', stat: 'mean', sortCol: -1, dir: -1 },
      raw: { sort: 't', dir: 1, page: 0, st: '', min: '' },
      result: null, summaryImage: null,
    };
  }
  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify({ pane: S.pane, pollutant: S.pollutant, agg: S.agg, lines: S.lines, evTh: S.ev.th, pivot: { cols: S.pivot.cols, stat: S.pivot.stat } })); } catch (e) { /* 저장 안 됨 */ }
  }
  function restore() {
    try {
      const j = JSON.parse(localStorage.getItem(STORE) || 'null'); if (!j) return;
      if (['overview', 'explore', 'events', 'pivot', 'quality', 'raw'].includes(j.pane)) S.pane = j.pane; if (j.pollutant) S.pollutant = j.pollutant; if (j.agg) S.agg = j.agg;
      if (j.lines) Object.assign(S.lines, j.lines); if (j.evTh) S.ev.th = j.evTh; if (j.pivot) Object.assign(S.pivot, j.pivot);
    } catch (e) { /* 무시 */ }
  }

  // ---------- 자료 격자: 측정소 × 시각(연속) Float64Array, 빠른 집계용 ----------
  function buildGrid(recs) {
    let tmin = Infinity, tmax = -Infinity; const set = new Set();
    for (const r of recs) { if (r.t < tmin) tmin = r.t; if (r.t > tmax) tmax = r.t; set.add(r.st); }
    const stations = [...set].sort((a, b) => a.localeCompare(b, 'ko'));
    const idx = new Map(stations.map((s, i) => [s, i])), N = tmax - tmin + 1;
    const g = {}, has = {};
    for (const p of POLL) { g[p.key] = stations.map(() => { const a = new Float64Array(N); a.fill(NaN); return a; }); has[p.key] = false; }
    for (const r of recs) { const i = idx.get(r.st), k = r.t - tmin; for (const p of POLL) { const v = r[p.key]; if (Number.isFinite(v)) { g[p.key][i][k] = v; has[p.key] = true; } } }
    return { tmin, tmax, N, stations, idx, g, has, dmin: dayOfT(tmin), dmax: dayOfT(tmax) };
  }
  // 8시간 이동평균(8개 중 6개 이상 있을 때), 측정소·항목별로 한 번만 계산
  const m8cache = new Map();
  function mean8(key, i) {
    const ck = key + '|' + i; if (m8cache.has(ck)) return m8cache.get(ck);
    const a = S.grid.g[key][i], out = new Float64Array(a.length); out.fill(NaN);
    for (let k = 7; k < a.length; k++) { let s = 0, n = 0; for (let j = k - 7; j <= k; j++) { const v = a[j]; if (Number.isFinite(v)) { s += v; n++; } } if (n >= 6) out[k] = s / n; }
    m8cache.set(ck, out); return out;
  }

  // ---------- 불러오기 ----------
  function load(recs, label, info) {
    const keep = { pane: S.pane, pollutant: S.pollutant, agg: S.agg, lines: S.lines, ev: S.ev, pivot: S.pivot };
    S = fresh(); Object.assign(S, keep); m8cache.clear();
    const sane = recs.filter(r => r.y >= 1990 && r.y <= 2100);
    if (sane.length < recs.length) (info.notes = info.notes || []).push(`연도가 1990~2100년 밖인 ${recs.length - sane.length}행은 뺐습니다.`);
    recs = sane;
    if (!recs.length) throw new Error('날짜를 읽을 수 있는 행이 없습니다.');
    { let tmin = Infinity, tmax = -Infinity; for (const r of recs) { if (r.t < tmin) tmin = r.t; if (r.t > tmax) tmax = r.t; } if (tmax - tmin > 50 * 366 * 24) throw new Error('자료 기간이 50년을 넘어 브라우저에서 계산하기 어렵습니다. 기간을 나눠 올려 주세요.'); }
    S.recs = recs; S.label = label; S.info = info; S.grid = buildGrid(recs);
    const firstPoll = POLL.find(p => S.grid.has[p.key]);
    if (!firstPoll) throw new Error('오존 등 측정값이 있는 행이 없습니다.');
    if (!S.grid.has[S.pollutant]) S.pollutant = firstPoll.key;
    S.filters = { from: S.grid.dmin, to: S.grid.dmax, st: new Set(S.grid.stations) };
    buildSide(); setPane(S.pane, true);
    $('my-result').hidden = false;
    recompute();
    return S;
  }

  // ---------- 필터 ----------
  function buildSide() {
    const G = S.grid;
    $('f-from').min = $('f-to').min = isoDay(G.dmin); $('f-from').max = $('f-to').max = isoDay(G.dmax);
    $('f-from').value = isoDay(S.filters.from); $('f-to').value = isoDay(S.filters.to);
    $('f-stations').innerHTML = G.stations.map(s => `<label><input type="checkbox" value="${H.esc(s)}" checked> ${H.esc(s)}</label>`).join('');
    $('f-poll').innerHTML = POLL.filter(p => G.has[p.key]).map(p => `<label><input type="radio" name="f-poll" value="${p.key}"${p.key === S.pollutant ? ' checked' : ''}> ${p.label}</label>`).join('');
    document.querySelectorAll('input[name=f-agg]').forEach(r => { r.checked = r.value === S.agg; });
    $('f-lines').innerHTML = Object.entries(O3LINES).map(([k, l]) => `<label><input type="checkbox" value="${k}"${S.lines[k] ? ' checked' : ''}> ${l.label}</label>`).join('');
    $('f-lines-box').hidden = S.pollutant !== 'o3';
    updateStCount();
  }
  function updateStCount() { $('f-st-count').textContent = `${S.filters.st.size}/${S.grid.stations.length}`; }
  function readFilters() {
    const G = S.grid;
    let from = diOfInput($('f-from').value), to = diOfInput($('f-to').value);
    if (from == null) from = G.dmin; if (to == null) to = G.dmax;
    from = Math.max(G.dmin, Math.min(G.dmax, from)); to = Math.max(G.dmin, Math.min(G.dmax, to));
    if (from > to) [from, to] = [to, from];
    const st = new Set([...document.querySelectorAll('#f-stations input:checked')].map(i => i.value));
    S.filters = { from, to, st };
    updateStCount();
  }
  const recompute = debounce(() => {
    const t0 = performance.now();
    readFilters();
    const G = S.grid, F = S.filters;
    const stations = G.stations.filter(s => F.st.has(s));
    const recs = S.recs.filter(r => r.di >= F.from && r.di <= F.to && F.st.has(r.st));
    S.view = { recs, stations, k0: Math.max(0, F.from * 24 - G.tmin), k1: Math.min(G.N - 1, F.to * 24 + 23 - G.tmin), summary: null, ai: null };
    S.zoom = null; S.ev.page = 0; S.raw.page = 0; S.events = null; S.pivotData = null; S.rawRowsCache = null;
    S.dirty = { overview: true, explore: true, events: true, pivot: true, quality: true, raw: true };
    S.view.ms = performance.now() - t0;
    const empty = $('st-empty');
    if (!recs.length) {
      empty.hidden = false; empty.textContent = stations.length ? '선택한 기간에 자료가 없습니다. 기간을 바꿔 주세요.' : '측정소를 하나 이상 선택해 주세요.';
      document.querySelectorAll('.studio-main .pane').forEach(p => { p.hidden = true; });
      foot(); return;
    }
    empty.hidden = true;
    document.querySelectorAll('.studio-main .pane').forEach(p => { p.hidden = p.dataset.pane !== S.pane; });
    renderPane(S.pane);
    foot();
  }, 150);
  function foot() {
    const V = S.view, F = S.filters;
    $('st-foot').innerHTML = [`원본 ${H.nf(S.recs.length)}행`, `필터 적용 ${H.nf(V.recs.length)}행`, `측정소 ${V.stations.length}/${S.grid.stations.length}곳`, `${isoDay(F.from)} ~ ${isoDay(F.to)}`, `계산 ${H.nf(Math.max(V.ms, S.lastMs || 0) / 1000, 1)}초`, '브라우저 안에서만 계산'].map(x => `<span>${x}</span>`).join('');
  }

  // ---------- 화면 전환 ----------
  function setPane(name, silent) {
    S.pane = name;
    const tip = document.getElementById('tip'); if (tip) tip.classList.remove('on');
    document.querySelectorAll('.studio-tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === name)));
    const empty = S.view && !S.view.recs.length;
    document.querySelectorAll('.studio-main .pane').forEach(p => { p.hidden = empty || p.dataset.pane !== name; });
    if (!silent) { persist(); if (S.view && !empty) renderPane(name); }
  }
  function renderPane(name) {
    if (!S.view || !S.view.recs.length || !S.dirty[name]) return;
    const t0 = performance.now();
    ({ overview: renderOverview, explore: renderExplore, events: renderEvents, pivot: renderPivot, quality: renderQuality, raw: renderRaw })[name]();
    S.dirty[name] = false; S.lastMs = performance.now() - t0; foot();
  }

  // ---------- 개요: 요약 수치, 그림 (a)~(f), AI 예보 ----------
  function ensureSummary() {
    const V = S.view; if (V.summary) return V.summary;
    V.summary = Core.summarize(V.recs, Core.T);
    const minStations = Math.min(8, Math.max(1, Math.ceil(V.summary.overview.stations * 0.4)));
    const built = Core.buildSamples(V.recs, Core.T, { minStations, withSkipped: true });
    const probs = built.samples.map(s => Core.predict(M.params, s.f));
    const ai = { days: built.samples.length, minStations, skipped: built.skipped, threshold: M.threshold };
    if (ai.days) Object.assign(ai, Core.scores(built.samples, probs.map(p => p >= M.threshold)), { auc: Core.auc(built.samples, probs), list: built.samples.map((s, i) => ({ date: s.date, p: Math.round(probs[i] * 1000) / 1000, actual: s.label })) });
    V.ai = ai;
    S.result = { source: S.label, analyzedAt: new Date().toISOString(), ...S.info, filters: { from: isoDay(S.filters.from), to: isoDay(S.filters.to), stations: V.stations }, summary: V.summary, quality: qualityRows(), ai };
    return V.summary;
  }
  function baselineBadDays() { // 2018~2022년 같은 달 평균 '나쁨' 날(기간이 달의 일부면 비례)
    const F = S.filters; let sum = 0;
    for (let di = F.from; di <= F.to;) {
      const { y, m } = Core.dateOf(di), dim = new Date(Date.UTC(y, m, 0)).getUTCDate(), end = Math.min(F.to, Core.dayIndex(y, m, dim));
      const avg = mean(D.yearMonth.map(row => row[m - 1] || 0));
      sum += avg * (end - di + 1) / dim; di = end + 1;
    }
    return sum;
  }
  const monthBad = MH => MH.map((row, i) => { let s = 0, n = 0; row.forEach(c => { if (c.n) { s += c.o3Bad * c.n; n += c.n; } }); return { m: i + 1, v: n ? s / n : null, n }; });
  function drawCompare(Sm) {
    const C = H.C, mine = monthBad(Sm.monthHour), base = monthBad(D.monthHour), ms = mine.filter(x => x.n > 0).map(x => x.m);
    $('my-compare-legend').innerHTML = H.legendHtml([['올린 자료', C.o3], ['2018~2022년 대구', C.muted]]);
    const el = $('my-compare'), W = H.widthOf(el), Ht = 190, L = 34, R = 8, Tp = 18, Bt = 28;
    const top = Math.max(1, Math.ceil(Math.max(...ms.map(m => Math.max(mine[m - 1].v || 0, base[m - 1].v || 0))) / 2) * 2);
    const gw = (W - L - R) / Math.max(1, ms.length), bw = Math.min(18, gw * 0.32), Y = v => Tp + (Ht - Tp - Bt) * (1 - v / top);
    let s = '';
    [0, top / 2, top].forEach(t => { s += `<line class="${t ? 'gridline' : 'axisline'}" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 5}" y="${Y(t) + 4}" text-anchor="end">${H.nf(t, t < 10 ? 1 : 0)}</text>`; });
    ms.forEach((m, i) => {
      const cx = L + gw * i + gw / 2, a = mine[m - 1].v || 0, b = base[m - 1].v || 0;
      const tip = H.esc(`<b>${m}월</b><br>올린 자료 ${H.nf(a, 2)}%<br>2018~2022년 대구 ${H.nf(b, 2)}%`);
      s += `<rect class="bar" x="${cx - bw - 1}" y="${Y(a)}" width="${bw}" height="${Math.max(1, Y(0) - Y(a))}" rx="2" fill="${C.o3}" data-tip="${tip}"/>`;
      s += `<rect class="bar" x="${cx + 1}" y="${Y(b)}" width="${bw}" height="${Math.max(1, Y(0) - Y(b))}" rx="2" fill="${C.muted}" data-tip="${tip}"/>`;
      if (ms.length <= 12) s += `<text x="${cx}" y="${Ht - 12}" text-anchor="middle">${m}월</text>`;
    });
    s += `<text x="0" y="10" class="ttl">‘나쁨’ 이상 시간 비율(%)</text>`;
    el.innerHTML = H.svg(W, Ht, s, '달별 나쁨 이상 시간 비율 비교');
  }
  // 측정소별 '나쁨' 이상 시간 비율: 선택한 기간 전체(사이트 본문의 그림 3은 4~9월만 쓰지만, 올린 자료는 4~9월이 없을 수 있다)
  function stationShares() {
    const G = S.grid, V = S.view, from = isoDay(S.filters.from), to = isoDay(S.filters.to);
    return V.stations.map(st => {
      const a = G.g.o3[G.idx.get(st)]; let n = 0, bad = 0;
      for (let k = V.k0; k <= V.k1; k++) { const v = a[k]; if (Number.isFinite(v)) { n++; if (v >= O3LINES.bad.v) bad++; } }
      return { name: st, years: `${from} ~ ${to}`, yearCount: 5, seasonHours: n, badHours: bad, badShare: n ? Math.round(bad / n * 10000) / 100 : null };
    }).sort((x, y) => (y.badShare || 0) - (x.badShare || 0));
  }
  function qualityRows() {
    const G = S.grid, V = S.view, a = G.g.o3, out = [];
    for (const st of V.stations) {
      const i = G.idx.get(st); let rows = 0, o3 = 0, first = -1, last = -1;
      for (const r of V.recs) if (r.st === st) { rows++; if (Number.isFinite(r.o3)) o3++; if (first < 0 || r.t < first) first = r.t; if (r.t > last) last = r.t; }
      out.push({ station: st, rows, o3Share: rows ? Math.round(o3 / rows * 1000) / 10 : 0, from: first >= 0 ? isoDay(dayOfT(first)) : '', to: last >= 0 ? isoDay(dayOfT(last)) : '' });
      void a; void i;
    }
    return out;
  }
  // ---------- 진단과 개선 방향: 이 기간의 오존이 좋은 편인지 나쁜 편인지, 줄이려면 무엇을 할지 ----------
  // 판정은 공식 기준값만 쓴다(가장 높았던 수준): 주의보 수준 0.12ppm(1시간) > ‘나쁨’ 0.091ppm(1시간) > 대기환경기준 0.06ppm(8시간).
  // 얼마나 잦았는지는 날 수와 2018~2022년 대구의 같은 달 평균으로 따로 보여 주고, 할 일마다 이 자료에서 계산한 숫자를 근거로 붙인다.
  const LEVELS = ['좋은 편', '조금 나쁜 편', '나쁜 편', '매우 나쁜 편'];
  function diagnose() {
    const V = S.view; if (V.diag !== undefined) return V.diag;
    const Sm = ensureSummary(), Ov = Sm.overview, G = S.grid, A = V.ai, nf = H.nf, cite = H.cite;
    const days = Sm.stripes.filter(v => v != null).length; // 오존 값이 한 번이라도 있는 날
    if (!Ov.o3Valid || !days) return (V.diag = null);
    const level = Ov.alertDays > 0 ? 3 : Ov.badDays > 0 ? 2 : Ov.std8Days > 0 ? 1 : 0;
    const share = (a, b) => `${nf(b ? a / b * 100 : 0, b && a / b < 0.1 ? 1 : 0)}%`;
    const hrs = (s, e) => `${s}~${e}시`;
    const sg = (v, d = 1) => (Math.abs(v) < 0.5 * 10 ** -d ? nf(0, d) : H.sgn(v, d)); // 0에 가까운 값은 부호 없이

    // 언제: 시작 시각별 ‘나쁨’ 측정소-시간 수, 그 80% 이상이 들어가는 가장 짧은 연속 시간대
    const byHour = new Array(24).fill(0);
    for (const st of V.stations) { const a = G.g.o3[G.idx.get(st)]; for (let k = V.k0; k <= V.k1; k++) if (a[k] >= O3LINES.bad.v) byHour[(G.tmin + k) % 24]++; }
    const badHours = byHour.reduce((x, y) => x + y, 0), sumH = (s, e) => { let v = 0; for (let h = s; h < e; h++) v += byHour[h]; return v; };
    let win = null;
    for (let len = 1; badHours && len <= 24 && !win; len++) for (let s = 0; s + len <= 24; s++) { const v = sumH(s, s + len); if (v / badHours >= 0.8 && (!win || v > win.v)) win = { s, e: s + len, v }; }
    // 활동 시간(5~22시) 가운데 ‘나쁨’이 한 번도 없었던 때. 하나도 없으면 가장 적었던 3시간
    const safe = [];
    for (let h = 5; h < 22; h++) if (byHour[h] === 0) { const last = safe[safe.length - 1]; if (last && last[1] === h) last[1] = h + 1; else safe.push([h, h + 1]); }
    let least = null;
    if (!safe.length) for (let s = 5; s + 3 <= 22; s++) { const v = sumH(s, s + 3); if (!least || v < least.v) least = { s, e: s + 3, v }; }
    const safeTxt = safe.map(r => hrs(r[0], r[1])).join(', ');
    const moveTo = safe.length ? `‘나쁨’이 한 번도 없었던 ${safeTxt}` : `‘나쁨’이 가장 적었던 ${hrs(least.s, least.e)}`;
    const hotList = () => (hot.length > 1 ? `${hot.map(s => `${H.esc(s.name)} ${nf(s.badShare, 2)}%`).join(', ')} 순으로 높았` : `${H.esc(hot[0].name)}에서 ${nf(hot[0].badShare, 2)}%로 가장 높았`);
    const calm = safe.length ? `‘나쁨’이 한 번도 없었던 때는 ${safeTxt}입니다` : `‘나쁨’이 가장 적었던 때는 ${hrs(least.s, least.e)}입니다(전체의 ${share(least.v, badHours)})`;

    // 어느 달: ‘나쁨’ 날이 많은 달부터 80%를 채울 때까지(최대 3달)
    const dataMonths = Sm.monthHour.filter(row => row.some(c => c.n > 0)).length;
    const perMonth = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, n: Sm.yearMonth.reduce((s, row) => s + row[i], 0) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    const mons = []; { let acc = 0; for (const x of perMonth) { if (mons.length >= 3 || acc / Ov.badDays >= 0.8) break; mons.push(x); acc += x.n; } }
    mons.sort((a, b) => a.m - b.m);
    const inSeason = [4, 5, 6, 7, 8, 9].some(m => Sm.monthHour[m - 1].some(c => c.n > 0));

    // 어디: 측정소별 ‘나쁨’ 시간 비율
    const shares = stationShares().filter(s => s.seasonHours > 0), hot = shares.filter(s => s.badShare > 0).slice(0, 3), low = shares[shares.length - 1];

    // 대구 평소(2018~2022년 같은 달 평균)와 비교
    const base = baselineBadDays(), baseTxt = base < 0.05 ? '0일' : `${nf(base, base < 10 ? 1 : 0)}일`;
    const cmp = base < 0.5 ? (Ov.badDays > 0 ? 'more' : 'none') : Ov.badDays > base * 1.2 ? 'more' : Ov.badDays < base * 0.8 ? 'less' : 'same';
    const fewStations = V.stations.length < D.overview.stations / 2;
    const cmpTxt = (cmp === 'none'
      ? `2018~2022년 대구에서도 같은 달에는 ‘나쁨’ 날이 거의 없었습니다(평균 ${baseTxt}). 오존이 낮은 철이라 좋게 나온 것일 수 있습니다.`
      : `2018~2022년 대구의 같은 달 평균은 ${baseTxt}입니다. 이 자료는 ${nf(Ov.badDays)}일로 ${cmp === 'more' ? `평소보다 많습니다${base >= 0.5 ? `(${nf(Ov.badDays / base, 1)}배)` : ''}` : cmp === 'less' ? '평소보다 적습니다' : '평소와 비슷합니다'}.`)
      + (fewStations ? ` 대구 자료는 측정소 ${D.overview.stations}곳 가운데 한 곳이라도 ‘나쁨’이면 센 것이라, 측정소가 ${V.stations.length}곳인 이 자료와 그대로 견주기는 어렵습니다.` : '');

    const headline = [
      `기준을 넘은 날이 없었습니다. 자료가 있는 ${nf(days)}일 동안 ‘나쁨’ 이상(1시간 0.091ppm 이상)인 날도, 8시간 환경기준(0.06ppm)을 넘은 날도 없습니다.`,
      `‘나쁨’ 이상인 날은 없었지만, 8시간 평균이 환경기준(0.06ppm)을 넘은 날이 자료가 있는 ${nf(days)}일 중 ${nf(Ov.std8Days)}일(${share(Ov.std8Days, days)}) 있었습니다.`,
      `자료가 있는 ${nf(days)}일 중 ${nf(Ov.badDays)}일(${share(Ov.badDays, days)})이 ‘나쁨’ 이상(1시간 0.091ppm 이상)이었습니다. 주의보 수준(1시간 0.12ppm 이상)까지 오른 날은 없습니다.`,
      `자료가 있는 ${nf(days)}일 중 ${nf(Ov.badDays)}일(${share(Ov.badDays, days)})이 ‘나쁨’ 이상(1시간 0.091ppm 이상)이었고, 그중 ${nf(Ov.alertDays)}일은 주의보 수준(1시간 0.12ppm 이상)까지 올랐습니다.`,
    ][level];

    const aiGood = A.days && A.tp + A.fn > 0 && A.tp / (A.tp + A.fn) >= 0.5;
    const facts = [['대구 평소와 비교', cmpTxt]];
    if (win) facts.push(['몰린 시간', `‘나쁨’ 시간(측정소마다 센 ${nf(badHours)}시간)의 ${share(win.v, badHours)}가 ${hrs(win.s, win.e)}에 있었습니다. 5~22시 가운데 ${calm}.`]);
    else { const pk = Sm.diurnal.reduce((a, x) => (x.o3 != null && (!a || x.o3 > a.o3) ? x : a), null); if (pk) facts.push(['높아지는 시간', `평균 오존이 가장 높은 때는 ${H.HR(pk.h)}(평균 ${nf(pk.o3, 3)}ppm)입니다.`]); }
    if (mons.length && dataMonths >= 2) facts.push(['몰린 달', `‘나쁨’ 날 ${nf(Ov.badDays)}일 가운데 ${mons.map(x => `${x.m}월 ${x.n}일`).join(', ')}입니다.`]);
    if (hot.length && shares.length >= 2) facts.push(['높았던 곳', `‘나쁨’ 시간 비율은 ${hotList()}고, 가장 낮은 곳은 ${H.esc(low.name)} ${nf(low.badShare, 2)}%입니다.`]);
    if (A.days && A.tp + A.fn > 0) facts.push(['11시 AI 예보', `13~18시에 실제로 ‘나쁨’이었던 ${A.tp + A.fn}일 중 ${A.tp}일을 그날 11시에 미리 잡았습니다(헛경보 ${A.fp}일).${aiGood ? '' : ' 이 자료에서는 절반도 잡지 못해 알림에 쓰기 어렵습니다.'}`]);
    if (level < 2 && Ov.who8Days > 0) facts.push(['WHO 권고', `WHO 8시간 권고(약 0.051ppm)를 넘은 날은 ${nf(Ov.who8Days)}일입니다.`]);

    // 원인 물질: 일요일(자동차 배출 감소)과 평일 비교. 이 자료로 계산할 수 없으면 사이트의 2018~2022년 분석을 출처를 밝혀 쓴다.
    const wk = Sm.weekend, W0 = D.weekend;
    const vocTail = `도장처럼 휘발성유기화합물(VOC)이 나오는 작업을 햇빛이 강한 오후 2~5시에 피하는 조정 ${cite('s7')}을 자동차 배출 줄이기와 함께 합니다. 수도권 연구도 질소산화물만 줄어든 것이 5월 오존이 늘어난 주된 까닭이라고 봤습니다 ${cite('p3')}.`;
    const wkNum = w => `일요일의 이산화질소는 평일보다 ${sg(w.no2.pct, 0)}%였고 오존은 ${sg(w.o3.pct)}%(95% 구간 ${sg(w.o3.loPct)}~${sg(w.o3.hiPct)}%)였습니다`;
    const siteWk = `2018~2022년 대구 자료(분석 리포트 그림 8)에서는 ${wkNum(W0)}. 자동차 배출이 줄어든 날에도 오존은 뚜렷이 줄지 않았으므로, ${vocTail}`;
    const reduce = !wk ? `이 자료만으로는 요일 비교를 할 수 없습니다(4~9월 일요일 5일, 평일 20일 이상이 필요합니다). ${siteWk}`
      : !(wk.no2.hiPct < 0 && wk.no2.pct <= -5) ? `이 자료에서는 일요일과 평일의 이산화질소 차이가 뚜렷하지 않아(${sg(wk.no2.pct, 0)}%) 요일 비교로는 판단하기 어렵습니다. ${siteWk}`
      : wk.o3.hiPct < 0 ? `이 자료에서 ${wkNum(wk)}. 자동차 배출이 줄어든 날에 오존도 함께 낮았습니다. 대중교통 이용과 공회전 줄이기 같은 교통 대책이 이 기간의 오존에도 도움이 됐을 수 있습니다(관찰한 결과이며 원인을 증명한 것은 아닙니다). 햇빛이 강한 오후 2~5시에는 도장처럼 휘발성유기화합물(VOC)이 나오는 작업도 피합니다 ${cite('s7')}.`
      : `이 자료에서 ${wkNum(wk)}. 자동차 배출이 줄어든 날에도 오존은 뚜렷이 줄지 않았으므로, ${vocTail}`;

    const acts = [], add = (who, title, html) => acts.push({ who, title, html });
    if (level >= 2) {
      if (win) add('노출 줄이기', `${hrs(win.s, win.e)}에는 야외 활동을 잡지 않기`, `‘나쁨’ 시간의 ${share(win.v, badHours)}가 이 시간대에 있었습니다. 체육 수업, 야외 행사, 바깥 작업은 ${win.s > 7 ? `${win.s}시 전으로 옮깁니다. 5~${win.s}시에 있었던 ‘나쁨’ 시간은 ${sumH(5, win.s) ? `전체의 ${share(sumH(5, win.s), badHours)}뿐입니다` : '한 번도 없었습니다'}` : `${moveTo}로 옮깁니다`}. 서울시도 14~17시를 오존이 높아지는 시간으로 안내합니다 ${cite('s8')}.`);
      if (mons.length && mons.length < dataMonths) add('노출 줄이기', `${mons.map(x => `${x.m}월`).join('·')}에 미리 알리기`, `‘나쁨’ 날 ${nf(Ov.badDays)}일 가운데 ${nf(mons.reduce((s, x) => s + x.n, 0))}일이 이 달에 있었습니다. 이 달에는 아침에 그날 오존 예보를 확인하고, 학교·경로당·요양시설에 오후 실외 활동을 줄이도록 미리 알립니다. 오존에 특히 약한 80세 이상이 머무는 시설이 먼저입니다 ${cite('s6')}.`);
      if (aiGood) add('노출 줄이기', '11시 AI 예보로 그날 오후 ‘주의’ 알리기', `이 자료에 11시 예보를 적용하면 13~18시에 실제로 ‘나쁨’이었던 ${A.tp + A.fn}일 중 ${A.tp}일을 그날 오전에 잡았습니다. 오후 1시가 되기 전에 알림을 보내는 데 쓸 수 있습니다. ${A.fp ? `헛경보가 ${A.fp}일 있어 ‘경보’가 아니라 ‘주의’ 단계로 씁니다.` : '이 자료에서는 헛경보가 없었습니다.'}`);
      if (hot.length && shares.length >= 3) add('노출 줄이기', `${H.esc(hot[0].name)}처럼 비율이 높은 곳부터 쉼터와 알림 두기`, `‘나쁨’ 시간 비율은 ${hotList()}습니다(가장 낮은 ${H.esc(low.name)} ${nf(low.badShare, 2)}%). 높은 곳 주변부터 오후 실내 쉼터와 알림을 둡니다.`);
      if (level === 3) add('노출 줄이기', '주의보 수준인 날은 민감한 사람의 실외 활동 줄이기', `주의보 수준까지 오른 날이 ${nf(Ov.alertDays)}일 있었습니다. 이런 날 오후에는 임산부, 어르신, 어린이, 호흡기·심장 질환이 있는 사람, 야외에서 일하는 사람의 실외 활동을 줄입니다 ${cite('s8')}. 서울시는 주의보 때 실외 운동과 산책, 자동차 운행을 줄이도록 안내합니다 ${cite('s7')}.`);
      add('오존 줄이기', '자동차 배출과 휘발성유기화합물(VOC)을 함께 줄이기', reduce);
    } else if (level === 1) {
      add('노출 줄이기', '오후에 오래 이어지는 야외 활동 줄이기', `8시간 평균이 환경기준을 넘은 날이 ${nf(Ov.std8Days)}일 있었습니다. 한두 시간만 높았던 것이 아니라 여러 시간 이어졌다는 뜻이므로, 오존에 민감한 사람(임산부, 어르신, 어린이, 호흡기·심장 질환이 있는 사람, 야외에서 일하는 사람 ${cite('s8')})은 그런 날 오후에 오래 이어지는 야외 운동과 작업을 줄입니다.`);
      add('오존 줄이기', '자동차 배출과 휘발성유기화합물(VOC)을 함께 줄이기', reduce);
    } else {
      if (!inSeason) add('확인', '오존이 높아지는 4~9월 자료로 다시 보기', '이 기간에는 4~9월이 들어 있지 않습니다. 오존은 햇빛이 강한 철의 오후에 높아지므로, 4~9월 자료를 올려 다시 확인해야 한 해의 수준을 알 수 있습니다.');
      else add('확인', '같은 방법으로 계속 지켜보기', '4~9월이 들어 있는 기간인데도 기준을 넘지 않았습니다. 새 자료가 나올 때마다 같은 방법으로 확인하면 됩니다.');
      if (Ov.who8Days > 0) add('노출 줄이기', 'WHO 권고를 넘은 날은 민감한 사람이 조심하기', `한국 기준은 넘지 않았지만 WHO 8시간 권고(약 0.051ppm) ${cite('w1')}는 ${nf(Ov.who8Days)}일 넘었습니다. 오존에 민감한 사람은 그런 날 오후에 오래 이어지는 야외 활동을 줄이는 편이 좋습니다.`);
    }
    const missing = Ov.rows ? Ov.o3Missing / Ov.rows : 0;
    if (missing > 0.1) add('확인', '빈 측정값부터 확인하기', `오존 값이 빈 시간이 ${share(Ov.o3Missing, Ov.rows)} 있습니다. 빈 시간에 높은 값이 있었다면 판정이 달라질 수 있으니 ‘자료 품질’ 화면에서 빈 구간을 확인하세요.`);

    const short = [`기준을 넘은 날 없음(자료 ${nf(days)}일)`, `8시간 환경기준 초과 ${nf(Ov.std8Days)}일(자료 ${nf(days)}일)`, `‘나쁨’ 이상 ${nf(Ov.badDays)}일(자료 ${nf(days)}일의 ${share(Ov.badDays, days)})`, `‘나쁨’ 이상 ${nf(Ov.badDays)}일(자료 ${nf(days)}일의 ${share(Ov.badDays, days)}), 주의보 수준 ${nf(Ov.alertDays)}일`][level]
      + (cmp === 'none' ? '' : `, 대구 평소(${baseTxt})${cmp === 'more' ? '보다 많음' : cmp === 'less' ? '보다 적음' : '와 비슷'}`) + (win ? `, ${hrs(win.s, win.e)}에 집중` : '');
    V.diag = { level, label: LEVELS[level], days, headline, short, facts, actions: acts };
    if (S.result) S.result.diagnosis = { 판정: LEVELS[level], 자료가_있는_날: days, 나쁨_이상_날: Ov.badDays, 주의보_수준_날: Ov.alertDays, 환경기준_8시간_초과_날: Ov.std8Days, WHO_권고_초과_날: Ov.who8Days, 대구_2018_2022_같은_달_평균_나쁨_날: Math.round(base * 10) / 10, 몰린_시간: win ? { 시작: win.s, 끝: win.e, 비율: Math.round(win.v / badHours * 1000) / 1000 } : null, 몰린_달: mons.map(x => ({ 월: x.m, 나쁨_날: x.n })), 높았던_곳: hot.map(s => ({ 측정소: s.name, 나쁨_시간_비율: s.badShare })), 할_일: acts.map(a => `[${a.who}] ${a.title}`) };
    return V.diag;
  }
  function renderDiagnosis() {
    const el = $('my-diag'), d = diagnose();
    if (!d) { el.innerHTML = '<h2 class="ph">진단</h2><p class="note">오존 값이 없어 진단하지 않았습니다.</p>'; return; }
    el.innerHTML = `<h2 class="ph">진단: 이 기간의 오존은 좋은 편인가, 나쁜 편인가</h2>
      <p class="diag-verdict"><b class="d-${d.level}">${d.label}</b><span>${d.headline}</span></p>
      <dl class="diag-facts">${d.facts.map(f => `<div><dt>${f[0]}</dt><dd>${f[1]}</dd></div>`).join('')}</dl>
      <h2 class="ph">개선하려면: 이 자료에서 나온 할 일</h2>
      <ol class="diag-actions">${d.actions.map(a => `<li><span class="who">${a.who}</span><b>${a.title}</b><p>${a.html}</p></li>`).join('')}</ol>
      <p class="note">판정 규칙: 가장 높았던 수준으로 정합니다. 주의보 수준(1시간 0.12ppm 이상)인 날이 있으면 ‘매우 나쁜 편’, ‘나쁨’ 이상(1시간 0.091ppm 이상)인 날이 있으면 ‘나쁜 편’, 8시간 환경기준(0.06ppm)만 넘었으면 ‘조금 나쁜 편’, 모두 없으면 ‘좋은 편’입니다. 측정소 한 곳이라도 넘으면 그날을 셉니다. 얼마나 잦았는지는 날 수와 대구 평소 비교로 보세요. 필터에서 고른 기간과 측정소의 숫자로 만든 자동 계산이며, 공식 판정이나 의학적 조언이 아닙니다.${d.days < 7 ? ' 자료가 7일보다 적어 참고용입니다.' : ''}</p>`;
  }
  function renderOverview() {
    const Sm = ensureSummary(), Ov = Sm.overview, A = S.view.ai, C = H.C, nf = H.nf;
    const base = baselineBadDays();
    $('my-tiles').innerHTML = [
      ['기간', `${Ov.start} ~ ${Ov.end}`, ''], ['측정소', `${Ov.stations}곳`, ''], ['오존 값이 있는 시간', nf(Ov.o3Valid), Ov.o3Missing ? `빈 시간 ${nf(Ov.o3Missing)}` : ''], ['최고 1시간 오존', Ov.maxAt ? `${nf(Ov.maxO3, 3)}ppm` : '없음', Ov.maxAt ? `${H.esc(Ov.maxAt.station)}, ${Ov.maxAt.date}` : ''],
      ['‘나쁨’ 이상 날', `${nf(Ov.badDays)}일`, `2018~2022년 같은 기간 평균 ${nf(base, 0)}일`], ['주의보 수준 날', `${nf(Ov.alertDays)}일`, '1시간 0.12ppm 이상'], ['8시간 기준 초과 날', `${nf(Ov.std8Days)}일`, '0.06ppm'], ['WHO 8시간 권고 초과 날', `${nf(Ov.who8Days)}일`, '약 0.051ppm'],
    ].map(([k, v, sub]) => `<div class="tile"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`).join('');
    const months = Sm.monthHour.map((row, i) => [i + 1, row.some(c => c.n > 0)]).filter(x => x[1]).map(x => x[0]);
    const cmax = H.heat($('my-clock'), months.length, 24, (r, c) => Sm.monthHour[months[r] - 1][c].o3Bad, { ch: 16, rowLabel: r => `${months[r]}월`, colLabel: c => H.HS(c + 1), colTick: c => c % 6 === 0 || c === 23, xTitle: '시작 시각', tip: (r, c, v) => `<b>${months[r]}월 ${H.HR(c + 1)}</b><br>나쁨 이상 ${nf(v || 0, 1)}%`, label: '올린 자료의 달·시각별 나쁨 비율' });
    H.rampBar($('my-clock-ramp'), '0%', `${nf(cmax, 1)}%`);
    H.stationBars($('my-stations'), stationShares(), false, '선택 기간 나쁨 이상 비율(%)');
    const o3 = Sm.diurnal.map(x => (x.o3 == null ? 0 : x.o3 * 1000)), top = Math.max(10, Math.ceil(Math.max(...o3) / 10) * 10);
    H.lineChart($('my-diurnal'), [{ name: '', values: o3, color: C.o3, markMax: true }], { xs: Sm.diurnal.map(x => x.h), fmtX: H.HS, tipX: H.HR, xTick: h => (h - 1) % 6 === 0, fmtV: v => `${nf(v, 1)}ppb`, h: 170, right: 16, xTitle: '시작 시각', fmtY: v => `${v}`, yMax: top, ticks: [0, top / 2, top], yTitle: 'O₃ (ppb)', label: '올린 자료의 시각별 평균 오존' });
    $('my-ai').innerHTML = A.days
      ? `<div class="cm"><div class="h"></div><div class="h">실제 나쁨</div><div class="h">실제 보통 이하</div><div class="h">‘주의’</div><div class="ok"><b>${A.tp}</b>맞힘</div><div class="no"><b>${A.fp}</b>헛경보</div><div class="h">예보 없음</div><div class="no"><b>${A.fn}</b>놓침</div><div class="ok"><b>${A.tn}</b>맞힘</div></div>
         <p class="note">4~9월 ${A.days}일에 2018~2021년 학습 모델을 그대로 적용했습니다(기준 확률 ${H.pct(A.threshold, 1)}). 실제 ‘나쁨’ ${A.tp + A.fn}일 중 ${A.tp}일을 미리 잡았고${A.auc != null ? `, AUC ${nf(A.auc, 2)}` : ''}입니다.</p>`
      : `<p class="note">AI 예보를 적용할 날이 없습니다. 4~9월 자료이면서 13~18시에 측정소 ${A.minStations}곳 이상 값이 있고, 11시까지의 입력값(오존·이산화질소·초미세먼지·일산화탄소)이 모두 있는 날만 계산합니다.</p>`;
    drawCompare(Sm);
    $('my-quality').innerHTML = `<table class="paper"><thead><tr><th>측정소</th><th>행</th><th>오존 값</th><th>기간</th></tr></thead><tbody>${S.result.quality.map(q => `<tr><td>${H.esc(q.station)}</td><td>${nf(q.rows)}</td><td>${nf(q.o3Share, 1)}%</td><td>${q.from.slice(2)} ~ ${q.to.slice(2)}</td></tr>`).join('')}</tbody></table>`;
    const wk = Sm.weekend;
    $('my-cap').innerHTML = `<b class="fn">그림.</b> ${H.esc(S.label)}의 분석(필터 적용: ${isoDay(S.filters.from)} ~ ${isoDay(S.filters.to)}, 측정소 ${S.view.stations.length}곳). 사이트의 분석과 같은 계산 코드와 기준값을 썼습니다(오존 ‘나쁨’ 0.091ppm 이상, 8시간 기준 0.06ppm, WHO 권고 약 0.051ppm). (e)는 측정소-시간 가운데 ‘나쁨’ 이상인 비율의 달 평균으로, 측정소 수가 달라도 비교할 수 있게 했습니다. (f)의 오존 값은 오존이 비어 있지 않은 행의 비율입니다.
      <span class="res">${wk ? `일요일과 평일 비교: 오존 ${H.sgn(wk.o3.pct)}%(95% 구간 ${H.sgn(wk.o3.loPct)}~${H.sgn(wk.o3.hiPct)}%), 이산화질소 ${H.sgn(wk.no2.pct)}%. ` : '주말 효과는 4~9월 일요일 5일·평일 20일 이상일 때만 계산합니다. '}참고로 2018~2022년 대구 자료에서는 ‘나쁨’ 날이 한 해 평균 ${nf(D.overview.badDays / D.overview.years.length, 0)}일이었습니다.</span>`;
    renderDiagnosis();
    scheduleSummary(); // 요약 그림은 자동으로 만들어 진단 아래에 보여 준다
  }

  // ---------- 시계열 탐색 ----------
  function seriesOptions() {
    const V = S.view;
    return [['cmax', '선택 측정소 중 최고'], ['cmean', '선택 측정소 평균'], ...V.stations.map(s => [s, s])];
  }
  function hourlySeries(key) {
    const G = S.grid, V = S.view, arrs = V.stations.map(s => G.g[S.pollutant][G.idx.get(s)]), n = V.k1 - V.k0 + 1, out = new Float64Array(n); out.fill(NaN);
    if (key !== 'cmax' && key !== 'cmean') { const a = G.g[S.pollutant][G.idx.get(key)]; if (a) for (let i = 0; i < n; i++) out[i] = a[V.k0 + i]; return out; }
    for (let i = 0; i < n; i++) { let mx = -Infinity, s = 0, c = 0; for (const a of arrs) { const v = a[V.k0 + i]; if (Number.isFinite(v)) { if (v > mx) mx = v; s += v; c++; } } out[i] = c ? (key === 'cmax' ? mx : s / c) : NaN; }
    return out;
  }
  function series(key) { // { xs, vs, unit:'hour'|'day' }
    const hv = hourlySeries(key), G = S.grid, V = S.view, t0 = G.tmin + V.k0;
    if (S.agg === 'hour') return { xs: Array.from(hv, (_, i) => t0 + i), vs: hv, unit: 'hour' };
    const d0 = dayOfT(t0), d1 = dayOfT(G.tmin + V.k1), xs = [], vs = [];
    for (let di = d0; di <= d1; di++) {
      let mx = -Infinity, s = 0, c = 0;
      for (let h = 0; h < 24; h++) { const i = di * 24 + h - t0; if (i < 0 || i >= hv.length) continue; const v = hv[i]; if (Number.isFinite(v)) { if (v > mx) mx = v; s += v; c++; } }
      xs.push(di); vs.push(c >= (S.agg === 'dmean' ? 12 : 1) ? (S.agg === 'dmax' ? mx : s / c) : NaN);
    }
    return { xs, vs, unit: 'day' };
  }
  const xLabel = (x, unit) => (unit === 'hour' ? fmtT(x) : isoDay(x));
  function thresholdLines() {
    const p = pollOf(S.pollutant), out = [];
    if (p.key === 'o3') { for (const [k, l] of Object.entries(O3LINES)) if (S.lines[k]) out.push(l); }
    else if (p.bad) out.push({ v: p.bad, label: `나쁨 ${p.bad}` });
    return out;
  }
  function renderExplore() {
    const opts = seriesOptions();
    if (!opts.some(o => o[0] === S.series)) S.series = 'cmax';
    if (S.series2 && !opts.some(o => o[0] === S.series2)) S.series2 = '';
    $('x-series').innerHTML = opts.map(([k, l]) => `<option value="${H.esc(k)}"${k === S.series ? ' selected' : ''}>${H.esc(l)}</option>`).join('');
    $('x-series2').innerHTML = `<option value="">없음</option>` + opts.map(([k, l]) => `<option value="${H.esc(k)}"${k === S.series2 ? ' selected' : ''}>${H.esc(l)}</option>`).join('');
    drawExplore();
  }
  function drawExplore() {
    const p = pollOf(S.pollutant), C = H.C, A = series(S.series), B = S.series2 ? series(S.series2) : null;
    const el = $('x-chart'), W = H.widthOf(el), Ht = 300, L = 54, R = 14, Tp = 14, Bt = 30, PW = W - L - R;
    const full = [A.xs[0], A.xs[A.xs.length - 1]];
    const z = S.zoom && S.zoom[0] < S.zoom[1] ? S.zoom : full;
    const i0 = Math.max(0, A.xs.findIndex(x => x >= z[0])), i1e = A.xs.findIndex(x => x > z[1]), i1 = i1e < 0 ? A.xs.length - 1 : Math.max(i0, i1e - 1);
    const span = Math.max(1, z[1] - z[0]), X = x => L + (x - z[0]) / span * PW;
    // 픽셀 단위 요약: 점이 화면 폭보다 많으면 구간별 최저·최고·끝값으로 줄인다
    const bucket = (ser) => {
      const n = i1 - i0 + 1, per = Math.max(1, Math.ceil(n / PW)), out = [];
      for (let i = i0; i <= i1; i += per) {
        let mn = Infinity, mx = -Infinity, mxi = -1, any = false;
        for (let j = i; j < Math.min(i1 + 1, i + per); j++) { const v = ser.vs[j]; if (Number.isFinite(v)) { any = true; if (v < mn) mn = v; if (v > mx) { mx = v; mxi = j; } } }
        out.push({ x: ser.xs[i], xe: ser.xs[Math.min(i1, i + per - 1)], mn: any ? mn : NaN, mx: any ? mx : NaN, xmax: mxi >= 0 ? ser.xs[mxi] : null });
      }
      return { pts: out, per };
    };
    const bA = bucket(A), bB = B ? bucket(B) : null;
    const lines = thresholdLines();
    let vmax = 0; for (const b of bA.pts) if (b.mx > vmax) vmax = b.mx; if (bB) for (const b of bB.pts) if (b.mx > vmax) vmax = b.mx;
    for (const l of lines) if (l.v > vmax) vmax = l.v;
    const yMax = niceCeil(vmax * 1.08) || 1, Y = v => Tp + (Ht - Tp - Bt) * (1 - v / yMax);
    let s = '';
    const ticksY = [0, yMax / 4, yMax / 2, yMax * 3 / 4, yMax];
    ticksY.forEach(t => { s += `<line class="${t ? 'gridline' : 'axisline'}" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${H.nf(t, p.d)}</text>`; });
    s += `<text x="0" y="10" class="ttl">${p.label} (${p.unit})</text>`;
    // 가로 눈금: 날짜 경계
    const dayStep = Math.max(1, Math.ceil((A.unit === 'hour' ? span / 24 : span) / 8));
    const dStart = A.unit === 'hour' ? dayOfT(z[0]) : z[0], dEnd = A.unit === 'hour' ? dayOfT(z[1]) : z[1];
    for (let di = dStart; di <= dEnd; di++) {
      if ((di - dStart) % dayStep) continue;
      const x = A.unit === 'hour' ? di * 24 : di; if (x < z[0] || x > z[1]) continue;
      const { m, d } = Core.dateOf(di);
      s += `<line class="gridline" x1="${X(x)}" x2="${X(x)}" y1="${Tp}" y2="${Ht - Bt}"/><text x="${X(x)}" y="${Ht - 12}" text-anchor="middle">${m}/${d}</text>`;
    }
    const path = (b, color, width, band) => {
      let d = '', up = false, bd = '', bk = [];
      for (const q of b.pts) {
        if (!Number.isFinite(q.mx)) { up = false; continue; }
        const x = X(q.x).toFixed(1), y = Y(q.mx).toFixed(1);
        d += (up ? 'L' : 'M') + x + ' ' + y + ' '; up = true;
        if (band) { bd += (bd ? 'L' : 'M') + x + ' ' + y + ' '; bk.push(x + ' ' + Y(q.mn).toFixed(1)); }
      }
      let out = '';
      if (band && b.per > 1 && bk.length) out += `<path d="${bd}L${bk.reverse().join('L')}Z" fill="${H.seq(0.08)}" stroke="none"/>`;
      out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
      return out;
    };
    if (bB) s += path(bB, C.muted, 1.6, false);
    s += path(bA, C.o3, 2, true);
    lines.forEach(l => { s += `<line x1="${L}" x2="${W - R}" y1="${Y(l.v)}" y2="${Y(l.v)}" stroke="${C.no2}" stroke-width="1" stroke-dasharray="4 4"/><text x="${W - R}" y="${Y(l.v) - 4}" text-anchor="end" class="lbl" style="fill:${C.no2}">${l.label}</text>`; });
    s += `<rect id="x-hit" x="${L}" y="${Tp}" width="${PW}" height="${Ht - Tp - Bt}" fill="transparent" style="cursor:crosshair"/>`;
    s += `<line id="x-cross" x1="0" x2="0" y1="${Tp}" y2="${Ht - Bt}" stroke="${C.ink}" stroke-width="1" stroke-dasharray="2 3" opacity="0"/><rect id="x-sel" x="0" y="${Tp}" width="0" height="${Ht - Tp - Bt}" fill="${C.o3}" opacity="0.12" pointer-events="none"/>`;
    el.innerHTML = H.svg(W, Ht, s, `${p.label} 시계열`);
    const svgEl = el.querySelector('svg'), hit = $('x-hit'), cross = $('x-cross'), sel = $('x-sel');
    const names = Object.fromEntries(seriesOptions());
    const xFromEvent = e => { const r = svgEl.getBoundingClientRect(); const px = (e.clientX - r.left) * W / r.width; return z[0] + Math.max(0, Math.min(1, (px - L) / PW)) * span; };
    const nearest = (b, x) => { let best = null, bd = Infinity; for (const q of b.pts) { const d = Math.abs(q.x - x); if (d < bd) { bd = d; best = q; } } return best; };
    hit.addEventListener('pointermove', e => {
      const x = xFromEvent(e), qa = nearest(bA, x), qb = bB ? nearest(bB, x) : null;
      if (!qa) return;
      cross.setAttribute('x1', X(qa.x)); cross.setAttribute('x2', X(qa.x)); cross.setAttribute('opacity', '1');
      const rangeTxt = bA.per > 1 ? `${xLabel(qa.x, A.unit)} ~ ${xLabel(qa.xe, A.unit)} (${bA.per}개 요약)` : xLabel(qa.x, A.unit);
      let tip = `<b>${rangeTxt}</b><br>${H.esc(names[S.series])}: ${bA.per > 1 ? `최고 ${fmtV(qa.mx, p)}, 최저 ${fmtV(qa.mn, p)}` : fmtV(qa.mx, p)}`;
      if (qb) tip += `<br>${H.esc(names[S.series2])}: ${bB.per > 1 ? `최고 ${fmtV(qb.mx, p)}` : fmtV(qb.mx, p)}`;
      hit.setAttribute('data-tip', tip);
      if (S.drag) { const a = Math.min(S.drag.px, e.clientX), b = Math.max(S.drag.px, e.clientX), r = svgEl.getBoundingClientRect(); sel.setAttribute('x', (a - r.left) * W / r.width); sel.setAttribute('width', (b - a) * W / r.width); }
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', '0'); });
    hit.addEventListener('pointerdown', e => { S.drag = { px: e.clientX, x: xFromEvent(e) }; hit.setPointerCapture(e.pointerId); });
    hit.addEventListener('pointerup', e => {
      if (!S.drag) return; const x2 = xFromEvent(e), x1 = S.drag.x, px0 = S.drag.px; S.drag = null; sel.setAttribute('width', 0);
      if (Math.abs(e.clientX - px0) < 6) return;
      S.zoom = [Math.floor(Math.min(x1, x2)), Math.ceil(Math.max(x1, x2))]; if (S.zoom[1] - S.zoom[0] < (A.unit === 'hour' ? 3 : 2)) S.zoom = null; drawExplore();
    });
    hit.addEventListener('dblclick', () => { S.zoom = null; drawExplore(); });
    hit.addEventListener('pointercancel', () => { S.drag = null; sel.setAttribute('width', 0); });
    $('x-range').textContent = `${xLabel(z[0], A.unit)} ~ ${xLabel(z[1], A.unit)}${S.zoom ? '' : ' (전체)'}`;
    $('x-zoom-out').disabled = !S.zoom;
    $('x-note').textContent = bA.per > 1 ? `점 ${H.nf(i1 - i0 + 1)}개를 화면 폭에 맞춰 ${bA.per}개씩 요약했습니다(선 = 구간 최고, 옅은 띠 = 최저~최고). 끌어서 확대하면 시간값이 그대로 보입니다. 두 번 누르면 전체로 돌아갑니다.` : '끌어서 확대, 두 번 누르면 전체로 돌아갑니다.';
    // 보이는 구간 통계
    const vals = []; let mx = -Infinity, mxAt = null;
    for (let i = i0; i <= i1; i++) { const v = A.vs[i]; if (Number.isFinite(v)) { vals.push(v); if (v > mx) { mx = v; mxAt = A.xs[i]; } } }
    const unitWord = A.unit === 'hour' ? '시간' : '일';
    const bad = p.key === 'o3' ? O3LINES.bad.v : p.bad;
    $('x-stats').innerHTML = [
      ['값이 있는 ' + unitWord, H.nf(vals.length)], ['평균', fmtV(mean(vals), p)], ['95백분위', fmtV(pctl(vals, 0.95), p)], ['최고', vals.length ? `${fmtV(mx, p)}<small>${xLabel(mxAt, A.unit)}</small>` : '없음'],
      ...(bad ? [[`‘나쁨’ 이상 ${unitWord}`, H.nf(vals.filter(v => v >= bad).length)]] : []),
    ].map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('');
    S.explore = { svgEl, A, p };
  }

  // ---------- 초과 사건 ----------
  function thresholdOptions() {
    const p = pollOf(S.pollutant);
    if (p.key === 'o3') return [['bad', '나쁨: 1시간 0.091ppm 이상'], ['alert', '주의보 수준: 1시간 0.12ppm 이상'], ['std8', '8시간 기준: 8시간 평균 0.06ppm 초과'], ['who8', 'WHO 권고: 8시간 평균 약 0.051ppm 초과'], ['custom', '직접 입력(1시간)']];
    if (p.bad) return [['bad', `나쁨: 1시간 ${p.bad}${p.unit} 이상`], ['custom', '직접 입력(1시간)']];
    return [['custom', '직접 입력(1시간)']];
  }
  function episodes() {
    const G = S.grid, V = S.view, p = pollOf(S.pollutant), opt = thresholdOptions();
    if (!opt.some(o => o[0] === S.ev.th)) S.ev.th = opt[0][0];
    let th, use8 = false;
    if (S.ev.th === 'custom') th = parseFloat(S.ev.custom); else if (p.key === 'o3') { th = O3LINES[S.ev.th].v; use8 = S.ev.th === 'std8' || S.ev.th === 'who8'; } else th = p.bad;
    if (!Number.isFinite(th)) return { th: NaN, list: [], use8 };
    const list = [];
    for (const st of V.stations) {
      const i = G.idx.get(st), a = use8 ? mean8(p.key, i) : G.g[p.key][i];
      let run = null;
      for (let k = V.k0; k <= V.k1 + 1; k++) {
        const v = k <= V.k1 ? a[k] : NaN, on = Number.isFinite(v) && (use8 ? v > th : v >= th);
        if (on) { if (!run) run = { st, t0: G.tmin + k, t1: G.tmin + k, hours: 0, peak: -Infinity, peakT: null, sum: 0 }; run.t1 = G.tmin + k; run.hours++; run.sum += v; if (v > run.peak) { run.peak = v; run.peakT = G.tmin + k; } }
        else if (run) { run.mean = run.sum / run.hours; list.push(run); run = null; }
      }
    }
    return { th, list, use8 };
  }
  function renderEvents() {
    const p = pollOf(S.pollutant), opt = thresholdOptions();
    $('e-th').innerHTML = opt.map(([k, l]) => `<option value="${k}"${k === S.ev.th ? ' selected' : ''}>${l}</option>`).join('');
    if ($('e-custom').value !== S.ev.custom) $('e-custom').value = S.ev.custom; $('e-custom').disabled = S.ev.th !== 'custom'; $('e-custom').step = p.d ? String(Math.pow(10, -p.d)) : '1';
    const E = episodes(); S.events = E;
    const L = E.list, nf = H.nf;
    if (!Number.isFinite(E.th)) { $('e-summary').innerHTML = ''; $('e-timeline').innerHTML = ''; $('e-table').innerHTML = '<p class="note">기준값을 입력하세요.</p>'; $('e-pager').innerHTML = ''; return; }
    const longest = L.reduce((a, e) => (e.hours > (a ? a.hours : 0) ? e : a), null), highest = L.reduce((a, e) => (e.peak > (a ? a.peak : -Infinity) ? e : a), null);
    const days = new Set(); for (const e of L) for (let t = e.t0; t <= e.t1; t++) days.add(dayOfT(t));
    $('e-summary').innerHTML = [
      ['사건', `${nf(L.length)}건`], ['측정소', `${new Set(L.map(e => e.st)).size}곳`], ['초과 날', `${nf(days.size)}일`], ['초과 시간 합', `${nf(L.reduce((a, e) => a + e.hours, 0))}시간`],
      ['가장 긴 사건', longest ? `${longest.hours}시간<small>${H.esc(longest.st)}, ${isoDay(dayOfT(longest.t0))}</small>` : '없음'], ['가장 높은 값', highest ? `${fmtV(highest.peak, p)}<small>${H.esc(highest.st)}, ${fmtT(highest.peakT)}</small>` : '없음'],
    ].map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('');
    drawTimeline(L);
    const cols = [['st', '측정소'], ['t0', '시작'], ['t1', '끝'], ['hours', '지속(시간)'], ['peak', '최고'], ['peakT', '최고 시각'], ['mean', '평균']];
    const dir = S.ev.dir, key = S.ev.sort;
    const sorted = [...L].sort((a, b) => (typeof a[key] === 'string' ? a[key].localeCompare(b[key], 'ko') : a[key] - b[key]) * dir);
    const pages = Math.max(1, Math.ceil(sorted.length / 50)); S.ev.page = Math.min(S.ev.page, pages - 1);
    const rows = sorted.slice(S.ev.page * 50, S.ev.page * 50 + 50);
    $('e-table').innerHTML = `<table class="paper sortable"><thead><tr>${cols.map(([k, l]) => `<th><button type="button" data-sort="${k}" aria-sort="${k === key ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}</button></th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(e => `<tr><td>${H.esc(e.st)}</td><td>${fmtT(e.t0)}</td><td>${fmtT(e.t1)}</td><td>${e.hours}</td><td>${fmtV(e.peak, p)}</td><td>${fmtT(e.peakT)}</td><td>${fmtV(e.mean, p)}</td></tr>`).join('') : `<tr><td colspan="7">이 기준을 넘은 사건이 없습니다.</td></tr>`}</tbody></table>`;
    pager($('e-pager'), S.ev.page, pages, sorted.length, i => { S.ev.page = i; renderEvents(); });
    $('e-table').querySelectorAll('[data-sort]').forEach(b => { b.onclick = () => { if (S.ev.sort === b.dataset.sort) S.ev.dir *= -1; else { S.ev.sort = b.dataset.sort; S.ev.dir = b.dataset.sort === 'st' || b.dataset.sort === 't0' ? 1 : -1; } renderEvents(); }; });
    $('e-note').textContent = `${E.use8 ? '8시간 평균(8개 중 6개 이상 있을 때)이 기준을 넘는' : '1시간 값이 기준 이상인'} 시간이 이어진 구간을 한 사건으로 셉니다. 값이 빈 시간이 끼면 사건이 나뉩니다. 측정소 ${S.view.stations.length}곳, ${isoDay(S.filters.from)} ~ ${isoDay(S.filters.to)}.`;
  }
  function drawTimeline(L) {
    const F = S.filters, el = $('e-timeline'), W = H.widthOf(el), Ht = 120, Lm = 30, R = 8, Tp = 14, Bt = 24, days = F.to - F.from + 1, C = H.C;
    const cnt = new Map(); for (const e of L) { const seen = new Set(); for (let t = e.t0; t <= e.t1; t++) { const d = dayOfT(t); const k = d + '|' + e.st; if (!seen.has(k)) { seen.add(k); cnt.set(d, (cnt.get(d) || 0) + 1); } } }
    const max = Math.max(1, ...cnt.values()), bw = (W - Lm - R) / days, Y = v => Tp + (Ht - Tp - Bt) * (1 - v / max);
    let s = `<text x="0" y="10" class="ttl">날마다 초과 측정소 수</text>`;
    [0, max].forEach(t => { s += `<line class="${t ? 'gridline' : 'axisline'}" x1="${Lm}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${Lm - 5}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`; });
    for (const [d, v] of cnt) { const x = Lm + (d - F.from) * bw; s += `<rect class="bar" x="${x.toFixed(2)}" y="${Y(v)}" width="${Math.max(1, bw - 0.5).toFixed(2)}" height="${Y(0) - Y(v)}" fill="${C.o3}" data-tip="${H.esc(`<b>${isoDay(d)}</b><br>초과 측정소 ${v}곳`)}"/>`; }
    const step = Math.max(1, Math.ceil(days / 8));
    for (let d = F.from; d <= F.to; d += step) { const { m, dd } = (({ m, d: dd }) => ({ m, dd }))(Core.dateOf(d)); s += `<text x="${Lm + (d - F.from + 0.5) * bw}" y="${Ht - 8}" text-anchor="middle">${m}/${dd}</text>`; }
    el.innerHTML = H.svg(W, Ht, s, '날마다 초과 측정소 수');
  }
  function pager(el, page, pages, total, go) {
    el.innerHTML = `<span>${H.nf(total)}건 중 ${pages > 1 ? `${page + 1}/${pages}쪽` : '전체'}</span><button type="button" ${page === 0 ? 'disabled' : ''} data-go="prev">이전</button><button type="button" ${page >= pages - 1 ? 'disabled' : ''} data-go="next">다음</button>`;
    el.querySelector('[data-go=prev]').onclick = () => go(page - 1); el.querySelector('[data-go=next]').onclick = () => go(page + 1);
  }

  // ---------- 측정소 비교표 ----------
  function pivotCols() {
    const F = S.filters, G = S.grid;
    if (S.pivot.cols === 'hour') return { labels: Array.from({ length: 24 }, (_, h) => `${h}~${h + 1}시`), of: t => t % 24, n: 24 };
    if (S.pivot.cols === 'dow') return { labels: DOW.map(d => d + '요일'), of: t => Core.dateOf(dayOfT(t)).dow, n: 7 };
    const keys = [], map = new Map();
    for (let di = F.from; di <= F.to;) { const { y, m } = Core.dateOf(di); map.set(`${y}-${m}`, keys.length); keys.push(`${y}년 ${m}월`); const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); di = Core.dayIndex(y, m, dim) + 1; }
    const dayKey = new Map(); // 날 → 열 번호(시간마다 날짜 계산을 피한다)
    return { labels: keys, of: t => { const d = dayOfT(t); let c = dayKey.get(d); if (c === undefined) { const { y, m } = Core.dateOf(d); c = map.get(`${y}-${m}`); dayKey.set(d, c); } return c; }, n: keys.length };
    void G;
  }
  function pivotTable() {
    const G = S.grid, V = S.view, p = pollOf(S.pollutant), cols = pivotCols(), stat = S.pivot.stat;
    const bad = p.key === 'o3' ? O3LINES.bad.v : p.bad;
    const mk = () => Array.from({ length: cols.n }, () => ({ s: 0, n: 0, mx: -Infinity, bad: 0, h: 0, vals: stat === 'p95' ? [] : null }));
    const rows = V.stations.map(st => ({ st, c: mk() })), all = { st: '전체', c: mk() };
    const colOfK = new Int16Array(V.k1 - V.k0 + 1); for (let k = V.k0; k <= V.k1; k++) colOfK[k - V.k0] = cols.of(G.tmin + k);
    for (const r of rows) {
      const a = G.g[p.key][G.idx.get(r.st)];
      for (let k = V.k0; k <= V.k1; k++) {
        const c = colOfK[k - V.k0], cell = r.c[c], tot = all.c[c]; cell.h++; tot.h++;
        const v = a[k]; if (!Number.isFinite(v)) continue;
        for (const x of [cell, tot]) { x.s += v; x.n++; if (v > x.mx) x.mx = v; if (bad && v >= bad) x.bad++; if (x.vals) x.vals.push(v); }
      }
    }
    const val = c => (stat === 'mean' ? (c.n ? c.s / c.n : NaN) : stat === 'max' ? (c.n ? c.mx : NaN) : stat === 'p95' ? pctl(c.vals, 0.95) : stat === 'bad' ? c.bad : c.h ? c.n / c.h * 100 : NaN);
    const table = [all, ...rows].map(r => ({ st: r.st, v: r.c.map(val) }));
    return { cols, table, stat, p };
  }
  function renderPivot() {
    const p = pollOf(S.pollutant), bad = p.key === 'o3' || p.bad;
    $('p-cols').value = S.pivot.cols;
    $('p-stat').querySelector('[value=bad]').disabled = !bad; if (!bad && S.pivot.stat === 'bad') S.pivot.stat = 'mean';
    $('p-stat').value = S.pivot.stat;
    const P = pivotTable(); S.pivotData = P;
    const unit = P.stat === 'cov' ? { d: 0, unit: '%' } : P.stat === 'bad' ? { d: 0, unit: '시간' } : p;
    const max = Math.max(...P.table.slice(1).flatMap(r => r.v).filter(Number.isFinite), 0);
    const body = P.table.slice(1); const sc = S.pivot.sortCol;
    if (sc >= 0) body.sort((a, b) => ((Number.isFinite(b.v[sc]) ? b.v[sc] : -Infinity) - (Number.isFinite(a.v[sc]) ? a.v[sc] : -Infinity)) * S.pivot.dir);
    const cell = v => { if (!Number.isFinite(v)) return '<td class="empty">없음</td>'; const f = max > 0 ? Math.max(0, Math.min(1, v / (P.stat === 'cov' ? 100 : max))) : 0; return `<td style="background:${H.seq(f)};color:${f > 0.55 ? H.C.onDark : H.C.onLight}">${H.nf(v, unit.d)}</td>`; };
    $('p-table').innerHTML = `<table class="paper pivot"><thead><tr><th>측정소</th>${P.cols.labels.map((l, i) => `<th><button type="button" data-col="${i}" aria-sort="${i === sc ? (S.pivot.dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}</button></th>`).join('')}</tr></thead><tbody>${[P.table[0], ...body].map((r, i) => `<tr${i === 0 ? ' class="total"' : ''}><td>${H.esc(r.st)}</td>${r.v.map(cell).join('')}</tr>`).join('')}</tbody></table>`;
    H.rampBar($('p-ramp'), `0${unit.unit === '%' ? '%' : ''}`, `${H.nf(P.stat === 'cov' ? 100 : max, unit.d)}${unit.unit === 'ppm' ? 'ppm' : unit.unit === '%' ? '%' : ' ' + unit.unit}`);
    $('p-table').querySelectorAll('[data-col]').forEach(b => { b.onclick = () => { const c = +b.dataset.col; if (S.pivot.sortCol === c) S.pivot.dir *= -1; else { S.pivot.sortCol = c; S.pivot.dir = -1; } renderPivot(); }; });
    const statName = { mean: '평균', max: '최고', p95: '95백분위', bad: '‘나쁨’ 이상 시간 수', cov: '값이 있는 시간 비율' }[P.stat];
    $('p-note').textContent = `${p.label}의 ${statName}. ‘전체’ 행은 선택한 측정소의 값을 모두 모아 계산했습니다. 열 제목을 누르면 그 열로 정렬합니다(다시 누르면 반대로).`;
  }

  // ---------- 자료 품질 ----------
  function renderQuality() {
    const G = S.grid, V = S.view, p = pollOf(S.pollutant), nf = H.nf;
    const cols = (() => { const keys = [], map = new Map(); for (let di = S.filters.from; di <= S.filters.to;) { const { y, m } = Core.dateOf(di); map.set(`${y}-${m}`, keys.length); keys.push(`${String(y).slice(2)}.${m}`); const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); di = Core.dayIndex(y, m, dim) + 1; } return { keys, map }; })();
    const cov = V.stations.map(st => { const a = G.g[p.key][G.idx.get(st)], n = cols.keys.map(() => 0), h = cols.keys.map(() => 0); let last = -1, c = 0; for (let k = V.k0; k <= V.k1; k++) { const d = dayOfT(G.tmin + k); if (d !== last) { last = d; const { y, m } = Core.dateOf(d); c = cols.map.get(`${y}-${m}`); } h[c]++; if (Number.isFinite(a[k])) n[c]++; } return { st, v: n.map((x, i) => (h[i] ? x / h[i] * 100 : NaN)) }; });
    const cell = v => (Number.isFinite(v) ? `<td style="background:${H.seq(v / 100)};color:${v > 55 ? H.C.onDark : H.C.onLight}">${nf(v, 0)}</td>` : '<td class="empty">없음</td>');
    $('q-coverage').innerHTML = `<table class="paper pivot"><thead><tr><th>측정소</th>${cols.keys.map(k => `<th>${k}</th>`).join('')}</tr></thead><tbody>${cov.map(r => `<tr><td>${H.esc(r.st)}</td>${r.v.map(cell).join('')}</tr>`).join('')}</tbody></table>`;
    const flags = V.stations.map(st => {
      const a = G.g[p.key][G.idx.get(st)]; let neg = 0, over = 0, stuck = 0, run = 1, gap = 0, longest = 0, gaps24 = 0, prev = NaN, n = 0;
      for (let k = V.k0; k <= V.k1; k++) {
        const v = a[k];
        if (!Number.isFinite(v)) { gap++; prev = NaN; run = 1; continue; }
        if (gap) { if (gap > longest) longest = gap; if (gap >= 24) gaps24++; gap = 0; }
        n++; if (v < 0) neg++; if (v > p.max) over++;
        if (v === prev && v !== 0) { run++; if (run === 8) stuck++; } else run = 1; prev = v;
      }
      if (gap) { if (gap > longest) longest = gap; if (gap >= 24) gaps24++; }
      return { st, n, neg, over, stuck, longest, gaps24 };
    });
    const w = x => (x ? `<td class="warn">${nf(x)}</td>` : `<td>0</td>`);
    $('q-flags').innerHTML = `<table class="paper"><thead><tr><th>측정소</th><th>값 있는 시간</th><th>음수</th><th>${p.max}${p.unit} 초과</th><th>같은 값 8시간 이상</th><th>가장 긴 빈 구간(시간)</th><th>하루 이상 빈 구간</th></tr></thead><tbody>${flags.map(f => `<tr><td>${H.esc(f.st)}</td><td>${nf(f.n)}</td>${w(f.neg)}${w(f.over)}${w(f.stuck)}<td>${nf(f.longest)}</td>${w(f.gaps24)}</tr>`).join('')}</tbody></table>`;
    S.qualityFlags = flags;
    $('q-note').textContent = `${p.label} 기준. ‘같은 값 8시간 이상’은 0이 아닌 같은 값이 8시간 넘게 이어진 구간 수로, 측정기가 멈춘 흔적일 수 있습니다. ${p.max}${p.unit} 초과는 물리적으로 드문 값이라 확인이 필요합니다. 이 점검은 참고용이며 값을 고치거나 빼지 않습니다.`;
  }

  // ---------- 원자료 ----------
  function rawRows() {
    const V = S.view, R = S.raw, p = pollOf(S.pollutant), min = parseFloat(R.min), q = R.st.trim();
    let rows = V.recs;
    if (q) rows = rows.filter(r => r.st.includes(q));
    if (Number.isFinite(min)) rows = rows.filter(r => r[p.key] >= min);
    const key = R.sort, dir = R.dir;
    rows = [...rows].sort((a, b) => { if (key === 'st') return a.st.localeCompare(b.st, 'ko') * dir || a.t - b.t; if (key === 't') return (a.t - b.t) * dir; const x = Number.isFinite(a[key]) ? a[key] : -Infinity, y = Number.isFinite(b[key]) ? b[key] : -Infinity; return (x - y) * dir || a.t - b.t; });
    return rows;
  }
  function renderRaw() {
    const p = pollOf(S.pollutant), R = S.raw, G = S.grid;
    $('r-min-label').textContent = p.label; $('r-min').step = p.d ? String(Math.pow(10, -p.d)) : '1'; if ($('r-min').value !== R.min) $('r-min').value = R.min; if ($('r-st').value !== R.st) $('r-st').value = R.st;
    const rows = rawRows(); S.rawRowsCache = rows;
    const cols = [['st', '측정소'], ['t', '측정일시'], ...POLL.filter(q => G.has[q.key]).map(q => [q.key, `${q.label}(${q.unit})`])];
    const pages = Math.max(1, Math.ceil(rows.length / PAGE)); R.page = Math.min(R.page, pages - 1);
    const slice = rows.slice(R.page * PAGE, R.page * PAGE + PAGE);
    $('r-count').textContent = `${H.nf(rows.length)}행`;
    $('r-table').innerHTML = `<table class="paper sortable raw"><thead><tr>${cols.map(([k, l]) => `<th><button type="button" data-sort="${k}" aria-sort="${k === R.sort ? (R.dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}</button></th>`).join('')}</tr></thead><tbody>${slice.map(r => `<tr><td>${H.esc(r.st)}</td><td>${dtOf(r.t)}</td>${cols.slice(2).map(([k]) => `<td>${Number.isFinite(r[k]) ? H.nf(r[k], pollOf(k).d) : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    pager($('r-pager'), R.page, pages, rows.length, i => { R.page = i; renderRaw(); });
    $('r-table').querySelectorAll('[data-sort]').forEach(b => { b.onclick = () => { if (R.sort === b.dataset.sort) R.dir *= -1; else { R.sort = b.dataset.sort; R.dir = b.dataset.sort === 'st' || b.dataset.sort === 't' ? 1 : -1; } R.page = 0; renderRaw(); }; });
  }

  // ---------- 내보내기 ----------
  const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvOf = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  function saveFile(data, name, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
  const stem = () => 'ozone-' + (S.info && S.info.files && S.info.files.length === 1 ? S.info.files[0].name : S.info && S.info.kind === 'airkorea-api' ? 'airkorea-recent30' : 'files').replace(/[^\w가-힣.-]+/g, '_').replace(/\.(csv|xlsx|zip).*$/i, '') + `-${isoDay(S.filters.from)}_${isoDay(S.filters.to)}`;
  function svgStyle() { const C = H.C; return `<style>text{font-family:"Pretendard Local","Segoe UI","Malgun Gothic",sans-serif;font-size:11.5px;fill:${H.tok('--viz-text')}}.gridline{stroke:${H.tok('--viz-grid')};stroke-width:1}.axisline{stroke:${H.tok('--viz-axis')};stroke-width:1}.lbl{fill:${C.ink}}.lbl-strong{fill:${H.tok('--viz-on-light')};font-weight:600}.ttl{fill:${H.tok('--color-muted')};font-size:11px}.hit{fill:transparent}.cell,.bar{stroke:none}</style>`; }
  function svgToImage(svgEl) {
    const clone = svgEl.cloneNode(true); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.insertAdjacentHTML('afterbegin', svgStyle());
    clone.querySelectorAll('#x-hit, #x-cross, #x-sel').forEach(n => n.remove());
    const w = +svgEl.getAttribute('width') || svgEl.viewBox.baseVal.width, h = +svgEl.getAttribute('height') || svgEl.viewBox.baseVal.height;
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => res({ img, w, h }); img.onerror = () => rej(new Error('그림 변환 실패')); img.src = url; });
  }
  async function chartPng(svgEl, name) {
    const { img, w, h } = await svgToImage(svgEl), c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
    const g = c.getContext('2d'); g.fillStyle = H.tok('--color-paper-2'); g.fillRect(0, 0, c.width, c.height); g.scale(2, 2); g.drawImage(img, 0, 0);
    c.toBlob(b => saveFile(b, name, 'image/png'), 'image/png');
  }
  // 요약 그림: 제목, 요약 수치, 그림 (a)(b)(c)(e)를 한 장에
  async function summaryImage() {
    ensureSummary();
    if (S.pane !== 'overview') return null;
    renderPane('overview');
    const Ov = S.view.summary.overview, A = S.view.ai, W = 1600, pad = 48, tok = H.tok, dg = diagnose();
    const panels = [['my-clock', '(a) 달·시각별 ‘나쁨’ 이상 비율'], ['my-stations', '(b) 측정소별 ‘나쁨’ 이상 시간 비율(선택 기간)'], ['my-diurnal', '(c) 시각별 평균 오존'], ['my-compare', '(e) 달별 ‘나쁨’ 비율, 2018~2022년 대구와 비교']];
    const imgs = [];
    for (const [id] of panels) { const el = $(id).querySelector('svg'); imgs.push(el ? await svgToImage(el) : null); }
    const colW = (W - pad * 3) / 2, rowH = imgs.map(x => (x ? x.h * colW / x.w : 0));
    const top = 300, Hh = top + Math.max(rowH[0], rowH[1]) + 60 + Math.max(rowH[2], rowH[3]) + 60 + 70;
    const c = document.createElement('canvas'); c.width = W; c.height = Math.round(Hh); const g = c.getContext('2d');
    g.fillStyle = tok('--color-paper'); g.fillRect(0, 0, W, Hh);
    const font = (w, px) => { g.font = `${w} ${px}px "Pretendard Local", "Segoe UI", "Malgun Gothic", sans-serif`; };
    g.fillStyle = tok('--color-ink'); font(800, 34); g.fillText('대구 오존 시간표: 올린 자료 분석 요약', pad, 70);
    g.fillStyle = tok('--color-ink-2'); font(400, 18); g.fillText(`${S.label}, ${Ov.start} ~ ${Ov.end}, 측정소 ${Ov.stations}곳, ${H.nf(S.view.recs.length)}행. 기준: 오존 ‘나쁨’ 1시간 0.091ppm 이상. 계산: daegu-ozone.pages.dev (ozone-core.js)`, pad, 104);
    const tiles = [['‘나쁨’ 이상 날', `${H.nf(Ov.badDays)}일`], ['주의보 수준 날', `${H.nf(Ov.alertDays)}일`], ['8시간 기준 초과 날', `${H.nf(Ov.std8Days)}일`], ['WHO 권고 초과 날', `${H.nf(Ov.who8Days)}일`], ['최고 1시간 오존', Ov.maxAt ? `${H.nf(Ov.maxO3, 3)}ppm` : '없음'], ['AI 예보(4~9월)', A.days ? `${A.tp}/${A.tp + A.fn}일 포착` : '해당 없음']];
    const tw = (W - pad * 2 - 20 * 5) / 6;
    tiles.forEach(([k, v], i) => { const x = pad + i * (tw + 20); g.fillStyle = tok('--color-ink'); g.fillRect(x, 140, tw, 2); g.fillStyle = tok('--color-muted'); font(400, 15); g.fillText(k, x, 168); g.fillStyle = tok('--color-ink'); font(800, 30); g.fillText(v, x, 206); });
    if (dg) { // 판정 한 줄: 길면 글자를 줄여 한 줄에 넣는다
      let px = 22; const line = `진단: ${dg.label}. ${dg.short}`;
      do { font(600, px); px--; } while (g.measureText(line).width > W - pad * 2 && px > 13);
      g.fillStyle = tok('--color-ink'); g.fillText(line, pad, 248);
    }
    let y = top;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) { const i = row * 2 + col, x = pad + col * (colW + pad); g.fillStyle = tok('--color-ink'); font(600, 17); g.fillText(panels[i][1], x, y - 12); if (imgs[i]) g.drawImage(imgs[i].img, x, y, colW, rowH[i]); }
      y += Math.max(rowH[row * 2], rowH[row * 2 + 1]) + 60;
    }
    g.fillStyle = tok('--color-muted'); font(400, 14); g.fillText(`만든 날 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)}. 자료는 브라우저 안에서만 계산했고 서버로 보내지 않았습니다. 그래프 색: dataviz 검증 팔레트.`, pad, Hh - 28);
    return new Promise(res => c.toBlob(b => res({ blob: b, w: W, h: Hh }), 'image/png'));
  }
  let summaryTimer = null, summaryUrl = null;
  function scheduleSummary() { clearTimeout(summaryTimer); S.summaryImage = null; summaryTimer = setTimeout(() => { if (S.pane === 'overview') showSummaryImage().catch(() => {}); }, 300); }
  async function showSummaryImage() {
    const box = $('st-summary-img'); box.hidden = false;
    if (!box.querySelector('img')) box.innerHTML = '<p class="muted">요약 그림을 만드는 중…</p>';
    try {
      const made = await summaryImage();
      if (!made) { box.hidden = true; return; }
      const { blob } = made;
      if (summaryUrl) URL.revokeObjectURL(summaryUrl);
      summaryUrl = URL.createObjectURL(blob); S.summaryImage = blob;
      box.innerHTML = `<h2 class="ph">한눈에 보기: 이 자료의 분석 요약 그림</h2><img src="${summaryUrl}" alt="올린 자료 분석 요약 그림"><p class="downloads"><button type="button" class="btn btn-ghost" id="st-summary-save">요약 그림 저장</button><span class="muted">필터를 바꾸면 그림도 다시 만들어집니다. 저장하면 그대로 쓸 수 있는 PNG 파일입니다.</span></p>`;
      $('st-summary-save').onclick = () => saveFile(blob, stem() + '-summary.png', 'image/png');
    } catch (e) { box.innerHTML = `<p class="muted">요약 그림을 만들지 못했습니다: ${H.esc(e.message)}</p>`; }
  }
  function exportHandlers() {
    const need = () => { if (!S.view) { alert('먼저 자료를 올려 주세요.'); return false; } if (!S.view.recs.length) { alert('선택한 기간·측정소에 자료가 없습니다.'); return false; } return true; };
    $('my-download').onclick = () => { if (!need()) return; ensureSummary(); diagnose(); saveFile(JSON.stringify(S.result, null, 2), stem() + '.json', 'application/json'); };
    $('my-dl-days').onclick = () => { if (!need()) return; ensureSummary(); const L = (S.view.ai && S.view.ai.list) || []; if (!L.length) { setStatus('AI 예보를 적용한 날이 없어 내려받을 내용이 없습니다(4~9월 자료가 필요합니다).'); return; } saveFile(csvOf([['날짜', 'AI 나쁨 확률', `예보(기준 ${H.pct(M.threshold, 1)})`, '실제 13~18시'], ...L.map(d => [d.date, d.p, d.p >= M.threshold ? '주의' : '예보 없음', d.actual ? '나쁨' : '보통 이하'])]), stem() + '-days.csv', 'text/csv'); };
    $('my-dl-stations').onclick = () => { if (!need()) return; ensureSummary(); const st = new Map(S.view.summary.stations.map(s => [s.name, s])); saveFile(csvOf([['측정소', '행 수', '오존 값 비율(%)', '시작', '끝', '4~9월 나쁨 이상 비율(%)'], ...S.result.quality.map(q => [q.station, q.rows, q.o3Share, q.from, q.to, st.get(q.station) && st.get(q.station).badShare != null ? st.get(q.station).badShare : ''])]), stem() + '-stations.csv', 'text/csv'); };
    $('st-dl-events').onclick = () => { if (!need()) return; const E = S.events || episodes(), p = pollOf(S.pollutant); saveFile(csvOf([['측정소', '시작(측정일시)', '끝(측정일시)', '지속 시간', `최고(${p.unit})`, '최고 시각', `평균(${p.unit})`, `기준 ${E.th}${E.use8 ? ' (8시간 평균)' : ''}`], ...E.list.map(e => [e.st, dtOf(e.t0), dtOf(e.t1), e.hours, e.peak, dtOf(e.peakT), Math.round(e.mean * 1e6) / 1e6, ''])]), stem() + '-events.csv', 'text/csv'); };
    $('st-dl-pivot').onclick = () => { if (!need()) return; const P = S.pivotData || pivotTable(); saveFile(csvOf([['측정소', ...P.cols.labels], ...P.table.map(r => [r.st, ...r.v.map(v => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : ''))])]), stem() + `-pivot-${P.stat}.csv`, 'text/csv'); };
    $('st-dl-raw').onclick = () => { if (!need()) return; const rows = S.rawRowsCache || rawRows(), keys = POLL.filter(q => S.grid.has[q.key]); saveFile(csvOf([['측정소', '측정일시(HH시 = 전 1시간 평균)', ...keys.map(q => `${q.key.toUpperCase()}(${q.unit})`)], ...rows.map(r => [r.st, dtOf(r.t), ...keys.map(q => (Number.isFinite(r[q.key]) ? r[q.key] : ''))])]), stem() + '-raw.csv', 'text/csv'); };
    $('st-dl-png').onclick = async () => { if (!need()) return; if (S.pane !== 'explore') setPane('explore'); renderPane('explore'); const svg = $('x-chart').querySelector('svg'); if (svg) await chartPng(svg, stem() + '-timeseries.png'); };
    $('st-summary-btn').onclick = async () => { if (!need()) return; if (S.pane !== 'overview') setPane('overview'); renderPane('overview'); if (!S.summaryImage) { clearTimeout(summaryTimer); await showSummaryImage(); } if (S.summaryImage) saveFile(S.summaryImage, stem() + '-summary.png', 'image/png'); };
    $('st-export').addEventListener('click', e => { if (e.target.closest('button')) $('st-export').open = false; });
  }
  function setStatus(msg) { const s = $('my-status'); s.className = 'status err'; s.textContent = msg; }

  // ---------- 고정 요소의 동작 ----------
  function bindStatic() {
    document.querySelectorAll('.studio-tabs [role=tab]').forEach(b => { b.onclick = () => setPane(b.dataset.pane); });
    $('f-from').onchange = $('f-to').onchange = recompute;
    $('f-stations').addEventListener('change', recompute);
    document.querySelectorAll('[data-st]').forEach(b => { b.onclick = () => { document.querySelectorAll('#f-stations input').forEach(i => { i.checked = b.dataset.st === 'all'; }); recompute(); }; });
    document.querySelectorAll('[data-quick]').forEach(b => {
      b.onclick = () => {
        const G = S.grid; if (!G) return; let from = G.dmin, to = G.dmax;
        if (b.dataset.quick === 'season') { const y1 = Core.dateOf(G.dmax).y; from = Math.max(G.dmin, Core.dayIndex(y1, 4, 1)); to = Math.min(G.dmax, Core.dayIndex(y1, 9, 30)); if (from > to) { from = G.dmin; } }
        if (b.dataset.quick === '30') from = Math.max(G.dmin, G.dmax - 29);
        $('f-from').value = isoDay(from); $('f-to').value = isoDay(to); recompute();
      };
    });
    $('f-poll').addEventListener('change', e => { S.pollutant = e.target.value; $('f-lines-box').hidden = S.pollutant !== 'o3'; S.zoom = null; S.events = null; S.pivotData = null; S.rawRowsCache = null; S.dirty = { ...S.dirty, explore: true, events: true, pivot: true, quality: true, raw: true }; persist(); renderPane(S.pane); });
    document.querySelectorAll('input[name=f-agg]').forEach(r => { r.onchange = () => { S.agg = r.value; S.zoom = null; S.dirty.explore = true; persist(); renderPane(S.pane); }; });
    $('f-lines').addEventListener('change', e => { S.lines[e.target.value] = e.target.checked; S.dirty.explore = true; persist(); if (S.pane === 'explore') drawExplore(); });
    $('x-series').onchange = e => { S.series = e.target.value; drawExplore(); };
    $('x-series2').onchange = e => { S.series2 = e.target.value; drawExplore(); };
    $('x-zoom-out').onclick = () => { S.zoom = null; drawExplore(); };
    $('e-th').onchange = e => { S.ev.th = e.target.value; S.ev.page = 0; persist(); renderEvents(); };
    $('e-custom').oninput = debounce(e => { S.ev.custom = e.target.value; S.ev.page = 0; renderEvents(); }, 300);
    $('p-cols').onchange = e => { S.pivot.cols = e.target.value; S.pivot.sortCol = -1; persist(); renderPivot(); };
    $('p-stat').onchange = e => { S.pivot.stat = e.target.value; persist(); renderPivot(); };
    $('r-st').oninput = debounce(e => { S.raw.st = e.target.value; S.raw.page = 0; renderRaw(); }, 250);
    $('r-min').oninput = debounce(e => { S.raw.min = e.target.value; S.raw.page = 0; renderRaw(); }, 250);
    $('st-side-toggle').onclick = () => { const open = $('st-side').classList.toggle('open'); $('st-side-toggle').setAttribute('aria-expanded', String(open)); };
    exportHandlers();
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.view) { S.dirty = { overview: true, explore: true, events: true, pivot: true, quality: true, raw: true }; renderPane(S.pane); } }, 200); });
  }

  window.OzoneStudio = {
    init(helpers) { H = helpers; Core = window.OzoneCore; D = H.D; M = H.M; S = fresh(); restore(); bindStatic(); },
    load, result: () => S.result, state: () => S,
  };
})();
