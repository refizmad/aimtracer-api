import { Module } from '@nestjs/common';
import { WorkerController } from './worker.controller';
import { WorkerAuthGuard } from '../common/worker-auth.guard';
import { WorkerLogsService } from './worker-logs.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [JobsModule],
  controllers: [WorkerController],
  providers: [WorkerAuthGuard, WorkerLogsService],
  exports: [WorkerLogsService],
})
export class WorkerModule {}
