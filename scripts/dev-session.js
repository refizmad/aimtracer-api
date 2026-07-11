/**
 * Mint a long-lived session cookie value for a fixture/dev player so local
 * gallery UI can be verified without Steam OpenID.
 *
 * Usage:
 *   node scripts/dev-session.js
 *   node scripts/dev-session.js 76561198119019050
 *
 * Then in the browser (localhost:3000):
 *   document.cookie = "aimtrace_session=<token>; path=/";
 *   location.href = "/clips";
 */
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function randomToken(prefix, bytes = 32) {
  return prefix + crypto.randomBytes(bytes).toString('base64url');
}

async function main() {
  const steamArg = process.argv[2];
  let player = steamArg
    ? await prisma.player.findUnique({ where: { steamId64: steamArg } })
    : await prisma.player.findFirst({
        where: { clips: { some: {} } },
        orderBy: { createdAt: 'asc' },
      });

  if (!player) {
    throw new Error(
      'No player found. Run npm run db:seed:fixtures first, or pass a steamId64.',
    );
  }

  const sessionToken = randomToken('st_', 32);
  await prisma.session.create({
    data: {
      tokenHash: sha256Hex(sessionToken),
      playerId: player.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  console.log(JSON.stringify({
    player: {
      id: player.id,
      steamId64: player.steamId64,
      displayName: player.displayName,
    },
    sessionToken,
    cookieHint: `document.cookie = "aimtrace_session=${sessionToken}; path=/"; location.href = "/clips";`,
  }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
