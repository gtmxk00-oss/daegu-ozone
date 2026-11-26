// 키가 두 서비스에서 동작하는지 확인한다(키 값은 출력하지 않음). 사용: node analysis/check-keys.mjs
import { dataKey, scrub } from './env.mjs';

const key = dataKey();
console.log('key length', key.length, '| looks encoded:', /%[0-9A-F]{2}/i.test(key));
const tests = {
  asos: 'https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList?' + new URLSearchParams({ serviceKey: key, pageNo: 1, numOfRows: 3, dataType: 'JSON', dataCd: 'ASOS', dateCd: 'HR', startDt: '20220601', startHh: '01', endDt: '20220601', endHh: '03', stnIds: '143' }),
  airkorea: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?' + new URLSearchParams({ serviceKey: key, returnType: 'json', numOfRows: 100, pageNo: 1, sidoName: '대구', ver: '1.0' }),
};
for (const [name, url] of Object.entries(tests)) {
  try {
    const r = await fetch(url);
    const t = await r.text();
    let summary;
    try {
      const j = JSON.parse(t);
      const h = j.response?.header || {};
      const items = j.response?.body?.items;
      const arr = Array.isArray(items) ? items : items?.item || [];
      summary = `code ${h.resultCode} ${h.resultMsg} | items ${arr.length} | first ${JSON.stringify(arr[0] || {}).slice(0, 220)}`;
    } catch { summary = 'not JSON: ' + t.slice(0, 200); }
    console.log(name, 'HTTP', r.status, '|', scrub(summary, key));
  } catch (e) { console.log(name, 'ERROR', scrub(e.message, key)); }
}
