import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { WorkerModule } from './worker/worker.module';
import { JobsModule } from './jobs/jobs.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { MatchHistoryModule } from './match-history/match-history.module';
import { ClipsModule } from './clips/clips.module';
import { MatchesModule } from './matches/matches.module';
import { AppController } from './app.controller';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AppThrottlerGuard } from './common/app-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Defaults sized for friends beta behind Coolify (one IP = BFF server
        // for most browser traffic). Auth routes use a tighter @Throttle.
        const ttl = parseInt(String(config.get('RATE_LIMIT_TTL_MS') || 60000), 10);
        const limit = parseInt(String(config.get('RATE_LIMIT_MAX') || 120), 10);
        return [
          {
            name: 'default',
            ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : 60000,
            limit: Number.isFinite(limit) && limit > 0 ? limit : 120,
          },
        ];
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AdminModule,
    MatchHistoryModule,
    ClipsModule,
    MatchesModule,
    WorkerModule,
    JobsModule,
    BootstrapModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
