import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PlayerSessionGuard } from '../common/player-session.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, PlayerSessionGuard],
  exports: [AuthService, PlayerSessionGuard],
})
export class AuthModule {}
