import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  JobStatus,
  MatchStatus,
  Prisma,
} from '../prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { normalizeShareCode } from '../common/sharecode.util';

/** Worker considered online if lastSeen within this window (ms). */
const WORKER_ONLINE_MS = 120_000;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

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
    const now = Date.now();
    const [workers, queueDepth, leasedJobs] = await Promise.all([
      this.prisma.worker.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.job.count({
        where: {
          status: {
            in: [JobStatus.PENDING, JobStatus.LEASED, JobStatus.PROCESSING],
          },
        },
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
        const lastSeenMs = w.lastSeenAt?.getTime() ?? 0;
        const online =
          w.enabled && lastSeenMs > 0 && now - lastSeenMs < WORKER_ONLINE_MS;
        const current = currentByWorker.get(w.id) ?? null;
        // Only treat as "working" when the lease is still valid — a dead PC
        // leaves PROCESSING rows forever until reclaim/cleanup runs.
        const leaseLive =
          current?.leaseExpiresAt != null &&
          current.leaseExpiresAt.getTime() > now;
        const activeJob = online && leaseLive ? current : null;
        const staleJob =
          current && !activeJob
            ? {
                id: current.id,
                status: current.status,
                stage: current.stage,
                progress: current.progress,
                shareCode: current.shareCode,
                leaseExpiresAt: current.leaseExpiresAt?.toISOString() ?? null,
                player: current.player,
              }
            : null;

        return {
          id: w.id,
          name: w.name,
          enabled: w.enabled,
          online,
          lastSeenAt: w.lastSeenAt?.toISOString() ?? null,
          createdAt: w.createdAt.toISOString(),
          currentJob: activeJob
            ? {
                id: activeJob.id,
                status: activeJob.status,
                stage: activeJob.stage,
                progress: activeJob.progress,
                shareCode: activeJob.shareCode,
                leaseExpiresAt: activeJob.leaseExpiresAt?.toISOString() ?? null,
                player: activeJob.player,
              }
            : null,
          staleJob,
        };
      }),
    };
  }

  /**
   * List demos for admin manage UI, **merged by share code**.
   *
   * Several Match rows can exist for one CS2 game (one per trusted player).
   * The dashboard should show each demo once, with all players listed, so
   * Reclip / Delete act on the whole match rather than one account's row.
   */
  async listMatches(opts?: { limit?: number; status?: MatchStatus }) {
    const take = Math.min(100, Math.max(1, opts?.limit ?? 50));
    const where: Prisma.MatchWhereInput = {};
    if (opts?.status) where.status = opts.status;

    // Over-fetch then group: several players share one demo.
    const rows = await this.prisma.match.findMany({
      where,
      orderBy: { matchDate: 'desc' },
      take: Math.min(500, take * 8),
      include: {
        player: {
          select: { id: true, steamId64: true, displayName: true },
        },
        job: {
          select: {
            id: true,
            status: true,
            stage: true,
            progress: true,
            error: true,
            attempts: true,
            maxAttempts: true,
            source: true,
            createdAt: true,
          },
        },
        _count: { select: { clips: true } },
      },
    });

    type JobSnap = NonNullable<(typeof rows)[number]['job']>;
    type PlayerSnap = (typeof rows)[number]['player'];
    type Group = {
      id: string;
      matchIds: string[];
      shareCode: string;
      status: MatchStatus;
      map: string | null;
      demoName: string | null;
      matchDate: Date;
      discoveredAt: Date;
      clipCount: number;
      players: PlayerSnap[];
      job: JobSnap | null;
    };

    const groups = new Map<string, Group>();
    const statusRank: Record<MatchStatus, number> = {
      RENDERED: 4,
      DOWNLOADED: 3,
      DETECTED: 2,
      FAILED: 1,
    };
    const jobActiveRank = (s: string | undefined) => {
      if (s === 'PROCESSING' || s === 'LEASED') return 3;
      if (s === 'PENDING') return 2;
      if (s === 'COMPLETED') return 1;
      return 0;
    };

    for (const m of rows) {
      let g = groups.get(m.shareCode);
      if (!g) {
        g = {
          id: m.id,
          matchIds: [m.id],
          shareCode: m.shareCode,
          status: m.status,
          map: m.map,
          demoName: m.demoName,
          matchDate: m.matchDate,
          discoveredAt: m.discoveredAt,
          clipCount: m._count.clips,
          players: m.player ? [m.player] : [],
          job: m.job,
        };
        groups.set(m.shareCode, g);
        continue;
      }
      g.matchIds.push(m.id);
      g.clipCount += m._count.clips;
      if (m.map && !g.map) g.map = m.map;
      if (m.demoName && !g.demoName) g.demoName = m.demoName;
      if (m.matchDate > g.matchDate) g.matchDate = m.matchDate;
      if (m.discoveredAt < g.discoveredAt) g.discoveredAt = m.discoveredAt;
      if (statusRank[m.status] > statusRank[g.status]) g.status = m.status;
      if (m.player) {
        const seen = g.players.some((p) => p.steamId64 === m.player!.steamId64);
        if (!seen) g.players.push(m.player);
      }
      if (
        m.job &&
        (!g.job ||
          jobActiveRank(m.job.status) > jobActiveRank(g.job.status) ||
          (jobActiveRank(m.job.status) === jobActiveRank(g.job.status) &&
            m.job.createdAt > g.job.createdAt))
      ) {
        g.job = m.job;
      }
    }

    const merged = [...groups.values()]
      .sort((a, b) => b.matchDate.getTime() - a.matchDate.getTime())
      .slice(0, take);

    return {
      matches: merged.map((g) => ({
        id: g.id,
        matchIds: g.matchIds,
        shareCode: g.shareCode,
        status: g.status,
        map: g.map,
        demoName: g.demoName,
        matchDate: g.matchDate.toISOString(),
        discoveredAt: g.discoveredAt.toISOString(),
        clipCount: g.clipCount,
        // Backward-compatible single player (first) + full roster.
        player: g.players[0] ?? null,
        players: g.players,
        job: g.job
          ? {
              id: g.job.id,
              status: g.job.status,
              stage: g.job.stage,
              progress: g.job.progress,
              error: g.job.error,
              attempts: g.job.attempts,
              maxAttempts: g.job.maxAttempts,
              source: g.job.source,
              createdAt: g.job.createdAt.toISOString(),
            }
          : null,
      })),
    };
  }

  /**
   * Delete every Match row (and their clips) for a share code — one demo
   * across all roster players. Cancels any non-terminal job for that code.
   */
  async deleteDemoByShareCode(rawShareCode: string) {
    const shareCode = normalizeShareCode(rawShareCode);
    if (!shareCode) throw new BadRequestException('Invalid share code');

    const matches = await this.prisma.match.findMany({
      where: { shareCode },
      include: { job: true },
    });
    if (matches.length === 0) throw new NotFoundException('Match not found');

    const jobIds = new Set<string>();
    for (const m of matches) {
      if (m.jobId) jobIds.add(m.jobId);
    }
    const jobs = await this.prisma.job.findMany({
      where: { shareCode },
      select: { id: true, status: true },
    });
    for (const j of jobs) jobIds.add(j.id);

    const cancelled: string[] = [];
    for (const jid of jobIds) {
      const j = await this.prisma.job.findUnique({ where: { id: jid } });
      if (
        j &&
        j.status !== 'COMPLETED' &&
        j.status !== 'FAILED' &&
        j.status !== 'CANCELLED'
      ) {
        try {
          await this.jobs.cancelJob(
            jid,
            'Cancelled: demo deleted from admin',
          );
          cancelled.push(jid);
        } catch {
          /* already terminal */
        }
      }
    }

    const matchIds = matches.map((m) => m.id);
    const clipsDeleted = await this.prisma.clip.deleteMany({
      where: { matchId: { in: matchIds } },
    });
    await this.prisma.match.deleteMany({ where: { id: { in: matchIds } } });

    return {
      deleted: true,
      shareCode,
      matchIds,
      matchesDeleted: matchIds.length,
      clipsDeleted: clipsDeleted.count,
      cancelledJobs: cancelled,
    };
  }

  async listClips(opts?: { limit?: number; matchId?: string }) {
    const take = Math.min(100, Math.max(1, opts?.limit ?? 50));
    const where: Prisma.ClipWhereInput = {};
    if (opts?.matchId) where.matchId = opts.matchId;

    const clips = await this.prisma.clip.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        player: {
          select: { id: true, steamId64: true, displayName: true },
        },
        match: {
          select: { id: true, shareCode: true, status: true, map: true },
        },
      },
    });

    return {
      clips: clips.map((c) => ({
        id: c.id,
        publicCode: c.publicCode,
        file: c.file,
        url: c.url,
        sizeBytes: c.sizeBytes,
        clipType: c.clipType,
        map: c.map,
        kills: c.kills,
        demoName: c.demoName,
        createdAt: c.createdAt.toISOString(),
        player: c.player,
        match: c.match,
      })),
    };
  }

  /**
   * Delete a match row, its clips, and cancel any non-terminal job.
   * Does not delete S3 objects (keys may remain until bucket lifecycle).
   */
  async deleteMatch(id: string) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: { job: true, _count: { select: { clips: true } } },
    });
    if (!match) throw new NotFoundException('Match not found');

    let cancelledJob: string | null = null;
    if (
      match.job &&
      match.job.status !== 'COMPLETED' &&
      match.job.status !== 'FAILED' &&
      match.job.status !== 'CANCELLED'
    ) {
      await this.jobs.cancelJob(
        match.job.id,
        'Cancelled: match deleted from admin',
      );
      cancelledJob = match.job.id;
    }

    const clipsDeleted = await this.prisma.clip.deleteMany({
      where: { matchId: id },
    });
    await this.prisma.match.delete({ where: { id } });

    return {
      deleted: true,
      matchId: id,
      shareCode: match.shareCode,
      clipsDeleted: clipsDeleted.count,
      cancelledJob,
    };
  }

  async deleteClip(id: string) {
    const clip = await this.prisma.clip.findUnique({ where: { id } });
    if (!clip) throw new NotFoundException('Clip not found');
    await this.prisma.clip.delete({ where: { id } });
    return {
      deleted: true,
      clipId: id,
      file: clip.file,
      note: 'DB row removed; S3 object may still exist until lifecycle cleanup',
    };
  }

  /**
   * Cancel every non-terminal auto_match_history job except the newest per
   * player (optional), or all of them. Used to clear a bad history backlog.
   */
  async cancelStaleAutoJobs(opts?: { keepNewestPerPlayer?: boolean }) {
    const keepNewest = opts?.keepNewestPerPlayer !== false;
    const active = await this.prisma.job.findMany({
      where: {
        source: 'auto_match_history',
        status: {
          in: [
            JobStatus.PENDING,
            JobStatus.LEASED,
            JobStatus.PROCESSING,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, playerId: true, shareCode: true, createdAt: true },
    });

    const keep = new Set<string>();
    if (keepNewest) {
      const seenPlayer = new Set<string>();
      for (const j of active) {
        const key = j.playerId || j.id;
        if (!seenPlayer.has(key)) {
          seenPlayer.add(key);
          keep.add(j.id);
        }
      }
    }

    let cancelled = 0;
    for (const j of active) {
      if (keep.has(j.id)) continue;
      try {
        await this.jobs.cancelJob(
          j.id,
          'Cancelled: stale auto-history backlog (admin)',
        );
        cancelled += 1;
      } catch {
        /* already terminal */
      }
    }

    return {
      scanned: active.length,
      kept: keep.size,
      cancelled,
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

  /**
   * Register a worker machine. machineToken is returned once — store it on the
   * render PC (env or worker_token.json).
   */
  async createWorker(opts: { name: string; machineToken?: string }) {
    const name = opts.name?.trim();
    if (!name) {
      throw new BadRequestException('name is required');
    }
    const machineToken =
      opts.machineToken?.trim() ||
      'mt_' +
        Buffer.from(
          crypto.randomUUID().replace(/-/g, '') + Date.now().toString(36),
        )
          .toString('base64url')
          .slice(0, 40);

    const worker = await this.prisma.worker.create({
      data: {
        name,
        machineToken,
        enabled: true,
      },
    });

    return {
      id: worker.id,
      name: worker.name,
      enabled: worker.enabled,
      machineToken,
      note: 'Store machineToken on the render PC. It will not be shown again.',
    };
  }

  /**
   * Worker-only setup: create (or reuse) a machine token and return copy-paste
   * snippets for the Windows render PC. Friend invites stay on POST /admin/invites
   * — workers are not invited users.
   */
  async workerSetup(opts: {
    workerName?: string;
    /** If set, upsert worker with this exact machine token. */
    machineToken?: string;
    /** Public API base the worker will call (HTTPS). */
    publicApiUrl?: string;
  }) {
    const workerName = (opts.workerName || 'render-pc').trim();
    const publicApiUrl = (opts.publicApiUrl || 'https://api.aimtracer.com')
      .trim()
      .replace(/\/+$/, '');

    let workerRow = await this.prisma.worker.findFirst({
      where: { name: workerName },
      orderBy: { createdAt: 'asc' },
    });
    let machineToken: string;
    let workerCreated: boolean;

    if (opts.machineToken?.trim()) {
      machineToken = opts.machineToken.trim();
      workerRow = await this.prisma.worker.upsert({
        where: { machineToken },
        update: { name: workerName, enabled: true },
        create: { name: workerName, machineToken, enabled: true },
      });
      workerCreated = true;
    } else if (workerRow) {
      machineToken = workerRow.machineToken;
      workerCreated = false;
    } else {
      const created = await this.createWorker({ name: workerName });
      machineToken = created.machineToken;
      workerRow = await this.prisma.worker.findUniqueOrThrow({
        where: { id: created.id },
      });
      workerCreated = true;
    }

    const workerCmd = [
      `set AIMTRACE_API=${publicApiUrl}`,
      `set MACHINE_TOKEN=${machineToken}`,
      `python worker.py --long-poll 25`,
    ].join('\r\n');

    const workerPs = [
      `$env:AIMTRACE_API="${publicApiUrl}"`,
      `$env:MACHINE_TOKEN="${machineToken}"`,
      `python worker.py --long-poll 25`,
    ].join('\n');

    const registerCmd = [
      `set AIMTRACE_API=${publicApiUrl}`,
      `python worker.py --register ${workerName} --bootstrap-token <ADMIN_OR_BOOTSTRAP_TOKEN>`,
    ].join('\r\n');

    return {
      worker: {
        id: workerRow.id,
        name: workerRow.name,
        machineToken,
        created: workerCreated,
      },
      snippets: {
        /** cmd.exe on the render PC */
        workerCmd,
        /** PowerShell on the render PC */
        workerPs,
        /** Alternative: self-register from the PC (saves worker_token.json) */
        registerCmd,
      },
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
