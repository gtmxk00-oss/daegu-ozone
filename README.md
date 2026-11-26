# 대구 오존 시간표

2026 대구광역시 기후·환경·탄소중립 공공데이터 AI 활용대회 부문 2(공공데이터 분석·시각화) 출품작.
대구시 대기질 측정소 20곳의 2018~2022년 시간 자료로 오존이 언제·어디서·왜 짙어지는지 분석하고, 11시까지의 자료로 그날 오후(13~18시) 오존 ‘나쁨’을 미리 알려 주는 머신러닝 예보를 만든 정적 웹사이트.

## 구조

| 경로 | 내용 |
| --- | --- |
| `data/raw/` | 공공데이터포털에서 내려받은 원본 CSV 4개와 기상청 대구(143) 시간자료 CSV(`analysis/fetch-asos.mjs`가 API로 받음). 수정하지 않음 |
| `analysis/analyze.cjs` | 원본 → `site/data.js` 생성. 모든 수치와 AI 모델을 여기서 계산 |
| `site/` | 배포 폴더. `index.html`, `style.css`, `app.js`, 생성된 `data.js`, 서체, `code/analyze.cjs.txt`(분석 코드 공개본) |
| `site/tokens.css`, `site/base.css` | 디자인 토큰(색·간격·글자 크기)과 기본 규칙. Hallmark(오픈소스 디자인 규칙) 스캐폴드로 만들고 브랜드 색을 채움. 모든 색은 여기서만 정하고 `style.css`·`app.js`가 읽는다 |
| `site/ozone-files.js` | 올린 파일 읽기(CSV, 엑셀 xlsx, zip). 에어코리아 최종확정 측정자료(연도별 zip 안 월별 xlsx, 전국)를 목차로 잘라 읽고 시트를 스트림으로 풀면서 대구 도시대기 행만 남긴다. 브라우저와 Node가 같은 코드를 쓴다 |
| `data/derived/` | `analysis/extract-airkorea.mjs`가 에어코리아 2024년 zip(약 350MB, 프로젝트에 두지 않음)에서 뽑은 대구 도시대기 행 CSV와, 원본 파일 이름·크기·SHA-256을 적은 JSON. AI 예보 새 자료 시험(표 3)에 쓴다. 저장소에는 JSON만 있다(아래 ‘저장소에 없는 것’) |
| `site/studio.js` | 분석 작업대(‘데이터 분석 Tool’ 화면). 측정소 × 시각 격자(Float64Array)로 빠르게 집계하고, 필터·시계열 탐색·초과 사건·측정소 비교표·자료 품질·원자료·내보내기(CSV, PNG, 요약 그림)를 그린다. 계산 규칙은 ozone-core.js, 그래프 도구는 app.js에서 받는다. 보기 설정은 localStorage에 저장(자료는 저장 안 함) 개요 맨 위의 ‘진단과 개선 방향’(2026-11-15 추가)은 공식 기준값만으로 좋은 편~매우 나쁜 편을 판정하고(가장 높았던 수준 기준), 2018~2022년 대구의 같은 달 평균과 견주며, ‘나쁨’이 몰린 시간·달·측정소와 그 숫자에서 나온 할 일을 출처와 함께 보여 준다. 결과 JSON의 `diagnosis`에도 들어간다 |
| `site/ozone-core.js` | 공통 계산(CSV 읽기, 열 찾기, 요약, AI 입력값, 예측). 분석 스크립트와 ‘데이터 분석 Tool’ 탭이 같은 코드를 쓴다 |
| `functions/api/news.js` | Cloudflare Pages Function. `/api/news?topic=` 값은 ozone, daegu, climate. 세 단계로 시도: 네이버 뉴스 검색(NAVER API HUB 비밀값 `NCP_API_KEY_ID`·`NCP_API_KEY`가 있을 때, 가장 먼저) → 구글 뉴스 검색 RSS(Cloudflare에서는 503이 잦음) → 언론사 공개 RSS 7곳을 주제어로 거름. 대구 주제는 네이버 검색어 3개를 합친다. 제목·언론사·시각·링크만, 30분 캐시, 비슷한 기사 묶음 제거. 셋 다 비면 사이트가 `news-snapshot.json`을 보여 준다 |
| `functions/api/air.js` | Cloudflare Pages Function. `/api/air?mode=now`(대구 전체 측정소 최신 1시간)과 `mode=hist`(학습과 같은 측정소 19곳의 최근 48시간)를 에어코리아 API에서 받아 키를 숨기고 KV(`CACHE`)에 저장해 하루 호출 수(개발계정 500회)를 넘지 않게 한다. 예보 계산은 브라우저가 `ozone-core.js`로 한다. `mode=now`는 20분 저장이며, 새로 받을 때 에어코리아가 6초 넘게 걸리면 저장값을 `stale` 표시로 먼저 주고 새 값은 뒤에서 저장한다(홈은 20초 뒤 한 번 다시 묻는다). 실패하면 5분 쉰다 |
| `functions/api/wx.js` | Cloudflare Pages Function. `/api/wx`는 대구 현재 기온·습도·바람·일사량을 서버에서 받아 KV에 10분 저장한다(2026-11-13 추가: 일부 통신망에서 브라우저가 Open-Meteo에 닿지 못해 홈 값이 비던 문제). 출처 순서는 Open-Meteo → 기상청 초단기실황(15084084, `DATA_GO_KR_KEY`에 활용신청이 되어 있을 때만) → MET Norway(CC BY 4.0, 일사량 없음). 모두 실패하면 마지막 저장값을 `stale`로 준다 |
| `cron/` | 예약 작업용 Worker `daegu-ozone-cron`(10분마다 `/api/wx`, `/api/air?mode=now`, `/api/air?mode=hist`를 불러 저장값을 새로 고침). 없어도 사이트는 방문할 때마다 최신 값을 받는다. 배포는 `cron` 폴더에서 `npx --yes wrangler@4 deploy`. **2026-11-13 현재 코드만 올라가 있고 예약은 걸리지 않았다**: 계정에 workers.dev 하위 주소가 없어서이며, Cloudflare 대시보드의 Workers & Pages 화면을 한 번 열면 만들어진다 |
| `wrangler.toml` | Pages 설정(배포 폴더 `site`, KV 연결). 키는 넣지 않는다 |
| `analysis/*.mjs` | `env.mjs`(키 읽기, 출력 안 함), `check-keys.mjs`(키 확인), `fetch-asos.mjs`(기상 자료), `probe-airkorea.mjs`(측정소 확인), `news-snapshot.mjs`(뉴스 저장본), `put-secret.mjs`(키를 Cloudflare 비밀값으로) |
| `site/sample/` | ‘데이터 분석 Tool’ 예시 파일(2022년 5~6월 원본 열 그대로, 분석 스크립트가 생성) |
| `serve.cjs` | 로컬 미리보기 서버(`/api/news`, `/api/air`, `/api/wx`는 functions의 같은 함수를 불러 실행, 키는 `.env.local`) |
| `제출-작성자료.md` | 신청서·내역서에 옮겨 적을 초안(붙임 1·4·5 칸 순서) |
| `제출서식/붙임자료-작성.html` | 붙임 1~5를 원본 서식 구성대로 채워 둔 파일. 브라우저로 열어 개인정보 입력·서명 후 PDF로 저장(입력값은 저장·전송하지 않음) |
| `report/` | 제출용 요약 보고서 PDF. `node analysis/build-report.cjs`(미리보기 서버를 켠 상태)로 사이트 그림을 캡처해 만든다. 배포하지 않는다 |

