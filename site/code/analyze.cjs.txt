// 대구 오존 분석: data/raw의 공공데이터 원본 → site/data.js
// 실행: node analysis/analyze.cjs
// 모든 수치는 원본에서 계산한다. 공통 계산은 site/ozone-core.js(사이트의 '내 데이터 분석'과 같은 코드)를 쓴다.
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../site/ozone-core.js');
const { T, num, round, mean, dayIndex, iso, parseCSV, decode, FEATURES, scores, auc } = core;

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'site', 'data.js');

function readText(prefix) {
  const file = fs.readdirSync(RAW).find(f => f.startsWith(prefix + '__'));
  if (!file) throw new Error('원본 파일 없음: ' + prefix);
  return { file, text: decode(fs.readFileSync(path.join(RAW, file))) };
}

// ---------- 1. 대기질 시간자료 → 공통 요약 ----------
const aqSrc = readText('15083249');
const aqRows = parseCSV(aqSrc.text);
const det = core.detectColumns(aqRows[0]);
if (!det.ok || det.map.o3 !== 8 || det.map.no2 !== 9 || det.map.pm25 !== 7 || det.map.st !== 0) throw new Error('대기질 열 구성이 예상과 다름: ' + aqRows[0].join('|'));
const { recs, notes } = core.toRecords(aqRows.slice(1), det.map);
if (notes.some(n => /ppb|0~23/.test(n))) throw new Error('단위·시각 판정이 예상과 다름: ' + notes.join(' / '));
const S = core.summarize(recs, T);
const overview = S.overview;

// ---------- 2. 측정소 구·군(가로수·태양광 허가 자료의 주소로 확인) ----------
const treeSrc = readText('15109655');
const treeRows = parseCSV(treeSrc.text);
const th = treeRows[0];
const iJibun = th.indexOf('지번주소'), iHaeng = th.indexOf('행정동'), iGu = th.indexOf('시군구');
const dongGu = new Map(); // 동/읍 이름 -> Map(구 -> count)
const add = (dong, gu) => { if (!dong || !gu) return; let m = dongGu.get(dong); if (!m) dongGu.set(dong, m = new Map()); m.set(gu, (m.get(gu) || 0) + 1); };
for (const r of treeRows.slice(1)) {
  const jm = (r[iJibun] || '').match(/대구광역시\s+(\S+[구군])\s+(\S+?(?:\d*동|읍|면|가))(?:\s|$)/);
  if (jm) add(jm[2], jm[1]);
  const gu = (r[iGu] || '').trim();
  if (/[구군]$/.test(gu)) add((r[iHaeng] || '').trim(), gu);
}
// 가로수 자료에 없는 구·군(달서구·달성군 등)은 태양광 허가 자료의 설치 주소로 보충한다.
const pvSrc = readText('15034028');
for (const r of parseCSV(pvSrc.text).slice(1)) {
  const addr = r[4] || '';
  const g = addr.match(/대구광역시\s+(\S+[구군])\s/);
  if (!g) continue;
  const eup = addr.match(/대구광역시\s+\S+[구군]\s+(\S+[읍면])(?:\s|$)/);
  if (eup) add(eup[1], g[1]);
  const paren = addr.match(/\((\S+?\d*동)[,)]/);
  if (paren) add(paren[1], g[1]);
  const jibun = addr.match(/대구광역시\s+\S+[구군]\s+(\S+?\d*동)\s+\d/);
  if (jibun) add(jibun[1], g[1]);
}
const guOf = name => {
  const m = dongGu.get(name);
  if (!m) return null;
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { gu: sorted[0][0], votes: sorted[0][1], others: sorted.slice(1).map(([g, c]) => `${g}:${c}`) };
};
const stationStats = S.stations.map(s => { const g = guOf(s.name); return { ...s, gu: g ? g.gu : null, guCheck: g }; });

