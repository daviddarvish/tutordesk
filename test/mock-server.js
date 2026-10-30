// Local server: serves the app and runs the real Code.gs (on mock Google services) behind POST /api
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildSeededEnv } = require('./seed');

const { env, run } = buildSeededEnv();
const ROOT = path.join(__dirname, '../app');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.argv[2] || 8765);

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        run('SETTINGS_MEMO = null');
        const out = run(`doPost(${JSON.stringify({ postData: { contents: body } })}).getContent()`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(out);
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
    });
    return;
  }
  if (req.url === '/__key') { res.end(env.props.API_KEY); return; }
  if (req.url === '/__sent') { res.end(JSON.stringify(env.sent)); return; }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('mock server on http://localhost:' + port));
