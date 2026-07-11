import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdminController],
  providers: [AdminAuthGuard],
})
export class AdminModule {}
