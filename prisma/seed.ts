import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  // Create a sample worker for local development.
  const token = process.env.SEED_WORKER_TOKEN || 'dev_machine_token_please_change';

  const worker = await prisma.worker.upsert({
    where: { machineToken: token },
    update: { name: 'local-dev-worker' },
    create: {
      name: 'local-dev-worker',
      machineToken: token,
      enabled: true,
    },
  });

  console.log('Seeded worker:', worker.id, worker.name);
  console.log('Use header: X-Machine-Token:', token);

  // Friends-only: seed a reusable-ish dev invite if none exist
  const existingInvite = await prisma.invite.findFirst();
  if (!existingInvite) {
    const code =
      process.env.SEED_INVITE_CODE ||
      crypto.randomBytes(6).toString('hex').toUpperCase();
    const invite = await prisma.invite.create({
      data: {
        code,
        note: 'local-dev seed invite',
        maxUses: 25,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    console.log('');
    console.log('=== Friends invite (share this link) ===');
    console.log(`  code: ${invite.code}`);
    console.log(`  path: /invite/${invite.code}`);
    console.log('=======================================');
  } else {
    console.log('Invite already exists:', existingInvite.code, `(uses ${existingInvite.useCount}/${existingInvite.maxUses})`);
  }

  // Optionally seed a demo job if SEED_SAMPLE_JOB=1
  if (process.env.SEED_SAMPLE_JOB === '1') {
    const existing = await prisma.job.findFirst({ where: { type: 'clip' } });
    if (!existing) {
      const job = await prisma.job.create({
        data: {
          type: 'clip',
          payload: {
            shareCode: 'CSGO-DEMO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX',
            trustedSteamIds: ['76561198000000000'],
            options: { minKills: 4, limit: 0 },
          },
          maxAttempts: 5,
        },
      });
      console.log('Seeded sample pending job:', job.id);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
