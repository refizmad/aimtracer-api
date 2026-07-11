import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnrollmentStatus, JobSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { SteamMatchHistoryClient } from './steam-match-history.client';
import { getCredentialsCrypto } from '../common/credentials-crypto';
import { normalizeShareCode } from '../common/sharecode.util';

export interface PublicEnrollment {
  status: EnrollmentStatus;
  authCodeLast4: string;
  knownShareCode: string;
  lastShareCode: string;
  lastPolledAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class MatchHistoryService {
  private readonly logger = new Logger(MatchHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly steam: SteamMatchHistoryClient,
    private readonly jobs: JobsService,
  ) {}

  private crypto() {
    return getCredentialsCrypto(this.config.get<string>('CREDENTIALS_ENCRYPTION_KEY'));
  }

  async getEnrollment(playerId: string): Promise<PublicEnrollment | null> {
    const row = await this.prisma.matchHistoryEnrollment.findUnique({
      where: { playerId },
    });
    if (!row) return null;
    return toPublic(row);
  }

  /**
   * Enroll or re-enroll.
   *
   * Steam walks **forward** only (more recent). Product rules:
   * 1. From the share code they give us, walk to the newest match.
   * 2. Enqueue the N most recent matches only (seed count; TEMP default 2 for testing).
   * 3. Intermediate older matches are skipped (not enqueued).
   * 4. Tip sits on that newest code → every later poll only gets new games they play.
   */
  async putEnrollment(
    playerId: string,
    steamId64: string,
    body: { authCode: string; knownShareCode: string },
  ): Promise<PublicEnrollment & { baselineSkipped: number; seedEnqueued: boolean; seedCount: number }> {
    const authCode = (body.authCode || '').trim();
    if (!authCode || authCode.length < 4) {
      throw new BadRequestException('authCode is required');
    }
    const known = normalizeShareCode(body.knownShareCode);
    if (!known) {
      throw new BadRequestException('knownShareCode must be a valid CSGO-… share code');
    }

    // Validate credentials (one probe) then walk tip to present.
    this.assertSteamOk(
      await this.steam.getNextShareCode({
        steamId64,
        authCode,
        knownCode: known,
      }),
      true,
    );

    const { tip, skipped, discovered } = await this.fastForwardToPresent({
      steamId64,
      authCode,
      startCode: known,
    });

    const ciphertext = this.crypto().encrypt(authCode);
    const last4 = authCode.slice(-4);

    const row = await this.prisma.matchHistoryEnrollment.upsert({
      where: { playerId },
      create: {
        playerId,
        status: EnrollmentStatus.ACTIVE,
        authCodeCiphertext: ciphertext,
        authCodeLast4: last4,
        knownShareCode: known,
        lastShareCode: tip,
        lastError: null,
        lastPolledAt: new Date(),
      },
      update: {
        status: EnrollmentStatus.ACTIVE,
        authCodeCiphertext: ciphertext,
        authCodeLast4: last4,
        knownShareCode: known,
        lastShareCode: tip,
        lastError: null,
        lastPolledAt: new Date(),
      },
    });

    // Seed only the newest N matches (from the walk). Never seed the old
    // anchor just because it is in the chain — that re-queues month-old demos.
    const seedCodes = newestSeedCodes(tip, discovered, this.seedCount());
    const seedEnqueued = await this.enqueueSeedMatches({
      playerId,
      steamId64,
      shareCodes: seedCodes,
    });

    this.logger.log(
      `Enrollment ACTIVE for player ${playerId} (anchor=${known} tip=${tip} skipped=${skipped} seeds=${seedCodes.join(',')} created=${seedEnqueued})`,
    );
    return {
      ...toPublic(row),
      baselineSkipped: skipped,
      seedEnqueued: seedEnqueued > 0,
      seedCount: seedEnqueued,
    };
  }

  async disableEnrollment(playerId: string): Promise<PublicEnrollment> {
    const row = await this.prisma.matchHistoryEnrollment.findUnique({ where: { playerId } });
    if (!row) throw new NotFoundException('Not enrolled');
    const updated = await this.prisma.matchHistoryEnrollment.update({
      where: { playerId },
      data: { status: EnrollmentStatus.DISABLED, lastError: null },
    });
    return toPublic(updated);
  }

  async enableEnrollment(playerId: string): Promise<PublicEnrollment> {
    const row = await this.prisma.matchHistoryEnrollment.findUnique({ where: { playerId } });
    if (!row) throw new NotFoundException('Not enrolled');
    if (row.status === EnrollmentStatus.INVALID_AUTH) {
      throw new ForbiddenException({
        code: 'REAUTH_REQUIRED',
        message: 'Re-submit match history auth code before enabling',
      });
    }
    const updated = await this.prisma.matchHistoryEnrollment.update({
      where: { playerId },
      data: { status: EnrollmentStatus.ACTIVE, lastError: null },
    });
    return toPublic(updated);
  }

  /**
   * Re-anchor share code chain (CHAIN_BROKEN recovery).
   * Same seed policy as enroll: tip → newest, enqueue last N recent games.
   */
  async reanchor(
    playerId: string,
    steamId64: string,
    knownShareCode: string,
  ): Promise<PublicEnrollment & { baselineSkipped: number; seedEnqueued: boolean; seedCount: number }> {
    const row = await this.prisma.matchHistoryEnrollment.findUnique({ where: { playerId } });
    if (!row) throw new NotFoundException('Not enrolled');

    const known = normalizeShareCode(knownShareCode);
    if (!known) throw new BadRequestException('Invalid knownShareCode');

    const authCode = this.crypto().decrypt(row.authCodeCiphertext);
    const probe = await this.steam.getNextShareCode({
      steamId64,
      authCode,
      knownCode: known,
    });

    if (probe.kind === 'invalid_auth') {
      await this.prisma.matchHistoryEnrollment.update({
        where: { playerId },
        data: {
          status: EnrollmentStatus.INVALID_AUTH,
          lastError: 'Steam 403 invalid auth',
        },
      });
      throw new ForbiddenException({
        code: 'INVALID_AUTH',
        message: 'Auth code is no longer valid — re-enroll with a new code',
      });
    }
    if (probe.kind === 'share_code_mismatch') {
      throw new ForbiddenException({
        code: 'SHARE_CODE_MISMATCH',
        message: 'Share code does not belong to this account',
      });
    }
    if (probe.kind === 'soft_error') {
      throw new BadRequestException('Steam temporarily unavailable');
    }

    const { tip, skipped, discovered } = await this.fastForwardToPresent({
      steamId64,
      authCode,
      startCode: known,
    });

    const updated = await this.prisma.matchHistoryEnrollment.update({
      where: { playerId },
      data: {
        status: EnrollmentStatus.ACTIVE,
        knownShareCode: known,
        lastShareCode: tip,
        lastError: null,
        lastPolledAt: new Date(),
      },
    });

    const seedCodes = newestSeedCodes(tip, discovered, this.seedCount());
    const seedEnqueued = await this.enqueueSeedMatches({
      playerId,
      steamId64,
      shareCodes: seedCodes,
    });

    return {
      ...toPublic(updated),
      baselineSkipped: skipped,
      seedEnqueued: seedEnqueued > 0,
      seedCount: seedEnqueued,
    };
  }

  /**
   * Catch tip up to the newest Steam match.
   * Seeds the last N recent matches (temp default 2) when far behind.
   */
  async baselineNow(
    playerId: string,
    steamId64: string,
    opts?: { seed?: boolean },
  ): Promise<PublicEnrollment & { baselineSkipped: number; seedEnqueued: boolean; seedCount: number }> {
    const row = await this.prisma.matchHistoryEnrollment.findUnique({ where: { playerId } });
    if (!row) throw new NotFoundException('Not enrolled');
    if (row.status === EnrollmentStatus.INVALID_AUTH) {
      throw new ForbiddenException({
        code: 'REAUTH_REQUIRED',
        message: 'Re-submit match history auth code first',
      });
    }

    const authCode = this.crypto().decrypt(row.authCodeCiphertext);
    const startCode = row.lastShareCode;
    const { tip, skipped, discovered } = await this.fastForwardToPresent({
      steamId64,
      authCode,
      startCode,
    });

    const updated = await this.prisma.matchHistoryEnrollment.update({
      where: { playerId },
      data: {
        status: EnrollmentStatus.ACTIVE,
        lastShareCode: tip,
        lastError: null,
        lastPolledAt: new Date(),
      },
    });

    let seedCount = 0;
    if (opts?.seed !== false) {
      const seedCodes = newestSeedCodes(tip, discovered, this.seedCount());
      seedCount = await this.enqueueSeedMatches({
        playerId,
        steamId64,
        shareCodes: seedCodes,
      });
    }

    this.logger.log(
      `Baseline for player ${playerId}: tip ${startCode} → ${tip}, skipped=${skipped}, seedCreated=${seedCount}`,
    );
    return {
      ...toPublic(updated),
      baselineSkipped: skipped,
      seedEnqueued: seedCount > 0,
      seedCount,
    };
  }

  /** TEMP for testing: how many recent matches to seed on enroll/baseline. Default 2. */
  private seedCount(): number {
    return Math.max(1, numEnv(this.config, 'MATCH_HISTORY_SEED_COUNT', 2));
  }

  /** Enqueue up to N seed clip jobs (idempotent). Returns how many were newly created. */
  private async enqueueSeedMatches(opts: {
    playerId: string;
    steamId64: string;
    shareCodes: string[];
  }): Promise<number> {
    let created = 0;
    for (const shareCode of opts.shareCodes) {
      try {
        const res = await this.jobs.enqueueClipForPlayer({
          playerId: opts.playerId,
          steamId64: opts.steamId64,
          shareCode,
          source: JobSource.auto_match_history,
          options: { minKills: 4 },
        });
        if (res.created) created += 1;
      } catch (e: any) {
        this.logger.warn(`Seed enqueue failed for ${shareCode}: ${e?.message}`);
      }
    }
    return created;
  }

  /**
   * Walk GetNextMatchSharingCode until caught up. Never creates jobs.
   * Returns tip, how many steps walked, and each nextcode discovered (older → newer).
   */
  private async fastForwardToPresent(opts: {
    steamId64: string;
    authCode: string;
    startCode: string;
  }): Promise<{ tip: string; skipped: number; discovered: string[] }> {
    let tip = opts.startCode;
    let skipped = 0;
    const discovered: string[] = [];
    // Allow a longer walk than a normal poll tick (history catch-up).
    const maxPages = Math.max(numEnv(this.config, 'MATCH_HISTORY_MAX_PAGES', 15) * 3, 40);

    for (let page = 0; page < maxPages; page++) {
      const result = await this.steam.getNextShareCode({
        steamId64: opts.steamId64,
        authCode: opts.authCode,
        knownCode: tip,
      });

      if (result.kind === 'caught_up') {
        break;
      }
      if (result.kind === 'invalid_auth') {
        throw new ForbiddenException({
          code: 'INVALID_AUTH',
          message:
            'Steam rejected the match history auth code (or platform API key). Check the code from help.steampowered.com.',
        });
      }
      if (result.kind === 'share_code_mismatch') {
        throw new ForbiddenException({
          code: 'SHARE_CODE_MISMATCH',
          message:
            'Share code does not belong to this Steam account. Use a code from the same help page as the auth code.',
        });
      }
      if (result.kind === 'soft_error') {
        this.logger.warn(
          `Baseline soft error at tip=${tip} HTTP ${result.status}; stopping with current tip`,
        );
        break;
      }

      // More recent match exists — advance tip only (no enqueue).
      const next = normalizeShareCode(result.nextcode) || result.nextcode;
      tip = next;
      discovered.push(next);
      skipped += 1;
      await sleep(1000);
    }

    return { tip, skipped, discovered };
  }

  private assertSteamOk(
    probe: Awaited<ReturnType<SteamMatchHistoryClient['getNextShareCode']>>,
    allowNextOrCaughtUp: boolean,
  ): void {
    if (probe.kind === 'invalid_auth') {
      throw new ForbiddenException({
        code: 'INVALID_AUTH',
        message:
          'Steam rejected the match history auth code (or platform API key). Check the code from help.steampowered.com.',
      });
    }
    if (probe.kind === 'share_code_mismatch') {
      throw new ForbiddenException({
        code: 'SHARE_CODE_MISMATCH',
        message:
          'Share code does not belong to this Steam account. Use a code from the same help page as the auth code.',
      });
    }
    if (probe.kind === 'soft_error') {
      throw new BadRequestException({
        code: 'STEAM_UNAVAILABLE',
        message: `Steam match history temporarily unavailable (HTTP ${probe.status}). Try again.`,
      });
    }
    if (!allowNextOrCaughtUp && probe.kind !== 'caught_up') {
      throw new BadRequestException('Unexpected Steam response');
    }
  }

  async deleteEnrollment(playerId: string): Promise<void> {
    await this.prisma.matchHistoryEnrollment
      .delete({ where: { playerId } })
      .catch(() => {
        throw new NotFoundException('Not enrolled');
      });
  }

  /**
   * Poll all ACTIVE enrollments (or one player). Called by cron / internal admin.
   */
  async pollAll(): Promise<{
    players: number;
    enqueued: number;
    errors: number;
  }> {
    const enrollments = await this.prisma.matchHistoryEnrollment.findMany({
      where: { status: EnrollmentStatus.ACTIVE },
      include: { player: true },
    });

    let enqueued = 0;
    let errors = 0;
    for (const enr of enrollments) {
      if (enr.player.status !== 'ACTIVE') continue;
      try {
        const n = await this.pollPlayer(enr.playerId);
        enqueued += n;
      } catch (e: any) {
        errors += 1;
        this.logger.warn(`Poll failed for ${enr.playerId}: ${e?.message}`);
      }
      await sleep(200);
    }
    return { players: enrollments.length, enqueued, errors };
  }

  async pollPlayer(playerId: string): Promise<number> {
    const enr = await this.prisma.matchHistoryEnrollment.findUnique({
      where: { playerId },
      include: { player: true },
    });
    if (!enr || enr.status !== EnrollmentStatus.ACTIVE) return 0;

    const maxPages = numEnv(this.config, 'MATCH_HISTORY_MAX_PAGES', 15);
    let enqueued = 0;

    // Do NOT re-enqueue historical Match rows with null jobId.
    // Those are skipped intermediates from baseline walks; recovering them
    // slowly re-queues month-old demos every poll tick.

    let tip = enr.lastShareCode;
    let authCode: string;
    try {
      authCode = this.crypto().decrypt(enr.authCodeCiphertext);
    } catch (e: any) {
      this.logger.error(`Decrypt failed for ${playerId}: ${e?.message}`);
      return enqueued;
    }

    // Collect the full forward walk first (no enqueue yet).
    const discovered: string[] = [];
    for (let page = 0; page < maxPages; page++) {
      const result = await this.steam.getNextShareCode({
        steamId64: enr.player.steamId64,
        authCode,
        knownCode: tip,
      });

      if (result.kind === 'caught_up') break;

      if (result.kind === 'invalid_auth') {
        await this.prisma.matchHistoryEnrollment.update({
          where: { playerId },
          data: {
            status: EnrollmentStatus.INVALID_AUTH,
            lastError: 'Steam 403 invalid auth',
            lastPolledAt: new Date(),
          },
        });
        return enqueued;
      }

      if (result.kind === 'share_code_mismatch') {
        await this.prisma.matchHistoryEnrollment.update({
          where: { playerId },
          data: {
            status: EnrollmentStatus.CHAIN_BROKEN,
            lastError: 'Steam 412 share code mismatch — re-anchor required',
            lastPolledAt: new Date(),
          },
        });
        return enqueued;
      }

      if (result.kind === 'soft_error') {
        await this.prisma.matchHistoryEnrollment.update({
          where: { playerId },
          data: {
            lastError: `Steam soft error HTTP ${result.status}`,
            lastPolledAt: new Date(),
          },
        });
        break;
      }

      const nextcode = normalizeShareCode(result.nextcode) || result.nextcode;
      discovered.push(nextcode);
      tip = nextcode;
      await sleep(1000);
    }

    // Always move tip to the newest known code so we never re-walk history.
    await this.prisma.matchHistoryEnrollment.update({
      where: { playerId },
      data: { lastShareCode: tip, lastPolledAt: new Date(), lastError: null },
    });

    if (discovered.length === 0) return enqueued;

    // Upcoming games: enqueue every newly discovered match when the gap is small
    // (normal play between polls). Large gaps = catch-up → only last N recent (seed count).
    const catchUpThreshold = numEnv(this.config, 'MATCH_HISTORY_CATCHUP_THRESHOLD', 5);
    const seedN = this.seedCount();
    const toEnqueue =
      discovered.length > catchUpThreshold
        ? discovered.slice(-seedN)
        : discovered;

    if (discovered.length > catchUpThreshold) {
      this.logger.log(
        `Poll catch-up for ${playerId}: found ${discovered.length} matches, enqueueing newest ${toEnqueue.length}`,
      );
    }

    for (const shareCode of toEnqueue) {
      if (!(await this.canAutoEnqueue(playerId))) break;
      const { created } = await this.jobs.enqueueClipForPlayer({
        playerId,
        steamId64: enr.player.steamId64,
        shareCode,
        source: JobSource.auto_match_history,
        options: { minKills: 4 },
      });
      if (created) enqueued += 1;
    }

    return enqueued;
  }

  private async canAutoEnqueue(playerId: string): Promise<boolean> {
    const maxPerDay = numEnv(this.config, 'MAX_AUTO_JOBS_PER_PLAYER_PER_DAY', 10);
    const maxDepth = numEnv(this.config, 'MAX_GLOBAL_QUEUE_DEPTH', 50);

    const depth = await this.prisma.job.count({
      where: { status: { in: ['PENDING', 'LEASED', 'PROCESSING'] } },
    });
    if (depth >= maxDepth) {
      this.logger.warn(`Global queue depth ${depth} >= ${maxDepth}; skip auto enqueue`);
      return false;
    }

    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);
    const todayCount = await this.prisma.job.count({
      where: {
        playerId,
        source: JobSource.auto_match_history,
        createdAt: { gte: startOfUtcDay },
      },
    });
    if (todayCount >= maxPerDay) {
      return false;
    }
    return true;
  }
}

function toPublic(row: {
  status: EnrollmentStatus;
  authCodeLast4: string;
  knownShareCode: string;
  lastShareCode: string;
  lastPolledAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PublicEnrollment {
  return {
    status: row.status,
    authCodeLast4: row.authCodeLast4,
    knownShareCode: row.knownShareCode,
    lastShareCode: row.lastShareCode,
    lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Newest N share codes to seed after a baseline walk.
 * - If we walked forward (`discovered` non-empty): take the last N of those
 *   (never the old anchor — that was often a month-old knowncode).
 * - If already at tip (`discovered` empty): seed the tip only (most recent).
 */
function newestSeedCodes(tip: string, discovered: string[], n: number): string[] {
  const count = Math.max(1, n);
  if (discovered.length > 0) {
    return discovered.slice(-count);
  }
  return tip ? [tip] : [];
}

function numEnv(config: ConfigService, key: string, fallback: number): number {
  const v = config.get<string | number>(key);
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}