// ---------- 3. 2020년 비교(2/18~4/30) ----------
const periodMean = (y, from, to, k) => {
  const a = dayIndex(y, from[0], from[1]), b = dayIndex(y, to[0], to[1]);
  return mean(recs.filter(r => r.di >= a && r.di <= b && !isNaN(r[k])).map(r => r[k]));
};
const P = { from: [2, 18], to: [4, 30] }, PRE = { from: [1, 1], to: [2, 17] };
const covid = { period: '2월 18일~4월 30일', pre: '1월 1일~2월 17일', byYear: {} };
for (const y of overview.years) {
  covid.byYear[y] = {};
  for (const k of ['no2', 'o3', 'pm25', 'co']) covid.byYear[y][k] = {
    during: round(periodMean(y, P.from, P.to, k), k === 'pm25' ? 2 : 4),
    pre: round(periodMean(y, PRE.from, PRE.to, k), k === 'pm25' ? 2 : 4),
  };
}
const pct = (a, b) => round((a - b) / b * 100, 1);
covid.vsBase = {}; covid.within = {};
for (const k of ['no2', 'o3', 'pm25', 'co']) {
  const base = mean([covid.byYear[2018][k].during, covid.byYear[2019][k].during]);
  covid.vsBase[k] = { y2020: pct(covid.byYear[2020][k].during, base), y2021: pct(covid.byYear[2021][k].during, base), y2022: pct(covid.byYear[2022][k].during, base) };
  covid.within[k] = Object.fromEntries(overview.years.map(y => [y, pct(covid.byYear[y][k].during, covid.byYear[y][k].pre)]));
}

// ---------- 4. 냉방도일(가스공사) ----------
const ddSrc = readText('15040826');
const ddRows = parseCSV(ddSrc.text);
const ddYears = ddRows[0].slice(2).map(Number);
const dg = ddRows.filter(r => r[0] === '대구');
const summer = ddYears.map((y, i) => ({ y, v: [6, 7, 8, 9].reduce((s, m) => s + num(dg.find(r => +r[1] === m)[i + 2]), 0) }));
const lin = pts => { const xs = pts.map(p => p.y), ys = pts.map(p => p.v), mx = mean(xs), my = mean(ys); const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0); return { slope: b, intercept: my - b * mx }; };
const ddFit = lin(summer);
const firstDecade = mean(summer.filter(p => p.y <= 2008).map(p => p.v));
const lastDecade = mean(summer.filter(p => p.y >= 2015).map(p => p.v));
const cooling = {
  years: summer.map(p => ({ y: p.y, v: p.v })),
  slopePerDecade: round(ddFit.slope * 10, 0), intercept: ddFit.intercept,
  firstDecadeMean: round(firstDecade, 0), lastDecadeMean: round(lastDecade, 0),
  changePct: round((lastDecade - firstDecade) / firstDecade * 100, 1),
  top: [...summer].sort((a, b) => b.v - a.v).slice(0, 3),
};

// ---------- 5. 머신러닝 예보: 11시까지의 자료로 그날 오후(13~18시) '나쁨' 맞히기 ----------
// 두 모델(로지스틱 회귀, 그래디언트 부스팅)을 2018~2020 학습 → 2021 검증으로 비교해 하나를 고르고,
// 고른 모델과 문턱값을 2018~2021로 다시 학습해 2022년에서 한 번만 시험한다.
const samples = core.buildSamples(recs, T);

