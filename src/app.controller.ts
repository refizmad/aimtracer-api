import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { S3MediaService } from './clips/s3-media.service';

@ApiTags('meta')
@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: S3MediaService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe (process up)' })
  health() {
    return {
      status: 'ok',
      service: 'aimtrace-api',
      time: new Date().toISOString(),
    };
  }

  /**
   * Readiness: DB reachable. Coolify/k8s should prefer this before routing traffic.
   */
  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness probe (DB + optional S3 flag)' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        reason: 'database_unreachable',
        message: (e as Error).message,
      });
    }

    return {
      status: 'ready',
      service: 'aimtrace-api',
      time: new Date().toISOString(),
      checks: {
        database: 'ok',
        s3Media: this.media.isConfigured() ? 'ok' : 'unconfigured',
      },
    };
  }

  @Get()
  root() {
    return {
      name: 'aimtrace-api',
      version: '0.1.0',
      health: '/health',
      ready: '/health/ready',
    };
  }
}
