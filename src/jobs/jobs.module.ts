import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { PlayerSessionGuard } from '../common/player-session.guard';
import { ClipsModule } from '../clips/clips.module';

@Module({
  imports: [ClipsModule],
  providers: [JobsService, PlayerSessionGuard],
  controllers: [JobsController],
  exports: [JobsService],
})
export class JobsModule {}
