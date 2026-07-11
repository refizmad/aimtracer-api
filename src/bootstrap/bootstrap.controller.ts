import {
  Controller,
  Post,
  Body,
  Headers,
  UnauthorizedException,
  HttpCode,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@ApiTags('bootstrap')
@ApiSecurity('bootstrap-token')
@Controller('bootstrap')
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class BootstrapController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * One-time (or admin) registration of a new worker machine.
   * Protect this in production (network, or strong secret).
   *
   * curl -X POST http://.../bootstrap/worker \
   *   -H "X-Bootstrap-Token: $BOOTSTRAP_TOKEN" \
   *   -d '{"name":"render-box-01"}'
   */
  @Post('worker')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a new worker machine and issue its machine token' })
  async registerWorker(
    @Headers('x-bootstrap-token') bootstrapToken: string,
    @Body() body: { name: string },
  ) {
    // Accept BOOTSTRAP_TOKEN or ADMIN_TOKEN so one Coolify secret is enough.
    const expected =
      this.config.get<string>('BOOTSTRAP_TOKEN') ||
      this.config.get<string>('ADMIN_TOKEN') ||
      '';
    if (!expected || !bootstrapToken || bootstrapToken !== expected) {
      throw new UnauthorizedException('Invalid bootstrap token');
    }

    if (!body?.name) {
      throw new UnauthorizedException('name is required');
    }

    // Generate a strong token for the machine
    const raw = crypto.randomUUID().replace(/-/g, '') + Date.now().toString(36);
    const machineToken = 'mt_' + Buffer.from(raw).toString('base64url').slice(0, 40);

    const worker = await this.prisma.worker.create({
      data: {
        name: body.name,
        machineToken,
        enabled: true,
      },
    });

    // IMPORTANT: This token is only shown once. Store it on the worker machine.
    return {
      id: worker.id,
      name: worker.name,
      machineToken, // <-- give this to the clipper worker
      note: 'Store the machineToken securely on the worker. It will not be shown again.',
    };
  }
}
