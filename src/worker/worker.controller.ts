import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { WorkerAuthGuard, AuthenticatedWorker } from '../common/worker-auth.guard';
import { CurrentWorker } from '../common/current-worker.decorator';
import { JobsService } from '../jobs/jobs.service';
import { LeaseQueryDto } from '../jobs/dto/lease-job.dto';
import { UpdateProgressDto } from '../jobs/dto/update-progress.dto';
import { ShipLogsDto } from './dto/ship-logs.dto';
import { WorkerLogsService } from './worker-logs.service';

@ApiTags('worker')
@ApiSecurity('machine-token')
@Controller('worker')
@UseGuards(WorkerAuthGuard)
export class WorkerController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly workerLogs: WorkerLogsService,
  ) {}

  /**
   * Lease the next available job.
   * Supports optional long-poll via ?wait=25 (seconds).
   */
  @Get('jobs/lease')
  @ApiOperation({ summary: 'Lease the next available job (optional long-poll via ?wait)' })
  async lease(
    @CurrentWorker() worker: AuthenticatedWorker,
    @Query() query: LeaseQueryDto,
  ) {
    const wait = query.wait ?? 0;
    const job = await this.jobsService.leaseJobWithWait(worker.id, wait);

    if (!job) {
      return { job: null };
    }

    // Return a sanitized view (hide internal lease fields from worker if desired)
    return {
      job: {
        id: job.id,
        type: job.type,
        payload: job.payload,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        leaseExpiresAt: job.leaseExpiresAt,
        createdAt: job.createdAt,
      },
    };
  }

  /**
   * Report progress or terminal state for a leased job.
   * Workers should call this periodically (e.g. every 5-15s) and on key milestones.
   */
  @Patch('jobs/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Report progress or terminal state for a leased job' })
  async updateProgress(
    @CurrentWorker() worker: AuthenticatedWorker,
    @Param('id') id: string,
    @Body() dto: UpdateProgressDto,
  ) {
    const job = await this.jobsService.updateJobProgress(id, worker.id, dto);
    return { ok: true, jobId: job.id, status: job.status, progress: job.progress };
  }

  /**
   * Ship a batch of console-log lines for the admin dashboard's live tail.
   * Best-effort: the worker drops batches on failure instead of retrying.
   */
  @Post('logs')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ship worker console-log lines (admin live tail)' })
  async shipLogs(
    @CurrentWorker() worker: AuthenticatedWorker,
    @Body() dto: ShipLogsDto,
  ) {
    const res = await this.workerLogs.ingest(worker.id, dto.lines);
    return { ok: true, ...res };
  }

  // Convenience: allow worker to fetch full details of a job it is working on
  @Get('jobs/:id')
  @ApiOperation({ summary: 'Fetch full details of a job the worker is handling' })
  async getJob(
    @CurrentWorker() worker: AuthenticatedWorker,
    @Param('id') id: string,
  ) {
    const job = await this.jobsService.getJob(id);
    // Only the assigned worker (or if terminal) should see details
    if (job.leasedBy && job.leasedBy !== worker.id && !['COMPLETED', 'FAILED'].includes(job.status)) {
      return { error: 'Not your leased job' };
    }
    return { job };
  }
}
