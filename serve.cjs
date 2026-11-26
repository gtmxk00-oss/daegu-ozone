// 로컬 미리보기: node serve.cjs → http://127.0.0.1:8796
// /api/news, /api/air, /api/wx는 배포용 Cloudflare Pages Function(functions/api/*.js)을 그대로 불러 실행한다.
// /api/air의 키는 .env.local의 DATA_GO_KR_KEY를 쓴다(배포본은 Cloudflare 비밀값).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, 'site');
const PORT = Number(process.env.OZONE_PORT || 8796);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const FNS = { '/api/news': 'news.js', '/api/air': 'air.js', '/api/wx': 'wx.js' };
const loaded = {};
const env = (() => {
  try {
    const t = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8'), out = {};
    for (const n of ['DATA_GO_KR_KEY', 'NCP_API_KEY_ID', 'NCP_API_KEY', 'NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET']) { const m = t.match(new RegExp('^\\s*' + n + '\\s*=\\s*(.+?)\\s*$', 'm')); if (m && m[1]) out[n] = m[1]; }
    return out;
  } catch { return {}; }
})();

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  if (FNS[url.pathname]) {
    try {
      loaded[url.pathname] = loaded[url.pathname] || await import(pathToFileURL(path.join(__dirname, 'functions', 'api', FNS[url.pathname])).href);
      const r = await loaded[url.pathname].onRequest({ request: new Request(url.href), env, waitUntil: p => { Promise.resolve(p).catch(() => {}); } });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(await r.text());
    } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: e.message })); }
  }
  const p = decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('http://127.0.0.1:' + PORT));
