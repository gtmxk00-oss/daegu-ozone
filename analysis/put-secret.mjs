// .env.local의 키를 Cloudflare Pages 비밀값으로 넣는다(키 값은 화면에 나오지 않음).
// DATA_GO_KR_KEY(공공데이터포털)는 필수. 네이버 뉴스 검색 키(NCP_API_KEY_ID·NCP_API_KEY 또는 옛 NAVER_CLIENT_ID·NAVER_CLIENT_SECRET)는 있으면 함께 넣는다.
// 사용: 프로젝트 폴더에서 node analysis/put-secret.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrub, ROOT } from './env.mjs';

const txt = readFileSync(join(ROOT, '.env.local'), 'utf8');
const val = name => { const m = txt.match(new RegExp('^\\s*' + name + '\\s*=\\s*(.+?)\\s*$', 'm')); return m && m[1] ? m[1].replace(/^["']|["']$/g, '') : ''; };
const names = ['DATA_GO_KR_KEY', 'NCP_API_KEY_ID', 'NCP_API_KEY', 'NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'].filter(n => val(n));
if (!names.includes('DATA_GO_KR_KEY')) { console.error('.env.local에 DATA_GO_KR_KEY 값이 비어 있습니다'); process.exit(1); }
for (const name of names) {
  const key = val(name);
  await new Promise(res => {
    const p = spawn('npx', ['--yes', 'wrangler@4', 'pages', 'secret', 'put', name, '--project-name', 'daegu-ozone'], { cwd: ROOT, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.stdin.write(key + '\n'); p.stdin.end();
    p.on('close', code => { console.log(name + ':', scrub(out, key).split('\n').filter(l => l.trim()).slice(-2).join(' ').trim(), '| exit', code); res(); });
  });
}
console.log('넣은 비밀값:', names.join(', '), '(네이버 키가 없으면 뉴스는 구글 → 언론사 RSS → 저장본 순서로 보여 줍니다)');
