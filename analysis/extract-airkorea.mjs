// 에어코리아 최종확정 측정자료(연도별 zip, 전국)에서 대구 도시대기 측정소 행만 뽑아 data/derived에 CSV로 저장한다.
// 원본: https://www.airkorea.or.kr/web/last_amb_hour_data?pMENU_NO=123 (환경부·한국환경공단). 원본 zip은 약 350MB라 프로젝트에 두지 않고,
// 파일 이름·크기·SHA-256을 함께 적어 같은 원본에서 다시 만들 수 있게 한다. 읽기 코드는 사이트의 '내 데이터 분석'과 같은 site/ozone-files.js.
// 사용: node analysis/extract-airkorea.mjs <2024.zip 경로> [연도]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { ROOT } from './env.mjs';

const require = createRequire(import.meta.url);
const Files = require('../site/ozone-files.js');
const [zipPath, yearArg] = process.argv.slice(2);
if (!zipPath) { console.error('사용: node analysis/extract-airkorea.mjs <zip 경로> [연도]'); process.exit(2); }
const buf = readFileSync(zipPath);
const sha256 = createHash('sha256').update(buf).digest('hex');
const t0 = Date.now();
const tables = await Files.readAny(new Blob([buf]), basename(zipPath), { daeguOnly: true });
const header = tables.find(t => t.header.length)?.header || [];
const rows = tables.flatMap(t => t.rows);
const year = yearArg || (rows[0] && String(rows[0][header.indexOf('측정일시')]).slice(0, 4));
const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
mkdirSync(join(ROOT, 'data', 'derived'), { recursive: true });
const out = join(ROOT, 'data', 'derived', `airkorea-final-${year}-daegu-urban.csv`);
writeFileSync(out, '﻿' + [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n');
const meta = {
  title: `에어코리아 최종확정 측정자료 ${year}년(대구 도시대기 측정소만 추출)`, provider: '환경부·한국환경공단(에어코리아)',
  url: 'https://www.airkorea.or.kr/web/last_amb_hour_data?pMENU_NO=123',
  sourceFile: basename(zipPath), sourceBytes: buf.length, sourceSha256: sha256,
  monthlyFiles: tables.map(t => ({ name: t.name, rowsNationwide: t.total, rowsKept: t.rows.length })),
  filter: "지역이 '대구'로 시작하고 망이 '도시대기'인 행", extractedWith: 'site/ozone-files.js', extractedAt: new Date().toISOString().slice(0, 10),
};
writeFileSync(out.replace(/\.csv$/, '.json'), JSON.stringify(meta, null, 2));
console.log('saved', out, rows.length, 'rows', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'sha256', sha256.slice(0, 16));
