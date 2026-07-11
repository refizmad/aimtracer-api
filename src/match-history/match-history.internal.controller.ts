import { Controller, Post, HttpCode, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MatchHistoryService } from './match-history.service';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { JobsService } from '../jobs/jobs.service';

@ApiTags('internal')
@ApiSecurity('admin-token')
@UseGuards(AdminAuthGuard)
@Controller('internal/match-history')
export class MatchHistoryInternalController {
  constructor(
    private readonly matchHistory: MatchHistoryService,
    private readonly jobs: JobsService,
  ) {}

  @Post('poll')
  @HttpCode(200)
  @ApiOperation({ summary: 'Admin/cron: poll all ACTIVE enrollments' })
  async poll() {
    await this.jobs.cleanupStaleLeases().catch(() => {});
    return this.matchHistory.pollAll();
  }
}
