/**
 * Dev-only fixture seed: realistic Players / Matches / Jobs / Clips built from
 * real clipper metadata (prisma/fixtures/clips.json, assembled from cs2-clip's
 * clips_manifest.json with X-Amz-* query strings stripped).
 *
 * Bucket stays private (ADR-0004): fixture `url` values are bare object URLs
 * for gallery layout only — they will not stream without a real signed GET.
 * M1 adds API-issued presigns for playback; until then, UI work can mock the
 * video element or point at any public sample mp4 if needed.
 *
 * Clips are ingested through the same mapping the worker-report path uses
 * (clipRowFromResultEntry), so the fixtures exercise the production contract
 * instead of a parallel hand-rolled insert.
 *
 * Idempotent: upserts by natural keys. Run: npm run db:seed:fixtures
 */
import { PrismaClient, JobStatus, JobSource, MatchStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { clipRowFromResultEntry, WorkerClipEntry } from '../src/clips/clip-ingest.util';

const prisma = new PrismaClient();

interface FixtureEntry extends WorkerClipEntry {
  file: string;
  demo?: string;
  player?: string;
  player_steamid?: string;
}

async function main() {
  const fixturePath = path.join(__dirname, 'fixtures', 'clips.json');
  const entries: FixtureEntry[] = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  // --- Players: one per distinct steamid, named from the sidecar data.
  const bySteamId = new Map<string, FixtureEntry[]>();
  for (const e of entries) {
    if (!e.player_steamid || !e.file) continue;
    const list = bySteamId.get(String(e.player_steamid)) ?? [];
    list.push(e);
    bySteamId.set(String(e.player_steamid), list);
  }

  const playerIds = new Map<string, string>();
  for (const [steamId64, list] of bySteamId) {
    const player = await prisma.player.upsert({
      where: { steamId64 },
      update: { displayName: String(list[0].player ?? steamId64) },
      create: {
        steamId64,
        displayName: String(list[0].player ?? steamId64),
      },
    });
    playerIds.set(steamId64, player.id);
  }

  // --- Matches + completed Jobs: one per (player, demo). Fixture share codes
  // are clearly synthetic; match dates are staggered over recent weeks so
  // date sorting/filtering has something to bite on.
  const demos = [...new Set(entries.map((e) => String(e.demo)))].sort();
  const demoDate = new Map<string, Date>();
  demos.forEach((demo, i) => {
    const daysAgo = (demos.length - 1 - i) * 2.5;
    demoDate.set(demo, new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
  });

  let clipCount = 0;
  for (const [steamId64, list] of bySteamId) {
    const playerId = playerIds.get(steamId64)!;
    const byDemo = new Map<string, FixtureEntry[]>();
    for (const e of list) {
      const demo = String(e.demo);
      byDemo.set(demo, [...(byDemo.get(demo) ?? []), e]);
    }

    for (const [demo, demoClips] of byDemo) {
      const matchId = demo.replace(/^match_/, '').replace(/\.dem$/, '');
      const shareCode = `FIXTURE-${matchId.slice(-10)}`;
      const matchDate = demoDate.get(demo)!;
      const map = demoClips.find((e) => e.map)?.map as string | undefined;

      const job = await prisma.job.create({
        data: {
          type: 'clip',
          source: JobSource.auto_match_history,
          status: JobStatus.COMPLETED,
          progress: 100,
          stage: 'done',
          playerId,
          shareCode,
          payload: {
            shareCode,
            trustedSteamIds: [steamId64],
            options: { minKills: 4 },
          },
          result: { shareCode, exitCode: 0, clips: demoClips as any },
          completedAt: matchDate,
          createdAt: matchDate,
        },
      });

      const match = await prisma.match.upsert({
        where: { playerId_shareCode: { playerId, shareCode } },
        update: { jobId: job.id, status: MatchStatus.RENDERED },
        create: {
          playerId,
          shareCode,
          jobId: job.id,
          status: MatchStatus.RENDERED,
          map: map ?? null,
          demoName: demo,
          matchDate,
          discoveredAt: matchDate,
        },
      });

      for (const entry of demoClips) {
        const row = clipRowFromResultEntry(entry);
        if (!row) continue;
        await prisma.clip.upsert({
          where: { file: row.file },
          update: { ...row, playerId, matchId: match.id, jobId: job.id },
          create: {
            ...row,
            playerId,
            matchId: match.id,
            jobId: job.id,
            createdAt: matchDate,
          },
        });
        clipCount++;
      }
    }
  }

  console.log(
    `Seeded fixtures: ${bySteamId.size} players, ${demos.length} demos, ${clipCount} clips`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