function fitLogistic(rows, FS = FEATURES, lambda = 0.02, iters = 4000, lr = 0.1) {
  const K = FS.length;
  const mu = FS.map(F => mean(rows.map(r => r.f[F.key])));
  const sd = FS.map((F, j) => Math.sqrt(mean(rows.map(r => (r.f[F.key] - mu[j]) ** 2))) || 1);
  const X = rows.map(r => FS.map((F, j) => (r.f[F.key] - mu[j]) / sd[j]));
  const Y = rows.map(r => r.label);
  const w = new Array(K).fill(0); let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(K).fill(0); let gb = 0;
    for (let i = 0; i < X.length; i++) {
      let z = b; for (let j = 0; j < K; j++) z += w[j] * X[i][j];
      const e = 1 / (1 + Math.exp(-z)) - Y[i];
      gb += e; for (let j = 0; j < K; j++) gw[j] += e * X[i][j];
    }
    b -= lr * gb / X.length;
    for (let j = 0; j < K; j++) w[j] -= lr * (gw[j] / X.length + lambda * w[j]);
  }
  return { type: 'logistic', w, b, mu, sd, FS };
}
// 그래디언트 부스팅(깊이 2 나무, 뉴턴 단계, L2 = 1)
const evalTree = (t, x) => { while (t.j !== undefined) t = x[t.j] <= t.t ? t.l : t.r; return t.v; };
function fitGBM(rows, FS = FEATURES, { rounds = 120, lr = 0.08, minLeaf = 15, depth = 2 } = {}) {
  const K = FS.length;
  const X = rows.map(r => FS.map(F => r.f[F.key]));
  const Y = rows.map(r => r.label);
  const cands = FS.map((F, j) => {
    const v = [...new Set(X.map(x => x[j]))].sort((a, b) => a - b);
    if (v.length <= 24) return v.slice(0, -1).map((x, i) => (x + v[i + 1]) / 2);
    const q = []; for (let i = 1; i < 24; i++) q.push(v[Math.floor(i * v.length / 24)]);
    return [...new Set(q)];
  });
  const p0 = mean(Y), base = Math.log(p0 / (1 - p0));
  const Fz = X.map(() => base), trees = [], importance = new Array(K).fill(0);
  for (let m = 0; m < rounds; m++) {
    const Pp = Fz.map(z => 1 / (1 + Math.exp(-z)));
    const g = Y.map((y, i) => y - Pp[i]), h = Pp.map(p => p * (1 - p));
    const build = (idx, d) => {
      let G = 0, H = 0; for (const i of idx) { G += g[i]; H += h[i]; }
      const leaf = { v: round(G / (H + 1), 6) };
      if (d >= depth || idx.length < 2 * minLeaf) return leaf;
      let best = null;
      for (let j = 0; j < K; j++) for (const t of cands[j]) {
        let GL = 0, HL = 0, nL = 0;
        for (const i of idx) if (X[i][j] <= t) { GL += g[i]; HL += h[i]; nL++; }
        if (nL < minLeaf || idx.length - nL < minLeaf) continue;
        const gain = GL * GL / (HL + 1) + (G - GL) ** 2 / (H - HL + 1) - G * G / (H + 1);
        if (!best || gain > best.gain) best = { j, t, gain };
      }
      if (!best || best.gain <= 0) return leaf;
      importance[best.j] += best.gain;
      return { j: best.j, t: round(best.t, 6), l: build(idx.filter(i => X[i][best.j] <= best.t), d + 1), r: build(idx.filter(i => X[i][best.j] > best.t), d + 1) };
    };
    const tree = build(X.map((_, i) => i), 0);
    trees.push(tree);
    for (let i = 0; i < X.length; i++) Fz[i] += lr * evalTree(tree, X[i]);
  }
  return { type: 'gbm', base: round(base, 6), lr, trees, importance, FS };
}
const keysOf = M => (M.FS === FEATURES ? undefined : M.FS.map(F => F.key)); // 기본 입력값이면 생략(사이트 모델과 같은 형식)
const predictRaw = (M, f) => (M.type === 'gbm'
  ? core.predict({ type: 'gbm', base: M.base, lr: M.lr, trees: M.trees, features: keysOf(M) }, f)
  : core.predict({ type: 'logistic', bias: M.b, w: M.w, mu: M.mu, sd: M.sd, features: keysOf(M) }, f));
const fit = (type, rows, FS = FEATURES) => (type === 'gbm' ? fitGBM(rows, FS) : fitLogistic(rows, FS));
const bestThreshold = (rows, probs) => { // 놓친 '나쁨'을 더 무겁게 보는 F2 기준
  let best = { th: 0.5, f2: -1 };
  for (let th = 0.05; th <= 0.9001; th += 0.025) { const sc = scores(rows, probs.map(p => p >= th)); if (sc.f2 > best.f2) best = { th: round(th, 3), f2: sc.f2 }; }
  return best;
};
const tr0 = samples.filter(s => s.y <= 2020), va = samples.filter(s => s.y === 2021);
const train = samples.filter(s => s.y <= 2021), test = samples.filter(s => s.y === 2022);
const candidates = ['logistic', 'gbm'].map(type => {
  const M0 = fit(type, tr0);
  const vp = va.map(s => predictRaw(M0, s.f));
  const th = bestThreshold(va, vp);
  const M = fit(type, train);
  const tp = test.map(s => predictRaw(M, s.f));
  return { type, model: M, validation: { auc: auc(va, vp), th: th.th, f2: th.f2 }, testProbs: tp, test: { ...scores(test, tp.map(p => p >= th.th)), auc: auc(test, tp) } };
});
const chosen = candidates.reduce((a, b) => (b.validation.auc > a.validation.auc ? b : a)); // 검증 AUC로만 고른다
const importanceOf = c => {
  const FS = c.model.FS;
  if (c.type === 'gbm') { const tot = c.model.importance.reduce((s, v) => s + v, 0) || 1; return FS.map((F, j) => ({ key: F.key, label: F.label, v: round(c.model.importance[j] / tot * 100, 1) })); }
  const tot = c.model.w.reduce((s, v) => s + Math.abs(v), 0) || 1;
  return FS.map((F, j) => ({ key: F.key, label: F.label, v: round(Math.abs(c.model.w[j]) / tot * 100, 1), sign: Math.sign(c.model.w[j]) }));
};
const morningRule = (() => { // 11시 최고 오존만 보는 단순 규칙(학습 자료에서 F2 최대 문턱)
  let b2 = { th: 0, f2: -1 };
  for (let th = 0.03; th <= 0.1; th += 0.0025) { const sc = scores(train, train.map(s => s.f.o3Max11 >= th)); if (sc.f2 > b2.f2) b2 = { th, f2: sc.f2 }; }
  return { ...scores(test, test.map(s => s.f.o3Max11 >= b2.th)), rule: `11시 측정소 최고 오존 ${round(b2.th, 4)}ppm 이상이면 나쁨`, th: round(b2.th, 4) };
})();
const exportModel = c => (c.type === 'gbm'
  ? { type: 'gbm', base: c.model.base, lr: c.model.lr, trees: c.model.trees }
  : { type: 'logistic', bias: round(c.model.b, 5), w: c.model.w.map(v => round(v, 5)), mu: c.model.mu.map(v => round(v, 6)), sd: c.model.sd.map(v => round(v, 6)) });
