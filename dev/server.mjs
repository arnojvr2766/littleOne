// Local preview: serves the static site and an in-memory copy of the API.
// Passcode is "baby". Data resets when the server restarts.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 5173;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
const entries = new Map(), files = new Map();

// Seed from the migration so the preview matches production.
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261113070000_littleone.sql'), 'utf8');
let t = Date.now() - 100000;
for (const m of sql.matchAll(/^\('([\w-]+)', '(\w+)', '(.*)'::jsonb, 'starter'/gm)) {
  const at = new Date(t++).toISOString();
  entries.set(m[1], { id: m[1], kind: m[2], data: JSON.parse(m[3].replace(/''/g, "'")), created_by: 'starter', updated_by: null, created_at: at, updated_at: at });
}
const body = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api') {
    const action = url.searchParams.get('action'), raw = await body(req);
    const j = () => { try { return JSON.parse(raw.toString() || '{}'); } catch { return {}; } };
    if (action === 'unlock') return j().passcode === 'baby' ? send(res, 200, { token: 'dev-token' }) : send(res, 401, { error: 'That passcode is not right.' });
    if (req.headers['x-ll-token'] !== 'dev-token') return send(res, 401, { error: 'Locked' });
    const name = decodeURIComponent(req.headers['x-ll-name'] || '') || 'Someone';
    if (action === 'list') return send(res, 200, { entries: [...entries.values()], urls: Object.fromEntries([...files.keys()].map(p => [p, '/files/' + p])) });
    if (action === 'save') {
      const { entry } = j(), now = new Date().toISOString(), old = entries.get(entry.id);
      const e = { ...entry, created_by: old?.created_by ?? name, created_at: old?.created_at ?? now, updated_by: name, updated_at: now };
      entries.set(e.id, e); return send(res, 200, { entry: e });
    }
    if (action === 'delete') { entries.delete(j().id); return send(res, 200, { ok: true }); }
    if (action === 'upload') {
      const type = req.headers['content-type'], p = 'dev/' + Math.random().toString(36).slice(2) + '.' + type.split('/')[1];
      files.set(p, { type, raw }); return send(res, 200, { path: p, url: '/files/' + p, type, size: raw.length });
    }
    return send(res, 404, { error: 'Unknown action' });
  }
  if (url.pathname.startsWith('/files/')) {
    const f = files.get(url.pathname.slice(7));
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': f.type }); return res.end(f.raw);
  }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`The Little List preview: http://localhost:${port}  (passcode: baby)`));
