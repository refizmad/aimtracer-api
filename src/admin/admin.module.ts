import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { JobsModule } from '../jobs/jobs.module';
import { WorkerModule } from '../worker/worker.module';

@Module({
  imports: [PrismaModule, JobsModule, WorkerModule],
  controllers: [AdminController],
  providers: [AdminAuthGuard, AdminService],
  exports: [AdminService],
})
export class AdminModule {}
