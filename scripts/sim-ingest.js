/**
 * Simulate a worker COMPLETED report and verify Clip/Match ingestion (M2).
 * Does not hit S3 or Steam. Uses a disposable player + share code.
 */
const { PrismaClient, JobStatus, JobSource, MatchStatus } = require('@prisma/client');
// nest build emits under dist/src (see package layout).
const { ClipsService } = require('../dist/src/clips/clips.service');
const { S3MediaService } = require('../dist/src/clips/s3-media.service');
const { ConfigService } = require('@nestjs/config');

const prisma = new PrismaClient();

async function main() {
  const steamId64 = '76561197999999999';
  const shareCode = 'CSGO-SIMTEST-M2-INGEST-AAAAA';

  const player = await prisma.player.upsert({
    where: { steamId64 },
    update: { displayName: 'sim-ingest' },
    create: { steamId64, displayName: 'sim-ingest' },
  });

  // Clean prior sim rows
  await prisma.clip.deleteMany({ where: { file: { startsWith: 'sim_ingest_' } } });
  await prisma.match.deleteMany({ where: { shareCode } });
  await prisma.job.deleteMany({ where: { shareCode } });

  const job = await prisma.job.create({
    data: {
      type: 'clip',
      source: JobSource.manual,
      status: JobStatus.COMPLETED,
      progress: 100,
      stage: 'done',
      playerId: player.id,
      shareCode,
      payload: {
        shareCode,
        trustedSteamIds: [steamId64],
        options: { minKills: 4 },
      },
      result: {
        shareCode,
        exitCode: 0,
        clips: [
          {
            file: 'sim_ingest_4k_mirage_001.mp4',
            url: 'https://example.invalid/sim_ingest_4k_mirage_001.mp4',
            sizeBytes: 12345,
            type: '4k',
            map: 'de_mirage',
            kills: 4,
            headshots: 2,
            score: 200,
            duration_s: 11,
            player: 'sim-ingest',
            player_steamid: steamId64,
            demo: 'match_sim.dem',
          },
        ],
      },
      completedAt: new Date(),
    },
  });

  await prisma.match.create({
    data: {
      playerId: player.id,
      shareCode,
      jobId: job.id,
      status: MatchStatus.DOWNLOADED,
      matchDate: new Date(),
    },
  });

  // Use the same service path as the worker report handler
  const media = new S3MediaService(new ConfigService());
  const clipsService = new ClipsService(prisma, media);
  const { ingested } = await clipsService.ingestCompletedJob(job);

  const clip = await prisma.clip.findUnique({
    where: { file: 'sim_ingest_4k_mirage_001.mp4' },
  });
  const match = await prisma.match.findUnique({
    where: { playerId_shareCode: { playerId: player.id, shareCode } },
  });

  console.log(
    JSON.stringify(
      {
        ingested,
        clip: clip && {
          file: clip.file,
          map: clip.map,
          kills: clip.kills,
          clipType: clip.clipType,
          score: clip.score,
          matchId: clip.matchId,
        },
        matchStatus: match?.status,
      },
      null,
      2,
    ),
  );

  if (ingested !== 1 || !clip || clip.kills !== 4 || match?.status !== 'RENDERED') {
    throw new Error('sim-ingest acceptance failed');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