const model = {
  target: '그날 13~18시에 대구 측정소 중 한 곳이라도 오존 0.091ppm 이상(나쁨)',
  cutoff: '11시', season: '4~9월', features: FEATURES,
  trainDays: train.length, testDays: test.length, validationDays: va.length,
  trainBadRate: round(mean(train.map(s => s.label)) * 100, 1), testBadRate: round(mean(test.map(s => s.label)) * 100, 1),
  compared: candidates.map(c => ({ type: c.type, validation: c.validation, test: c.test })),
  chosen: chosen.type, threshold: chosen.validation.th,
  test: chosen.test,
  importance: importanceOf(chosen),
  params: exportModel(chosen),
  baselines: {
    persistence: { ...scores(test, test.map(s => s.f.yBad === 1)), rule: '어제 오후가 나쁨이면 오늘도 나쁨' },
    season: { ...scores(test, test.map(s => s.m === 5 || s.m === 6)), rule: '5~6월이면 나쁨' },
    morning: morningRule,
  },
  days: test.map((s, i) => ({ date: s.date, p: round(chosen.testProbs[i], 3), actual: s.label, f: Object.fromEntries(FEATURES.map(F => [F.key, round(s.f[F.key], 4)])) })),
};

// ---------- 5-1. 새 자료로 다시 시험: 에어코리아 최종확정 측정자료 2024년 ----------
// 2024년은 학습(2018~2021)·검증(2021)·시험(2022) 어디에도 쓰지 않은 해다. 모델과 기준 확률은 바꾸지 않고 그대로 적용한다.
// 원본은 에어코리아 연도별 zip(전국)이고, analysis/extract-airkorea.mjs가 대구 도시대기 행만 data/derived에 뽑아 둔다.
const extFile = path.join(ROOT, 'data', 'derived', 'airkorea-final-2024-daegu-urban.csv');
let extSrc = null;
if (fs.existsSync(extFile)) {
  const meta = JSON.parse(fs.readFileSync(extFile.replace(/\.csv$/, '.json'), 'utf8'));
  const rowsX = parseCSV(fs.readFileSync(extFile, 'utf8').replace(/^﻿/, ''));
  const detX = core.detectColumns(rowsX[0]);
  const trained = new Set(S.stations.map(s => s.name));
  const allX = core.toRecords(rowsX.slice(1), detX.map).recs;
  const recX = allX.filter(r => trained.has(r.st)); // 학습 자료와 같은 측정소만(같은 '한 곳이라도 나쁨' 정의)
  const SX = core.summarize(recX, T);
  const sx = core.buildSamples(recX, T);
  const px = sx.map(s => predictRaw(chosen.model, s.f));
  const ov = SX.overview;
  model.external2024 = {
    year: 2024, stations: ov.stations, stationNames: [...new Set(recX.map(r => r.st))].sort(), excluded: [...new Set(allX.filter(r => !trained.has(r.st)).map(r => r.st))],
    overview: { badDays: ov.badDays, alertDays: ov.alertDays, std8Days: ov.std8Days, who8Days: ov.who8Days, maxO3: ov.maxO3, maxAt: ov.maxAt },
    days: sx.length, badDays: sx.reduce((a, s) => a + s.label, 0),
    test: { ...scores(sx, px.map(p => p >= model.threshold)), auc: auc(sx, px) },
    rule: { ...scores(sx, sx.map(s => s.f.o3Max11 >= morningRule.th)), rule: morningRule.rule },
  };
  extSrc = { title: meta.title, provider: meta.provider, url: meta.url, file: meta.sourceFile, sha256: meta.sourceSha256, bytes: meta.sourceBytes, license: '에어코리아 누리집 공개 자료(출처: 환경부·한국환경공단)', use: 'AI 예보 새 자료 시험(표 3), 내 데이터 분석의 연도별 zip 읽기 확인' };
}

