// .env.local에서 공공데이터포털 키를 읽는다. 키 값은 절대 출력하지 않는다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export function dataKey() {
  let txt = '';
  try { txt = readFileSync(join(ROOT, '.env.local'), 'utf8'); } catch { throw new Error('.env.local 파일이 없습니다'); }
  const m = txt.match(/^\s*DATA_GO_KR_KEY\s*=\s*(.+?)\s*$/m);
  if (!m || !m[1]) throw new Error('.env.local에 DATA_GO_KR_KEY 값이 비어 있습니다');
  return m[1].replace(/^["']|["']$/g, '');
}
// 응답이나 오류 문구에 키가 섞여 나오면 가린다
export const scrub = (s, key) => String(s).split(key).join('***').split(encodeURIComponent(key)).join('***');