## 실행

```powershell
node analysis/analyze.cjs   # 원본에서 site/data.js와 site/code/analyze.cjs.txt를 다시 만든다
node serve.cjs              # http://127.0.0.1:8796
```

외부 라이브러리·npm 의존성 없음(Node 24에서 확인). 원본 CSV의 EUC-KR 인코딩은 Node의 TextDecoder로 읽는다.

공개 주소: https://daegu-ozone.pages.dev/ (Cloudflare Pages 프로젝트 `daegu-ozone`, 2026-11-09 첫 배포).

다시 배포할 때는 **프로젝트 폴더에서** 아래 순서로 실행한다(`functions/`가 함께 올라가야 뉴스 함수가 동작한다).

```powershell
node analysis/news-snapshot.mjs   # 뉴스 저장본 갱신. 구글이 Cloudflare 서버 요청을 503으로 거절할 때 사이트가 이 목록을 저장 시각과 함께 보여 준다
Remove-Item -Recurse -Force site/.hallmark -ErrorAction SilentlyContinue   # 디자인 검사 사진이 올라가지 않게
npx --yes wrangler@4 pages deploy --branch main --commit-dirty=true   # wrangler.toml을 읽어 site/와 KV 연결을 함께 올린다
```

공개 사이트의 에어코리아 키는 Cloudflare 비밀값 `DATA_GO_KR_KEY`로 한 번만 넣는다: `node analysis/put-secret.mjs` (또는 `npx --yes wrangler@4 pages secret put DATA_GO_KR_KEY --project-name daegu-ozone` 후 키 붙여 넣기).