// ---------- 5-2. 날씨(기상청 대구 지점 143 시간자료)와 오존 ----------
// 기상청 시각 HH:00은 그 시각까지의 관측(일사량은 직전 1시간 누적)이라, 대기질 자료의 'HH시'(HH-1~HH시 평균)와 같은 칸(t = 날*24 + HH - 1)에 맞춘다.
const wxSrc = (() => {
  const file = fs.readdirSync(RAW).find(f => f.startsWith('kma-asos-143'));
  return { file, text: fs.readFileSync(path.join(RAW, file), 'utf8').replace(/^﻿/, '') };
})();
const wxRows = parseCSV(wxSrc.text);
const wh = wxRows[0];
const wi = k => wh.indexOf(k);
const WX = new Map(); // t -> {ta, rn, ws, hm, icsr}
for (const r of wxRows.slice(1)) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})/.exec(r[wi('tm')] || ''); if (!m) continue;
  const di = dayIndex(+m[1], +m[2], +m[3]), HH = +m[4];
  const v = k => { const x = r[wi(k)]; return x === '' || x == null ? NaN : +x; };
  WX.set(di * 24 + HH - 1, { ta: v('ta'), rn: v('rn') || 0, ws: v('ws'), hm: v('hm'), icsr: v('icsr') || 0 }); // 비·일사 빈칸 = 0(비 없음·밤)
}
const wxAt = (di, HH, k) => { const w = WX.get(di * 24 + HH - 1); return w ? w[k] : NaN; };
const wxDay = di => { // 그 날 1~24시(기상청 01:00~24:00)
  const hs = []; for (let HH = 1; HH <= 24; HH++) { const w = WX.get(di * 24 + HH - 1); if (w) hs.push(w); }
  if (hs.length < 20) return null;
  const ta = hs.map(w => w.ta).filter(Number.isFinite);
  return { tmax: ta.length ? Math.max(...ta) : NaN, insol: hs.reduce((s, w) => s + w.icsr, 0), rain: hs.reduce((s, w) => s + w.rn, 0) };
};
const sumWx = (di, from, to, k) => { let s = 0, n = 0; for (let HH = from; HH <= to; HH++) { const v = wxAt(di, HH, k); if (Number.isFinite(v)) { s += v; n++; } } return n >= to - from ? s : NaN; };
const meanWx = (di, from, to, k) => { const v = []; for (let HH = from; HH <= to; HH++) { const x = wxAt(di, HH, k); if (Number.isFinite(x)) v.push(x); } return v.length >= to - from ? mean(v) : NaN; };

