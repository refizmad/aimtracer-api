const fs = require('fs');
const path = require('path');

function loadEnv() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const map = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return map;
}

async function probe(base, token) {
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const cookies = login.headers.getSetCookie ? login.headers.getSetCookie() : [];
  console.log(base, 'login', login.status, 'cookies', cookies.map((c) => c.split('=')[0]));
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  const r = await fetch(`${base}/api/admin/stats`, { headers: { Cookie: cookie } });
  const t = await r.text();
  console.log(base, 'stats', r.status, t.slice(0, 200));
}

(async () => {
  const token = loadEnv().ADMIN_TOKEN;
  for (const base of ['http://127.0.0.1:3001', 'http://127.0.0.1:3000']) {
    try {
      await probe(base, token);
    } catch (e) {
      console.log(base, 'error', e.message);
    }
  }
})();
