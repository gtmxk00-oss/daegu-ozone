// 제출용 PDF 분석 보고서를 만든다: 로컬 미리보기(node serve.cjs)의 그림을 캡처하고 data.js의 수치로 본문을 채운다.
// 사용: node serve.cjs 를 켠 상태에서 node analysis/build-report.cjs
// 결과: report/대구-오존-시간표-분석보고서.pdf (report/ 폴더는 배포하지 않는다)
const fs = require('fs');
const path = require('path');
// puppeteer-core는 이 프로젝트에 설치하지 않는다. HALLMARK_PUPPETEER에 경로를 주거나, 없으면 두 단계 위 `해커톤` 폴더의 것을 쓴다.
const puppeteer = require(process.env.HALLMARK_PUPPETEER || path.join(__dirname, '..', '..', '..', '해커톤', '.design-tools', 'runtime', 'node_modules', 'puppeteer-core'));

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'report');
const IMG = path.join(OUT, 'img');
const BASE = 'http://127.0.0.1:8796/';
const URL_PUBLIC = 'https://daegu-ozone.pages.dev/';
fs.mkdirSync(IMG, { recursive: true });

const src = fs.readFileSync(path.join(ROOT, 'site', 'data.js'), 'utf8');
const D = JSON.parse(src.slice(src.indexOf('=') + 1).trim().replace(/;\s*$/, ''));
const O = D.overview, M = D.model, T = M.test, W = D.weather, K = D.carbon, WK = D.weekend;
const nf = (v, d = 0) => Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1180, height: 1400, deviceScaleFactor: 2 });
  const shot = async (view, sel, name) => {
    await page.goto(BASE + '#' + view, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 900));
    await page.mouse.move(0, 0);
    const el = await page.$(sel);
    if (!el) throw new Error('없음: ' + sel);
    await el.screenshot({ path: path.join(IMG, name + '.png') });
  };
  const figs = [
    ['report', '#fig1', 'fig1'], ['breathe', '#fig2', 'fig2'], ['report', '#fig3', 'fig3'], ['report', '#fig4', 'fig4'],
    ['report', '#fig5', 'fig5'], ['report', '#fig7', 'fig7'], ['report', '#fig8', 'fig8'], ['forecast', '#fig6', 'fig6'],
  ];
  for (const [v, s, n] of figs) await shot(v, s, n);
  await shot('forecast', '.fig:has(#ai-score)', 'tab2');
  if (M.external2024) await shot('forecast', '#ext-box', 'tab3');
  // 본문에 옮길 글: 정책 제안, 한계(사이트 문장 그대로)
  await page.goto(BASE + '#propose', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  const proposals = await page.$$eval('#proposals article', as => as.map(a => ({ h: a.querySelector('h2').innerText, p: a.querySelector('p').innerText })));
  await page.goto(BASE + '#sources', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  const limits = await page.$$eval('#limits li', ls => ls.map(l => l.innerText));
  const refCount = await page.$$eval('#refs li', ls => ls.length);

  const img = n => `<img src="img/${n}.png" alt="">`;
  const S = D.sources;
  const srcRows = [S.airQuality, S.weather, S.airkorea, S.cooling, S.trees, S.solar, S.airkoreaFinal].filter(Boolean).map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.title)}</td><td>${esc(s.provider)}</td><td>${esc(s.license.split(':')[0])}</td></tr>`).join('');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>대구 오존 시간표 분석 보고서</title><style>
@font-face { font-family: "P"; src: url("../site/vendor/PretendardVariable.woff2") format("woff2-variations"), url("../site/vendor/PretendardVariable.woff2") format("woff2"); font-weight: 45 920; }
@page { size: A4; margin: 15mm 14mm 16mm; @bottom-center { content: counter(page); } }
* { box-sizing: border-box; }
body { margin: 0; font: 400 10pt/1.62 "P", "Malgun Gothic", sans-serif; color: #171815; word-break: keep-all; overflow-wrap: anywhere; }
h1 { font-size: 22pt; font-weight: 800; letter-spacing: -0.02em; line-height: 1.25; margin: 0 0 4pt; }
h2 { font-size: 13.5pt; font-weight: 800; margin: 14pt 0 5pt; padding-top: 5pt; border-top: 2px solid #171815; break-after: avoid; }
p { margin: 0 0 6pt; }
.meta { color: #3d3f39; margin-bottom: 10pt; }
.meta b { color: #171815; }
.lead { font-size: 11pt; color: #3d3f39; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; margin: 10pt 0 6pt; }
.kpis div { border-top: 2px solid #171815; padding-top: 4pt; }
.kpis b { display: block; font-size: 16pt; font-weight: 800; letter-spacing: -0.02em; }
.kpis span { font-size: 8.5pt; color: #63655d; }
figure { margin: 6pt 0 10pt; break-inside: avoid; }
figure img { width: 100%; display: block; border: 1px solid #e2dfd6; border-radius: 4pt; }
table { width: 100%; border-collapse: collapse; font-size: 8.8pt; margin: 4pt 0 8pt; border-top: 1.5pt solid #171815; border-bottom: 1.5pt solid #171815; }
th, td { border-bottom: 0.5pt solid #c9c5b9; padding: 3pt 5pt; text-align: left; vertical-align: top; }
th { font-weight: 600; color: #3d3f39; }
ol.prop { padding-left: 16pt; margin: 4pt 0; }
ol.prop li { margin-bottom: 5pt; break-inside: avoid; }
ul { padding-left: 15pt; margin: 4pt 0; }
li { margin-bottom: 3pt; }
.note { font-size: 8.5pt; color: #63655d; }
.pb { break-before: page; }
</style></head><body>
<h1>대구 오존 시간표: 언제 숨쉬기 좋은가</h1>
<p class="meta"><b>2026 대구광역시 기후·환경·탄소중립 공공데이터 AI 활용대회 부문 2(공공데이터 분석·시각화)</b><br>웹사이트(출품작 본문): <b>${URL_PUBLIC}</b> · 이 문서는 사이트의 분석을 옮긴 요약 보고서입니다.</p>
<p class="lead">대구시 대기질 측정소 ${O.stations}곳의 ${O.start.slice(0, 4)}~${O.end.slice(0, 4)}년 시간자료(${nf(O.rows)}행)와 기상청 대구 관측소 시간자료로 오존 고농도가 언제·어디서·왜 생기는지 분석하고, 11시까지의 자료로 그날 오후 오존 ‘나쁨’을 미리 알려 주는 AI 예보를 만들었습니다. 예보는 에어코리아 실시간 측정값으로 매일 다시 계산되며, 결과를 탄소중립 정책과 연결해 7가지 제안을 냈습니다.</p>
<div class="kpis">
  <div><b>${nf(O.badDays)}일</b><span>오존 ‘나쁨’(1시간 0.091ppm↑) 날, 5년</span></div>
  <div><b>${nf(W.hotSunny.rate, 1)}%</b><span>30℃↑·일사 20MJ/m²↑ 날 중 ‘나쁨’ 비율</span></div>
  <div><b>${T.tp}/${T.tp + T.fn}일</b><span>AI가 11시에 미리 잡은 2022년 ‘나쁨’ 날${M.external2024 ? `, 2024년 새 자료 ${M.external2024.test.tp}/${M.external2024.test.tp + M.external2024.test.fn}일` : ''}</span></div>
  <div><b>+${nf((K.insol.badDay / K.insol.otherDay - 1) * 100, 0)}%</b><span>‘나쁨’ 날의 일사량(태양광 발전에 유리)</span></div>
</div>

<h2>1. 데이터와 방법</h2>
<table><tr><th>연번</th><th>공공데이터</th><th>제공기관</th><th>이용허락범위</th></tr>${srcRows}</table>
<p>모든 수치는 공개된 분석 코드(사이트의 ‘자료·출처’ 탭, analyze.cjs·ozone-core.js)가 원본에서 다시 계산합니다. ‘나쁨 날’은 측정소 한 곳이라도 1시간 오존이 0.091ppm 이상인 날입니다. AI 예보는 4~9월 날마다 11시까지의 대기질 값 ${M.features.length}가지로 그날 13~18시 ‘나쁨’ 여부를 맞히며, 2018~2020년 학습, 2021년 검증으로 모델과 기준 확률을 정하고 2022년 시험 자료는 마지막에 한 번만 썼습니다.</p>

<h2>2. 언제: 5~6월 오후</h2>
<figure>${img('fig1')}</figure>
<figure>${img('fig2')}</figure>
<h2 class="pb">3. 어디서와 왜</h2>
<figure>${img('fig3')}</figure>
<figure>${img('fig4')}</figure>
<figure>${img('fig5')}</figure>
<h2 class="pb">4. 날씨: 덥고 햇빛이 강한 날</h2>
<figure>${img('fig7')}</figure>
<h2>5. 탄소중립과 오존</h2>
<figure>${img('fig8')}</figure>
<h2 class="pb">6. AI 예보: 11시에 오후 ‘나쁨’ 알리기</h2>
<figure>${img('tab2')}</figure>
${M.external2024 ? `<figure>${img('tab3')}</figure>` : ''}
<figure>${img('fig6')}</figure>
<p>사이트 홈의 ‘오늘의 AI 오존 예보’는 서버가 에어코리아 실시간 측정정보(학습과 같은 측정소 19곳)를 받아 오고, 브라우저가 학습 때와 같은 코드로 입력값과 확률을 계산합니다. 11시 값이 나오기 전에는 전날 예보와 실제 결과를 보여 줍니다. 4~9월 밖의 확률은 참고용으로 표시합니다.</p>
<h2 class="pb">7. 정책 제안</h2>
<ol class="prop">${proposals.map(x => `<li><b>${esc(x.h)}</b><br>${esc(x.p)}</li>`).join('')}</ol>
<h2>8. 사이트에서 바로 쓰는 기능</h2>
<ul>
<li><b>오늘의 AI 오존 예보:</b> 서버가 에어코리아 실시간 측정값(학습과 같은 측정소 19곳)을 받아 오고, 11시 값이 나오면 그날 오후 ‘나쁨’ 확률을 홈에 띄웁니다. 2018~2021년으로 학습한 모델을 그대로 씁니다.</li>
<li><b>데이터 분석 Tool:</b> 에어코리아 최종확정 측정자료(연도별 zip·월별 엑셀)나 대구시·에어코리아 형식 CSV를 올리면 브라우저 안에서만 계산합니다. 기간·측정소·항목·집계·기준선 필터, 시계열 탐색(끌어서 확대, 십자선), 초과 사건 목록(1시간·8시간 기준), 측정소 비교표(달·시각·요일별 평균·최고·95백분위·나쁨 시간·자료 비율), 자료 품질 점검, 원자료 표, CSV·그림 내보내기, 분석이 끝나면 자동으로 만들어지는 요약 그림을 제공합니다. 최근 30일 실측 자료는 버튼 하나로 불러와 같은 방법으로 분석합니다.</li>
<li><b>진단과 개선 방향(데이터 분석 Tool):</b> 분석이 끝나면 그 기간의 오존이 좋은 편인지 나쁜 편인지를 공식 기준값만으로 판정합니다(주의보 수준 0.12ppm인 날이 있으면 ‘매우 나쁜 편’, ‘나쁨’ 0.091ppm 이상인 날이 있으면 ‘나쁜 편’, 8시간 환경기준 0.06ppm만 넘으면 ‘조금 나쁜 편’, 모두 없으면 ‘좋은 편’). 2018~2022년 대구의 같은 달 평균과의 비교, ‘나쁨’이 몰린 시간·달·측정소를 함께 보여 주고, 그 숫자에서 나온 할 일(야외 활동 시간 옮기기, 미리 알릴 달과 장소, 11시 AI 예보 활용, 자동차 배출과 휘발성유기화합물을 함께 줄이기)을 근거와 출처를 붙여 제시합니다. 판정 규칙을 화면에 그대로 적었고, 자동 계산이며 공식 판정이 아님을 밝혔습니다.</li>
<li><b>오존·환경 뉴스:</b> 네이버 뉴스 검색(NAVER API HUB)으로 오존, 대구 환경, 기후·대기 주제의 최신 기사 제목과 링크를 30분마다 받아 옵니다. 받지 못하면 구글 뉴스 검색, 언론사 공개 RSS, 배포 때 저장한 목록 순서로 대신합니다.</li>
<li><b>지금 대구:</b> 에어코리아 실측 오존(측정소 평균)과 Open-Meteo의 기온·바람·일사량 현재값을 15분마다 보여 줍니다. 날씨 값은 서버가 받아 10분 동안 저장해 두므로 보는 사람의 통신망과 상관없이 같은 값이 나오고, Open-Meteo가 응답하지 않으면 기온과 바람은 MET Norway 예측값으로 대신합니다.</li>
</ul>
<h2>9. 한계</h2>
<ul>${limits.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
<p class="note">참고문헌 ${refCount}개(공공데이터, 공식 통계, 보고서, 논문, 공익광고 영상)와 각 수치의 출처는 사이트 ‘자료·출처’ 탭에 번호로 정리했습니다. 그림 속 [n]은 그 번호입니다. 서체: Pretendard(SIL Open Font License). 분석 기준일 ${D.generated}.</p>
</body></html>`;
  const htmlPath = path.join(OUT, 'report.html');
  fs.writeFileSync(htmlPath, html);
  const pdfPage = await browser.newPage();
  await pdfPage.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  const pdfPath = path.join(OUT, '대구-오존-시간표-분석보고서.pdf');
  await pdfPage.pdf({ path: pdfPath, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font-size:8px;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>', margin: { top: '15mm', bottom: '16mm', left: '14mm', right: '14mm' } });
  await browser.close();
  console.log('saved', pdfPath, Math.round(fs.statSync(pdfPath).size / 1024) + 'KB', 'proposals', proposals.length, 'limits', limits.length, 'refs', refCount);
})().catch(e => { console.error(e); process.exit(1); });
