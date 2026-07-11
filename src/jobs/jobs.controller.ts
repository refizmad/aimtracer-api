import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { PlayerSessionGuard, AuthenticatedPlayer } from '../common/player-session.guard';
import { CurrentPlayer } from '../common/current-player.decorator';

@ApiTags('jobs')
@ApiSecurity('session-token')
@UseGuards(PlayerSessionGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * Enqueue a clip job for the logged-in friend.
   * Server forces trustedSteamIds to exactly [player.steamId64].
   */
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Enqueue a clip job for the current player' })
  async create(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Body() dto: CreateJobDto,
  ) {
    const shareCode =
      typeof dto.payload?.shareCode === 'string' ? dto.payload.shareCode.trim() : '';
    if (!shareCode) {
      throw new ForbiddenException('payload.shareCode is required');
    }

    const options =
      dto.payload?.options && typeof dto.payload.options === 'object'
        ? dto.payload.options
        : {};

    const job = await this.jobsService.createJobForPlayer({
      playerId: player.id,
      steamId64: player.steamId64,
      shareCode,
      type: dto.type,
      options,
      maxAttempts: dto.maxAttempts,
    });
    return { job };
  }

  @Get()
  @ApiOperation({ summary: 'List jobs for the current player' })
  @ApiQuery({ name: 'limit', required: false })
  async list(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Query('limit') limit?: string,
  ) {
    const jobs = await this.jobsService.listJobsForPlayer(
      player.id,
      limit ? parseInt(limit, 10) : 50,
    );
    return { jobs };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single job owned by the current player' })
  async getOne(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Param('id') id: string,
  ) {
    const job = await this.jobsService.getJob(id);
    if (job.playerId !== player.id) {
      throw new NotFoundException('Job not found');
    }
    return { job };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a job owned by the current player' })
  async delete(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Param('id') id: string,
  ) {
    const job = await this.jobsService.getJob(id);
    if (job.playerId !== player.id) {
      throw new NotFoundException('Job not found');
    }
    await this.jobsService.deleteJob(id);
  }
}
