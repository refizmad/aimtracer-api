/**
 * Smoke-test admin endpoints using ADMIN_TOKEN from .env (never prints the token).
 */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  const raw = fs.readFileSync(p, 'utf8');
  const map = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return map;
}

async function main() {
  const env = loadEnv();
  const token = env.ADMIN_TOKEN;
  if (!token) throw new Error('ADMIN_TOKEN missing in .env');

  const headers = {
    'X-Admin-Token': token,
    'X-Bootstrap-Token': token,
  };

  const bad = await fetch('http://127.0.0.1:5500/admin/stats');
  console.log('no-token status', bad.status);

  const wrong = await fetch('http://127.0.0.1:5500/admin/stats', {
    headers: { 'X-Admin-Token': 'definitely-wrong' },
  });
  console.log('wrong-token status', wrong.status);

  const stats = await fetch('http://127.0.0.1:5500/admin/stats', { headers });
  const s = await stats.json();
  console.log('stats', stats.status, {
    clips: s.totals?.clipsRendered,
    demos: s.totals?.demosDownloaded,
    players: s.totals?.players,
    storage: s.totals?.storageHuman,
  });

  for (const path of ['jobs?failedOnly=1', 'players', 'workers', 'invites']) {
    const r = await fetch(`http://127.0.0.1:5500/admin/${path}`, { headers });
    const j = await r.json();
    const key = Object.keys(j).find((k) => Array.isArray(j[k])) || 'ok';
    console.log(path, r.status, key, Array.isArray(j[key]) ? j[key].length : '');
  }

  // BFF login + proxy (dev server on 3001 preferred)
  const base = process.env.WEB || 'http://127.0.0.1:3001';
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const setCookie = login.headers.getSetCookie?.() || [];
  const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
  console.log('bff login', login.status, 'cookie set', cookieHeader.includes('aimtrace_admin'));

  const bffStats = await fetch(`${base}/api/admin/stats`, {
    headers: { Cookie: cookieHeader },
  });
  const bs = await bffStats.json();
  console.log('bff stats', bffStats.status, 'clips', bs.totals?.clipsRendered);

  const page = await fetch(`${base}/admin`);
  console.log('admin page', page.status, 'len', (await page.text()).length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
