import { Module } from '@nestjs/common';
import { MatchHistoryController } from './match-history.controller';
import { MatchHistoryInternalController } from './match-history.internal.controller';
import { MatchHistoryService } from './match-history.service';
import { MatchHistoryPoller } from './match-history.poller';
import { SteamMatchHistoryClient } from './steam-match-history.client';
import { JobsModule } from '../jobs/jobs.module';
import { PlayerSessionGuard } from '../common/player-session.guard';
import { AdminAuthGuard } from '../common/admin-auth.guard';

@Module({
  imports: [JobsModule],
  controllers: [MatchHistoryController, MatchHistoryInternalController],
  providers: [
    MatchHistoryService,
    MatchHistoryPoller,
    SteamMatchHistoryClient,
    PlayerSessionGuard,
    AdminAuthGuard,
  ],
  exports: [MatchHistoryService],
})
export class MatchHistoryModule {}
