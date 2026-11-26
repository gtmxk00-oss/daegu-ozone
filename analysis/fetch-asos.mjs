// 기상청 지상(종관, ASOS) 시간자료 조회서비스에서 대구(지점 143) 2018~2022년 시간자료를 받아 data/raw에 CSV로 저장한다.
// 출처: 공공데이터포털 https://www.data.go.kr/data/15057210/openapi.do (기상청, 이용허락범위 제한 없음)
// 사용: node analysis/fetch-asos.mjs   (키는 .env.local의 DATA_GO_KR_KEY, 출력하지 않음)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataKey, scrub, ROOT } from './env.mjs';

const key = dataKey();
const COLS = ['tm', 'ta', 'rn', 'ws', 'wd', 'hm', 'td', 'pa', 'ss', 'icsr', 'dc10Tca', 'vs'];
const pad = n => String(n).padStart(2, '0');
const rows = [];
for (let y = 2018; y <= 2022; y++) {
  for (let m = 1; m <= 12; m++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const q = new URLSearchParams({ serviceKey: key, pageNo: 1, numOfRows: 999, dataType: 'JSON', dataCd: 'ASOS', dateCd: 'HR', startDt: `${y}${pad(m)}01`, startHh: '00', endDt: `${y}${pad(m)}${pad(last)}`, endHh: '23', stnIds: '143' });
    let items = null;
    for (let attempt = 1; attempt <= 4 && !items; attempt++) {
      try {
        const r = await fetch('https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList?' + q);
        const j = JSON.parse(await r.text());
        if (j.response?.header?.resultCode !== '00') throw new Error(j.response?.header?.resultMsg || 'bad response');
        items = j.response.body.items.item;
      } catch (e) { console.log(`${y}-${pad(m)} 재시도 ${attempt}: ${scrub(e.message, key)}`); await new Promise(r => setTimeout(r, 1500 * attempt)); }
    }
    if (!items) throw new Error(`${y}-${pad(m)} 받지 못함`);
    for (const it of items) rows.push(COLS.map(c => it[c] ?? ''));
    console.log(`${y}-${pad(m)} ${items.length}행`);
  }
}
mkdirSync(join(ROOT, 'data/raw'), { recursive: true });
const out = join(ROOT, 'data/raw/kma-asos-143-daegu-hourly-2018-2022.csv');
writeFileSync(out, '﻿' + [COLS.join(','), ...rows.map(r => r.join(','))].join('\n'));
console.log('saved', rows.length, 'rows ->', out);
