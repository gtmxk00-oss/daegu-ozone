// 에어코리아 대구 측정소 목록과 측정소별 48시간 자료 형식을 확인한다(키 출력 없음). 사용: node analysis/probe-airkorea.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataKey, scrub, ROOT } from './env.mjs';

const key = dataKey();
const base = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/';
const get = async (op, params) => {
  const r = await fetch(base + op + '?' + new URLSearchParams({ serviceKey: key, returnType: 'json', ...params }));
  const j = JSON.parse(await r.text());
  if (j.response?.header?.resultCode !== '00') throw new Error(scrub(JSON.stringify(j.response?.header), key));
  return j.response.body;
};
const sido = await get('getCtprvnRltmMesureDnsty', { numOfRows: 100, pageNo: 1, sidoName: '대구', ver: '1.0' });
const names = sido.items.map(x => x.stationName);
console.log('airkorea daegu stations', names.length, names.join(' '));
console.log('sample row keys', Object.keys(sido.items[0]).join(','));
console.log('dataTime', sido.items[0].dataTime);

const D = readFileSync(join(ROOT, 'site/data.js'), 'utf8');
const trained = [...new Set([...D.matchAll(/"name":"([^"]+)"/g)].map(m => m[1]))];
console.log('trained stations', trained.length, trained.join(' '));
console.log('in both', names.filter(n => trained.includes(n)).join(' '));
console.log('airkorea only', names.filter(n => !trained.includes(n)).join(' '));

const st = await get('getMsrstnAcctoRltmMesureDnsty', { numOfRows: 48, pageNo: 1, stationName: names[0], dataTerm: 'MONTH', ver: '1.0' });
console.log('station', names[0], 'rows', st.items.length, 'first', st.items[0].dataTime, 'last', st.items.at(-1).dataTime, 'total', st.totalCount);
console.log('station row', JSON.stringify(st.items[0]).slice(0, 300));