API 키는 `.env.local`(프로젝트 폴더, `site/` 밖이라 배포되지 않음)에만 둔다. 채팅이나 코드에 적지 않는다. 네이버 뉴스 검색 키(선택)는 네이버클라우드 콘솔의 NAVER API HUB에서 Search API를 신청해 받고(개발자센터의 검색 API는 2026-07-31에 신규 신청이 끝남), 같은 파일의 `NCP_API_KEY_ID`·`NCP_API_KEY`에 넣은 뒤 `node analysis/put-secret.mjs`로 올린다. 키가 있으면 뉴스는 네이버를 먼저 쓴다.

## 사이트 구성(포털형 탭)

`#home`(뉴스·지금 대구·오늘의 AI 예보·위젯) · `#report`(그림 1·3·4·5·7·8) · `#breathe`(그림 2) · `#forecast`(표 2·그림 6) · `#mydata`(분석 작업대: 개요·시계열 탐색·초과 사건·측정소 비교표·자료 품질·원자료) · `#propose` · `#sources`(기준·방법·한계·참고문헌). `#ref-…` 인용 링크는 자료·출처 탭으로 이동한다. 그래프는 탭을 처음 열 때 그린다.

## 원칙

- 화면의 숫자는 모두 `data.js`에서 채운다. 본문에 숫자를 손으로 쓰지 않는다.
- 생성 파일(`site/data.js`, `site/code/analyze.cjs.txt`)을 직접 고치지 않는다.
- AI 예보는 2018~2020 학습 → 2021 검증으로 모델과 기준 확률을 정하고, 2022 시험 자료는 마지막에 한 번만 쓴다. 시험 결과를 보고 설정을 바꾸지 않는다.
- 논문·기관 자료는 원문에서 확인한 문장만 인용한다. Reddit은 도구 접근이 막혀 참고하지 못했다.
- 그래프는 논문 그림 형식(그림 1~8, 표 1~3, 패널 기호, 캡션 끝의 자료 출처)으로 쓴다. 참고문헌 목록과 본문 인용 번호는 `site/app.js`의 `REFS`·`VIDEOS` 배열 순서로 자동 매겨진다. 출처를 추가하면 이 배열에 넣는다.
- ‘지금 무엇이 문제인가’의 수치는 원문 페이지에서 확인한 것만 쓴다. 논문 서지 정보는 Crossref에서, 유튜브 영상 제목·채널은 oEmbed에서 확인했다(2026-11-09). 공고의 이미지 사용 권리 조건 때문에 영상 썸네일 이미지는 쓰지 않고 제목·채널·링크만 보여 준다.
- WHO 2021 8시간 권고 100µg/m³는 25℃·1기압 환산으로 0.051ppm을 쓴다(`T.who8h`).
- 그래프 색은 dataviz 검증 팔레트(#2a78d6, #eb6834, #1baf7a)와 파란 순차 색을 쓴다. 값은 `tokens.css`의 `--viz-*`, `--ramp`에 있고 `app.js`가 실행할 때 읽는다. 청록은 흰 바탕 대비 3:1 미만이라 직접 이름표와 표를 함께 둔다.

## 디자인(Hallmark)

2026-11-09 Hallmark v2.0.0 규칙으로 전면 재디자인했다(로컬 사본: `해커톤/.agents/skills/hallmark`). `style.css` 첫 줄의 주석이 그 기록이다(바꾼 문구, 생략한 항목, 예외 사유). 다시 검사하려면 프로젝트 폴더에서:

```powershell
# $lab: Hallmark 스킬과 puppeteer-core를 설치해 둔 폴더(만든 PC에서는 두 단계 위의 `해커톤` 폴더)
$lab = (Resolve-Path "../../해커톤").Path -replace '\\','/'
$env:CHROME_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
$env:HALLMARK_PUPPETEER="$lab/.design-tools/runtime/node_modules/puppeteer-core"
node "$lab/.agents/skills/hallmark/scripts/sloplint.mjs" site/index.html site/style.css --genre modern-minimal --scope app --render --kept --url http://127.0.0.1:8796/
```

검사는 `site/.hallmark/` 폴더를 만든다. **배포 전에 이 폴더를 지운다**(검사 화면 사진이 공개 사이트에 올라가지 않도록). 재디자인 전후 비교: `.hallmark/compare.html`.

## 데이터

| 데이터 | 제공 | 링크 | 쓴 곳 |
| --- | --- | --- | --- |
| 대구광역시_대기질 항목별 시간평균자료 (2018~2022) | 대구광역시 보건환경연구원 | https://www.data.go.kr/data/15083249/fileData.do | 모든 대기질 분석, AI 예보 |
| 기상청_지상(종관, ASOS) 시간자료 조회서비스 (대구 143, 2018~2022) | 기상청 | https://www.data.go.kr/data/15057210/openapi.do | 날씨와 오존(그림 7), 기상 추가 예보 모델 비교(표 2) |
| 한국환경공단_에어코리아_대기오염정보 (실시간) | 한국환경공단 | https://www.data.go.kr/data/15073861/openapi.do | 홈의 실시간 오존, 오늘의 AI 예보 |
| 에어코리아 최종확정 측정자료 2024년(대구 도시대기만 추출) | 환경부·한국환경공단 | https://www.airkorea.or.kr/web/last_amb_hour_data?pMENU_NO=123 | AI 예보 새 자료 시험(표 3). 원본 zip과 추출본 CSV는 저장소에 두지 않고, data/derived에 원본의 SHA-256과 추출 기록만 둔다 |
| 한국가스공사_월별 시도별 냉난방도일 통계현황 (1999~2024) | 한국가스공사 | https://www.data.go.kr/data/15040826/fileData.do | 6~9월 냉방도일 추세 |
| 대구광역시_가로수정보 | 대구광역시 | https://www.data.go.kr/data/15109655/fileData.do | 측정소 동·읍 이름의 구·군 확인 |
| 대구광역시_태양광전기사업허가현황 | 대구광역시 | https://www.data.go.kr/data/15034028/fileData.do | 측정소 동·읍 이름의 구·군 확인(달서구·달성군 보충), 태양광 허가 용량과 탄소중립 분석(그림 8) |

이용허락범위: 대기질·냉난방도일·가로수·태양광 ‘제한 없음’, 기상청 ASOS 공공누리 제1유형(출처표시), 에어코리아 공공누리 제3유형(출처표시, 변경금지: 측정값은 그대로 보여 주고 평균·예보는 계산값으로 따로 표시).

## 저장소에 없는 것

| 없는 것 | 이유 | 다시 얻는 방법 |
| --- | --- | --- |
| `.env.local` | 공공데이터포털·네이버 API 키 | 키를 다시 발급받아 적는다. 확인: `node analysis/check-keys.mjs` |
| `제출서식/붙임자료-작성.html` | 성명·생년월일·연락처·주소가 채워진 제출 서식 | 작품 내용은 `제출-작성자료.md`와 같다 |
| `data/derived/airkorea-final-2024-daegu-urban.csv` | 에어코리아 자료는 공공누리 제3유형(변경금지)이라 추출본을 다시 배포하지 않는다 | 에어코리아 ‘최종확정 측정자료’에서 2024년 zip을 받아 `node analysis/extract-airkorea.mjs <2024.zip 경로>`. 같은 원본인지는 `data/derived`의 JSON에 적힌 SHA-256으로 확인한다. 이 파일이 없으면 `analyze.cjs`는 표 3을 건너뛴다 |
| `.wrangler/`, `.hallmark/` | Cloudflare 로그인 정보, 디자인 검사 기록 | 필요할 때 다시 생긴다 |

## 한계

대기질 자료가 2022년까지만 공개됨, 오늘의 예보는 실시간 일사량을 받지 못해 대기질 모델로 운영, 4~9월 밖의 예보는 참고용, 측정소마다 운영 기간이 다름, 공휴일 미제외, 2020년 비교는 날씨를 통제하지 않음. 자세한 내용은 사이트의 ‘데이터·방법’.
