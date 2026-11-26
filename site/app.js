/* 대구 오존 시간표: 화면 그리기. 데이터는 data.js(window.OZONE_DATA, analysis/analyze.cjs가 생성) */
(function () {
  'use strict';
  const D = window.OZONE_DATA, O = D.overview, M = D.model;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), d);
  const pct = (v, d = 0) => nf(v * 100, d) + '%';
  // 색은 tokens.css 한 곳에서 정하고 여기서 읽는다(--viz-*, --ramp, --color-*-well)
  const CSSV = getComputedStyle(document.documentElement), tok = n => CSSV.getPropertyValue(n).trim();
  const C = { o3: tok('--viz-o3'), no2: tok('--viz-no2'), pm: tok('--viz-pm'), ink: tok('--viz-ink'), muted: tok('--viz-muted'), empty: tok('--viz-empty'), onDark: tok('--viz-on-dark'), onLight: tok('--viz-on-light'), goodWell: tok('--color-good-well'), badWell: tok('--color-bad-well') };
  const RAMP = tok('--ramp').split(',').map(x => x.trim());
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function seq(t) {
    if (!Number.isFinite(t)) return C.empty;
    t = Math.max(0, Math.min(1, t));
    const x = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i, a = hex(RAMP[i]), b = hex(RAMP[i + 1]);
    return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('');
  }
  const rampBar = (el, a, b) => { el.innerHTML = `<span>${a}</span><span class="bar" style="background:linear-gradient(90deg,${RAMP.join(',')})"></span><span>${b}</span>`; };
  const svg = (w, h, inner, label) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
  const widthOf = el => Math.max(260, Math.floor(el.clientWidth || el.parentElement.clientWidth || 600));
  const kdt = s => `${+s.slice(5, 7)}월 ${+s.slice(8, 10)}일 ${s.slice(11, 16)}`; // '2026-11-09 11:00' → '11월 9일 11:00'
  // 원자료의 'h시' = (h−1)시~h시 1시간 평균. 축은 시작 시각, 설명은 범위로 쓴다.
  const HS = h => `${h - 1}시`, HR = h => `${h - 1}~${h}시`;

  // ---------- 툴팁 ----------
  const tip = $('tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.classList.remove('on'); return; }
    tip.innerHTML = t.getAttribute('data-tip'); tip.classList.add('on');
    const r = tip.getBoundingClientRect(); let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });

  // ---------- 참고문헌(번호는 이 배열 순서) ----------
  const REFS = [
    { id: 'd1', type: '공공데이터', cls: 'own', text: '대구광역시(보건환경연구원), 「대구광역시_대기질 항목별 시간평균자료」 2018~2022, 공공데이터포털, 이용허락범위 제한 없음.', url: 'https://www.data.go.kr/data/15083249/fileData.do' },
    { id: 'd2', type: '공공데이터', cls: 'own', text: '한국가스공사, 「한국가스공사_월별 시도별 냉난방도일 통계현황」 1999~2024, 공공데이터포털, 이용허락범위 제한 없음.', url: 'https://www.data.go.kr/data/15040826/fileData.do' },
    { id: 'd3', type: '공공데이터', cls: 'own', text: '대구광역시, 「대구광역시_가로수정보」, 공공데이터포털, 이용허락범위 제한 없음(측정소 구·군 확인과 태양광 허가 용량 분석).', url: 'https://www.data.go.kr/data/15109655/fileData.do' },
    { id: 'd4', type: '공공데이터', cls: 'own', text: '대구광역시, 「대구광역시_태양광전기사업허가현황」, 공공데이터포털(측정소 구·군 확인용).', url: 'https://www.data.go.kr/data/15034028/fileData.do' },
    { id: 'd5', type: '공공데이터', cls: 'own', text: '기상청, 「기상청_지상(종관, ASOS) 시간자료 조회서비스」 대구(143) 2018~2022 시간자료(기온·일사량·강수량·풍속·습도), 공공데이터포털, 공공누리 제1유형(출처표시).', url: 'https://www.data.go.kr/data/15057210/openapi.do' },
    { id: 'd6', type: '공공데이터', cls: 'own', text: '환경부·한국환경공단, 「한국환경공단_에어코리아_대기오염정보」 실시간 측정정보(대구 측정소), 공공데이터포털, 공공누리 제3유형(출처표시, 변경금지). 측정값은 받은 그대로 보여 주고, 평균과 예보 확률은 이 사이트의 계산값으로 따로 표시합니다.', url: 'https://www.data.go.kr/data/15073861/openapi.do' },
    { id: 'd7', type: '공공데이터', cls: 'own', text: '환경부·한국환경공단, 에어코리아 「최종확정 측정자료」 2024년(연도별 zip, 월별 엑셀). 에어코리아 누리집 공개 자료. 대구 도시대기 측정소 행만 뽑아 AI 예보를 다시 시험(표 3).', url: 'https://www.airkorea.or.kr/web/last_amb_hour_data?pMENU_NO=123' },
    { id: 's1', type: '공식 통계', cls: 'stat', text: '국립환경과학원 국가기후위기적응센터, 「기후변화와 오존」 현안보고서. 보도: 스마트투데이, 「오존 농도·주의보 발령횟수·기간 갈수록↑↑↑」, 2022-06-27.', url: 'https://www.smarttoday.co.kr/ko-kr/articles/23634' },
    { id: 's2', type: '공식 통계', cls: 'stat', text: '기후에너지환경부 국립환경과학원 대기환경연구과, 「폭염에도 전국 오존주의보 발령 감소… 8월과 남부권 감소폭 두드러져」, 2026-09-22 (KDI 경제정보센터 수록).', url: 'https://eiec.kdi.re.kr/policy/materialView.do?num=287279' },
    { id: 's3', type: '공식 통계', cls: 'stat', text: '서울특별시, 「갈수록 높아가는 오존 농도, 대기환경정보를 확인해 주세요!」, 2024-09-04.', url: 'https://news.seoul.go.kr/env/?p=559396' },
    { id: 's4', type: '공식 통계', cls: 'stat', text: '경북매일, 「대구보건환경연구원, 대기오염 실시간 서비스」, 2025-04-13 (대구 오존주의보 발령 횟수·기준, 대구시 보건환경연구원 자료).', url: 'https://kbmaeil.com/article/202504131173686' },
    { id: 's5', type: '보고서', cls: 'report', text: '질병관리청, 「제1차 기후보건영향평가 결과 보고서」, 2022-03-22. 보도: 더나은미래, 「기후변화 가속화, 건강에도 ‘빨간불’… 오존 노출 사망 10년새 2배」, 2022-03-23.', url: 'https://futurechosun.com/archives/63319' },
    { id: 's6', type: '보고서', cls: 'report', text: '질병관리청, 「한국 초고령 노인에서 폭염한파와 오존이 사망에 미치는 단기적 영향」. 보도: 코메디닷컴, 「오존 농도 올라갈수록... 80대 노인 사망위험 높다」, 2023-09-03.', url: 'https://kormedi.com/1618876/' },
    { id: 's7', type: '공식 안내', cls: 'stat', text: '서울특별시, 「5.14(수) 14시 기준, 동남권 4개 자치구에 오존주의보 발령」(오존 발령 기준 0.12ppm/hr), 2014-05-14.', url: 'https://news.seoul.go.kr/env/archives/38524' },
    { id: 's8', type: '공식 안내', cls: 'stat', text: '서울특별시, 「맑은 날 더 주의해야 하는 여름철 오존, 제대로 알고 피하기」, 2026-08-26.', url: 'https://news.seoul.go.kr/env/?p=570509' },
    { id: 's9', type: '공식 안내', cls: 'stat', text: '대구광역시, 대기환경기준(오존 1시간 0.1ppm 이하, 8시간 0.06ppm 이하).', url: 'https://www.daegu.go.kr/env/index.do?menu_id=00001300' },
    { id: 's10', type: '공식 안내', cls: 'stat', text: '파주시, 대기질 예보 등급(오존 나쁨 0.091~0.150ppm).', url: 'https://www.paju.go.kr/www/www_02/environment/environment_01/environment_01_08/environment_01_08_03.jsp' },
    { id: 'w1', type: '국제 기준', cls: 'report', text: 'World Health Organization, WHO global air quality guidelines: particulate matter (PM2.5 and PM10), ozone, nitrogen dioxide, sulfur dioxide and carbon monoxide, 2021-09-22.', url: 'https://www.who.int/publications/i/item/9789240034228' },
    { id: 'w2', type: '국제 기준', cls: 'report', text: 'UK COMEAP, COMEAP statement: response to publication of the World Health Organization Air quality guidelines 2021, 2022-07-27 (오존 성수기 60µg/m³, 8시간 100µg/m³ 표).', url: 'https://www.gov.uk/government/publications/comeap-statement-response-to-who-air-quality-guidelines-2021/comeap-statement-response-to-publication-of-the-world-health-organization-air-quality-guidelines-2021' },
    { id: 'p1', type: '논문', cls: 'paper', text: 'Vicedo-Cabrera AM, Sera F, et al. Short term association between ozone and mortality: global two stage time series study in 406 locations in 20 countries. BMJ 2020;368:m108.', url: 'https://doi.org/10.1136/bmj.m108' },
    { id: 'p2', type: '논문', cls: 'paper', text: 'Fu TM, Tian H. Climate Change Penalty to Ozone Air Quality: Review of Current Understandings and Knowledge Gaps. Current Pollution Reports 2019;5(3):159-171.', url: 'https://doi.org/10.1007/s40726-019-00115-6' },
    { id: 'p3', type: '논문', cls: 'paper', text: 'Colombi NK, et al. Why is ozone in South Korea and the Seoul metropolitan area so high and increasing? Atmospheric Chemistry and Physics 2023;23:4031-4044.', url: 'https://doi.org/10.5194/acp-23-4031-2023' },
    { id: 'p4', type: '논문', cls: 'paper', text: '전병일. 부산지역 오존농도의 주말 효과 특성. 한국환경과학회지 2014;23(5):861-871.', url: 'https://db.koreascholar.com/Article/Detail/358154' },
    { id: 'p5', type: '논문', cls: 'paper', text: 'Vuong QT, Thang PQ, et al. Effects of the COVID-19 lockdown on criteria air pollutants in the city of Daegu, the epicenter of South Korea’s outbreak. Environmental Science and Pollution Research 2020;27:45983-45991.', url: 'https://doi.org/10.1007/s11356-020-11360-4' },
    { id: 'c1', type: '커뮤니티', cls: 'comm', text: '신나게마을 블로그(위키독스), 「오존은 더울수록 짙다는데, 4년 내내 7월과 8월이 5월과 6월보다 옅었어요 (측정소 665곳)」, 2026-09-14.', url: 'https://wikidocs.net/blog/@sinnake_town/31068/' },
    { id: 'c2', type: '시민단체', cls: 'comm', text: 'Group Against Smog and Pollution(GASP), Physical activity and temporal trends in air quality.', url: 'https://www.gasp-pgh.org/physical-activity-and-temporal-trends-in-air-quality-1' },
    { id: 'c3', type: '공공기관', cls: 'comm', text: 'Mid-America Regional Council(MARC), Protecting your health and the environment on Ozone Alert days.', url: 'https://www.marc.org/news/environment/protecting-your-health-and-environment-ozone-alert-days' },
    { id: 'm1', type: '실시간 자료', cls: 'own', text: 'Zippenfenig P. (2023). Open-Meteo.com Weather API. Zenodo, doi:10.5281/ZENODO.7970649. 첫 화면의 현재 기온·습도·풍속·풍향·일사량, CC BY 4.0.', url: 'https://open-meteo.com/' },
    { id: 'm2', type: '실시간 자료', cls: 'own', text: 'Open-Meteo Air Quality API, Copernicus 대기 모델 예측(오존·이산화질소·초미세먼지), CC BY 4.0. 공식 측정값이 아닌 모델 추정치.', url: 'https://open-meteo.com/en/docs/air-quality-api' },
    { id: 'm3', type: '공식 실시간', cls: 'stat', text: '한국환경공단, 에어코리아 실시간 대기정보(공식 측정값).', url: 'https://www.airkorea.or.kr/' },
  ];
  const VIDEOS = [
    { id: 'OlfB3wkdK9E', kind: '공익광고', title: '[공익광고협의회] 기후 변화-기후 위기는 비싸다(30초)', ch: 'KOBACO공익광고협의회' },
    { id: 'cCW6eKySZjk', kind: '정부 영상', title: '더 뜨거워지기🔥 전에! 하나뿐인 지구🌎를 위해', ch: '기후에너지환경부' },
    { id: 'fA-Xa-LcJzQ', kind: '정부 영상', title: '여름철 고농도 오존 피해 튀어!😫ㅣ여름 건강 챙기는 국민행동요령 #환경부 #오존', ch: '기후에너지환경부' },
    { id: 'Gp801l9PfJI', kind: '정부 영상', title: '오존 고농도 시기 건강루틴 🏃🏃‍♂️', ch: '기후에너지환경부' },
    { id: 'jloUotqhnMY', kind: '정부 영상', title: '오존예보는 누가, 어떻게 만들까?  I 주간환경부', ch: '기후에너지환경부' },
    { id: 'Z1dRC2119aI', kind: '방송 보도', title: '질병관리청 “오존 노출, 80세 이상 초고령층 사망 위험 높여” [기후는 말한다] / KBS  2023.08.29.', ch: 'KBS News' },
    { id: 'T_5meFIgpl4', kind: '방송 보도', title: '마스크 써도 못 피하는 \'인체 유해\' 오존‥이른 더위에 더 빨리 더 자주 (2024.06.20/뉴스데스크/MBC)', ch: 'MBCNEWS' },
    { id: 'KWetxqFH4o8', kind: '방송 보도', title: '"낮 기온이 39.4℃라고?" 1994년 대구 폭염 | 백투더투데이', ch: '대구MBC뉴스' },
  ];
  VIDEOS.forEach((v, i) => REFS.push({ id: 'v' + (i + 1), type: '영상 · ' + v.kind, cls: 'video', text: `${v.ch}, 「${v.title}」, YouTube.`, url: 'https://www.youtube.com/watch?v=' + v.id }));
  const NUM = Object.fromEntries(REFS.map((r, i) => [r.id, i + 1]));
  const cite = (...ids) => `<span class="cite">[${ids.map(id => `<a href="#ref-${id}">${NUM[id]}</a>`).join(', ')}]</span>`;

  // ---------- 공통 수치 ----------
  const sumMonth = m => D.yearMonth.reduce((s, row) => s + row[m - 1], 0);
  const mj = sumMonth(5) + sumMonth(6), ja = sumMonth(7) + sumMonth(8);
  let peak = { v: -1 }; D.monthHour.forEach((row, m) => row.forEach((c, h) => { if (c.o3Bad > peak.v) peak = { v: c.o3Bad, m: m + 1, h: h + 1 }; }));
  const W8 = D.weekend, CV = D.covid.vsBase, CW = D.covid.within, T = M.test;
  function windows(month, dur) { // 5~22시(원자료 6~22시) 중 '둘 중 하나라도 나쁨' 평균이 가장 낮은·높은 구간
    const row = D.monthHour[month - 1], hrs = Array.from({ length: 17 }, (_, i) => i + 6), e = hrs.map(h => row[h - 1].either);
    let best = null, worst = null;
    for (let i = 0; i + dur <= hrs.length; i++) { const v = e.slice(i, i + dur).reduce((a, b) => a + b, 0) / dur; if (!best || v < best.v) best = { i, v }; if (!worst || v > worst.v) worst = { i, v }; }
    const lab = w => `${hrs[w.i] - 1}~${hrs[w.i] + dur - 1}시`;
    return { hrs, best: { ...best, label: lab(best) }, worst: { ...worst, label: lab(worst) } };
  }

  // ---------- 숫자 채우기 ----------
  const K = { period: `${O.start.slice(0, 4)}~${O.end.slice(0, 4)}`, stations: nf(O.stations), rowsMan: nf(O.rows / 10000), generated: D.generated };
  document.querySelectorAll('[data-k]').forEach(el => { if (K[el.dataset.k] !== undefined) el.textContent = K[el.dataset.k]; });

  // ---------- 히어로 코딩창: 이 사이트의 실제 분석 단계와 결과 ----------
  (function codebox() {
    const L = [
      ['cmd', '<span class="c">$</span> node analysis/analyze.cjs'],
      ['out', `대기질 시간자료 ${nf(O.rows)}행 · 측정소 ${O.stations}곳 읽음`],
      ['cmd', `bad = days.<span class="f">filter</span>(d =&gt; d.maxO3 &gt;= <span class="s">0.091</span>)`],
      ['out', `→ ${O.badDays}일 (5~6월 ${mj}일 · 7~8월 ${ja}일)`],
      ['cmd', `who = days.<span class="f">filter</span>(d =&gt; d.max8h &gt; <span class="s">0.051</span>)`],
      ['out', `→ ${O.who8Days}일 WHO 8시간 권고 초과`],
      ['cmd', `<span class="f">bootstrap</span>(sunday, weekday, <span class="s">4000</span>)`],
      ['out', `→ O₃ ${sgn(W8.o3.pct)}% [${sgn(W8.o3.loPct)}, ${sgn(W8.o3.hiPct)}] · NO₂ ${sgn(W8.no2.pct)}%`],
      ['cmd', `<span class="k">const</span> model = <span class="f">fitLogistic</span>(train_2018_21)`],
      ['cmd', `<span class="f">evaluate</span>(model, test_2022)`],
      ['out', `→ 나쁨 ${T.tp}/${T.tp + T.fn}일 미리 포착 · AUC ${nf(T.auc, 2)}`],
    ];
    const plain = s => s.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<');
    let n = 0;
    $('codebox').innerHTML = `<div class="bar"><span>analyze.cjs: 이 사이트의 분석 코드</span><span>Node.js, 공공데이터 원본에서 계산</span></div>` +
      L.map(([k, l], i) => `<div class="code-row ${k}"><i>${k === 'cmd' ? String(++n).padStart(2, '0') : ''}</i><span class="typed" style="--line:${i};--chars:${plain(l).length}">${l}</span></div>`).join('') +
      `<div class="code-row"><i>${String(n + 1).padStart(2, '0')}</i><span class="caret"></span></div>`;
  })();

  // ---------- 지금 대구: 오존은 에어코리아 실측(api/air), 기온·바람·일사량은 서버가 받아 둔 값(api/wx) ----------
  // 출처마다 따로 받아 오는 대로 바로 그린다. 한 출처가 응답하지 않아도 나머지는 멈추지 않는다.
  (function live() {
    const LAT = 35.8714, LON = 128.6014; // 대구광역시청 부근
    const WX = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,shortwave_radiation,is_day&timezone=Asia%2FSeoul&wind_speed_unit=ms`;
    const AQ = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&current=ozone,nitrogen_dioxide,pm2_5&timezone=Asia%2FSeoul`;
    const DIRS = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
    const dirName = deg => DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] + '풍'; // 풍향 = 바람이 불어오는 방향
    const grade = ppm => (ppm <= 0.030 ? ['좋음', 'good'] : ppm <= 0.090 ? ['보통', 'fair'] : ppm <= 0.150 ? ['나쁨', 'bad'] : ['매우나쁨', 'worse']);
    const set = (k, html, tipHtml) => {
      const el = document.querySelector(`[data-live="${k}"]`); if (!el) return;
      el.innerHTML = html;
      const fig = el.closest('figure');
      if (tipHtml) fig.setAttribute('data-tip', tipHtml); else fig.removeAttribute('data-tip');
    };
    // 응답이 없는 출처를 끝없이 기다리지 않도록 시간 제한을 둔다
    const getJson = (u, ms = 9000) => { const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms); return fetch(u, { cache: 'no-store', signal: ctl.signal }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).finally(() => clearTimeout(to)); };
    const AIRKOREA = '<a href="https://www.airkorea.or.kr/" target="_blank" rel="noopener">에어코리아</a>';
    const OM = '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> (CC BY 4.0)';
    const METNO = '<a href="https://api.met.no/" target="_blank" rel="noopener">MET Norway</a> (CC BY 4.0)';
    const note = { o3: '', wx: '', credit: OM };
    const paint = () => { const parts = [note.o3, note.wx].filter(Boolean); $('env-src').innerHTML = (parts.length ? `대구 현재 값, 15분마다 갱신. ${parts.join('. ')}.` : '대구 실시간 값을 불러오는 중…') + ' ' + note.credit; };
    // 기온·바람·일사량 그리기. d = { label, time, temp, hum, ws, wd, sun, isDay, lastSun, stale, source }
    function showWx(d) {
      set('temp', `${nf(d.temp, 1)}℃`, `<b>기온</b> ${nf(d.temp, 1)}℃${d.hum != null ? ` · 습도 ${nf(d.hum)}%` : ''}`);
      set('wind', `${nf(d.ws, 1)}m/s<em>${dirName(d.wd)}</em>`, `<b>바람</b> ${nf(d.ws, 1)}m/s · ${dirName(d.wd)}(${Math.round(d.wd)}° 쪽에서 불어옴)`);
      if (d.sun != null) set('sun', `${nf(d.sun)}W/m²${d.isDay ? '' : '<em>밤</em>'}`, `<b>일사량</b> ${nf(d.sun)}W/m², 태양광 발전과 오존 생성에 쓰이는 햇빛의 세기`);
      else if (d.isDay === false) set('sun', '밤', '<b>일사량</b> 해가 진 뒤입니다. 일사량 출처(Open-Meteo)가 응답하지 않아 값은 받지 못했습니다');
      else if (d.lastSun) set('sun', `${nf(d.lastSun.v)}W/m²<em>${d.lastSun.time}</em>`, `<b>일사량</b> 출처(Open-Meteo)가 응답하지 않아 마지막으로 받은 ${d.lastSun.time}의 값을 보여 줍니다`);
      else set('sun', '받지 못함', '<b>일사량</b> 출처(Open-Meteo)가 응답하지 않습니다');
      const base = `기온·바람${d.sun != null ? '·일사량' : ''}은 ${d.label}(${d.time}${d.stale ? ', 새 값을 받지 못해 마지막으로 받은 값' : ''})`;
      note.wx = d.source === 'open-meteo' ? `${base} ${cite('m1')}` : `${base}. Open-Meteo가 응답하지 않아 대신 쓰며 일사량은 주지 않습니다`;
      note.credit = d.source === 'met-norway' ? `${METNO}, ${OM}` : OM;
      paint();
    }
    function showO3Measured(j) {
      const ak = j.stations.filter(s => s.row[1] != null); if (!ak.length) return false;
      const latest = ak.reduce((a, s) => (s.row[0] > a ? s.row[0] : a), '');
      const lp = latest.match(/^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/); // 한국 시각. 자정의 24:00 표기도 그대로 계산된다
      if (!lp || Date.now() - Date.UTC(+lp[1], lp[2] - 1, +lp[3], lp[4] - 9, +lp[5]) > 3 * 3600e3) return false; // 3시간 넘게 지난 값은 '지금' 값으로 쓰지 않는다
      const at = ak.filter(s => s.row[0] === latest), vals = at.map(s => s.row[1]), avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const top = at.reduce((a, s) => (s.row[1] > a.row[1] ? s : a));
      const [g, gc] = grade(avg);
      set('o3', `${nf(avg, 3)}ppm<em class="g-${gc}">${g}</em>`, `<b>오존(에어코리아 실측)</b> ${kdt(latest)} 기준<br>측정소 ${at.length}곳 평균 ${nf(avg, 3)}ppm(이 사이트의 계산), 가장 높은 곳 ${esc(top.st)} ${nf(top.row[1], 3)}ppm<br>등급: 1시간 기준 좋음 ≤0.030 · 보통 ≤0.090 · 나쁨 ≤0.150ppm`);
      note.o3 = `오존은 에어코리아 실측값(대구 측정소 ${at.length}곳, ${latest.slice(11, 16)} 기준)의 평균이며, 평균은 이 사이트가 계산했습니다. 자료: 환경부·한국환경공단 ${cite('d6')}. 실시간 관측 자료라 측정소 사정에 따라 빠질 수 있으며, 공식 실시간 정보는 ${AIRKOREA}에서 확인하세요 ${cite('m3')}`;
      paint(); return true;
    }
    function showO3Model(a) {
      const q = a.current, o3ppm = q.ozone / 1960; // µg/m³ → ppm (25℃·1기압, 1ppb = 1.96µg/m³)
      const [g, gc] = grade(o3ppm);
      set('o3', `${nf(o3ppm, 3)}ppm<em class="g-${gc}">${g}</em>`, `<b>오존(모델 추정)</b> ${nf(q.ozone, 0)}µg/m³ ≈ ${nf(o3ppm, 3)}ppm · ${g}<br>등급: 1시간 기준 좋음 ≤0.030 · 보통 ≤0.090 · 나쁨 ≤0.150ppm`);
      note.o3 = `에어코리아 실측값을 받지 못해 오존은 Copernicus 대기 모델 예측값(${q.time.slice(11, 16)})으로 보여 줍니다 ${cite('m2')}. 공식 측정값은 ${AIRKOREA} ${cite('m3')}`;
      paint();
    }
    let o3Again = 0;
    // 오존: 에어코리아 실측을 먼저 쓰고, 못 받으면 대기 모델 추정값
    function loadO3(isRetry) {
      clearTimeout(o3Again);
      // 서버가 새 값을 받는 중이었으면(늦은 응답, 저장해 둔 값) 20초 뒤 한 번만 다시 묻는다
      const later = () => { if (!isRetry) o3Again = setTimeout(() => loadO3(true), 20000); };
      getJson('api/air?mode=now', 12000).then(j => { if (!j.ok || !showO3Measured(j)) throw new Error(j.error || '값 없음'); if (j.stale) later(); })
        .catch(() => { later(); return getJson(AQ, 7000).then(showO3Model); })
        .catch(() => { set('o3', '받지 못함'); note.o3 = `오존 값을 받지 못했습니다. ${AIRKOREA}에서 확인하세요`; paint(); });
    }
    function load() {
      // 기온·바람·일사량: 서버가 받아 둔 값(api/wx)을 먼저 쓰고, 서버가 답하지 못하면 브라우저에서 Open-Meteo에 직접 묻는다
      getJson('api/wx').then(j => { if (!j.ok) throw new Error(j.error); showWx(j); })
        .catch(() => getJson(WX, 7000).then(w => { const c = w.current; showWx({ source: 'open-meteo', label: 'Open-Meteo 예측값', time: c.time.slice(11, 16), temp: c.temperature_2m, hum: c.relative_humidity_2m, ws: c.wind_speed_10m, wd: c.wind_direction_10m, sun: c.shortwave_radiation, isDay: !!c.is_day }); }))
        .catch(() => { ['temp', 'wind', 'sun'].forEach(k => set(k, '받지 못함')); note.wx = '기온·바람·일사량은 출처가 응답하지 않아 받지 못했습니다'; paint(); });
      loadO3(false);
    }
    load();
    setInterval(load, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); }); // 다른 탭에 있다가 돌아오면 바로 새로 받는다
  })();

  // ---------- 문제: 근거 카드와 영상 ----------
  (function problem() {
    const ev = [
      ['stat', '공식 통계 · 전국', '25일 → 67일', '전국 오존주의보 발령일이 2010년 25일(83회)에서 2021년 67일(400회)로 늘었습니다.', ['s1']],
      ['stat', '공식 통계 · 서울', '3일 → 31일', '서울 오존주의보 발령일은 2015년 3일에서 2024년(8월 기준) 31일로 약 10배 늘었습니다.', ['s3']],
      ['stat', '공식 통계 · 대구', '5회 → 1회 → 9회', '대구 오존주의보는 2022년 5회, 2023년 1회, 2024년 9회 발령됐습니다. 측정소 한 곳이라도 1시간 0.120ppm 이상이면 발령됩니다.', ['s4']],
      ['stat', '공식 통계 · 전국', '61일 → 54일 → 48일', '5~8월 발령일은 2024~2026년 줄었습니다. 국립환경과학원은 일사량 감소·강수일 증가 같은 날씨와 원인물질 감소를 이유로 들었습니다. 날씨의 영향이 크다는 뜻입니다.', ['s2']],
      ['own', '이 사이트 분석 · 대구', `${nf(O.std8Days)}일 · ${nf(O.who8Days)}일`, `2018~2022년 대구 측정소 한 곳이라도 8시간 평균 오존이 한국 기준(0.06ppm)을 넘은 날은 ${nf(O.std8Days)}일, WHO 권고(100µg/m³ ≈ 0.051ppm)를 넘은 날은 ${nf(O.who8Days)}일입니다.`, ['d1', 'w1', 'w2']],
      ['report', '보고서 · 건강', '35.8 → 45.0ppb', '전국 연평균 오존은 2010년 35.8ppb에서 2019년 45.0ppb로 올랐고, 오존 단기 노출 초과사망자는 1,248명에서 2,890명으로 늘었습니다.', ['s5']],
      ['report', '보고서 · 건강', '80세 이상 +0.07%/ppb', '하루 8시간 최고 오존이 1ppb 오를 때 80세 이상 사망 위험은 0.07% 늘었고, 79세 이하는 유의한 변화가 없었습니다(2006~2020년).', ['s6']],
      ['paper', '논문 · 세계 406개 지역', '상대위험 1.0018', '20개국 406개 지역 시계열 연구에서, 당일·전날 오존이 10µg/m³ 높을 때 사망 상대위험은 1.0018이었습니다.', ['p1']],
      ['paper', '논문 · 기후', '기후 페널티', '최근 연구들은 대체로 기후변화가 지표 오존을 높이는 ‘기후 페널티’를 예측하지만, 그 크기는 예전 예측보다 작다고 정리합니다.', ['p2']],
      ['paper', '논문 · 국내', 'NOx↓인데 5월 O₃↑', '수도권 오존 증가의 주된 원인은 한국의 질소산화물 배출 감소였고, 기상을 보정한 오존과 그 증가 폭은 5월에 가장 컸습니다.', ['p3']],
      ['comm', '커뮤니티 · 전국 665곳', '7~8월 < 5~6월', '전국 측정소 하루 평균을 정리한 공개 글은 4년 내내 7~8월 오존이 5~6월보다 옅었다고 보고합니다. 이 사이트의 대구 결과와 같은 방향입니다.', ['c1']],
    ];
    $('evidence').innerHTML = ev.map(([cls, tag, stat, text, refs]) => `<article class="ev"><div class="ev-meta"><span class="badge b-${cls}">${esc(tag)}</span>${cite(...refs)}</div><div class="stat">${stat}</div><p>${text}</p></article>`).join('');
    $('videos').innerHTML = VIDEOS.map((v, i) => `<a class="vid" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener"><div><span class="badge b-video">${v.kind}</span><b>${esc(v.title)}</b><span>${esc(v.ch)} · 참고문헌 [${NUM['v' + (i + 1)]}]</span></div></a>`).join('');
  })();

  // ---------- 그림 1: 줄무늬, 오존 시계, 연×월 ----------
  function drawStripes() {
    const el = $('stripes'), W = widthOf(el), left = 38, rowH = 15, gap = 4, years = O.years, start = Date.parse(D.stripesStart + 'T00:00:00Z');
    const lo = 0.02, hi = 0.12, cw = (W - left) / 366;
    let s = '';
    D.stripes.forEach((v, i) => {
      const t = new Date(start + i * 864e5), y = t.getUTCFullYear(), r = years.indexOf(y), doy = Math.round((t - Date.UTC(y, 0, 1)) / 864e5);
      s += `<rect x="${(left + doy * cw).toFixed(2)}" y="${r * (rowH + gap)}" width="${(cw + 0.4).toFixed(2)}" height="${rowH}" fill="${v == null ? C.empty : seq((v - lo) / (hi - lo))}" data-tip="<b>${y}.${t.getUTCMonth() + 1}.${t.getUTCDate()}</b><br>측정소 최고 1시간 오존 ${v == null ? '자료 없음' : nf(v, 3) + 'ppm'}${v >= D.thresholds.bad ? ' · 나쁨 이상' : ''}"/>`;
    });
    years.forEach((y, r) => { s += `<text x="0" y="${r * (rowH + gap) + rowH - 3}" class="lbl">${y}</text>`; });
    const H = years.length * (rowH + gap) + 14;
    for (let m = 1; m <= 12; m++) { const doy = Math.round((Date.UTC(2021, m - 1, 1) - Date.UTC(2021, 0, 1)) / 864e5); s += `<text x="${left + doy * cw}" y="${H - 1}">${m}월</text>`; }
    el.innerHTML = svg(W, H, s, '2018~2022년 날마다의 대구 오존 최고값');
    rampBar($('stripes-ramp'), '0.02ppm 이하', '0.12ppm 이상');
  }
  function heat(el, rows, cols, val, o) {
    const W = widthOf(el), left = o.left || 36, cw = (W - left) / cols, ch = o.ch, H = rows * ch + 30;
    let max = 0; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) max = Math.max(max, val(r, c) || 0);
    let s = '';
    for (let r = 0; r < rows; r++) {
      s += `<text x="${left - 5}" y="${r * ch + ch / 2 + 4}" text-anchor="end" class="lbl">${o.rowLabel(r)}</text>`;
      for (let c = 0; c < cols; c++) {
        const v = val(r, c);
        s += `<rect class="cell" x="${(left + c * cw + 1).toFixed(2)}" y="${r * ch + 1}" width="${(cw - 2).toFixed(2)}" height="${ch - 2}" rx="2" fill="${v > 0 ? seq(v / max) : C.empty}" data-tip="${esc(o.tip(r, c, v))}"/>`;
        if (o.inside && v > 0 && cw > 20) s += `<text x="${left + c * cw + cw / 2}" y="${r * ch + ch / 2 + 4}" text-anchor="middle" style="fill:${v / max > .55 ? C.onDark : C.onLight};font-size:10.5px;pointer-events:none">${v}</text>`;
      }
    }
    for (let c = 0; c < cols; c++) if (o.colTick(c)) s += `<text x="${left + c * cw + cw / 2}" y="${rows * ch + 13}" text-anchor="middle">${o.colLabel(c)}</text>`;
    s += `<text x="${W}" y="${H - 1}" text-anchor="end" class="ttl">${o.xTitle}</text>`;
    el.innerHTML = svg(W, H, s, o.label);
    return max;
  }
  function drawWhen() {
    drawStripes();
    const MH = D.monthHour;
    const cmax = heat($('clock'), 12, 24, (r, c) => MH[r][c].o3Bad, { ch: 15, rowLabel: r => `${r + 1}월`, colLabel: c => HS(c + 1), colTick: c => c % 6 === 0 || c === 23, xTitle: '시작 시각', tip: (r, c, v) => `<b>${r + 1}월 ${HR(c + 1)}</b><br>나쁨 이상 ${nf(v, 1)}% · 평균 ${nf(MH[r][c].o3Mean, 3)}ppm`, label: '달과 시각별 오존 나쁨 이상 비율' });
    rampBar($('clock-ramp'), '0%', `${nf(cmax, 1)}%`);
    const ymax = heat($('ymheat'), D.yearMonth.length, 12, (r, c) => D.yearMonth[r][c], { left: 40, ch: 30, inside: true, rowLabel: r => O.years[r], colLabel: c => `${c + 1}월`, colTick: () => true, xTitle: '달', tip: (r, c, v) => `<b>${O.years[r]}년 ${c + 1}월</b><br>나쁨 이상인 날 ${v}일`, label: '연도와 달별 나쁨 날 수' });
    rampBar($('ym-ramp'), '0일', `${ymax}일`);
    $('cap1').innerHTML = `<b class="fn">그림 1.</b> 대구 오존 고농도의 시기. (a) 2018~2022년 날마다 대구 측정소에서 잰 1시간 오존의 최고값(ppm), 한 줄이 하루입니다(기후 줄무늬 형식). (b) 달·시각별로 측정소-시간 가운데 ‘나쁨’(0.091ppm 이상)인 비율. 가로축은 시작 시각입니다(예: 13시 = 13~14시). (c) 달마다 측정소 한 곳이라도 ‘나쁨’ 이상이었던 날 수. 자료: ${cite('d1')}, 등급 기준 ${cite('s10')}.
      <span class="res">‘나쁨’ 날 ${O.badDays}일 가운데 <b>5~6월이 ${mj}일</b>로 7~8월(${ja}일)보다 많았고, 가장 짙은 칸은 <b>${peak.m}월 ${HR(peak.h)}</b>(${nf(peak.v, 1)}%)입니다. 전국 측정소 자료로도 같은 경향이 보고됐습니다 ${cite('c1')}.</span>`;
  }

  // ---------- 그림 2: 숨쉬기 좋은 시간 ----------
  const B = { month: 5, dur: 2 };
  function lineChart(el, series, o) {
    const W = widthOf(el), H = o.h || 200, L = 40, R = o.right || 84, Tp = 32, Bt = 30;
    const xs = o.xs, n = xs.length, xw = (W - L - R) / (n - 1), X = i => L + i * xw, Y = v => Tp + (H - Tp - Bt) * (1 - v / o.yMax);
    let s = '';
    (o.bands || []).forEach(b => { s += `<rect x="${X(b.from) - xw / 2}" y="${Tp}" width="${xw * (b.to - b.from + 1)}" height="${H - Tp - Bt}" fill="${b.fill}"/>`; });
    o.ticks.forEach(t => { s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 5}" y="${Y(t) + 4}" text-anchor="end">${o.fmtY(t)}</text>`; });
    s += `<line class="axisline" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/><text x="0" y="${Tp - 16}" class="ttl">${o.yTitle}</text>`;
    let ticks = xs.map((x, i) => i).filter(i => o.xTick(xs[i]));
    while (ticks.length > 1 && (W - L - R) / ticks.length < 34) ticks = ticks.filter((_, k) => k % 2 === 0);
    ticks.forEach(i => { s += `<text x="${X(i)}" y="${H - 14}" text-anchor="middle">${o.fmtX(xs[i])}</text>`; });
    s += `<text x="${W - R}" y="${H - 1}" text-anchor="end" class="ttl">${o.xTitle}</text>`;
    const ends = [];
    series.forEach(sr => {
      s += `<polyline points="${sr.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${sr.color}" stroke-width="${sr.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (sr.name) ends.push({ x: X(n - 1) + 6, y: Y(sr.values[n - 1]) + 4, name: sr.name });
      if (sr.markMax) { let mi = 0; sr.values.forEach((v, i) => { if (v > sr.values[mi]) mi = i; }); s += `<circle cx="${X(mi)}" cy="${Y(sr.values[mi])}" r="4" fill="${sr.color}" stroke="${C.onDark}" stroke-width="2"/><text x="${X(mi)}" y="${Y(sr.values[mi]) - 8}" text-anchor="middle" class="lbl">${o.fmtX(xs[mi])} 최고</text>`; }
    });
    ends.sort((a, b) => a.y - b.y).forEach((e, k, arr) => { if (k && e.y - arr[k - 1].y < 14) e.y = arr[k - 1].y + 14; s += `<text x="${e.x}" y="${e.y}" class="lbl-strong">${esc(e.name)}</text>`; });
    xs.forEach((x, i) => { s += `<rect class="hit" x="${X(i) - xw / 2}" y="${Tp}" width="${xw}" height="${H - Tp - Bt}" data-tip="${esc(`<b>${o.tipX(x)}</b><br>` + series.map(sr => `${sr.name || o.yTitle} ${o.fmtV(sr.values[i])}`).join('<br>'))}"/>`; });
    el.innerHTML = svg(W, H, s, o.label);
  }
  function drawBreathe() {
    const ms = $('month-sel');
    if (!ms.options.length) {
      ms.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${i + 1 === B.month ? ' selected' : ''}>${i + 1}월</option>`).join('');
      ms.onchange = () => { B.month = +ms.value; drawBreathe(); };
      $('dur-sel').onchange = e => { B.dur = +e.target.value; drawBreathe(); };
    }
    const row = D.monthHour[B.month - 1], w = windows(B.month, B.dur), hrs = w.hrs;
    const either = hrs.map(h => row[h - 1].either), o3 = hrs.map(h => row[h - 1].o3Bad), pm = hrs.map(h => row[h - 1].pmBad);
    $('breathe-legend').innerHTML = `<span><i class="line" style="background:${C.ink}"></i>오존이나 초미세먼지가 나쁨</span><span><i class="line" style="background:${C.o3}"></i>오존</span><span><i class="line" style="background:${C.pm}"></i>초미세먼지</span><span><i style="background:${C.goodWell}"></i>추천</span><span><i style="background:${C.badWell}"></i>회피</span>`;
    const yMax = Math.max(10, Math.ceil(Math.max(...either, ...o3, ...pm) / 10) * 10), step = yMax > 20 ? 10 : 5;
    lineChart($('breathe-chart'), [{ name: '오존 또는 초미세먼지', values: either, color: C.ink, width: 2.6 }, { name: '오존', values: o3, color: C.o3 }, { name: '초미세먼지', values: pm, color: C.pm }], {
      xs: hrs, yMax, ticks: Array.from({ length: yMax / step + 1 }, (_, i) => i * step), fmtY: v => `${v}`, yTitle: '나쁨 비율(%)', xTitle: '시작 시각',
      fmtX: HS, tipX: HR, xTick: h => (h - 1) % 2 === 0, fmtV: v => `${nf(v, 1)}%`, label: `${B.month}월 시각별 나쁨 비율`, h: 220, right: 140,
      bands: [{ from: w.best.i, to: w.best.i + B.dur - 1, fill: C.goodWell }, { from: w.worst.i, to: w.worst.i + B.dur - 1, fill: C.badWell }],
    });
    $('breathe-advice').innerHTML = `<div><span class="tag good">추천</span><b>${w.best.label}</b><span>${B.month}월에 ${B.dur}시간 활동할 때 · 오존이나 초미세먼지가 나쁨 ${nf(w.best.v, 1)}%</span></div><div><span class="tag bad">회피</span><b>${w.worst.label}</b><span>같은 조건에서 가장 높음 · ${nf(w.worst.v, 1)}%</span></div>`;
    const may = windows(5, 2);
    $('cap2').innerHTML = `<b class="fn">그림 2.</b> 숨쉬기 좋은 시간. (a) 선택한 달의 시각별 ‘나쁨’ 비율: 오존(0.091ppm 이상), 초미세먼지(36µg/m³ 이상), 오존이나 초미세먼지 중 하나라도 나쁨. (b) 선택한 활동 시간 동안 ‘오존이나 초미세먼지가 나쁨’ 평균이 가장 낮은·높은 시간대(5~22시). 오존 경보일에는 아침에 운동하라는 안내 ${cite('c3')}와, 아침에는 미세먼지가 높을 수 있다는 관찰 ${cite('c2')}을 함께 확인하려고 만들었습니다. 과거 5년의 측정소 평균이며 그날의 실제 대기질이나 개인 건강 영향을 뜻하지 않습니다. 자료 ${cite('d1')}.
      <span class="res">예: 5월에 2시간 활동한다면 가장 나쁜 때는 오존이 높은 오후가 아니라 <b>아침 ${may.worst.label}</b>(${nf(may.worst.v, 1)}%, 초미세먼지 때문)이고, 가장 좋은 때는 <b>${may.best.label}</b>(${nf(may.best.v, 1)}%)입니다.</span>`;
  }

  // ---------- 그림 3: 측정소 ----------
  function stationBars(el, rows, withGu, title) {
    const W = widthOf(el), L = Math.min(150, W * 0.34), R = 92, rowH = 19, H = rows.length * rowH + 30;
    const max = Math.max(0.5, Math.ceil(Math.max(...rows.map(r => r.badShare || 0)))), X = v => L + (W - L - R) * v / max;
    let s = '';
    [0, max / 2, max].forEach(t => { s += `<line class="gridline" x1="${X(t)}" x2="${X(t)}" y1="0" y2="${H - 28}"/><text x="${X(t)}" y="${H - 15}" text-anchor="middle">${nf(t, 1)}</text>`; });
    s += `<text x="${W - R}" y="${H - 1}" text-anchor="end" class="ttl">${title || '4~9월 나쁨 이상 비율(%)'}</text>`;
    rows.forEach((r, i) => {
      const y = i * rowH + 2, v = r.badShare || 0, w = Math.max(4, X(v) - L), gu = withGu && r.gu ? r.gu : '';
      s += `<text x="${L - 6}" y="${y + 12}" text-anchor="end" class="lbl-strong">${esc(r.name)}${gu ? `<tspan class="lbl" style="font-weight:400" dx="4">${esc(gu)}</tspan>` : ''}</text>`;
      s += `<path class="bar" d="M${L} ${y + 3} h${w - 3} a3 3 0 0 1 3 3 v6 a3 3 0 0 1 -3 3 h-${w - 3} z" fill="${C.o3}" data-tip="${esc(`<b>${r.name}${gu ? ' (' + gu + ')' : ''}</b><br>4~9월 나쁨 이상 ${r.badShare == null ? '자료 없음' : nf(r.badShare, 2) + '%'} (${nf(r.badHours)} / ${nf(r.seasonHours)}시간)<br>자료 기간 ${r.years}`)}"/>`;
      s += `<text x="${L + w + 5}" y="${y + 12}" class="lbl">${r.badShare == null ? '—' : nf(r.badShare, 1)}${withGu && r.yearCount < 5 ? ` · ${r.years}` : ''}</text>`;
    });
    el.innerHTML = svg(W, H, s, '측정소별 4~9월 오존 나쁨 이상 비율');
  }
  function drawStations() {
    const rows = D.stations;
    stationBars($('stations'), rows, true);
    const full = rows.filter(r => r.yearCount === 5), low = full[full.length - 1];
    $('cap3').innerHTML = `<b class="fn">그림 3.</b> 측정소별 4~9월 1시간 오존 ‘나쁨’ 이상 비율. 이름 옆은 구·군으로, 대구시 가로수·태양광 허가 자료의 주소로 확인했습니다 ${cite('d3', 'd4')}. 막대 끝의 연도는 운영 기간이 5년보다 짧은 측정소이며, 그해 날씨의 영향을 크게 받으므로 단순 비교하면 안 됩니다. 자료 ${cite('d1')}.
      <span class="res">5년 자료가 모두 있는 측정소 중 <b>${full.slice(0, 3).map(r => `${r.name}(${r.gu}) ${nf(r.badShare, 1)}%`).join(', ')}</b> 순으로 높고, 가장 낮은 곳은 ${low.name}(${low.gu}) ${nf(low.badShare, 1)}%입니다.</span>`;
  }

  // ---------- 그림 4: 일변화, 주말 효과 ----------
  function drawWhy() {
    const d = D.diurnal, hours = d.map(x => x.h), c10 = v => Math.ceil(v / 10) * 10;
    const no2 = d.map(x => x.no2 * 1000), o3 = d.map(x => x.o3 * 1000);
    const common = { xs: hours, fmtX: HS, tipX: HR, xTick: h => (h - 1) % 6 === 0, fmtV: v => `${nf(v, 1)}ppb`, h: 160, right: 16, xTitle: '시작 시각', fmtY: v => `${v}` };
    lineChart($('di-no2'), [{ name: '', values: no2, color: C.no2, markMax: true }], { ...common, yMax: c10(Math.max(...no2)), ticks: [0, c10(Math.max(...no2)) / 2, c10(Math.max(...no2))], yTitle: 'NO₂ (ppb)', label: '5~6월 시각별 이산화질소' });
    lineChart($('di-o3'), [{ name: '', values: o3, color: C.o3, markMax: true }], { ...common, yMax: c10(Math.max(...o3)), ticks: [0, c10(Math.max(...o3)) / 2, c10(Math.max(...o3))], yTitle: 'O₃ (ppb)', label: '5~6월 시각별 오존' });
    const el = $('weekend'), W = widthOf(el), L = 40, R = 12, H = 160, lo = -45, hi = 20, X = v => L + (W - L - R) * (v - lo) / (hi - lo);
    let s = '';
    [-40, -20, 0, 20].forEach(t => { s += `<line class="${t === 0 ? 'axisline' : 'gridline'}" x1="${X(t)}" x2="${X(t)}" y1="6" y2="${H - 36}"/><text x="${X(t)}" y="${H - 22}" text-anchor="middle">${t > 0 ? '+' : ''}${t}</text>`; });
    s += `<line x1="${X(10)}" x2="${X(10)}" y1="6" y2="${H - 36}" stroke="${C.ink}" stroke-width="1.5"/><text x="${X(10) + 3}" y="14" class="lbl" style="font-size:10.5px">부산</text>`;
    s += `<text x="${W - R}" y="${H - 6}" text-anchor="end" class="ttl">일요일 − 평일 (%)</text>`;
    [['NO₂', W8.no2, C.no2], ['O₃', W8.o3, C.o3]].forEach(([name, v, col], i) => {
      const y = 30 + i * 48, x0 = X(0), x1 = X(v.pct);
      s += `<text x="${L - 8}" y="${y + 4}" text-anchor="end" class="lbl-strong">${name}</text>`;
      s += `<rect x="${Math.min(x0, x1)}" y="${y - 6}" width="${Math.max(2, Math.abs(x1 - x0))}" height="12" rx="2" fill="${col}" data-tip="${esc(`<b>${name}</b><br>일요일 − 평일 ${sgn(v.pct)}%<br>95% 구간 ${sgn(v.loPct)} ~ ${sgn(v.hiPct)}%`)}"/>`;
      s += `<line x1="${X(v.loPct)}" x2="${X(v.hiPct)}" y1="${y + 12}" y2="${y + 12}" stroke="${C.ink}" stroke-width="1.6"/><line x1="${X(v.loPct)}" x2="${X(v.loPct)}" y1="${y + 8}" y2="${y + 16}" stroke="${C.ink}" stroke-width="1.6"/><line x1="${X(v.hiPct)}" x2="${X(v.hiPct)}" y1="${y + 8}" y2="${y + 16}" stroke="${C.ink}" stroke-width="1.6"/>`;
      s += `<text x="${Math.min(x0, x1)}" y="${y - 10}" class="lbl">${sgn(v.pct)}%</text>`;
    });
    el.innerHTML = svg(W, H, s, '일요일과 평일의 차이');
    const mp = d.filter(x => x.h <= 12).reduce((a, b) => (b.no2 > a.no2 ? b : a)), op = d.reduce((a, b) => (b.o3 > a.o3 ? b : a));
    $('cap4').innerHTML = `<b class="fn">그림 4.</b> 오존이 만들어지는 흐름 확인. (a)(b) 5~6월 시각별 평균 이산화질소와 오존(ppb). 세로 눈금이 서로 다릅니다. 오존은 햇빛과 질소산화물·휘발성유기화합물의 광화학 반응으로 생기는 2차 오염물질입니다 ${cite('s3')}. (c) 4~9월 일요일과 평일(월~금)의 차이: 막대 = 평균 차이, 가로선 = 부트스트랩 95% 구간, 세로선 = 부산 연구의 일요일 오존 +10% ${cite('p4')}. 공휴일은 따로 빼지 않았습니다. 자료 ${cite('d1')}.
      <span class="res">이산화질소는 아침 <b>${HR(mp.h)}</b>에 가장 높고 오존은 <b>${HR(op.h)}</b>에 가장 높습니다(평균 ${nf(op.o3 * 1000, 0)}ppb). 일요일에 이산화질소는 ${nf(Math.abs(W8.no2.pct), 0)}% 낮았지만 오존은 ${sgn(W8.o3.pct)}%(95% 구간 ${sgn(W8.o3.loPct)}~${sgn(W8.o3.hiPct)}%)로 뚜렷한 차이가 없어, 부산 연구와 달리 대구에서는 주말 효과가 확인되지 않았습니다.</span>`;
  }

  // ---------- 그림 5: 2020년 비교, 냉방도일 ----------
  function drawFig5() {
    let el = $('covid'), W = widthOf(el), H = 200;
    const Tp = 18, Bt = 42, lo = -40, hi = 20, Y = v => Tp + (H - Tp - Bt) * (hi - v) / (hi - lo);
    const groups = [['NO₂', 'no2'], ['O₃', 'o3'], ['PM2.5', 'pm25']], years = ['y2020', 'y2021', 'y2022'], gw = (W - 40) / 3, bw = Math.min(28, gw / 5);
    let s = `<text x="0" y="8" class="ttl">2018~19년 대비 (%)</text>`;
    [-40, -20, 0, 20].forEach(t => { s += `<line class="${t === 0 ? 'axisline' : 'gridline'}" x1="34" x2="${W}" y1="${Y(t)}" y2="${Y(t)}"/><text x="30" y="${Y(t) + 4}" text-anchor="end">${t > 0 ? '+' : ''}${t}</text>`; });
    groups.forEach(([name, k], g) => {
      const cx = 40 + gw * g + gw / 2;
      years.forEach((y, j) => {
        const v = CV[k][y], x = cx + (j - 1) * (bw + 6) - bw / 2, y0 = Y(0), y1 = Y(v);
        s += `<rect x="${x}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(2, Math.abs(y1 - y0))}" rx="2" fill="${y === 'y2020' ? C.o3 : C.muted}" data-tip="${esc(`<b>${name} · ${y.slice(1)}년</b><br>2/18~4/30 평균, 2018~19년 대비 ${sgn(v)}%`)}"/>`;
        s += `<text x="${x + bw / 2}" y="${v >= 0 ? y1 - 4 : y1 + 12}" text-anchor="middle" class="lbl" style="font-size:10.5px">${sgn(v, Math.abs(v) < 1 ? 1 : 0)}</text>`;
        s += `<text x="${x + bw / 2}" y="${H - 26}" text-anchor="middle" style="font-size:10.5px">${y.slice(3)}</text>`;
      });
      s += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="lbl-strong">${name}</text>`;
    });
    el.innerHTML = svg(W, H, s, '2월 18일~4월 30일 대기질 변화');
    $('covid-table').innerHTML = `<table class="paper"><thead><tr><th>같은 해 1/1~2/17 → 2/18~4/30</th>${O.years.map(y => `<th>${y}</th>`).join('')}</tr></thead><tbody>${[['이산화질소', 'no2'], ['오존', 'o3'], ['초미세먼지', 'pm25'], ['일산화탄소', 'co']].map(([n, k]) => `<tr><td>${n}</td>${O.years.map(y => `<td>${sgn(CW[k][y])}%</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const c = D.cooling; el = $('cooling'); W = widthOf(el);
    const L = 40, R = 6, Tq = 18, Bq = 30, ys = c.years, max = Math.ceil(Math.max(...ys.map(p => p.v)) / 2000) * 2000, bw2 = (W - L - R) / ys.length, Yc = v => Tq + (H - Tq - Bq) * (1 - v / max);
    s = `<text x="0" y="8" class="ttl">6~9월 냉방도일 합</text>`;
    [0, max / 2, max].forEach(t => { s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${Yc(t)}" y2="${Yc(t)}"/><text x="${L - 5}" y="${Yc(t) + 4}" text-anchor="end">${nf(t)}</text>`; });
    const top = c.top.map(t => t.y);
    ys.forEach((p, i) => {
      const x = L + i * bw2 + 1, h = (H - Tq - Bq) * p.v / max;
      s += `<path class="bar" d="M${x} ${Yc(0)} v-${Math.max(0, h - 2)} a2 2 0 0 1 2 -2 h${Math.max(0, bw2 - 6)} a2 2 0 0 1 2 2 v${Math.max(0, h - 2)} z" fill="${C.o3}" opacity="${top.includes(p.y) ? 1 : .5}" data-tip="${esc(`<b>${p.y}년 6~9월</b><br>냉방도일 합 ${nf(p.v)}`)}"/>`;
      if (p.y % 5 === 0) s += `<text x="${x + bw2 / 2 - 1}" y="${H - 14}" text-anchor="middle">${p.y}</text>`;
    });
    const f = y => c.intercept + c.slopePerDecade / 10 * y;
    s += `<line x1="${L + bw2 / 2}" x2="${L + (ys.length - .5) * bw2}" y1="${Yc(f(ys[0].y))}" y2="${Yc(f(ys[ys.length - 1].y))}" stroke="${C.ink}" stroke-width="1.8"/>`;
    s += `<text x="${W - R}" y="${H - 1}" text-anchor="end" class="ttl">연도 · 검은 선 = 직선 추세</text>`;
    el.innerHTML = svg(W, H, s, '대구 6~9월 냉방도일 합');
    $('cap5').innerHTML = `<b class="fn">그림 5.</b> 바깥 요인 확인. (a) 2월 18일~4월 30일 평균을 2018~19년 같은 기간과 비교한 변화. 2020년은 대구 코로나 확산기로, 이 시기를 다룬 논문 ${cite('p5')}을 다시 확인했습니다. 표 1은 논문처럼 같은 해 1월 1일~2월 17일과 비교한 값입니다. (b) 한국가스공사 냉방도일(기준 24℃, 단위는 원자료에 표기되지 않음)의 6~9월 합과 직선 추세 ${cite('d2')}. 자료 ${cite('d1')}.
      <span class="res">2020년 이산화질소는 2018~19년보다 ${nf(Math.abs(CV.no2.y2020), 0)}% 낮았지만 2021·2022년도 ${sgn(CV.no2.y2021, 0)}%, ${sgn(CV.no2.y2022, 0)}%로 비슷해 <b>2020년만의 변화로 보기 어렵습니다.</b> 같은 해 비교의 오존 증가(2020년 ${sgn(CW.o3[2020])}%)는 다른 해에도 ${sgn(Math.min(CW.o3[2018], CW.o3[2019], CW.o3[2021], CW.o3[2022]), 0)}~${sgn(Math.max(CW.o3[2018], CW.o3[2019], CW.o3[2021], CW.o3[2022]), 0)}%로 나와 대부분 계절 변화입니다. 이산화질소가 줄어든 2021·2022년 오존은 오히려 ${sgn(CV.o3.y2021, 0)}%, ${sgn(CV.o3.y2022, 0)}%였습니다. 여름 냉방도일은 최근 10년 평균이 1999~2008년보다 <b>${nf(c.changePct, 0)}%</b> 높습니다. 더워질수록 오존 관리가 어려워질 수 있다는 ‘기후 페널티’ ${cite('p2')}의 맥락에서 읽을 수 있지만, 오존 자료가 5년뿐이라 둘의 관계를 직접 계산하지는 않았습니다.</span>`;
  }

  // ---------- AI 예보 ----------
  const F = M.features, P = M.params;
  function predict(f) {
    if (P.type === 'gbm') { const x = F.map(ft => f[ft.key]); let z = P.base; for (let t of P.trees) { while (t.j !== undefined) t = x[t.j] <= t.t ? t.l : t.r; z += P.lr * t.v; } return 1 / (1 + Math.exp(-z)); }
    let z = P.bias; F.forEach((ft, j) => { z += P.w[j] * (f[ft.key] - P.mu[j]) / P.sd[j]; }); return 1 / (1 + Math.exp(-z));
  }
  const modelName = t => (t === 'gbm' ? '그래디언트 부스팅' : '로지스틱 회귀');
  function drawAI() {
    const other = M.compared.find(c => c.type !== M.chosen), mr = M.baselines.morning;
    $('ai-sub').innerHTML = `4~9월 어느 날, <b>그날 13~18시에 대구 측정소 한 곳이라도 오존 ‘나쁨’이 나올지</b>를 그날 11시까지의 대기질 자료 ${F.length}가지로 계산합니다. 로지스틱 회귀와 그래디언트 부스팅을 2018~2020년으로 학습해 2021년 자료로 비교했고, 검증 AUC가 더 높은 <b>${modelName(M.chosen)}</b>를 골랐습니다. ‘나쁨’을 놓치지 않는 쪽을 중시해 확률 ${pct(M.threshold, 1)} 이상이면 ‘주의’로 알립니다. 정부 오존 예보 ${cite('v5')}와 별개인 연구용 모델입니다.`;
    renderLive($('ai-live'), true);
    const WM = D.weather.model, WT = WM.withWeather.test;
    $('tab2cap').innerHTML = `<b class="fn">표 2.</b> 2022년 4~9월(${T.tp + T.fp + T.fn + T.tn}일, ‘나쁨’ ${T.tp + T.fn}일) 시험 성적. 모든 방법을 같은 날짜로 비교했습니다. 2022년 자료는 학습과 설정에 쓰지 않았습니다. ‘AI + 기상’은 같은 방식(2018~2020 학습, 2021 검증으로 모델과 기준 확률 결정)에 기상청 대구 관측소의 11시까지 기상 값 ${WM.features.length}가지 ${cite('d5')}를 더한 모델로, 검증 AUC가 ${nf(WM.airOnly.validation.auc, 3)}에서 ${nf(WM.withWeather.validation.auc, 3)}로 올랐습니다. 다만 11시 일사량 같은 실시간 기상 관측을 아직 받아 오지 못해, 홈의 오늘 예보는 대기질만 쓰는 선택 모델로 계산합니다.`;
    const rows = [[`AI: ${modelName(M.chosen)} (선택, 오늘 예보에 사용)`, T, true], [`AI: ${modelName(other.type)} (비교)`, other.test], [`AI + 기상: ${modelName(WM.chosen)} (비교)`, WT], [`규칙: ${mr.rule}`, mr], [`규칙: ${M.baselines.persistence.rule}`, M.baselines.persistence], [`규칙: ${M.baselines.season.rule}`, M.baselines.season]];
    $('ai-score').innerHTML = `<table class="paper scoreboard"><thead><tr><th>방법</th><th>미리 잡은 나쁨 날</th><th>놓친 날</th><th>헛경보</th><th>정확도</th><th>AUC</th></tr></thead><tbody>${rows.map(([n, s, b]) => `<tr><td${b ? ' class="best"' : ''}>${esc(n)}</td><td${b ? ' class="best"' : ''}>${s.tp}/${s.tp + s.fn}일</td><td>${s.fn}일</td><td>${s.fp}일</td><td>${pct(s.accuracy)}</td><td>${s.auc != null ? nf(s.auc, 2) : '—'}</td></tr>`).join('')}</tbody></table>`;
    const X = M.external2024;
    if (X) {
      const xo = X.overview;
      $('tab3cap').innerHTML = `<b class="fn">표 3.</b> 새 자료로 다시 시험: 2024년 4~9월(${X.days}일, 오후 ‘나쁨’ ${X.badDays}일). 에어코리아 최종확정 측정자료 ${cite('d7')}에서 학습 자료와 같은 측정소 ${X.stations}곳만 써서, 2018~2021년으로 학습한 모델과 기준 확률을 바꾸지 않고 적용했습니다. 2024년은 학습·검증·시험 어디에도 쓰지 않은 해입니다. 이 해 대구는 ‘나쁨’ 날 ${xo.badDays}일, 주의보 수준(1시간 0.12ppm 이상) 날 ${xo.alertDays}일, 최고 ${nf(xo.maxO3, 3)}ppm(${esc(xo.maxAt.station)}, ${+xo.maxAt.date.slice(5, 7)}월 ${+xo.maxAt.date.slice(8)}일)이었습니다. ‘데이터 분석 Tool’ 탭에 같은 zip을 그대로 올려도 확인할 수 있습니다. 다만 그 탭은 군위읍을 포함한 대구 도시대기 측정소를 모두 쓰므로 숫자가 조금 다를 수 있습니다.`;
      $('ai-ext').innerHTML = `<table class="paper scoreboard"><thead><tr><th>방법</th><th>미리 잡은 나쁨 날</th><th>놓친 날</th><th>헛경보</th><th>정확도</th><th>AUC</th></tr></thead><tbody>${[[`AI: ${modelName(M.chosen)} (선택, 바꾸지 않음)`, X.test, true], [`규칙: ${X.rule.rule}`, X.rule]].map(([n, s, b]) => `<tr><td${b ? ' class="best"' : ''}>${esc(n)}</td><td${b ? ' class="best"' : ''}>${s.tp}/${s.tp + s.fn}일</td><td>${s.fn}일</td><td>${s.fp}일</td><td>${pct(s.accuracy)}</td><td>${s.auc != null ? nf(s.auc, 2) : '—'}</td></tr>`).join('')}</tbody></table>`;
    } else $('ext-box').hidden = true;
    $('ai-cm').innerHTML =`<div class="h"></div><div class="h">실제 나쁨</div><div class="h">실제 보통 이하</div><div class="h">‘주의’</div><div class="ok"><b>${T.tp}</b>맞힘</div><div class="no"><b>${T.fp}</b>헛경보</div><div class="h">예보 없음</div><div class="no"><b>${T.fn}</b>놓침</div><div class="ok"><b>${T.tn}</b>맞힘</div>`;
    const el = $('ai-imp'), W = widthOf(el), imp = [...M.importance].sort((a, b) => b.v - a.v), L = Math.min(200, W * .48), rowH = 18, H = imp.length * rowH + 18, max = Math.max(...imp.map(i => i.v));
    let s = '';
    imp.forEach((it, i) => { const y = i * rowH, w = Math.max(2, (W - L - 44) * it.v / max); s += `<text x="${L - 6}" y="${y + 12}" text-anchor="end" class="lbl">${esc(it.label)}</text><rect x="${L}" y="${y + 4}" width="${w}" height="10" rx="2" fill="${C.o3}" data-tip="${esc(`<b>${it.label}</b><br>비중 ${nf(it.v, 1)}%${it.sign ? (it.sign > 0 ? ' · 클수록 나쁨 확률↑' : ' · 클수록 나쁨 확률↓') : ''}`)}"/><text x="${L + w + 5}" y="${y + 13}" class="lbl">${nf(it.v, 0)}%</text>`; });
    s += `<text x="${W}" y="${H - 1}" text-anchor="end" class="ttl">비중(%) = 표준화 계수 절댓값의 비율</text>`;
    el.innerHTML = svg(W, H, s, 'AI 예보 변수 비중');
    drawCalendar();
    $('cap6').innerHTML = `<b class="fn">그림 6.</b> AI 예보의 2022년 시험 결과. (a) 확률이 기준(${pct(M.threshold, 1)}) 이상이면 ‘주의’ 예보로 셌습니다. (b) 선택된 모델이 판단에 쓴 정보의 비중. (c) 칸 색 = AI가 계산한 오후 ‘나쁨’ 확률, 점 = 실제로 ‘나쁨’이었던 날, 빈칸 = 자료 부족으로 제외한 날. 자료 ${cite('d1')}.
      <span class="res">AI는 ‘나쁨’ ${T.tp + T.fn}일 중 <b>${T.tp}일</b>을 11시에 미리 잡았고(놓친 날 ${T.fn}일), 헛경보는 ${T.fp}일입니다. ‘11시 최고 오존’ 하나만 보는 단순 규칙도 ${mr.tp}일을 잡아 차이가 크지 않습니다. AI의 장점은 놓친 날이 적고(${T.fn}일 대 ${mr.fn}일), 예/아니오 대신 <b>확률</b>을 주어 학교·사업장이 각자 기준을 정할 수 있다는 점입니다. 오존 노출은 80세 이상에서 사망 위험을 높이므로 ${cite('s6')} 놓친 날을 줄이는 쪽을 택했습니다.</span>`;
  }
  let selDay = null;
  function drawCalendar() {
    const el = $('ai-cal'), W = widthOf(el), days = M.days, L = 34, Tp = 16, cw = (W - L) / 31, ch = Math.max(16, Math.min(22, cw)), months = [4, 5, 6, 7, 8, 9], H = Tp + months.length * ch + 2;
    let s = '';
    for (let d = 1; d <= 31; d++) if (d === 1 || d % 5 === 0) s += `<text x="${L + (d - .5) * cw}" y="11" text-anchor="middle">${d}일</text>`;
    months.forEach((m, r) => { s += `<text x="${L - 5}" y="${Tp + r * ch + ch / 2 + 4}" text-anchor="end" class="lbl">${m}월</text>`; });
    const by = new Map(days.map(d => [d.date, d]));
    months.forEach((m, r) => {
      const dim = new Date(Date.UTC(2022, m, 0)).getUTCDate();
      for (let d = 1; d <= dim; d++) {
        const key = `2022-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, it = by.get(key), x = L + (d - 1) * cw, y = Tp + r * ch;
        if (!it) { s += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="${C.empty}" data-tip="${esc(`<b>${m}월 ${d}일</b><br>자료 부족으로 제외`)}"/>`; continue; }
        s += `<rect class="cell" data-day="${key}" tabindex="0" x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="${seq(it.p)}" stroke="${key === selDay ? C.onLight : 'none'}" stroke-width="2" style="cursor:pointer" data-tip="${esc(`<b>${m}월 ${d}일</b><br>AI 나쁨 확률 ${pct(it.p)} → ${it.p >= M.threshold ? '‘주의’' : '예보 없음'}<br>실제: ${it.actual ? '나쁨' : '보통 이하'}`)}"/>`;
        if (it.actual) s += `<circle cx="${x + cw / 2}" cy="${y + ch / 2}" r="${Math.min(3.5, cw / 5)}" fill="${it.p > .55 ? C.onDark : C.onLight}" pointer-events="none"/>`;
      }
    });
    el.innerHTML = svg(W, H, s, '2022년 날짜별 AI 예보 확률과 실제 나쁨');
    rampBar($('ai-ramp'), '확률 0%', '100% · 점 = 실제 나쁨');
    const pick = key => { selDay = key; drawCalendar(); };
    el.querySelectorAll('[data-day]').forEach(c => { c.onclick = () => pick(c.dataset.day); c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(c.dataset.day); } }; });
    if (!selDay) { selDay = (days.find(d => d.actual && d.p >= M.threshold) || days[0]).date; drawCalendar(); return; }
    drawDay(by.get(selDay));
  }
  function fmtFeat(ft, v) { if (ft.unit === '0/1') return v ? '예' : '아니오'; if (ft.key === 'doySin' || ft.key === 'doyCos') return nf(v, 2); if (ft.unit === 'µg/m³') return `${nf(v, 1)} µg/m³`; return `${nf(v, 4)} ppm`; }
  function drawDay(it) {
    const [y, m, d] = it.date.split('-').map(Number), f = { ...it.f };
    const render = () => {
      const p = predict(f), warn = p >= M.threshold, changed = f.o3Max11 !== it.f.o3Max11, right = (warn ? 1 : 0) === it.actual;
      $('ai-day').innerHTML = `<div><p class="note" style="margin:0">${y}년 ${m}월 ${d}일 11시, AI의 계산</p><div class="prob">${pct(p)}</div>
        <p class="verdict">${warn ? '<span class="tag bad">오후 ‘나쁨’ 주의</span>' : '<span class="tag good">예보 없음</span>'} ${changed ? '<span class="note">(값을 바꿔 본 결과)</span>' : `· 실제 오후 <b>${it.actual ? '나쁨' : '보통 이하'}</b> → ${right ? '맞음' : warn ? '헛경보' : '놓침'}`}</p>
        <label class="ctl" style="display:block;margin-top:10px">11시 측정소 최고 오존 바꿔 보기: <b>${nf(f.o3Max11, 3)}ppm</b><br><input id="o3s" type="range" min="0.01" max="0.12" step="0.001" value="${f.o3Max11}" style="width:100%"></label>
        <button type="button" class="btn btn-ghost" id="o3reset" style="min-height:34px;margin-top:6px">그날 실제 값으로</button></div>
        <div><table class="feat"><thead><tr><th>AI가 본 값</th><th>그날</th></tr></thead><tbody>${F.map(ft => `<tr><td>${esc(ft.label)}</td><td>${fmtFeat(ft, f[ft.key])}</td></tr>`).join('')}</tbody></table></div>`;
      $('o3s').oninput = e => { f.o3Max11 = Number(e.target.value); render(); $('o3s').focus(); };
      $('o3reset').onclick = () => { f.o3Max11 = it.f.o3Max11; render(); };
    };
    render();
  }

  // ---------- 그림 7: 날씨(기상청 대구 관측소)와 오존 '나쁨' 날 ----------
  function binBars(el, bins, label) {
    const W = widthOf(el), L = 76, R = 92, rowH = 26, Tp = 4, H = Tp + bins.length * rowH + 22, max = 60, X = v => L + (W - L - R) * v / max;
    let s = '';
    [0, 20, 40, 60].forEach(t => { s += `<line class="${t ? 'gridline' : 'axisline'}" x1="${X(t)}" x2="${X(t)}" y1="${Tp}" y2="${Tp + bins.length * rowH}"/><text x="${X(t)}" y="${H - 6}" text-anchor="middle">${t}%</text>`; });
    bins.forEach((b, i) => {
      const y = Tp + i * rowH, w = Math.max(2, X(b.rate || 0) - L);
      s += `<text x="${L - 6}" y="${y + rowH / 2 + 4}" text-anchor="end" class="lbl">${esc(b.label)}</text>`;
      s += `<rect class="bar" x="${L}" y="${y + 5}" width="${w}" height="${rowH - 10}" rx="2" fill="${C.o3}" data-tip="${esc(`<b>${b.label}</b><br>‘나쁨’ 날 ${b.bad}일 / ${b.n}일 = ${nf(b.rate, 1)}%`)}"/>`;
      s += `<text x="${L + w + 5}" y="${y + rowH / 2 + 4}" class="lbl">${nf(b.rate, 1)}% <tspan class="ttl">(${b.bad}/${b.n}일)</tspan></text>`;
    });
    el.innerHTML = svg(W, H, s, label);
  }
  function drawWeather() {
    const Wd = D.weather, WM = Wd.model, WT = WM.withWeather.test, A = WM.airOnly.test;
    binBars($('wx-tmax'), Wd.tmaxBins, '그날 최고기온별 오존 나쁨 날 비율');
    binBars($('wx-insol'), Wd.insolBins, '그날 일사량 합별 오존 나쁨 날 비율');
    $('wx-month').innerHTML = `<table class="paper"><thead><tr><th>달</th><th>‘나쁨’ 날</th><th>최고기온</th><th>일사량</th><th>비 온 날</th></tr></thead><tbody>${Wd.byMonth.map(r => `<tr><td>${r.m}월</td><td>${nf(r.badRate, 1)}%</td><td>${nf(r.tmax, 1)}℃</td><td>${nf(r.insol, 1)}</td><td>${nf(r.rainyShare, 0)}%</td></tr>`).join('')}</tbody></table><p class="note">최고기온·일사량(MJ/m²)은 달 평균, 비 온 날은 하루 1mm 이상인 날의 비율입니다.</p>`;
    const hs = Wd.hotSunny, jl = Wd.july, m5 = Wd.byMonth.find(r => r.m === 6), m7 = Wd.byMonth.find(r => r.m === 7);
    $('cap7').innerHTML = `<b class="fn">그림 7.</b> 날씨와 오존 고농도. 기상청 대구 관측소(143) 시간자료 ${cite('d5')}와 대기질 자료 ${cite('d1')}를 날짜별로 맞췄습니다(2018~2022년 4~9월 ${nf(Wd.days)}일). ‘나쁨 날’은 측정소 한 곳이라도 1시간 오존이 0.091ppm 이상인 날입니다. (a) 하루 최고기온, (b) 하루 일사량 합, (c) 달별 평균.
      <span class="res">최고기온 30℃ 이상이면서 일사량 20MJ/m² 이상인 날은 <b>${nf(hs.rate, 1)}%</b>(${nf(hs.n)}일 중)가 ‘나쁨’이었고, 나머지 날은 ${nf(hs.restRate, 1)}%였습니다. 7월은 6월보다 덥지만(${nf(m7.tmax, 1)}℃ 대 ${nf(m5.tmax, 1)}℃) 일사량이 적고 비 온 날이 많아 ‘나쁨’ 날 비율이 ${nf(m7.badRate, 1)}%로 6월(${nf(m5.badRate, 1)}%)보다 낮았습니다. 7월 안에서도 비 온 날은 ${nf(jl.rainRate, 1)}%, 비 안 온 날은 ${nf(jl.dryRate, 1)}%였습니다. 예보 모델에 11시까지의 기상 값(기온, 일사량, 풍속, 습도, 전날 최고기온)을 더하면 2022년 시험에서 ‘나쁨’ ${WT.tp + WT.fn}일 중 ${WT.tp}일을 잡고 헛경보가 ${A.fp}일에서 ${WT.fp}일로 줄었습니다(표 2).</span>`;
  }

  // ---------- 그림 8: 탄소중립과 오존(태양광 허가, '나쁨' 날의 햇빛, 일요일 배기가스 감소) ----------
  const legendHtml = items => items.map(([name, color, line]) => `<span><i${line ? ' class="line"' : ''} style="background:${color}"></i>${esc(name)}</span>`).join('');
  function drawCarbon() {
    const K = D.carbon, pv = K.pv, ins = K.insol, wk = D.weekend, lastY = +pv.latest.slice(0, 4);
    const light = seq(0.18);
    $('pv-legend').innerHTML = legendHtml([['가동 중(사업개시)', C.o3], ['허가·공사 중', light]]);
    {
      const el = $('pv-year'), W = widthOf(el), H = 200, L = 36, R = 8, Tp = 22, Bt = 30, rows = pv.byYear, max = Math.ceil(Math.max(...rows.map(r => r.mw)) / 50) * 50;
      const bw = (W - L - R) / rows.length, Y = v => Tp + (H - Tp - Bt) * (1 - v / max);
      let s = '';
      [0, max / 2, max].forEach(t => { s += `<line class="${t ? 'gridline' : 'axisline'}" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 5}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`; });
      rows.forEach((r, i) => {
        const x = L + i * bw + bw * 0.18, w = bw * 0.64, rest = r.mw - r.opMw;
        const tip = esc(`<b>${r.y}년 허가${r.y === lastY ? `(${pv.latest.slice(5).replace('-', '월 ')}일까지)` : ''}</b><br>${nf(r.n)}건, ${nf(r.mw, 1)}MW<br>가동 중 ${nf(r.opMw, 1)}MW, 허가·공사 중 ${nf(rest, 1)}MW`);
        s += `<rect class="bar" x="${x}" y="${Y(r.opMw)}" width="${w}" height="${Math.max(0, Y(0) - Y(r.opMw))}" fill="${C.o3}" data-tip="${tip}"/>`;
        if (rest > 0) s += `<rect class="bar" x="${x}" y="${Y(r.mw)}" width="${w}" height="${Math.max(0, Y(r.opMw) - Y(r.mw) - 1)}" fill="${light}" data-tip="${tip}"/>`;
        s += `<text x="${x + w / 2}" y="${Y(r.mw) - 5}" text-anchor="middle" class="lbl">${nf(r.mw, 0)}</text>`;
        if (rows.length <= 9 || i % 2 === 0) s += `<text x="${x + w / 2}" y="${H - 14}" text-anchor="middle">${r.y === lastY ? `${String(r.y).slice(2)}년*` : `${String(r.y).slice(2)}년`}</text>`;
      });
      s += `<text x="${W - R}" y="${H - 1}" text-anchor="end" class="ttl">허가 연도, * = ${+pv.latest.slice(5, 7)}월까지</text>`;
      el.innerHTML = svg(W, H, s, '대구 태양광 전기사업 허가 용량');
    }
    $('insol-legend').innerHTML = legendHtml([['오존 ‘나쁨’ 날', C.ink, true], ['나머지 날', C.muted, true]]);
    const yMax = Math.ceil(Math.max(...ins.bad) * 2) / 2;
    lineChart($('insol-hour'), [{ name: '나쁨 날', values: ins.bad, color: C.ink, markMax: true }, { name: '나머지', values: ins.other, color: C.muted }],
      { xs: ins.hours, fmtX: HS, tipX: HR, xTick: h => (h - 1) % 3 === 0, fmtV: v => `${nf(v, 2)}MJ/m²`, h: 200, right: 52, yMax, ticks: [0, yMax / 2, yMax], fmtY: v => nf(v, 1), yTitle: 'MJ/m²', xTitle: '시작 시각', label: '오존 나쁨 날과 나머지 날의 시각별 일사량' });
    $('sunday-table').innerHTML = `<table class="paper"><thead><tr><th>일요일 − 평일</th><th>변화</th><th>95% 구간</th></tr></thead><tbody>
      <tr><td>이산화질소</td><td>${sgn(wk.no2.pct)}%</td><td>${sgn(wk.no2.loPct)} ~ ${sgn(wk.no2.hiPct)}%</td></tr>
      <tr><td>오존(하루 최고)</td><td>${sgn(wk.o3.pct)}%</td><td>${sgn(wk.o3.loPct)} ~ ${sgn(wk.o3.hiPct)}%</td></tr></tbody></table>
      <p class="note">평일은 월~금. 이산화질소는 주로 자동차 배기가스에서 나옵니다. 그림 4(c)와 같은 계산이며, 오존의 95% 구간이 0을 포함해 이산화질소가 크게 줄어도 오존은 줄었다고 말할 수 없습니다.</p>`;
    $('cap8').innerHTML = `<b class="fn">그림 8.</b> 탄소중립 정책과 오존. (a) 대구시 태양광 전기사업 허가 ${nf(pv.permits)}건(취소·폐업·이관 ${nf(pv.cancelled)}건 제외)의 허가 연도별 설비용량, 2023년 대구에 편입된 군위군 포함 ${cite('d4')}. (b) 2018~2022년 4~9월 기상청 대구 관측소의 시각별 평균 일사량, 오존 ‘나쁨’ 날 ${nf(ins.badN)}일과 나머지 ${nf(ins.otherN)}일 ${cite('d5', 'd1')}. (c) 4~9월 일요일과 평일의 차이, 부트스트랩 95% 구간 ${cite('d1')}.
      <span class="res">대구의 태양광은 허가 기준 <b>${nf(pv.totalMw, 1)}MW</b>, 그중 가동 중 ${nf(pv.operatingMw, 1)}MW이고 해마다 빠르게 늘고 있습니다. 오존 ‘나쁨’ 날의 하루 일사량은 평균 ${nf(ins.badDay, 1)}MJ/m²로 나머지 날(${nf(ins.otherDay, 1)})보다 <b>${nf((ins.badDay / ins.otherDay - 1) * 100, 0)}%</b> 많습니다. 오존이 짙은 날은 태양광 발전이 가장 많은 날이기도 하다는 뜻으로, 이날 오후의 실내 쉼터 냉방을 태양광 전력으로 돌리면 추가 배출 없이 노출을 줄일 수 있습니다(제안 7). 반면 자동차 배기가스가 줄어드는 일요일에 이산화질소는 ${sgn(wk.no2.pct, 0)}%였지만 오존은 뚜렷이 줄지 않았습니다. 수송 부문 탄소중립(전기차 전환)으로 질소산화물이 줄어도 도심 오존은 바로 낮아지지 않을 수 있어, 휘발성유기화합물(VOC) 관리를 함께 해야 합니다 ${cite('p3')}.</span>`;
  }

  // ---------- 제안 ----------
  function drawProposals() {
    const may = windows(5, 2), st = D.stations.filter(s => s.yearCount === 5).slice(0, 3);
    const items = [
      ['5~6월 낮 12시~오후 6시, 학교 체육과 야외 행사 시간 옮기기', `‘나쁨’ 날의 대부분이 5~6월에 있고 가장 위험한 때는 ${peak.m}월 ${HR(peak.h)}입니다(그림 1). 서울시도 14~17시를 오존이 높아지는 시간으로 안내합니다 ${cite('s8')}.`],
      ['11시 AI 예보로 당일 오후 ‘주의’ 알림', `2022년 시험에서 ‘나쁨’ ${T.tp + T.fn}일 중 ${T.tp}일을 11시에 잡았습니다(표 2). 이 사이트는 에어코리아 실시간 측정값으로 이 계산을 매일 하고 있어(홈의 ‘오늘의 AI 오존 예보’) 공공 알림 시스템으로 옮기기 쉽습니다. 오존 위험이 큰 80세 이상 ${cite('s6')}이 머무는 노인 쉼터·요양시설과 학교에 우선 알리고, 헛경보(${T.fp}일)를 고려해 ‘주의’ 단계로 운영합니다.`],
      ['시민용 ‘숨쉬기 좋은 시간표’ 안내', `오존과 초미세먼지를 함께 보면 5월에는 아침 ${may.worst.label}가 가장 나쁘고 ${may.best.label}가 가장 좋습니다(그림 2). 달마다 다른 시간표를 운동·산책 안내에 쓸 수 있습니다.`],
      ['수송 탄소중립(전기차 전환)과 휘발성유기화합물(VOC) 관리를 함께', `배기가스가 줄어드는 일요일에 이산화질소는 ${sgn(D.weekend.no2.pct, 0)}%였지만 오존은 뚜렷이 줄지 않았고(그림 8), 이산화질소가 줄어든 2021·2022년에 오존은 오히려 높았습니다(그림 5). 수도권 연구도 NOx 감소가 5월 오존 증가의 주원인이라고 봤습니다 ${cite('p3')}. 전기차 전환 같은 수송 탄소중립 정책에 도장 등 VOC 작업을 햇빛이 강한 오후 2~5시에 피하도록 한 권고 ${cite('s7')}를 묶어, 5~6월 오후 작업 시간 조정을 함께 추진합니다.`],
      ['고농도 측정소 주변부터 그늘·실내 쉼터 안내', `5년 자료가 모두 있는 측정소 중 ${st.map(s => `${s.name}(${s.gu})`).join(', ')}의 4~9월 ‘나쁨’ 비율이 높았습니다(그림 3). 이 지역부터 오후 실내 쉼터와 알림을 우선 안내합니다.`],
      ['WHO 수준까지 알리고, 폭염 대책과 묶기', `대구는 5년 동안 ${nf(O.who8Days)}일이 WHO 8시간 권고를 넘었습니다 ${cite('w1', 'w2')}. 여름이 더워지고 있어(그림 5) 기후 페널티 ${cite('p2')}를 고려해 오존 안내를 폭염 대책과 함께 운영할 것을 제안합니다. 최고기온 30℃ 이상이고 햇빛이 강한 날은 ${nf(D.weather.hotSunny.rate, 0)}%가 ‘나쁨’이었습니다(그림 7).`],
      ['오존 ‘주의’ 날 실내 쉼터를 태양광 전력으로', `오존 ‘나쁨’ 날은 하루 일사량이 다른 날보다 ${nf((D.carbon.insol.badDay / D.carbon.insol.otherDay - 1) * 100, 0)}% 많아 태양광 발전이 가장 많은 날이고, 대구의 태양광은 가동 중인 것만 ${nf(D.carbon.pv.operatingMw, 0)}MW입니다(그림 8). 11시 AI 예보가 ‘주의’를 내면 공공건물 태양광이 있는 경로당·도서관을 오후 실내 쉼터로 열어, 추가 온실가스 배출 없이 오존 노출을 줄입니다.`],
    ];
    $('proposals').innerHTML = items.map(([h, p]) => `<article><h2>${h}</h2><p>${p}</p></article>`).join('');
  }

  // ---------- 방법·참고문헌 ----------
  function drawMethods() {
    $('criteria').innerHTML = [
      `오존 ‘나쁨’: 1시간 0.091ppm 이상, 초미세먼지 ‘나쁨’: 36µg/m³ 이상 , 통합대기환경지수 예보 등급 ${cite('s10')}`,
      `대기환경기준: 오존 1시간 평균 0.1ppm 이하, 8시간 평균 0.06ppm 이하 ${cite('s9')}`,
      `오존주의보 발령 수준: 1시간 평균 0.12ppm 이상 ${cite('s7', 's4')}. 실제 주의보는 권역 단위로 발령되므로 이 사이트의 ‘주의보 수준’은 측정소 값 기준의 참고치입니다.`,
      `WHO 2021 권고: 8시간 100µg/m³, 성수기 60µg/m³ ${cite('w1', 'w2')}. 100µg/m³는 25℃·1기압에서 약 0.051ppm(1ppb = 1.96µg/m³)으로 환산했습니다.`,
    ].map(x => `<li>${x}</li>`).join('');
    $('methods').innerHTML = [
      `대기질 시간자료 ${nf(O.rows)}행(측정소 ${O.stations}곳, ${O.start}~${O.end})을 그대로 읽었습니다 ${cite('d1')}. 오존 값이 빈 ${nf(O.o3Missing)}시간은 빼고 계산했고 0으로 채우지 않았습니다.`,
      `‘나쁨 날’은 측정소 한 곳이라도 1시간 오존이 0.091ppm 이상이었던 날입니다. 8시간 평균은 8개 중 6개 이상 값이 있을 때만 계산했습니다(한국 기준 초과 ${nf(O.std8Days)}일, WHO 권고 초과 ${nf(O.who8Days)}일).`,
      '원자료의 ‘14시’ 값은 13~14시의 1시간 평균입니다. 그래프 축은 시작 시각(13시)으로, 설명은 범위(13~14시)로 적었습니다.',
      '주말 효과는 4~9월 도시 일평균(측정소별 하루 최고 오존과 하루 평균 이산화질소의 평균, 하루 18시간 이상 자료가 있는 측정소만)으로 일요일과 평일(월~금)을 비교하고, 부트스트랩 4,000회로 95% 구간을 냈습니다.',
      `AI 예보는 4~9월 날마다 13~18시에 측정소 8곳 이상 자료가 있는 날만 썼습니다(학습 ${M.trainDays}일, 검증 ${M.validationDays}일, 시험 ${M.testDays}일). 모델 선택과 기준 확률은 2021년 검증 자료로만 정했고, 2022년 시험 자료는 마지막에 한 번만 썼습니다.`,
      `측정소 구·군은 측정소 이름(동·읍)을 대구시 가로수·태양광 허가 자료의 주소와 맞춰 확인했습니다 ${cite('d3', 'd4')}.`,
      `날씨 분석은 기상청 대구 관측소(143)의 2018~2022년 시간자료 ${cite('d5')}를 대기질 자료와 같은 시각 표기(‘11시’ = 10~11시)로 맞췄습니다. 비와 일사량의 빈칸은 0(비 없음, 밤)으로 보았습니다.`,
      `오늘의 AI 예보는 서버 함수가 에어코리아 실시간 측정정보 ${cite('d6')}에서 학습 자료와 같은 측정소 19곳의 최근 48시간 값을 받아 오고(3시간마다, 11시 값이 나온 직후 한 번 더), 브라우저가 학습 때와 같은 코드로 입력값과 확률을 계산합니다. 11시 값이 나오기 전에는 전날 예보와 실제 결과를 보여 줍니다.`,
      `2024년 새 자료 시험(표 3)은 에어코리아 연도별 zip(월별 엑셀 12개, 전국 자료)에서 대구 도시대기 측정소 행만 뽑아, 학습 자료와 같은 측정소 ${M.external2024 ? M.external2024.stations : 19}곳으로 계산했습니다 ${cite('d7')}. 뽑는 코드는 ‘데이터 분석 Tool’ 탭의 파일 읽기 코드(ozone-files.js)와 같고, 원본 zip의 크기와 SHA-256 값을 함께 기록해 같은 원본에서 다시 만들 수 있습니다.`,
      `첫 화면의 오존은 에어코리아 실측값의 측정소 평균(이 사이트의 계산)이고 ${cite('d6')}, 기온·풍속·일사량은 서버가 10분마다 받아 두는 Open-Meteo 공개 API의 예측값입니다 ${cite('m1')}. Open-Meteo가 응답하지 않으면 기온과 바람은 MET Norway 예측값(CC BY 4.0)으로 대신하고, 일사량은 마지막으로 받은 값과 시각을 보여 줍니다. 에어코리아 값을 받지 못하면 Open-Meteo 대기 모델 추정 오존을 대신 보여 줍니다 ${cite('m2')}. 공식 실시간 정보는 에어코리아 ${cite('m3')}.`,
    ].map(x => `<li>${x}</li>`).join('');
    $('limits').innerHTML = [
      `분석(그림 1~8)은 공공데이터포털에 공개된 대구시 자료 2018~2022년으로 했습니다. 2024년은 에어코리아 최종확정 측정자료로 AI 예보만 다시 시험했고(표 3), 2023년과 2025년 이후는 넣지 않았습니다. 2024~2026년 전국 주의보 발령일은 날씨 영향으로 줄었다는 발표도 있습니다.`,
      '오늘의 AI 예보는 대기질 값만 쓰는 모델로 계산합니다. 기상 값을 더한 모델이 시험 성적이 더 좋았지만(표 2), 11시 일사량 같은 실시간 기상 관측을 아직 받아 오지 못합니다. 기상 분석은 대구 관측소 한 곳의 값이라 측정소별 날씨 차이는 반영하지 못합니다.',
      '오늘의 예보는 4~9월 자료로 학습한 모델이라 10~3월의 확률은 참고용입니다. 실시간 측정값은 확정 전 자료라 나중에 바뀌거나 빠질 수 있습니다.',
      '측정소마다 운영 기간이 다르고 2021년 이후 측정소가 늘었습니다. 연도·측정소 비교는 이 차이를 감안해 읽어야 합니다.',
      '주말 효과 분석에서 공휴일을 빼지 않았고, 2020년 비교는 날씨를 통제하지 않았으므로 원인(코로나)을 증명하지 않습니다.',
      '‘숨쉬기 좋은 시간’ 비율은 과거 5년 측정소 평균이며 그날의 실제 대기질이나 개인 건강 영향을 대신하지 않습니다. 외출 전에는 에어코리아 실시간 정보를 확인하세요.',
      '보도·영상 자료는 원 보고서를 소개한 2차 자료일 수 있어, 가능한 경우 발표 기관과 보고서 이름을 함께 적었습니다.',
    ].map(x => `<li>${x}</li>`).join('');
    $('refs').innerHTML = REFS.map((r, i) => `<li id="ref-${r.id}"><span class="n">[${i + 1}]</span><span class="t"><span class="badge b-${r.cls}">${esc(r.type)}</span>${esc(r.text)} <a href="${r.url}" target="_blank" rel="noopener">${esc(r.url.replace(/^https?:\/\//, '').slice(0, 70))}${r.url.replace(/^https?:\/\//, '').length > 70 ? '…' : ''}</a></span></li>`).join('');
  }

  // ---------- 홈: 오늘 날짜와 위젯 ----------
  const seoulNow = () => {
    const p = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(new Date());
    const g = t => (p.find(x => x.type === t) || {}).value;
    return { y: +g('year'), m: +g('month'), d: +g('day'), wd: g('weekday') };
  };
  { const n = seoulNow(); $('today').textContent = `${n.y}년 ${n.m}월 ${n.d}일 (${n.wd})`; } // 어느 탭으로 들어와도 날짜를 보인다
  // ---------- 오늘의 AI 예보: 에어코리아 실시간 측정값(functions/api/air.js) + 이 사이트의 학습 모델 ----------
  // 입력값은 학습 때와 같은 코드(OzoneCore.dayFeatures)로 만들고, 확률도 같은 식(OzoneCore.predict)으로 계산한다.
  const Core = window.OzoneCore;
  let liveReq = null;
  function liveForecast() {
    liveReq = liveReq || fetch('api/air?mode=hist').then(r => r.json()).then(j => {
      if (!j.ok) return { ok: false, error: j.error || '실시간 자료를 받지 못했습니다.' };
      const recs = [];
      for (const [st, rows] of Object.entries(j.stations)) for (const [dt, o3, no2, pm25, co] of rows) {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})/.exec(dt || ''); if (!m) continue;
        const h = +m[4]; if (!(h >= 1 && h <= 24)) continue; // 에어코리아 'HH:00' = (HH−1)~HH시 평균, 학습 자료와 같은 표기
        const di = Core.dayIndex(+m[1], +m[2], +m[3]);
        recs.push({ st, di, h, t: di * 24 + h - 1, y: +m[1], m: +m[2], o3: o3 ?? NaN, no2: no2 ?? NaN, pm25: pm25 ?? NaN, co: co ?? NaN });
      }
      const n = seoulNow(), today = Core.dayIndex(n.y, n.m, n.d);
      const at11 = di => recs.filter(r => r.di === di && r.h === 11 && Number.isFinite(r.o3)).length;
      const di = at11(today) >= 8 ? today : at11(today - 1) >= 8 ? today - 1 : null;
      if (di === null) return { ok: false, error: '11시 측정값이 아직 충분하지 않습니다.' };
      const r = Core.dayFeatures(recs, di, D.thresholds, { minStations: 8 });
      if (r.missing.length) return { ok: false, error: '입력값이 부족합니다(' + r.missing.map(k => (F.find(x => x.key === k) || {}).label || k).join(', ') + ').' };
      const p = Core.predict(M.params, r.f), dd = Core.dateOf(di);
      return { ok: true, di, isToday: di === today, date: `${dd.m}월 ${dd.d}일`, p, warn: p >= M.threshold, actual: r.actual, f: r.f, stations: at11(di), inSeason: dd.m >= 4 && dd.m <= 9, latest: j.latest };
    }).catch(e => ({ ok: false, error: e.message }));
    return liveReq;
  }
  async function renderLive(el, full) {
    el.innerHTML = '<p class="muted">에어코리아 실시간 자료로 계산하는 중…</p>';
    const L = await liveForecast();
    if (!L.ok) { el.innerHTML = `<p class="muted">오늘 예보를 계산하지 못했습니다: ${esc(L.error)}</p>`; return; }
    const verdict = L.warn ? '<span class="tag bad">오후 ‘나쁨’ 주의</span>' : '<span class="tag good">예보 없음</span>';
    const actual = L.actual === 1 ? '나쁨' : L.actual === 0 ? '보통 이하' : null;
    const lines = [
      `${L.date} 11시까지의 에어코리아 측정값(측정소 ${L.stations}곳)으로 이 사이트가 계산한 ${L.isToday ? '오늘' : '그날'} 13~18시 ‘나쁨’ 확률입니다. ${pct(M.threshold, 1)} 이상이면 ‘주의’로 알립니다. 자료 ${cite('d6')}.`,
      !L.isToday ? `오늘 11시 측정값이 나오면(보통 11시 15분 무렵) 오늘 예보로 바뀝니다.${actual ? ` 그날 실제 오후는 <b>${actual}</b>였습니다.` : ''}` : actual ? `오늘 실제 오후는 <b>${actual}</b>였습니다.` : '',
      !L.inSeason ? '4~9월 자료로 학습한 모델이라, 이 계절의 확률은 참고용입니다. 이 계절에는 오존 ‘나쁨’이 거의 나오지 않습니다.' : '',
    ].filter(Boolean);
    el.innerHTML = `<p class="big">${pct(L.p, 1)}</p><p class="verdict">${verdict}</p>${lines.map(t => `<p class="muted">${t}</p>`).join('')}` +
      (full ? `<details class="table"><summary>AI가 본 값(${L.date} 11시 기준)</summary><div class="tbl-wrap"><table class="feat"><tbody>${F.map(ft => `<tr><td>${esc(ft.label)}</td><td>${fmtFeat(ft, L.f[ft.key])}</td></tr>`).join('')}</tbody></table></div></details>` : '');
  }
  function drawHome() {
    const now = seoulNow(), w = windows(now.m, 2);
    $('w-breathe').innerHTML = `<h3>${now.m}월의 숨쉬기 시간표</h3><p class="muted">2018~2022년 ${now.m}월 측정소 평균 · 2시간 활동 기준</p>
      <div class="advice"><div><span class="tag good">추천</span><b>${w.best.label}</b><span>오존이나 초미세먼지가 나쁨 ${nf(w.best.v, 1)}%</span></div><div><span class="tag bad">회피</span><b>${w.worst.label}</b><span>오존이나 초미세먼지가 나쁨 ${nf(w.worst.v, 1)}%</span></div></div>
      <a class="more" href="#breathe">달과 활동 시간 바꿔 보기</a>`;
    $('w-facts').innerHTML = `<h3>분석 한눈에 (2018~2022 대구)</h3><dl class="facts">
      <div><dt>오존 ‘나쁨’ 날</dt><dd>${nf(O.badDays)}일</dd></div><div><dt>그중 5~6월</dt><dd>${mj}일</dd></div>
      <div><dt>가장 짙은 때</dt><dd>${peak.m}월 ${HR(peak.h)}</dd></div><div><dt>WHO 8시간 권고 초과</dt><dd>${nf(O.who8Days)}일</dd></div></dl>
      <a class="more" href="#report">분석 리포트 보기</a>`;
    const X = M.external2024;
    $('w-ai').innerHTML = `<h3>오늘의 AI 오존 예보</h3><div id="w-ai-live"></div><p class="muted">2022년 시험 성적: 오후 ‘나쁨’ ${T.tp + T.fn}일 중 ${T.tp}일을 11시에 미리 잡음, 헛경보 ${T.fp}일, AUC ${nf(T.auc, 2)}${X ? `. 학습에 쓰지 않은 2024년 새 자료에서도 ${X.test.tp + X.test.fn}일 중 ${X.test.tp}일` : ''}</p><a class="more" href="#forecast">예보 자세히 보기</a>`;
    renderLive($('w-ai-live'), false);
  }

  // ---------- 홈: 오존·환경 뉴스(functions/api/news.js가 구글 뉴스 검색 RSS를 정리해 돌려줌) ----------
  const NEWS_TOPICS = [['ozone', '오존'], ['daegu', '대구 환경'], ['climate', '기후·대기']];
  const NEWS_Q = { ozone: '오존 주의보', daegu: '대구 환경', climate: '폭염 대기오염' };
  let newsTopic = 'ozone', newsSnap = null;
  const renderNews = items => { $('news').innerHTML = items.slice(0, 12).map((n, i) => `<li${i < 3 ? ' class="hot"' : ''}><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><span>${esc(n.source)} · ${ago(n.time)}</span></li>`).join(''); };
  const ago = t => {
    if (!t) return '';
    const m = Math.round((Date.now() - Date.parse(t)) / 60000);
    if (m < 60) return `${Math.max(1, m)}분 전`;
    if (m < 1440) return `${Math.round(m / 60)}시간 전`;
    if (m < 1440 * 30) return `${Math.round(m / 1440)}일 전`;
    return t.slice(0, 10);
  };
  async function loadNews() {
    $('news-tabs').innerHTML = NEWS_TOPICS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === newsTopic}" data-topic="${k}">${l}</button>`).join('');
    $('news-tabs').onclick = e => { const b = e.target.closest('button'); if (b && b.dataset.topic !== newsTopic) { newsTopic = b.dataset.topic; loadNews(); } };
    const list = $('news'), topic = newsTopic;
    list.innerHTML = '<li class="muted">뉴스를 불러오는 중…</li>';
    try {
      const r = await fetch('api/news?topic=' + topic);
      const j = await r.json();
      if (topic !== newsTopic) return;
      if (!j.ok || !j.items.length) throw new Error(j.error || '결과 없음');
      let items = j.items, note = '';
      if (items.length < 6) { // 실시간 결과가 적으면(언론사 RSS 단계) 저장본의 기사를 뒤에 붙인다
        try {
          newsSnap = newsSnap || await fetch('news-snapshot.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
          const have = new Set(items.map(n => n.title)), extra = ((newsSnap.topics[topic] || {}).items || []).filter(n => !have.has(n.title));
          if (extra.length) { items = [...items, ...extra]; note = ` 실시간 ${j.items.length}건 뒤에 ${newsSnap.saved.slice(0, 10)}에 저장한 구글 뉴스 검색 결과를 이어 붙였습니다.`; }
        } catch (e2) { /* 저장본 없음 */ }
      }
      if (topic !== newsTopic) return;
      renderNews(items);
      $('news-src').textContent = `${j.source}, ‘${j.label}’ 주제, 30분마다 갱신.${note} 제목·언론사·시각만 보여 주며 기사는 각 언론사 사이트에서 열립니다.`;
    } catch (e) {
      if (topic !== newsTopic) return;
      // 구글이 서버 요청을 거절하면 배포할 때 저장한 목록(analysis/news-snapshot.mjs)을 저장 시각과 함께 보여 준다
      try {
        newsSnap = newsSnap || await fetch('news-snapshot.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
        const t = newsSnap.topics[topic];
        if (topic !== newsTopic) return;
        if (t && t.items.length) {
          renderNews(t.items);
          const sp = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(newsSnap.saved));
          const g = k => (sp.find(x => x.type === k) || {}).value;
          const saved = `${g('month')}월 ${g('day')}일 ${g('hour')}:${g('minute')}`;
          $('news-src').textContent = `지금은 실시간 뉴스를 불러오지 못해 ${saved}에 저장한 구글 뉴스 검색 결과(‘${t.label}’ 주제)를 보여 줍니다. 기사는 각 언론사 사이트에서 열립니다.`;
          return;
        }
      } catch (e2) { /* 저장본도 없으면 아래 안내 */ }
      list.innerHTML = `<li class="muted">뉴스를 불러오지 못했습니다. <a href="https://news.google.com/search?q=${encodeURIComponent(NEWS_Q[topic])}&hl=ko&gl=KR&ceid=KR:ko" target="_blank" rel="noopener">구글 뉴스에서 ‘${NEWS_Q[topic]}’ 보기</a></li>`;
      $('news-src').textContent = '';
    }
  }

  // ---------- 데이터 분석 Tool: 파일(CSV·xlsx·zip, 여러 개)이나 최근 30일 실측을 읽어 분석 작업대(studio.js)에 넘긴다 ----------
  const Studio = window.OzoneStudio;
  Studio.init({ D, M, esc, nf, sgn, pct, C, seq, rampBar, svg, widthOf, HS, HR, heat, lineChart, stationBars, legendHtml, kdt, cite, tok });
  const setStatus = (html, cls) => { const s = $('my-status'); s.className = 'status ' + (cls || ''); s.innerHTML = html; };
  const pause = () => new Promise(r => setTimeout(r, 20));
  // 여러 표를 하나의 기록 목록으로: 같은 측정소·같은 시각은 먼저 읽은 값 하나만 남긴다
  function mergeRecs(lists) {
    const seen = new Set(), out = [];
    let dup = 0;
    for (const list of lists) for (const r of list) { const k = r.st + '|' + r.t; if (seen.has(k)) { dup++; continue; } seen.add(k); out.push(r); }
    return { recs: out, dup };
  }
  async function analyzeRecs(recs, label, info) {
    if (!recs.length) throw new Error('날짜·시각과 오존 값을 읽을 수 있는 행이 없습니다.');
    setStatus(`${esc(label)}: ${nf(recs.length)}행 계산 중…`); await pause();
    const St = Studio.load(recs, label, info);
    const notes = info.notes || [], G = St.grid;
    setStatus(`${esc(label)} 분석 완료. ${nf(recs.length)}행(측정소 ${G.stations.length}곳, ${window.OzoneCore.iso(G.dmin)} ~ ${window.OzoneCore.iso(G.dmax)})${info.dup ? `, 겹친 ${nf(info.dup)}행 제외` : ''}${info.skippedRows ? `, 날짜·시각을 읽지 못한 ${nf(info.skippedRows)}행 제외` : ''}${notes.length ? '<br>' + notes.map(esc).join('<br>') : ''}`, 'ok');
  }
  async function analyzeFiles(files) {
    const F = window.OzoneFiles, Cr = window.OzoneCore;
    const lists = [], notes = [], used = [];
    let skippedRows = 0;
    try {
      for (const f of files) {
        if (f.size > 1.5 * 1024 ** 3) throw new Error(`‘${f.name}’이 1.5GB보다 큽니다. 연도별로 나눠 올려 주세요.`);
        setStatus(`‘${esc(f.name)}’ 여는 중…`); await pause();
        let lastPaint = 0;
        const tables = await F.readAny(f, f.name, {
          daeguOnly: $('daegu-only').checked,
          onProgress: (name, frac) => { const now = performance.now(); if (now - lastPaint > 250) { lastPaint = now; setStatus(`‘${esc(name)}’ 읽는 중… ${Math.round(frac * 100)}%`); } },
        });
        for (const t of tables) {
          if (!t.rows.length) { notes.push(`${t.name}: 남은 행이 없습니다${t.total ? '(대구 도시대기 측정소가 없음)' : '(빈 파일)'}.`); continue; }
          const det = Cr.detectColumns(t.header);
          if (!det.ok) { notes.push(`${t.name}: 필요한 열을 찾지 못했습니다(${det.missing.join(', ')}). 첫 줄: ${t.header.slice(0, 12).join(', ')}`); continue; }
          const r = Cr.toRecords(t.rows, det.map);
          lists.push(r.recs); skippedRows += r.skipped;
          r.notes.forEach(n => notes.push(`${t.name}: ${n}`));
          used.push({ name: t.name, format: det.timeFormat, rowsRead: t.total, rowsKept: t.rows.length, records: r.recs.length, columns: Object.fromEntries(Object.entries(det.map).map(([k, i]) => [k, t.header[i]])) });
          await pause();
        }
      }
      if (!lists.length) throw new Error(notes.join(' ') || '읽을 수 있는 표가 없습니다.');
      const { recs, dup } = mergeRecs(lists);
      const label = files.length === 1 ? `‘${files[0].name}’` : `파일 ${files.length}개`;
      await analyzeRecs(recs, label, { kind: 'files', files: used, notes, skippedRows, dup, daeguOnly: $('daegu-only').checked });
    } catch (e) {
      $('my-result').hidden = true;
      setStatus('분석하지 못했습니다: ' + esc(e.message), 'err');
    }
  }
  async function analyzeRecent() {
    setStatus('에어코리아에서 최근 30일 대구 측정값을 받는 중…');
    try {
      const j = await fetch('api/air?mode=month').then(r => r.json());
      if (!j.ok) throw new Error(j.error || '실시간 자료를 받지 못했습니다.');
      const Cr = window.OzoneCore, recs = [];
      for (const [st, rows] of Object.entries(j.stations)) for (const [dt, o3, no2, pm25, co] of rows) {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})/.exec(dt || ''); if (!m) continue;
        const h = +m[4]; if (!(h >= 1 && h <= 24)) continue;
        const di = Cr.dayIndex(+m[1], +m[2], +m[3]);
        recs.push({ st, di, h, t: di * 24 + h - 1, y: +m[1], m: +m[2], o3: o3 ?? NaN, no2: no2 ?? NaN, pm25: pm25 ?? NaN, co: co ?? NaN });
      }
      await analyzeRecs(recs, `최근 30일 대구 실측(에어코리아, ${kdt(j.latest)}까지)`, { kind: 'airkorea-api', notes: ['에어코리아 실시간 측정정보는 확정 전 자료입니다. 측정소 19곳(학습 자료와 같은 측정소).'], source: j.source });
    } catch (e) {
      $('my-result').hidden = true;
      setStatus('최근 자료를 분석하지 못했습니다: ' + esc(e.message), 'err');
    }
  }
  (function myData() {
    const drop = $('drop'), file = $('file');
    const take = list => { const fs = [...(list || [])]; if (fs.length) analyzeFiles(fs); };
    $('pick').onclick = () => file.click();
    file.onchange = () => { take(file.files); file.value = ''; };
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files); });
    $('try-recent').onclick = analyzeRecent;
    $('try-sample').onclick = () => {
      setStatus('예시 파일을 불러오는 중…');
      fetch('sample/daegu-airquality-2022-05-06.csv').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then(b => analyzeFiles([new File([b], 'daegu-airquality-2022-05-06.csv')]))
        .catch(e => setStatus('예시 파일을 불러오지 못했습니다: ' + esc(e.message), 'err'));
    };
  })();

  // ---------- 탭 이동(주소 #home, #report, … / #ref-…는 자료·출처로) ----------
  const VIEWS = { home: [drawHome], report: [drawWhen, drawStations, drawWhy, drawFig5, drawWeather, drawCarbon], breathe: [drawBreathe], forecast: [drawAI], mydata: [], propose: [drawProposals], sources: [drawMethods] };
  let current = null;
  const drawn = new Set();
  function show(name, target, keepScroll) {
    if (!VIEWS[name]) name = 'home';
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll('.tabs a').forEach(a => { if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (!drawn.has(name)) { VIEWS[name].forEach(f => f()); drawn.add(name); }
    current = name;
    if (target) { const el = document.getElementById(target); if (el) { el.scrollIntoView({ block: 'center' }); return; } }
    if (!keepScroll) window.scrollTo(0, 0);
  }
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith('ref-')) show('sources', h);
    else show(h || 'home');
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-more]'); if (b) b.closest('.box').classList.add('open'); });
  addEventListener('hashchange', route);
  route();
  loadNews();
  let rz, lastW = innerWidth;
  addEventListener('resize', () => {
    if (Math.abs(innerWidth - lastW) < 8) return;
    lastW = innerWidth; clearTimeout(rz);
    rz = setTimeout(() => { drawn.clear(); show(current, null, true); }, 150);
  });
})();
