import { Injectable } from '@nestjs/common';
import {
  EnrollmentStatus,
  JobStatus,
  MatchStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const [
      clipsRendered,
      demosDownloaded,
      matchesByStatus,
      jobsByStatus,
      playersTotal,
      enrollmentsByStatus,
      invitesOpen,
      storage,
      queueDepth,
      workers,
    ] = await Promise.all([
      this.prisma.clip.count(),
      this.prisma.match.count({
        where: {
          status: { in: [MatchStatus.DOWNLOADED, MatchStatus.RENDERED] },
        },
      }),
      this.prisma.match.groupBy({ by: ['status'], _count: true }),
      this.prisma.job.groupBy({ by: ['status'], _count: true }),
      this.prisma.player.count(),
      this.prisma.matchHistoryEnrollment.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.invite.count({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }),
      this.prisma.clip.aggregate({ _sum: { sizeBytes: true } }),
      this.prisma.job.count({
        where: { status: { in: [JobStatus.PENDING, JobStatus.LEASED] } },
      }),
      this.prisma.worker.findMany({
        select: { id: true, name: true, enabled: true, lastSeenAt: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const matchStatus = emptyStatusMap<MatchStatus>([
      'DETECTED',
      'DOWNLOADED',
      'RENDERED',
      'FAILED',
    ]);
    for (const g of matchesByStatus) matchStatus[g.status] = g._count;

    const jobStatus = emptyStatusMap<JobStatus>([
      'PENDING',
      'LEASED',
      'PROCESSING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ]);
    for (const g of jobsByStatus) jobStatus[g.status] = g._count;

    const enrollmentStatus = emptyStatusMap<EnrollmentStatus>([
      'ACTIVE',
      'DISABLED',
      'INVALID_AUTH',
      'CHAIN_BROKEN',
    ]);
    for (const g of enrollmentsByStatus) enrollmentStatus[g.status] = g._count;

    const sizeBytes = storage._sum.sizeBytes ?? 0;

    return {
      totals: {
        clipsRendered,
        demosDownloaded,
        players: playersTotal,
        invitesOpen,
        queueDepth,
        storageBytes: sizeBytes,
        storageHuman: formatBytes(sizeBytes),
      },
      matchesByStatus: matchStatus,
      jobsByStatus: jobStatus,
      enrollmentsByStatus: enrollmentStatus,
      workers: workers.map((w) => ({
        id: w.id,
        name: w.name,
        enabled: w.enabled,
        lastSeenAt: w.lastSeenAt?.toISOString() ?? null,
      })),
    };
  }

  async listJobs(opts: {
    status?: JobStatus;
    failedOnly?: boolean;
    limit?: number;
  }) {
    const take = Math.min(100, Math.max(1, opts.limit ?? 40));
    const where: Prisma.JobWhereInput = {};
    if (opts.failedOnly) {
      where.status = JobStatus.FAILED;
    } else if (opts.status) {
      where.status = opts.status;
    }

    const jobs = await this.prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        player: {
          select: {
            id: true,
            steamId64: true,
            displayName: true,
          },
        },
        worker: {
          select: { id: true, name: true },
        },
      },
    });

    return {
      jobs: jobs.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        source: j.source,
        progress: j.progress,
        stage: j.stage,
        message: j.message,
        error: j.error,
        attempts: j.attempts,
        maxAttempts: j.maxAttempts,
        shareCode: j.shareCode,
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
        leaseExpiresAt: j.leaseExpiresAt?.toISOString() ?? null,
        player: j.player,
        worker: j.worker,
      })),
    };
  }

  async listPlayers() {
    const players = await this.prisma.player.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        enrollment: {
          select: {
            status: true,
            lastPolledAt: true,
            lastError: true,
            authCodeLast4: true,
          },
        },
        inviteUsed: {
          select: { code: true, note: true },
        },
        _count: {
          select: { jobs: true, clips: true, matches: true },
        },
      },
    });

    return {
      players: players.map((p) => ({
        id: p.id,
        steamId64: p.steamId64,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        jobs: p._count.jobs,
        clips: p._count.clips,
        matches: p._count.matches,
        enrollment: p.enrollment
          ? {
              status: p.enrollment.status,
              lastPolledAt: p.enrollment.lastPolledAt?.toISOString() ?? null,
              lastError: p.enrollment.lastError,
              authCodeLast4: p.enrollment.authCodeLast4,
            }
          : null,
        invite: p.inviteUsed
          ? { code: p.inviteUsed.code, note: p.inviteUsed.note }
          : null,
      })),
    };
  }

  async listWorkers() {
    const [workers, queueDepth, leasedJobs] = await Promise.all([
      this.prisma.worker.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.job.count({
        where: { status: { in: [JobStatus.PENDING, JobStatus.LEASED] } },
      }),
      this.prisma.job.findMany({
        where: {
          status: { in: [JobStatus.LEASED, JobStatus.PROCESSING] },
          leasedBy: { not: null },
        },
        select: {
          id: true,
          status: true,
          stage: true,
          progress: true,
          shareCode: true,
          leasedBy: true,
          leaseExpiresAt: true,
          player: { select: { displayName: true, steamId64: true } },
        },
      }),
    ]);

    const currentByWorker = new Map(leasedJobs.map((j) => [j.leasedBy!, j]));

    return {
      queueDepth,
      workers: workers.map((w) => {
        const current = currentByWorker.get(w.id) ?? null;
        return {
          id: w.id,
          name: w.name,
          enabled: w.enabled,
          lastSeenAt: w.lastSeenAt?.toISOString() ?? null,
          createdAt: w.createdAt.toISOString(),
          currentJob: current
            ? {
                id: current.id,
                status: current.status,
                stage: current.stage,
                progress: current.progress,
                shareCode: current.shareCode,
                leaseExpiresAt: current.leaseExpiresAt?.toISOString() ?? null,
                player: current.player,
              }
            : null,
        };
      }),
    };
  }

  async listInvites() {
    const invites = await this.prisma.invite.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        usedBy: {
          select: {
            id: true,
            steamId64: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
    return {
      invites: invites.map((i) => ({
        id: i.id,
        code: i.code,
        note: i.note,
        maxUses: i.maxUses,
        useCount: i.useCount,
        expiresAt: i.expiresAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
        usedBy: i.usedBy,
        path: `/invite/${i.code}`,
      })),
    };
  }
}

function emptyStatusMap<T extends string>(keys: T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
}

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
