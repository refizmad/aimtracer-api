import { Module } from '@nestjs/common';
import { WorkerController } from './worker.controller';
import { WorkerAuthGuard } from '../common/worker-auth.guard';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [JobsModule],
  controllers: [WorkerController],
  providers: [WorkerAuthGuard],
})
export class WorkerModule {}
