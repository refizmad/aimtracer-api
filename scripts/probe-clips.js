/**
 * Diagnose clips list + media for a session token.
 * Usage: node scripts/probe-clips.js [sessionToken]
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

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
  const env = loadEnv();
  const prisma = new PrismaClient();
  const clipCount = await prisma.clip.count();
  const withUrl = await prisma.clip.count({ where: { url: { not: null } } });
  console.log('db clips', clipCount, 'with url field', withUrl);

  let token = process.argv[2];
  if (!token) {
    // use latest session if any
    const s = await prisma.session.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!s) {
      console.log('no session — pass token as argv');
      await prisma.$disconnect();
      return;
    }
    console.log('note: cannot reverse session token from hash; pass token argv');
  }

  if (token) {
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-Session-Token': token,
    };
    const list = await fetch('http://127.0.0.1:5500/clips?pageSize=3', { headers });
    const listText = await list.text();
    console.log('GET /clips', list.status, listText.slice(0, 400));

    let clips = [];
    try {
      clips = JSON.parse(listText).clips || [];
    } catch {
      /* */
    }
    if (clips[0]) {
      const media = await fetch(
        `http://127.0.0.1:5500/clips/${clips[0].id}/media`,
        { headers },
      );
      const mediaBody = await media.text();
      console.log('GET /clips/:id/media', media.status, mediaBody.slice(0, 300));
    }
  }

  // S3 env presence (no secrets printed)
  console.log('S3 configured?', !!(env.S3_ENDPOINT_URL && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY));
  console.log('NODE_ENV', env.NODE_ENV || 'unset');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
