// 배포 직전에 실행: 구글 뉴스 검색 RSS를 이 컴퓨터에서 읽어 site/news-snapshot.json으로 저장한다.
// 구글이 Cloudflare 서버의 요청을 거절(HTTP 503)할 때, 사이트는 이 저장본을 '저장 시각'과 함께 보여 준다.
// 사용: node analysis/news-snapshot.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { onRequest } = await import(pathToFileURL(join(root, 'functions/api/news.js')).href);

const topics = {};
for (const topic of ['ozone', 'daegu', 'climate']) {
  const res = await onRequest({ request: new Request(`http://local/api/news?topic=${topic}`) });
  const j = await res.json();
  if (!j.ok || !j.items.length) throw new Error(`${topic}: ${j.error || '결과 없음'}`);
  topics[topic] = { label: j.label, items: j.items };
  console.log(topic, j.items.length, '건');
}
const out = join(root, 'site/news-snapshot.json');
writeFileSync(out, JSON.stringify({ saved: new Date().toISOString(), source: 'Google 뉴스 검색 RSS', topics }));
console.log('saved', out);
