// 예약 작업(Cloudflare Worker, 10분마다): 공개 사이트의 서버 함수를 불러 저장값을 새로 고친다.
// 방문자가 아무도 없어도 기온·바람·일사량(api/wx), 실시간 오존(api/air?mode=now), 예보용 48시간 값(api/air?mode=hist)이 최신으로 유지된다.
// 각 함수는 스스로 저장 기간을 지키므로(날씨 10분, 오존 20분, 예보용 3시간) 자주 불러도 원 출처 호출 수는 늘지 않는다.
const BASE = 'https://daegu-ozone.pages.dev';
const PATHS = ['/api/wx', '/api/air?mode=now', '/api/air?mode=hist'];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.allSettled(PATHS.map(p => fetch(BASE + p, { headers: { 'User-Agent': 'daegu-ozone-cron' } }).then(r => r.text()))));
  },
};