// (1) 4~9월 날마다: 그날 측정소 한 곳이라도 1시간 오존 '나쁨'이었는지와 그날 날씨
const cityAll = core.cityIndex(recs);
const dayO3Max = di => { let mx = NaN; for (let h = 0; h < 24; h++) { const v = cityAll.o3Max(di * 24 + h); if (Number.isFinite(v) && !(v <= mx)) mx = v; } return mx; };
const wxDays = [];
for (let di = dayIndex(2018, 1, 1); di <= dayIndex(2022, 12, 31); di++) {
  const { m } = core.dateOf(di); if (m < 4 || m > 9) continue;
  const w = wxDay(di), o = dayO3Max(di);
  if (!w || !Number.isFinite(w.tmax) || !Number.isFinite(o)) continue;
  wxDays.push({ di, m, ...w, bad: o >= T.bad ? 1 : 0 });
}
const binStats = (key, edges, label) => edges.slice(0, -1).map((lo, i) => {
  const hi = edges[i + 1], ds = wxDays.filter(d => d[key] >= lo && d[key] < hi);
  return { label: label(lo, hi, i, edges.length - 2), n: ds.length, bad: ds.reduce((s, d) => s + d.bad, 0), rate: ds.length ? round(mean(ds.map(d => d.bad)) * 100, 1) : null };
});
const tmaxBins = binStats('tmax', [-99, 24, 27, 30, 33, 99], (lo, hi, i, last) => (i === 0 ? `${hi}℃ 미만` : i === last ? `${lo}℃ 이상` : `${lo}~${hi}℃`));
const insolBins = binStats('insol', [0, 10, 15, 20, 25, 99], (lo, hi, i, last) => (i === 0 ? `${hi} 미만` : i === last ? `${lo} 이상` : `${lo}~${hi}`));
const byMonthWx = [4, 5, 6, 7, 8, 9].map(m => {
  const ds = wxDays.filter(d => d.m === m);
  return { m, n: ds.length, badRate: round(mean(ds.map(d => d.bad)) * 100, 1), tmax: round(mean(ds.map(d => d.tmax)), 1), insol: round(mean(ds.map(d => d.insol)), 1), rainyShare: round(mean(ds.map(d => (d.rain >= 1 ? 1 : 0))) * 100, 1) };
});
const hotSunny = wxDays.filter(d => d.tmax >= 30 && d.insol >= 20), others = wxDays.filter(d => !(d.tmax >= 30 && d.insol >= 20));
const july = wxDays.filter(d => d.m === 7), julyRain = july.filter(d => d.rain >= 1), julyDry = july.filter(d => d.rain < 1);
const weather = {
  station: '대구(143)', days: wxDays.length,
  tmaxBins, insolBins, byMonth: byMonthWx,
  hotSunny: { n: hotSunny.length, rate: round(mean(hotSunny.map(d => d.bad)) * 100, 1), restN: others.length, restRate: round(mean(others.map(d => d.bad)) * 100, 1) },
  july: { rainN: julyRain.length, rainRate: round(mean(julyRain.map(d => d.bad)) * 100, 1), dryN: julyDry.length, dryRate: round(mean(julyDry.map(d => d.bad)) * 100, 1) },
};

// (2) 날씨를 더한 예보 모델: 11시까지 알 수 있는 기상 값만 더한다(같은 학습·검증·시험 나누기, 검증 AUC로만 고름)
const WX_FEATURES = [
  ...FEATURES,
  { key: 'ta11', label: '11시 기온', unit: '℃' },
  { key: 'insol6to11', label: '6~11시 일사량 합', unit: 'MJ/m²' },
  { key: 'ws6to11', label: '6~11시 평균 풍속', unit: 'm/s' },
  { key: 'hm11', label: '11시 습도', unit: '%' },
  { key: 'yTmax', label: '전날 최고기온', unit: '℃' },
];
const withWx = samples.map(s => {
  const yw = wxDay(s.di - 1);
  return { ...s, f: { ...s.f, ta11: wxAt(s.di, 11, 'ta'), insol6to11: sumWx(s.di, 7, 11, 'icsr'), ws6to11: meanWx(s.di, 6, 11, 'ws'), hm11: wxAt(s.di, 11, 'hm'), yTmax: yw ? yw.tmax : NaN } };
}).filter(s => WX_FEATURES.every(F => Number.isFinite(s.f[F.key])));
const wTr0 = withWx.filter(s => s.y <= 2020), wVa = withWx.filter(s => s.y === 2021);
const wTrain = withWx.filter(s => s.y <= 2021), wTest = withWx.filter(s => s.y === 2022);
const wxCandidates = ['logistic', 'gbm'].map(type => {
  const M0 = fit(type, wTr0, WX_FEATURES);
  const vp = wVa.map(s => predictRaw(M0, s.f));
  const th = bestThreshold(wVa, vp);
  const M = fit(type, wTrain, WX_FEATURES);
  const tp = wTest.map(s => predictRaw(M, s.f));
  return { type, model: M, validation: { auc: auc(wVa, vp), th: th.th, f2: th.f2 }, test: { ...scores(wTest, tp.map(p => p >= th.th)), auc: auc(wTest, tp) } };
});
const wxChosen = wxCandidates.reduce((a, b) => (b.validation.auc > a.validation.auc ? b : a));
// 같은 날들(기상 값이 있는 날)에서 운영 모델(대기질만)의 성적도 다시 계산해 공정하게 비교한다
const baseOnSame = (() => {
  const M0 = fit(chosen.type, wTr0), vp = wVa.map(s => predictRaw(M0, s.f)), th = bestThreshold(wVa, vp);
  const M = fit(chosen.type, wTrain), tp = wTest.map(s => predictRaw(M, s.f));
  return { type: chosen.type, validation: { auc: auc(wVa, vp), th: th.th }, test: { ...scores(wTest, tp.map(p => p >= th.th)), auc: auc(wTest, tp) } };
})();
weather.model = {
  features: WX_FEATURES.slice(FEATURES.length),
  days: { train: wTrain.length, validation: wVa.length, test: wTest.length },
  compared: wxCandidates.map(c => ({ type: c.type, validation: c.validation, test: c.test })),
  chosen: wxChosen.type, withWeather: { validation: wxChosen.validation, test: wxChosen.test },
  airOnly: baseOnSame,
  importance: importanceOf(wxChosen),
};

