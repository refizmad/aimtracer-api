import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PlayerSessionGuard, AuthenticatedPlayer } from '../common/player-session.guard';
import { CurrentPlayer } from '../common/current-player.decorator';
import { ClipsService } from './clips.service';

@ApiTags('clips')
@ApiSecurity('session-token')
@UseGuards(PlayerSessionGuard)
@Controller('clips')
export class ClipsController {
  constructor(private readonly clips: ClipsService) {}

  /**
   * All friends' clips (ADR-0002). Session required; no public access.
   */
  @Get()
  @ApiOperation({ summary: "List all friends' clips (paginated, filterable)" })
  @ApiQuery({ name: 'player', required: false, description: 'Steam64 of clip owner' })
  @ApiQuery({ name: 'map', required: false })
  @ApiQuery({ name: 'minKills', required: false })
  @ApiQuery({ name: 'type', required: false, description: 'Moment type: 2k/3k/4k/ace/clutch…' })
  @ApiQuery({ name: 'sort', required: false, description: 'date | kills | score' })
  @ApiQuery({ name: 'order', required: false, description: 'asc | desc' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  async list(
    @CurrentPlayer() _player: AuthenticatedPlayer,
    @Query('player') steamId64?: string,
    @Query('map') map?: string,
    @Query('minKills') minKills?: string,
    @Query('type') type?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.clips.listClips({
      steamId64: steamId64?.trim() || undefined,
      map: map?.trim() || undefined,
      minKills: minKills != null && minKills !== '' ? parseInt(minKills, 10) : undefined,
      type: type?.trim() || undefined,
      sort: parseSort(sort),
      order: parseOrder(order),
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('mine')
  @ApiOperation({ summary: "List the current player's clips" })
  @ApiQuery({ name: 'map', required: false })
  @ApiQuery({ name: 'minKills', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'sort', required: false })
  @ApiQuery({ name: 'order', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  async listMine(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Query('map') map?: string,
    @Query('minKills') minKills?: string,
    @Query('type') type?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.clips.listClips({
      playerId: player.id,
      map: map?.trim() || undefined,
      minKills: minKills != null && minKills !== '' ? parseInt(minKills, 10) : undefined,
      type: type?.trim() || undefined,
      sort: parseSort(sort),
      order: parseOrder(order),
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get(':id/media')
  @ApiOperation({
    summary:
      'Resolve a short-lived playable URL (video or JPEG poster via ?kind=poster)',
  })
  @ApiQuery({ name: 'kind', required: false, description: 'video (default) | poster' })
  async media(
    @CurrentPlayer() _player: AuthenticatedPlayer,
    @Param('id') id: string,
    @Query('kind') kind?: string,
  ) {
    const k = kind?.toLowerCase() === 'poster' ? 'poster' : 'video';
    return this.clips.getPlayableMedia(id, k);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one clip by id' })
  async getOne(
    @CurrentPlayer() _player: AuthenticatedPlayer,
    @Param('id') id: string,
  ) {
    const clip = await this.clips.getPublicClip(id);
    return { clip };
  }
}

function parseSort(v?: string): 'date' | 'kills' | 'score' {
  if (v === 'kills' || v === 'score' || v === 'date') return v;
  return 'date';
}

function parseOrder(v?: string): 'asc' | 'desc' {
  return v === 'asc' ? 'asc' : 'desc';
}
