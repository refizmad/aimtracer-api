import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MatchStatus } from '@prisma/client';
import { PlayerSessionGuard, AuthenticatedPlayer } from '../common/player-session.guard';
import { CurrentPlayer } from '../common/current-player.decorator';
import { MatchesService } from './matches.service';

@ApiTags('matches')
@ApiSecurity('session-token')
@UseGuards(PlayerSessionGuard)
@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get('mine')
  @ApiOperation({
    summary: "List the current player's matches (pipeline status + clip count)",
  })
  @ApiQuery({ name: 'status', required: false, description: 'DETECTED|DOWNLOADED|RENDERED|FAILED' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  async listMine(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.matches.listMine({
      playerId: player.id,
      status: parseStatus(status),
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }
}

function parseStatus(v?: string): MatchStatus | undefined {
  if (!v) return undefined;
  const u = v.toUpperCase();
  if (
    u === 'DETECTED' ||
    u === 'DOWNLOADED' ||
    u === 'RENDERED' ||
    u === 'FAILED'
  ) {
    return u as MatchStatus;
  }
  return undefined;
}
