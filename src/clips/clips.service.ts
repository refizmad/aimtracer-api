import { Injectable, Logger } from '@nestjs/common';
import { Job, Match, MatchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { clipRowFromResultEntry, WorkerClipEntry } from './clip-ingest.util';

/** Forward-only lifecycle rank; FAILED never overwrites RENDERED. */
const STATUS_RANK: Record<MatchStatus, number> = {
  DETECTED: 0,
  DOWNLOADED: 1,
  RENDERED: 2,
  FAILED: 2,
};

@Injectable()
export class ClipsService {
  private readonly logger = new Logger(ClipsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
}
