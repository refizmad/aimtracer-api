import { Module } from '@nestjs/common';
import { ClipsService } from './clips.service';

@Module({
  providers: [ClipsService],
  exports: [ClipsService],
})
export class ClipsModule {}
