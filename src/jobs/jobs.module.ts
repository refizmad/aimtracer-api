import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { PlayerSessionGuard } from '../common/player-session.guard';

@Module({
  providers: [JobsService, PlayerSessionGuard],
  controllers: [JobsController],
  exports: [JobsService],
})
export class JobsModule {}
