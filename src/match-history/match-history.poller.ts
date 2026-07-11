import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MatchHistoryService } from './match-history.service';
import { JobsService } from '../jobs/jobs.service';

@Injectable()
export class MatchHistoryPoller {
  private readonly logger = new Logger(MatchHistoryPoller.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly matchHistory: MatchHistoryService,
    private readonly jobs: JobsService,
  ) {}

  /** Every 10 minutes when MATCH_HISTORY_POLL_ENABLED=true */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron() {
    const enabled =
      String(this.config.get('MATCH_HISTORY_POLL_ENABLED') || 'false').toLowerCase() ===
      'true';
    if (!enabled) return;
    if (this.running) {
      this.logger.warn('Poller still running; skip tick');
      return;
    }
    this.running = true;
    try {
      await this.jobs.cleanupStaleLeases().catch(() => {});
      const result = await this.matchHistory.pollAll();
      this.logger.log(
        `Match history poll: players=${result.players} enqueued=${result.enqueued} errors=${result.errors}`,
      );
    } catch (e: any) {
      this.logger.error(`Poller tick failed: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }
}