// ---------- 5-3. 탄소중립과 오존: 대구 태양광 허가 용량, '나쁨' 날의 햇빛 ----------
// 상태가 인허가취소·폐업·타시도이관인 허가는 뺀다. '사업개시'만 가동 중으로 본다. 2023년 대구에 편입된 군위군 허가도 자료에 들어 있다.
const pvRows = parseCSV(pvSrc.text).slice(1).map(r => ({ date: (r[1] || '').trim(), kw: num(r[3]), addr: r[4] || '', status: (r[5] || '').trim() }))
  .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.kw));
const pvLive = pvRows.filter(r => !/취소|폐업|이관/.test(r.status));
const pvYears = [...new Set(pvLive.map(r => +r.date.slice(0, 4)))].sort((a, b) => a - b);
const pvLatest = pvRows.reduce((a, r) => (r.date > a ? r.date : a), '');
const pvByYear = pvYears.map(y => {
  const ys = pvLive.filter(r => +r.date.slice(0, 4) === y);
  return { y, n: ys.length, mw: round(ys.reduce((s, r) => s + r.kw, 0) / 1000, 1), opMw: round(ys.filter(r => r.status === '사업개시').reduce((s, r) => s + r.kw, 0) / 1000, 1) };
});
const pvGu = {};
for (const r of pvLive) { const g = (r.addr.match(/대구광역시\s+(\S+[구군])/) || [])[1] || '기타'; pvGu[g] = (pvGu[g] || 0) + r.kw; }
// 4~9월 시각별 평균 일사량: 오존 '나쁨' 날과 나머지 날(기상청 대구, 직전 1시간 누적 MJ/m²)
const insolHours = []; for (let HH = 6; HH <= 19; HH++) insolHours.push(HH);
const hourMeans = ds => insolHours.map(HH => round(mean(ds.map(d => wxAt(d.di, HH, 'icsr')).filter(Number.isFinite)), 3));
const badDs = wxDays.filter(d => d.bad), okDs = wxDays.filter(d => !d.bad);
const carbon = {
  pv: {
    latest: pvLatest, permits: pvLive.length, cancelled: pvRows.length - pvLive.length,
    totalMw: round(pvLive.reduce((s, r) => s + r.kw, 0) / 1000, 1),
    operatingMw: round(pvLive.filter(r => r.status === '사업개시').reduce((s, r) => s + r.kw, 0) / 1000, 1),
    byYear: pvByYear,
    byGu: Object.entries(pvGu).map(([gu, kw]) => ({ gu, mw: round(kw / 1000, 1) })).sort((a, b) => b.mw - a.mw),
  },
  insol: {
    hours: insolHours, bad: hourMeans(badDs), other: hourMeans(okDs), badN: badDs.length, otherN: okDs.length,
    badDay: round(mean(badDs.map(d => d.insol)), 1), otherDay: round(mean(okDs.map(d => d.insol)), 1),
  },
};

// ---------- 6. '내 데이터 분석' 예시 파일: 2022년 5~6월(원본 그대로의 열, UTF-8) ----------
const sampleDir = path.join(ROOT, 'site', 'sample');
fs.mkdirSync(sampleDir, { recursive: true });
const sampleRows = aqRows.filter((r, i) => i === 0 || (r[1] === '2022' && (r[2] === '05' || r[2] === '06')));
fs.writeFileSync(path.join(sampleDir, 'daegu-airquality-2022-05-06.csv'), '﻿' + sampleRows.map(r => r.join(',')).join('\r\n') + '\r\n');

