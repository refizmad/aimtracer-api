import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MatchHistoryService } from './match-history.service';
import { PlayerSessionGuard, AuthenticatedPlayer } from '../common/player-session.guard';
import { CurrentPlayer } from '../common/current-player.decorator';

@ApiTags('match-history')
@ApiSecurity('session-token')
@UseGuards(PlayerSessionGuard)
@Controller('match-history')
export class MatchHistoryController {
  constructor(private readonly matchHistory: MatchHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'Get current match-history enrollment (null if never enrolled)' })
  async get(@CurrentPlayer() player: AuthenticatedPlayer) {
    const enrollment = await this.matchHistory.getEnrollment(player.id);
    return { enrollment };
  }

  @Put()
  @ApiOperation({
    summary:
      'Enroll or re-enroll. Baselines to newest match (no historical jobs); only future matches auto-clip.',
  })
  async put(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Body() body: { authCode: string; knownShareCode: string },
  ) {
    const result = await this.matchHistory.putEnrollment(
      player.id,
      player.steamId64,
      body,
    );
    const { baselineSkipped, seedEnqueued, seedCount, ...enrollment } = result;
    return { enrollment, baselineSkipped, seedEnqueued, seedCount };
  }

  @Post('disable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause auto-clip polling' })
  async disable(@CurrentPlayer() player: AuthenticatedPlayer) {
    const enrollment = await this.matchHistory.disableEnrollment(player.id);
    return { enrollment };
  }

  @Post('enable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume auto-clip polling' })
  async enable(@CurrentPlayer() player: AuthenticatedPlayer) {
    const enrollment = await this.matchHistory.enableEnrollment(player.id);
    return { enrollment };
  }

  @Post('reanchor')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Fix CHAIN_BROKEN with a new known share code; baselines tip (no jobs)',
  })
  async reanchor(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Body() body: { knownShareCode: string },
  ) {
    const result = await this.matchHistory.reanchor(
      player.id,
      player.steamId64,
      body.knownShareCode,
    );
    const { baselineSkipped, seedEnqueued, seedCount, ...enrollment } = result;
    return { enrollment, baselineSkipped, seedEnqueued, seedCount };
  }

  @Post('baseline')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Fast-forward tip to newest match; seed last N recent games (MATCH_HISTORY_SEED_COUNT); skip older history',
  })
  async baseline(@CurrentPlayer() player: AuthenticatedPlayer) {
    const result = await this.matchHistory.baselineNow(player.id, player.steamId64, {
      seed: true,
    });
    const { baselineSkipped, seedEnqueued, seedCount, ...enrollment } = result;
    return { enrollment, baselineSkipped, seedEnqueued, seedCount };
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete enrollment and encrypted credentials' })
  async remove(@CurrentPlayer() player: AuthenticatedPlayer) {
    await this.matchHistory.deleteEnrollment(player.id);
  }

  @Post('poll-now')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manually trigger a poll for the current player (dev / force check)' })
  async pollNow(@CurrentPlayer() player: AuthenticatedPlayer) {
    const enqueued = await this.matchHistory.pollPlayer(player.id);
    const enrollment = await this.matchHistory.getEnrollment(player.id);
    return { enqueued, enrollment };
  }
}
