import { Module } from '@nestjs/common';
import { ClipsService } from './clips.service';
import { ClipsController } from './clips.controller';
import { S3MediaService } from './s3-media.service';
import { DiscordNotifyService } from './discord-notify.service';
import { PlayerSessionGuard } from '../common/player-session.guard';

@Module({
  controllers: [ClipsController],
  providers: [
    ClipsService,
    S3MediaService,
    DiscordNotifyService,
    PlayerSessionGuard,
  ],
  exports: [ClipsService, S3MediaService],
})
export class ClipsModule {}
