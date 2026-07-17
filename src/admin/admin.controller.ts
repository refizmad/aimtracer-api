import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JobStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { randomToken } from '../common/crypto.util';
import { AdminService } from './admin.service';
import { JobsService } from '../jobs/jobs.service';

@ApiTags('admin')
@ApiSecurity('admin-token')
@UseGuards(AdminAuthGuard)
@Controller('admin')
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly jobsService: JobsService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Overview stats for the admin dashboard' })
  async stats() {
    return this.admin.overview();
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Jobs list with optional status / failed-only filter' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'failedOnly', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async jobs(
    @Query('status') status?: string,
    @Query('failedOnly') failedOnly?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listJobs({
      status: parseJobStatus(status),
      failedOnly: failedOnly === '1' || failedOnly === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Requeue a FAILED job: attempts reset to 0, back to PENDING',
  })
  async retryJob(@Param('id') id: string) {
    const job = await this.jobsService.retryJob(id);
    return { job };
  }

  @Get('players')
  @ApiOperation({ summary: 'Per-player activity + enrollment + invite used' })
  async players() {
    return this.admin.listPlayers();
  }

  @Get('workers')
  @ApiOperation({ summary: 'Worker health, current job, queue depth' })
  async workers() {
    return this.admin.listWorkers();
  }

  @Post('invites')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a friends-only invite code' })
  async createInvite(
    @Body()
    body: {
      note?: string;
      maxUses?: number;
      expiresInDays?: number;
      /** Optional fixed code (default: random) */
      code?: string;
    },
  ) {
    const code =
      body.code?.trim() ||
      randomToken('inv_', 9).replace(/^inv_/, '').toUpperCase().slice(0, 12);

    const expiresAt =
      body.expiresInDays && body.expiresInDays > 0
        ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const invite = await this.prisma.invite.create({
      data: {
        code,
        note: body.note || null,
        maxUses: body.maxUses && body.maxUses > 0 ? body.maxUses : 1,
        expiresAt,
      },
    });

    return {
      invite: {
        id: invite.id,
        code: invite.code,
        note: invite.note,
        maxUses: invite.maxUses,
        useCount: invite.useCount,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        path: `/invite/${invite.code}`,
      },
    };
  }

  @Get('invites')
  @ApiOperation({ summary: 'List invite codes (which invite → which player)' })
  async listInvites() {
    return this.admin.listInvites();
  }

  @Post('workers')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Register a render worker; returns machineToken once',
  })
  async createWorker(
    @Body() body: { name?: string; machineToken?: string },
  ) {
    const worker = await this.admin.createWorker({
      name: body.name || 'render-pc',
      machineToken: body.machineToken,
    });
    return { worker };
  }

  /**
   * Worker setup only (machine token + Windows snippets).
   * Friend invites: POST /admin/invites — workers are not invited users.
   */
  @Post('setup')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Register render worker and return Windows env snippets',
  })
  async workerSetup(
    @Body()
    body: {
      workerName?: string;
      machineToken?: string;
      publicApiUrl?: string;
    },
  ) {
    return this.admin.workerSetup(body || {});
  }
}

function parseJobStatus(v?: string): JobStatus | undefined {
  if (!v) return undefined;
  const u = v.toUpperCase();
  const allowed: JobStatus[] = [
    'PENDING',
    'LEASED',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ];
  return allowed.includes(u as JobStatus) ? (u as JobStatus) : undefined;
}
