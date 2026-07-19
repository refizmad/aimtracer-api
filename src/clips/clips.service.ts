import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Match, MatchStatus, Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  clipRowFromResultEntry,
  resolveClipOwnership,
  WorkerClipEntry,
} from './clip-ingest.util';
import { generatePublicCode, isClipUuid } from './public-code.util';
import { S3MediaService } from './s3-media.service';
import {
  AnnouncedClip,
  DiscordNotifyService,
} from './discord-notify.service';

/** Forward-only lifecycle rank; FAILED never overwrites RENDERED. */
const STATUS_RANK: Record<MatchStatus, number> = {
  DETECTED: 0,
  DOWNLOADED: 1,
  RENDERED: 2,
  FAILED: 2,
};

export type ClipListQuery = {
  /** When set, only this player's clips (GET /clips/mine). */
  playerId?: string;
  /** Filter by Steam64 of the clip owner. */
  steamId64?: string;
  map?: string;
  minKills?: number;
  /** Sidecar moment type: 2k/3k/4k/ace/clutch/… */
  type?: string;
  sort?: 'date' | 'kills' | 'score';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};

export type PublicClip = {
  id: string;
  /** Short public share slug (`/clip/:publicCode`). */
  publicCode: string;
  file: string;
  map: string | null;
  round: number | null;
  kills: number | null;
  headshots: number | null;
  clipType: string | null;
  score: number | null;
  durationS: number | null;
  /** Sidecar special-kill counts, e.g. { noscope: 2, wallbang: 1 }. */
  specials: Record<string, number> | null;
  /** Compact per-kill events from the sidecar (weapon, headshot, flags). */
  killEvents: Array<Record<string, unknown>> | null;
  playerName: string | null;
  playerSteamId: string | null;
  demoName: string | null;
  reason: string | null;
  matchDate: string | null;
  createdAt: string;
  /** Same-origin BFF path for the video media hop. */
  playUrl: string;
  /** Same-origin BFF path for the JPEG poster (convention: <file>.jpg in S3). */
  posterUrl: string;
  player: {
    id: string;
    steamId64: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
};

@Injectable()
export class ClipsService implements OnModuleInit {
  private readonly logger = new Logger(ClipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: S3MediaService,
    private readonly discord: DiscordNotifyService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.backfillMissingPublicCodes();
    await this.backfillMissingClipMatchDates();
  }

  /**
   * Turn a COMPLETED job's `result.clips[]` into Clip rows and mark its
   * Match(es) RENDERED. Upserts by `file` (the S3 key — a re-render
   * overwrites there too, so the DB mirrors that). Tolerates pre-M2 results
   * ({file,url} only) and jobs without player/match linkage (admin-created).
   *
   * A merged job serves several players of the same match; each clip is
   * attributed to its own player via the sidecar steamid
   * (resolveClipOwnership), and every linked Match advances — a player with
   * no clipworthy moments still had their match processed.
   */
  async ingestCompletedJob(job: Job): Promise<{ ingested: number }> {
    const result = job.result as { clips?: WorkerClipEntry[] } | null;
    const entries = Array.isArray(result?.clips) ? result!.clips! : [];
    const matches = await this.findJobMatches(job);
    const playerIdBySteamId = await this.mapPlayersBySteamId(entries);

    // Files that already have rows are re-renders — announce only new clips.
    const knownFiles = new Set(
      (
        await this.prisma.clip.findMany({
          where: {
            file: {
              in: entries
                .map((e) => (typeof e?.file === 'string' ? e.file : ''))
                .filter((f) => f.length > 0),
            },
          },
          select: { file: true },
        })
      ).map((c) => c.file),
    );

    let ingested = 0;
    const fresh: AnnouncedClip[] = [];
    for (const entry of entries) {
      const row = clipRowFromResultEntry(entry);
      if (!row) continue;
      const ownership = resolveClipOwnership(
        row.playerSteamId,
        job,
        matches,
        playerIdBySteamId,
      );
      const publicCode = await this.allocatePublicCode();
      const saved = await this.prisma.clip.upsert({
        where: { file: row.file },
        create: { ...row, ...ownership, publicCode },
        // Never rotate publicCode on re-render — share links must stay stable.
        update: { ...row, ...ownership },
      });
      ingested++;
      if (!knownFiles.has(row.file)) {
        fresh.push({ publicCode: saved.publicCode });
      }
    }

    // Fire-and-forget: a Discord hiccup must never fail the job report.
    void this.discord.announceNewClips(fresh).catch((e: Error) => {
      this.logger.warn(`Discord clip announcement failed: ${e.message}`);
    });

    const fromClips = entries
      .map(clipRowFromResultEntry)
      .filter((r): r is NonNullable<typeof r> => !!r);
    for (const match of matches) {
      await this.advanceMatch(match, MatchStatus.RENDERED, {
        map: fromClips.find((r) => r.map)?.map,
        demoName: fromClips.find((r) => r.demoName)?.demoName,
      });
    }
    return { ingested };
  }

  /** Mark the job's match(es) FAILED (unless already rendered earlier). */
  async markJobMatchFailed(job: Job): Promise<void> {
    for (const match of await this.findJobMatches(job)) {
      await this.advanceMatch(match, MatchStatus.FAILED);
    }
  }

  /**
   * A worker progress report past the download stage means the demo is on
   * the render box: DETECTED → DOWNLOADED. Later stages imply it too (a
   * heartbeat can skip stage strings the stdout pump never saw).
   */
  async markJobMatchDownloaded(job: Job): Promise<void> {
    for (const match of await this.findJobMatches(job)) {
      if (match.status === MatchStatus.DETECTED) {
        await this.advanceMatch(match, MatchStatus.DOWNLOADED);
      }
    }
  }

  /** playerId by steamId64 for the players named in a result's sidecars. */
  private async mapPlayersBySteamId(
    entries: WorkerClipEntry[],
  ): Promise<Map<string, string>> {
    const steamIds = [
      ...new Set(
        entries
          .map((e) => (typeof e?.player_steamid === 'string' ? e.player_steamid : ''))
          .filter((s) => s.length > 0),
      ),
    ];
    if (!steamIds.length) return new Map();
    const players = await this.prisma.player.findMany({
      where: { steamId64: { in: steamIds } },
      select: { id: true, steamId64: true },
    });
    return new Map(players.map((p) => [p.steamId64, p.id]));
  }

  /** Bulk FAILED for jobs the lease cleaner just exhausted. */
  async markMatchesFailedForJobs(jobIds: string[]): Promise<void> {
    if (!jobIds.length) return;
    await this.prisma.match.updateMany({
      where: {
        jobId: { in: jobIds },
        status: { notIn: [MatchStatus.RENDERED, MatchStatus.FAILED] },
      },
      data: { status: MatchStatus.FAILED },
    });
  }

  async listClips(q: ClipListQuery): Promise<{
    clips: PublicClip[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 24));
    const sort = q.sort ?? 'date';
    const order = q.order ?? 'desc';

    const where: Prisma.ClipWhereInput = {};
    if (q.playerId) where.playerId = q.playerId;
    if (q.steamId64) {
      where.OR = [
        { playerSteamId: q.steamId64 },
        { player: { steamId64: q.steamId64 } },
      ];
    }
    if (q.map) where.map = { equals: q.map, mode: 'insensitive' };
    if (q.type) where.clipType = { equals: q.type, mode: 'insensitive' };
    if (q.minKills != null && Number.isFinite(q.minKills)) {
      where.kills = { gte: q.minKills };
    }

    // "Newest" means the most recent MATCH first, not the most recent render:
    // ingest order scatters whenever an older game renders later (enrollment
    // seeds, retries, multi-player merges), which put stale clips on top.
    // Primary key is the denormalized clip.matchDate (nulls last — legacy /
    // admin clips sink), then ingest time, then id so same-batch ties stay
    // stable (the uuid alone is random, which shuffled same-second clips).
    const orderBy: Prisma.ClipOrderByWithRelationInput[] =
      sort === 'kills'
        ? [{ kills: order }, { createdAt: 'desc' }, { id: 'desc' }]
        : sort === 'score'
          ? [{ score: order }, { createdAt: 'desc' }, { id: 'desc' }]
          : [
              { matchDate: { sort: order, nulls: 'last' } },
              { createdAt: order },
              { id: 'desc' },
            ];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.clip.count({ where }),
      this.prisma.clip.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          player: {
            select: {
              id: true,
              steamId64: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          match: { select: { matchDate: true } },
        },
      }),
    ]);

    return {
      clips: rows.map((r) => this.toPublic(r)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Fetch one clip by short public code or internal UUID
   * (old share links with UUID still work).
   */
  async getPublicClip(idOrCode: string): Promise<PublicClip> {
    const clip = await this.findClipByIdOrCode(idOrCode);
    if (!clip) throw new NotFoundException('Clip not found');
    return this.toPublic(clip);
  }

  async getPlayableMedia(
    idOrCode: string,
    kind: 'video' | 'poster' = 'video',
  ): Promise<{
    url: string;
    source: string;
    expiresIn: number | null;
    file: string;
    kind: 'video' | 'poster';
  }> {
    const clip = await this.findClipByIdOrCode(idOrCode);
    if (!clip) throw new NotFoundException('Clip not found');
    if (kind === 'poster') {
      const posterFile = posterFileFromClip(clip.file);
      const resolved = await this.media.getPlayableUrl(posterFile, null, {
        contentType: 'image/jpeg',
        allowDevFallback: false,
      });
      return {
        url: resolved.url,
        source: resolved.source,
        expiresIn: resolved.expiresIn,
        file: posterFile,
        kind: 'poster',
      };
    }
    const resolved = await this.media.getPlayableUrl(clip.file, clip.url);
    return {
      url: resolved.url,
      source: resolved.source,
      expiresIn: resolved.expiresIn,
      file: clip.file,
      kind: 'video',
    };
  }

  private async findClipByIdOrCode(idOrCode: string) {
    const key = idOrCode.trim();
    if (!key) return null;
    const include = {
      player: {
        select: {
          id: true,
          steamId64: true,
          displayName: true,
          avatarUrl: true,
        },
      },
      match: { select: { matchDate: true } },
    } as const;

    if (isClipUuid(key)) {
      return this.prisma.clip.findUnique({ where: { id: key }, include });
    }
    return this.prisma.clip.findUnique({
      where: { publicCode: key },
      include,
    });
  }

  /** Unique short code for new clips; retries on the rare collision. */
  private async allocatePublicCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generatePublicCode();
      const existing = await this.prisma.clip.findUnique({
        where: { publicCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    // Extremely unlikely; widen length once.
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generatePublicCode(8);
      const existing = await this.prisma.clip.findUnique({
        where: { publicCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new Error('Could not allocate unique clip publicCode');
  }

  /** Safety net if migration backfill missed rows (or partial deploys). */
  private async backfillMissingPublicCodes(): Promise<void> {
    try {
      const missing = await this.prisma.clip.findMany({
        where: { publicCode: '' },
        select: { id: true },
        take: 500,
      });
      // Prisma non-null string: empty shouldn't happen. Also catch pre-migrate
      // by raw query if column exists with nulls — skip if schema enforces.
      if (!missing.length) return;
      for (const row of missing) {
        const publicCode = await this.allocatePublicCode();
        await this.prisma.clip.update({
          where: { id: row.id },
          data: { publicCode },
        });
      }
      this.logger.log(`Backfilled publicCode for ${missing.length} clip(s)`);
    } catch (e: unknown) {
      // Column missing during first boot before migrate — ignore.
      this.logger.debug(
        `publicCode backfill skipped: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * Copy Match.matchDate onto Clip.matchDate when the column is still null.
   * Migration does this once; this covers partial deploys / rows linked later.
   */
  private async backfillMissingClipMatchDates(): Promise<void> {
    try {
      const updated = await this.prisma.$executeRaw`
        UPDATE "clips" c
        SET "match_date" = m."match_date"
        FROM "matches" m
        WHERE c."match_id" = m."id" AND c."match_date" IS NULL
      `;
      if (typeof updated === 'number' && updated > 0) {
        this.logger.log(`Backfilled matchDate on ${updated} clip(s)`);
      }
    } catch (e: unknown) {
      this.logger.debug(
        `clip matchDate backfill skipped: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  private toPublic(row: {
    id: string;
    publicCode: string;
    file: string;
    map: string | null;
    round: number | null;
    kills: number | null;
    headshots: number | null;
    clipType: string | null;
    score: number | null;
    durationS: number | null;
    specials: unknown;
    killEvents: unknown;
    playerName: string | null;
    playerSteamId: string | null;
    demoName: string | null;
    reason: string | null;
    matchDate: Date | null;
    createdAt: Date;
    player: {
      id: string;
      steamId64: string;
      displayName: string | null;
      avatarUrl: string | null;
    } | null;
    match: { matchDate: Date } | null;
  }): PublicClip {
    return {
      id: row.id,
      publicCode: row.publicCode,
      file: row.file,
      map: row.map,
      round: row.round,
      kills: row.kills,
      headshots: row.headshots,
      clipType: row.clipType,
      score: row.score,
      durationS: row.durationS,
      specials: asSpecialsMap(row.specials),
      killEvents: asKillEvents(row.killEvents),
      playerName: row.playerName,
      playerSteamId: row.playerSteamId,
      demoName: row.demoName,
      reason: row.reason,
      matchDate: (row.matchDate ?? row.match?.matchDate)?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      // Media hops stay on stable internal UUID paths.
      playUrl: `/api/clips/${row.id}/media`,
      posterUrl: `/api/clips/${row.id}/media?kind=poster`,
      player: row.player,
    };
  }

  /** Every Match linked to this job (a merged job has one per player).
   * Falls back to the (playerId, shareCode) lookup for legacy rows created
   * before jobId linking. */
  private async findJobMatches(job: Job): Promise<Match[]> {
    const byJob = await this.prisma.match.findMany({ where: { jobId: job.id } });
    if (byJob.length) return byJob;
    if (!job.playerId || !job.shareCode) return [];
    const legacy = await this.prisma.match.findUnique({
      where: {
        playerId_shareCode: {
          playerId: job.playerId,
          shareCode: job.shareCode,
        },
      },
    });
    return legacy ? [legacy] : [];
  }

  /** Forward-only status update; also fills map/demoName when learned. */
  private async advanceMatch(
    match: Match,
    to: MatchStatus,
    learned?: { map?: string; demoName?: string },
  ): Promise<void> {
    const forward =
      STATUS_RANK[to] > STATUS_RANK[match.status] ||
      // RENDERED may overwrite a FAILED left by an earlier attempt.
      (to === MatchStatus.RENDERED && match.status === MatchStatus.FAILED);
    await this.prisma.match.update({
      where: { id: match.id },
      data: {
        status: forward ? to : undefined,
        map: match.map ?? learned?.map,
        demoName: match.demoName ?? learned?.demoName,
      },
    });
  }
}

/** Poster object basename convention: same as the mp4 with .jpg. */
export function posterFileFromClip(file: string): string {
  return file.replace(/\.mp4$/i, '.jpg');
}

/** Sidecar specials JSON → plain count map (drop garbage shapes). */
function asSpecialsMap(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

/** Sidecar kill_events JSON → list of plain objects. */
function asKillEvents(v: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: Array<Record<string, unknown>> = [];
  for (const item of v) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      out.push(item as Record<string, unknown>);
    }
  }
  return out.length ? out : null;
}