// ---------- 내보내기 ----------
const unresolved = stationStats.filter(s => !s.gu).map(s => s.name);
const data = {
  generated: new Date().toISOString().slice(0, 10),
  thresholds: T,
  sources: {
    airQuality: { title: '대구광역시_대기질 항목별 시간평균자료', provider: '대구광역시(보건환경연구원)', url: 'https://www.data.go.kr/data/15083249/fileData.do', file: aqSrc.file, license: '이용허락범위 제한 없음' },
    cooling: { title: '한국가스공사_월별 시도별 냉난방도일 통계현황', provider: '한국가스공사', url: 'https://www.data.go.kr/data/15040826/fileData.do', file: ddSrc.file, license: '이용허락범위 제한 없음' },
    trees: { title: '대구광역시_가로수정보', provider: '대구광역시', url: 'https://www.data.go.kr/data/15109655/fileData.do', file: treeSrc.file, license: '이용허락범위 제한 없음', use: '측정소 이름(동·읍)의 구·군 확인에만 사용' },
    solar: { title: '대구광역시_태양광전기사업허가현황', provider: '대구광역시', url: 'https://www.data.go.kr/data/15034028/fileData.do', file: pvSrc.file, license: '이용허락범위 제한 없음', use: '측정소 이름(동·읍)의 구·군 확인, 대구 태양광 허가 용량 분석(그림 8)' },
    weather: { title: '기상청_지상(종관, ASOS) 시간자료 조회서비스', provider: '기상청', url: 'https://www.data.go.kr/data/15057210/openapi.do', file: wxSrc.file, license: '공공누리 제1유형(출처표시)', use: '대구(143) 2018~2022 시간자료: 기온, 일사량, 강수량, 풍속, 습도' },
    airkorea: { title: '한국환경공단_에어코리아_대기오염정보', provider: '한국환경공단', url: 'https://www.data.go.kr/data/15073861/openapi.do', license: '공공누리 제3유형(출처표시, 변경금지): 측정값은 받은 그대로 보여 주고, 평균과 예보 확률은 이 사이트의 계산값으로 따로 표시', use: '홈의 실시간 측정값과 오늘의 AI 예보(서버 함수가 1시간 단위로 받아 옴)' },
    ...(extSrc ? { airkoreaFinal: extSrc } : {}),
  },
  overview, monthHour: S.monthHour, yearMonth: S.yearMonth, diurnal: S.diurnal, stations: stationStats, weekend: S.weekend, covid, cooling,
  stripes: S.stripes, stripesStart: S.stripesStart, model, weather, carbon,
};
fs.writeFileSync(OUT, '// analysis/analyze.cjs가 생성한 파일. 직접 고치지 말 것.\nwindow.OZONE_DATA = ' + JSON.stringify(data) + ';\n');
// 사이트에서 분석 코드를 그대로 볼 수 있게 복사한다(공개 투명성).
fs.mkdirSync(path.join(ROOT, 'site', 'code'), { recursive: true });
fs.copyFileSync(__filename, path.join(ROOT, 'site', 'code', 'analyze.cjs.txt'));
fs.copyFileSync(path.join(ROOT, 'site', 'ozone-core.js'), path.join(ROOT, 'site', 'code', 'ozone-core.js.txt'));
fs.copyFileSync(path.join(ROOT, 'site', 'ozone-files.js'), path.join(ROOT, 'site', 'code', 'ozone-files.js.txt'));

// 확인용 요약
console.log('rows', recs.length, 'stations', overview.stations, 'end', overview.end);
console.log('overview', JSON.stringify(overview));
console.log('station→구', stationStats.map(s => `${s.name}:${s.gu}`).join(' '), unresolved.length ? 'UNRESOLVED ' + unresolved : '');
console.log('model', JSON.stringify({ train: model.trainDays, valid: model.validationDays, test: model.testDays, chosen: model.chosen, th: model.threshold, test: model.test }));
console.log('weather', JSON.stringify({ days: weather.days, tmaxBins: weather.tmaxBins, insolBins: weather.insolBins, byMonth: weather.byMonth, hotSunny: weather.hotSunny, july: weather.july }));
console.log('wx model', JSON.stringify(weather.model.days), 'chosen', weather.model.chosen, 'withWeather', JSON.stringify(weather.model.withWeather), 'airOnly', JSON.stringify(weather.model.airOnly), 'imp', JSON.stringify(weather.model.importance.slice(-5)));
console.log('carbon', JSON.stringify(carbon));
console.log('external2024', JSON.stringify(model.external2024 || null));
console.log('sample rows', sampleRows.length - 1);
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
