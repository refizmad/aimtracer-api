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

async function main() {
  const token = loadEnv().ADMIN_TOKEN;
  const headers = {
    'X-Admin-Token': token,
    'Content-Type': 'application/json',
  };

  const r = await fetch('http://127.0.0.1:5500/admin/setup', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workerName: 'probe-pc',
      publicApiUrl: 'https://api.example.com',
    }),
  });
  const text = await r.text();
  console.log('status', r.status);
  console.log(text.slice(0, 500));
  const j = JSON.parse(text);
  if (j.invite) {
    console.error('FAIL: setup should not create invites');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
