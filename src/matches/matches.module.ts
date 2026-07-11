import { Module } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { MatchesController } from './matches.controller';
import { PlayerSessionGuard } from '../common/player-session.guard';

@Module({
  controllers: [MatchesController],
  providers: [MatchesService, PlayerSessionGuard],
  exports: [MatchesService],
})
export class MatchesModule {}
