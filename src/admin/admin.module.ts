import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { JobsModule } from '../jobs/jobs.module';
import { WorkerModule } from '../worker/worker.module';
import { ClipsModule } from '../clips/clips.module';

@Module({
  imports: [PrismaModule, JobsModule, WorkerModule, ClipsModule],
  controllers: [AdminController],
  providers: [AdminAuthGuard, AdminService],
  exports: [AdminService],
})
export class AdminModule {}
