import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Job, Match, MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { clipRowFromResultEntry, WorkerClipEntry } from './clip-ingest.util';
import { S3MediaService } from './s3-media.service';

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
  file: string;
  map: string | null;
  round: number | null;
  kills: number | null;
  headshots: number | null;
  clipType: string | null;
  score: number | null;
  durationS: number | null;
  playerName: string | null;
  playerSteamId: string | null;
  demoName: string | null;
  reason: string | null;
  matchDate: string | null;
  createdAt: string;
  /** Same-origin BFF path the web app should use as <video src>. */
  playUrl: string;
  player: {
    id: string;
    steamId64: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
};

@Injectable()
export class ClipsService {
  private readonly logger = new Logger(ClipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: S3MediaService,
  ) {}

  /**
   * Turn a COMPLETED job's `result.clips[]` into Clip rows and mark its Match
   * RENDERED. Upserts by `file` (the S3 key — a re-render overwrites there
   * too, so the DB mirrors that). Tolerates pre-M2 results ({file,url} only)
   * and jobs without player/match linkage (admin-created).
   */
  async ingestCompletedJob(job: Job): Promise<{ ingested: number }> {
    const result = job.result as { clips?: WorkerClipEntry[] } | null;
    const entries = Array.isArray(result?.clips) ? result!.clips! : [];
    const match = await this.findJobMatch(job);

    let ingested = 0;
    for (const entry of entries) {
      const row = clipRowFromResultEntry(entry);
      if (!row) continue;
      const ownership = {
        playerId: job.playerId,
        matchId: match?.id ?? null,
        jobId: job.id,
      };
      await this.prisma.clip.upsert({
        where: { file: row.file },
        create: { ...row, ...ownership },
        update: { ...row, ...ownership },
      });
      ingested++;
    }

    if (match) {
      const fromClips = entries
        .map(clipRowFromResultEntry)
        .filter((r): r is NonNullable<typeof r> => !!r);
      await this.advanceMatch(match, MatchStatus.RENDERED, {
        map: fromClips.find((r) => r.map)?.map,
        demoName: fromClips.find((r) => r.demoName)?.demoName,
      });
    }
    return { ingested };
  }

  /** Mark the job's match FAILED (unless it already rendered earlier). */
  async markJobMatchFailed(job: Job): Promise<void> {
    const match = await this.findJobMatch(job);
    if (match) await this.advanceMatch(match, MatchStatus.FAILED);
  }

  /**
   * A worker progress report past the download stage means the demo is on
   * the render box: DETECTED → DOWNLOADED. Later stages imply it too (a
   * heartbeat can skip stage strings the stdout pump never saw).
   */
  async markJobMatchDownloaded(job: Job): Promise<void> {
    const match = await this.findJobMatch(job);
    if (match && match.status === MatchStatus.DETECTED) {
      await this.advanceMatch(match, MatchStatus.DOWNLOADED);
    }
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

    const orderBy: Prisma.ClipOrderByWithRelationInput[] =
      sort === 'kills'
        ? [{ kills: order }, { createdAt: 'desc' }]
        : sort === 'score'
          ? [{ score: order }, { createdAt: 'desc' }]
          : [{ createdAt: order }];

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

  async getPublicClip(id: string): Promise<PublicClip> {
    const clip = await this.prisma.clip.findUnique({
      where: { id },
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
    });
    if (!clip) throw new NotFoundException('Clip not found');
    return this.toPublic(clip);
  }

  async getPlayableMedia(id: string): Promise<{
    url: string;
    source: string;
    expiresIn: number | null;
    file: string;
  }> {
    const clip = await this.prisma.clip.findUnique({ where: { id } });
    if (!clip) throw new NotFoundException('Clip not found');
    const resolved = await this.media.getPlayableUrl(clip.file, clip.url);
    return {
      url: resolved.url,
      source: resolved.source,
      expiresIn: resolved.expiresIn,
      file: clip.file,
    };
  }

  private toPublic(row: {
    id: string;
    file: string;
    map: string | null;
    round: number | null;
    kills: number | null;
    headshots: number | null;
    clipType: string | null;
    score: number | null;
    durationS: number | null;
    playerName: string | null;
    playerSteamId: string | null;
    demoName: string | null;
    reason: string | null;
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
      file: row.file,
      map: row.map,
      round: row.round,
      kills: row.kills,
      headshots: row.headshots,
      clipType: row.clipType,
      score: row.score,
      durationS: row.durationS,
      playerName: row.playerName,
      playerSteamId: row.playerSteamId,
      demoName: row.demoName,
      reason: row.reason,
      matchDate: row.match?.matchDate?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      playUrl: `/api/clips/${row.id}/media`,
      player: row.player,
    };
  }

  private async findJobMatch(job: Job): Promise<Match | null> {
    if (!job.playerId || !job.shareCode) return null;
    return this.prisma.match.findUnique({
      where: {
        playerId_shareCode: {
          playerId: job.playerId,
          shareCode: job.shareCode,
        },
      },
    });
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
