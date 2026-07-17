import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Job, JobSource, JobStatus, MatchStatus, Prisma } from '../prisma/client';
import { ConfigService } from '@nestjs/config';
import { normalizeShareCode } from '../common/sharecode.util';
import { ClipsService } from '../clips/clips.service';
import { ClipJobPayload, withTrustedSteamId } from './job-payload.util';

/** Worker stages that imply the demo reached the render box (anything past
 * download). Keep in sync with cs2-clip worker.py STAGE_MARKERS. */
const STAGES_PAST_DOWNLOAD = new Set(['parse', 'render', 'encode', 'upload', 'done']);

export interface LeaseResult {
  job: Job | null;
}

@Injectable()
export class JobsService {
  private readonly visibilityTimeoutMs: number;
  private readonly maxWaitMs: number;

  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly clips: ClipsService,
  ) {
    const visibilitySec = this.config.get<number>('LEASE_VISIBILITY_TIMEOUT', 300);
    this.visibilityTimeoutMs = visibilitySec * 1000;

    const maxWaitSec = this.config.get<number>('MAX_LEASE_WAIT_SECONDS', 25);
    this.maxWaitMs = maxWaitSec * 1000;
  }

  /**
   * Core leasing logic using Postgres SELECT ... FOR UPDATE SKIP LOCKED.
   * Handles both fresh pending jobs and expired leases (visibility timeout + retry).
   */
  async leaseNextJob(workerId: string): Promise<Job | null> {
    const now = new Date();

    // Opportunistic cleanup on every lease attempt (very cheap for low volume)
    // In production you can also run this from a lightweight cron/scheduler.
    if (Math.random() < 0.1) {
      this.cleanupStaleLeases().catch(() => {});
    }

    // Atomic claim using CTE + FOR UPDATE SKIP LOCKED.
    // Only consider jobs that still have attempts remaining.
    // This + visibility-timeout + maxAttempts is your full lease/retry impl.
    const result = await this.prisma.$queryRaw<
      Array<{
        id: string;
      }>
    >(Prisma.sql`
      WITH candidate AS (
        SELECT id
        FROM "jobs"
        WHERE 
          attempts < "maxAttempts"
          AND (
            status = 'PENDING'
            OR (
              -- PROCESSING too: the worker's first heartbeat moves a job past
              -- LEASED, so a worker that dies mid-render leaves it PROCESSING
              -- with a lapsed lease.
              status IN ('LEASED', 'PROCESSING')
              AND "lease_expires_at" IS NOT NULL
              AND "lease_expires_at" < ${now}
            )
          )
        ORDER BY "created_at" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "jobs" j
      SET 
        status = 'LEASED',
        "leased_by" = ${workerId},
        "leased_at" = ${now},
        "lease_expires_at" = ${new Date(now.getTime() + this.visibilityTimeoutMs)},
        attempts = attempts + 1,
        "updated_at" = ${now}
      FROM candidate
      WHERE j.id = candidate.id
      RETURNING j.id
    `);

    if (!result.length) {
      return null;
    }

    // Fetch full job after update (to return complete object)
    return this.prisma.job.findUnique({ where: { id: result[0].id } });
  }

  /**
   * Long-poll wrapper. Worker can pass wait=30 to block up to ~30s.
   */
  async leaseJobWithWait(
    workerId: string,
    waitSeconds = 0,
  ): Promise<Job | null> {
    const start = Date.now();
    const maxWait = Math.min(waitSeconds * 1000, this.maxWaitMs);
    let job = await this.leaseNextJob(workerId);

    if (job || maxWait <= 0) {
      return job;
    }

    // Simple polling loop for long-poll (low volume, acceptable)
    const pollInterval = 1200; // 1.2s
    while (Date.now() - start < maxWait) {
      await this.sleep(pollInterval);
      job = await this.leaseNextJob(workerId);
      if (job) return job;

      // Also opportunistically release any fully expired leases that weren't picked
      // (defensive; the next lease will catch them anyway)
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async updateJobProgress(
    jobId: string,
    workerId: string,
    dto: {
      progress?: number;
      stage?: string;
      message?: string;
      status?: 'PROCESSING' | 'COMPLETED' | 'FAILED';
      result?: any;
      error?: string;
    },
  ): Promise<Job> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    // Basic authorization: only the current lease holder (or allow if already completed)
    const isLeaseHolder = job.leasedBy === workerId;
    const leaseValid =
      job.leaseExpiresAt && job.leaseExpiresAt.getTime() > Date.now();

    if (!isLeaseHolder && job.status !== 'COMPLETED' && job.status !== 'FAILED') {
      throw new BadRequestException('Not authorized to update this job (lease mismatch)');
    }
    if (isLeaseHolder && !leaseValid && job.status === 'LEASED') {
      // Allow final report even if lease just lapsed (common for long renders)
    }

    const now = new Date();
    // A worker-reported failure only goes terminal once the job has burned
    // all its attempts (attempts is incremented at lease time, so a job that
    // failed on its 3rd lease has attempts === maxAttempts). Anything short
    // of that is put back in the queue for the next lease to retry.
    const willRequeue =
      dto.status === 'FAILED' && job.attempts < job.maxAttempts;
    const isTerminal =
      dto.status === 'COMPLETED' || (dto.status === 'FAILED' && !willRequeue);

    const data: Prisma.JobUpdateInput = {
      progress: dto.progress ?? job.progress,
      stage: dto.stage ?? job.stage,
      message: dto.message ?? job.message,
      result: dto.result !== undefined ? (dto.result as any) : job.result,
      error: dto.error ?? job.error,
      updatedAt: now,
    };

    if (dto.status) {
      data.status = dto.status as JobStatus;
    }

    if (willRequeue) {
      // Non-terminal failure: back to the queue, keep the error text visible
      // so the dashboard shows what the last attempt died on.
      data.status = 'PENDING';
      data.progress = 0;
      data.stage = 'queued';
      data.message = `Attempt ${job.attempts}/${job.maxAttempts} failed — waiting for retry`;
      (data as any).leasedBy = null;
      (data as any).leaseExpiresAt = null;
      (data as any).leasedAt = null;
      this.logger.warn(
        `Job ${jobId} failed attempt ${job.attempts}/${job.maxAttempts}, requeued: ${dto.error ?? 'no error given'}`,
      );
    } else if (isTerminal) {
      data.completedAt = now;
      // Clear lease fields on terminal state.
      // Use any-cast because of how Prisma generates optional relation/scalar fields in UpdateInput.
      (data as any).leasedBy = null;
      (data as any).leaseExpiresAt = null;
      (data as any).leasedAt = null;
    } else if (dto.status === 'PROCESSING' && job.status === 'LEASED') {
      data.status = 'PROCESSING';
    }

    // Renew the lease on every non-terminal progress report by the lease holder
    // (but not on a requeue, whose lease fields were just cleared).
    // A render can run far longer than the visibility timeout while producing no
    // output, so without this a worker's own heartbeats would let the lease
    // lapse and cleanupStaleLeases could hand the job to another worker (double
    // render). The worker heartbeats well under the timeout to keep it alive.
    if (!isTerminal && !willRequeue && isLeaseHolder) {
      (data as any).leaseExpiresAt = new Date(now.getTime() + this.visibilityTimeoutMs);
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data,
    });

    // Side effects on the Match/Clip projections. Never fail the worker's
    // report over them -- the job row is already the source of truth, and a
    // re-run/backfill can recover a missed projection.
    try {
      if (dto.status === 'COMPLETED') {
        const { ingested } = await this.clips.ingestCompletedJob(updated);
        this.logger.log(`Job ${updated.id} completed: ingested ${ingested} clip(s)`);
      } else if (dto.status === 'FAILED' && !willRequeue) {
        await this.clips.markJobMatchFailed(updated);
      } else if (dto.stage && STAGES_PAST_DOWNLOAD.has(dto.stage)) {
        await this.clips.markJobMatchDownloaded(updated);
      }
    } catch (e) {
      this.logger.error(
        `Clip/match ingestion failed for job ${updated.id}: ${(e as Error).message}`,
      );
    }

    return updated;
  }

  async createJob(data: {
    type?: string;
    payload: any;
    maxAttempts?: number;
  }): Promise<Job> {
    return this.prisma.job.create({
      data: {
        type: data.type ?? 'clip',
        payload: data.payload as Prisma.InputJsonValue,
        maxAttempts: data.maxAttempts ?? 3,
      },
    });
  }

  /**
   * Player-scoped create (manual UI). Forces trustedSteamIds to exactly [steamId64].
   */
  async createJobForPlayer(data: {
    playerId: string;
    steamId64: string;
    shareCode: string;
    type?: string;
    options?: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<Job> {
    const { job } = await this.enqueueClipForPlayer({
      ...data,
      source: JobSource.manual,
    });
    return job;
  }

  /**
   * Unified enqueue for manual + auto. Idempotent on (playerId, shareCode).
   *
   * Cross-player merge: a share code identifies a MATCH, not a player, so
   * when another player's job for the same code is still PENDING this player
   * joins it (their steamid is added to trustedSteamIds and their Match row
   * links the same job) — one render serves everyone who played the game,
   * instead of the worker rendering the same demo once per enrolled player.
   * Once a job is LEASED its payload has been read by the worker, so a late
   * arrival gets their own job (the worker's demo cache makes the second
   * download free; only their clips render).
   */
  async enqueueClipForPlayer(data: {
    playerId: string;
    steamId64: string;
    shareCode: string;
    source: JobSource;
    type?: string;
    options?: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<{ job: Job; created: boolean }> {
    if (!data.steamId64) {
      throw new BadRequestException('steamId64 required');
    }
    const shareCode = normalizeShareCode(data.shareCode);
    if (!shareCode) {
      throw new BadRequestException('Invalid share code');
    }

    const existing = await this.prisma.match.findUnique({
      where: {
        playerId_shareCode: { playerId: data.playerId, shareCode },
      },
      include: { job: true },
    });

    if (existing?.jobId && existing.job) {
      return { job: existing.job, created: false };
    }

    const payload = {
      shareCode,
      trustedSteamIds: [data.steamId64],
      // Parse/render tuning is owned by the clipper's own defaults
      // (clipper.py constants + clipper_config.json); only explicit
      // per-job overrides belong in the payload.
      options: data.options ?? {},
    };
    if (!payload.trustedSteamIds.length) {
      throw new BadRequestException('trustedSteamIds must be non-empty');
    }

    // Transaction: merge into a pending same-match job, or create job +
    // upsert the Match row with jobId.
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Re-check inside txn
      const again = await tx.match.findUnique({
        where: {
          playerId_shareCode: { playerId: data.playerId, shareCode },
        },
      });
      if (again?.jobId) {
        const j = await tx.job.findUnique({ where: { id: again.jobId } });
        if (j) return { job: j, merged: false };
      }

      const mergeable = await tx.job.findFirst({
        where: {
          shareCode,
          type: data.type ?? 'clip',
          status: JobStatus.PENDING,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (mergeable) {
        const mergedPayload = withTrustedSteamId(
          mergeable.payload as ClipJobPayload,
          data.steamId64,
        );
        // Guard the write on the job still being PENDING: a worker leasing
        // it concurrently blocks on the row lock, and whichever commit wins,
        // the payload the worker reads is consistent. count 0 = just leased
        // -> fall through and create this player's own job.
        const claimed = await tx.job.updateMany({
          where: { id: mergeable.id, status: JobStatus.PENDING },
          // Already-trusted steamid (mergedPayload null) still writes the
          // existing payload: the write is what makes the PENDING guard
          // return a count, and an empty update-set would be invalid.
          data: {
            payload: (mergedPayload ?? mergeable.payload) as Prisma.InputJsonValue,
          },
        });
        if (claimed.count === 1) {
          await tx.match.upsert({
            where: {
              playerId_shareCode: { playerId: data.playerId, shareCode },
            },
            create: {
              playerId: data.playerId,
              shareCode,
              jobId: mergeable.id,
              matchDate: new Date(),
            },
            update: { jobId: mergeable.id },
          });
          const j = await tx.job.findUnique({ where: { id: mergeable.id } });
          return { job: j!, merged: true };
        }
      }

      const created = await tx.job.create({
        data: {
          type: data.type ?? 'clip',
          source: data.source,
          playerId: data.playerId,
          shareCode,
          payload: payload as Prisma.InputJsonValue,
          maxAttempts: data.maxAttempts ?? 3,
        },
      });

      await tx.match.upsert({
        where: {
          playerId_shareCode: { playerId: data.playerId, shareCode },
        },
        create: {
          playerId: data.playerId,
          shareCode,
          jobId: created.id,
          // Best-known match time at detection: now. A manual submit of an
          // old code overstates it; good enough until demo-header parsing.
          matchDate: new Date(),
        },
        update: {
          jobId: created.id,
        },
      });

      return { job: created, merged: false };
    });

    if (outcome.merged) {
      this.logger.log(
        `Merged player ${data.playerId} (${data.steamId64}) into pending job ` +
          `${outcome.job.id} for ${shareCode} — one render serves the match`,
      );
    }

    const wasNew = !existing?.jobId;
    return { job: outcome.job, created: wasNew };
  }

  async getJob(id: string): Promise<Job> {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  async listJobs(limit = 50): Promise<Job[]> {
    return this.prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async listJobsForPlayer(playerId: string, limit = 50): Promise<Job[]> {
    return this.prisma.job.findMany({
      where: { playerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async deleteJob(id: string): Promise<void> {
    await this.prisma.job.delete({ where: { id } });
  }

  /**
   * Admin cancel: terminal CANCELLED for any non-terminal job so a dead worker
   * or stale history queue does not keep re-leasing work.
   */
  async cancelJob(id: string, reason?: string): Promise<Job> {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (
      job.status === 'COMPLETED' ||
      job.status === 'FAILED' ||
      job.status === 'CANCELLED'
    ) {
      throw new BadRequestException(
        `Job is already terminal (${job.status})`,
      );
    }

    const now = new Date();
    const updated = await this.prisma.job.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        error: reason?.trim() || 'Cancelled from admin dashboard',
        completedAt: now,
        leasedBy: null,
        leasedAt: null,
        leaseExpiresAt: null,
        stage: 'cancelled',
        message: 'Cancelled by admin',
      },
    });

    await this.prisma.match.updateMany({
      where: { jobId: id, status: { in: [MatchStatus.DETECTED, MatchStatus.DOWNLOADED] } },
      data: { status: MatchStatus.FAILED },
    });

    this.logger.log(`Job ${id} cancelled by admin (was ${job.status})`);
    return updated;
  }

  /**
   * Manual admin retry of a job that exhausted its attempts: reset the
   * attempt counter and put it back in the queue. Also flips the Match
   * projection back from FAILED so the dashboard shows it in-flight again.
   */
  async retryJob(id: string): Promise<Job> {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'FAILED' && job.status !== 'CANCELLED') {
      throw new BadRequestException(
        `Only FAILED or CANCELLED jobs can be retried (job is ${job.status})`,
      );
    }

    const updated = await this.prisma.job.update({
      where: { id },
      data: {
        status: 'PENDING',
        attempts: 0,
        progress: 0,
        stage: 'queued',
        message: 'Manually requeued from admin dashboard',
        error: null,
        completedAt: null,
        leasedBy: null,
        leasedAt: null,
        leaseExpiresAt: null,
      },
    });

    await this.prisma.match.updateMany({
      where: { jobId: id, status: MatchStatus.FAILED },
      data: { status: MatchStatus.DETECTED },
    });

    this.logger.log(`Job ${id} manually requeued (was ${job.status})`);
    return updated;
  }

  /**
   * Periodic maintenance (call from a simple cron or on demand).
   * Releases truly stuck leases and marks exhausted attempts as FAILED.
   */
  async cleanupStaleLeases(): Promise<{ released: number; failed: number }> {
    const now = new Date();

    // 1. Release leases that have truly expired (visibility timeout).
    // PROCESSING included: a job whose worker died after the first heartbeat
    // is PROCESSING with a lapsed lease, not LEASED.
    const released = await this.prisma.job.updateMany({
      where: {
        status: { in: ['LEASED', 'PROCESSING'] },
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: 'PENDING',
        leasedBy: null,
        leasedAt: null,
        leaseExpiresAt: null,
      },
    });

    // 2. Mark jobs that have exhausted attempts as FAILED (two-step for Prisma safety)
    const exhausted = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id FROM "jobs"
        WHERE attempts >= "maxAttempts"
          AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
        LIMIT 100
      `,
    );

    let failedCount = 0;
    if (exhausted.length > 0) {
      const ids = exhausted.map((r: any) => r.id);
      const res = await this.prisma.job.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'FAILED',
          error: 'Max attempts exceeded',
          completedAt: now,
        },
      });
      failedCount = res.count;
      await this.clips.markMatchesFailedForJobs(ids);
    }

    return { released: released.count, failed: failedCount };
  }
}


