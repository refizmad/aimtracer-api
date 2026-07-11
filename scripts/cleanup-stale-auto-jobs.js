const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();

async function main() {
  const enr = await p.matchHistoryEnrollment.findFirst();
  const tip = enr && enr.lastShareCode;
  const pending = await p.job.findMany({
    where: { source: 'auto_match_history', status: 'PENDING' },
  });
  let cancelled = 0;
  for (const j of pending) {
    if (tip && j.shareCode === tip) continue;
    await p.job.update({
      where: { id: j.id },
      data: {
        status: 'CANCELLED',
        error: 'Cancelled: stale historical auto-job (tip fixed)',
        completedAt: new Date(),
      },
    });
    cancelled += 1;
  }
  const del = await p.matchShareCode.deleteMany({ where: { jobId: null } });
  console.log(
    JSON.stringify(
      {
        tip,
        pendingBefore: pending.length,
        cancelled,
        orphansDeleted: del.count,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await p.$disconnect();
  });
