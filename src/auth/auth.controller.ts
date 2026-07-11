import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiSecurity } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { PlayerSessionGuard, AuthenticatedPlayer } from '../common/player-session.guard';
import { CurrentPlayer } from '../common/current-player.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('steam/begin')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Start Steam OpenID login (friends invite optional for returning users)' })
  async begin(
    @Body()
    body: {
      inviteCode?: string;
      /** Full web callback URL, e.g. http://127.0.0.1:3000/api/auth/steam/callback */
      returnTo?: string;
    },
  ) {
    const result = await this.authService.beginSteamLogin({
      inviteCode: body.inviteCode,
      returnTo: body.returnTo || '/api/auth/steam/callback',
    });
    return result;
  }

  @Post('steam/complete')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Complete Steam OpenID after callback; issues session token' })
  async complete(
    @Body()
    body: {
      /** OpenID query params from Steam callback */
      query: Record<string, string | string[] | undefined>;
      state?: string;
    },
  ) {
    const result = await this.authService.completeSteamLogin({
      query: body.query || {},
      state: body.state,
    });
    return {
      sessionToken: result.sessionToken,
      player: result.player,
      returnTo: result.returnTo,
    };
  }

  @Get('me')
  @UseGuards(PlayerSessionGuard)
  @ApiSecurity('session-token')
  @ApiOperation({ summary: 'Current authenticated player' })
  async me(@CurrentPlayer() player: AuthenticatedPlayer) {
    const me = await this.authService.getMe(player.id);
    return { player: me, enrollment: me.enrollment };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(PlayerSessionGuard)
  @ApiSecurity('session-token')
  @ApiOperation({ summary: 'Revoke current session' })
  async logout(@CurrentPlayer() player: AuthenticatedPlayer) {
    await this.authService.logout(player.sessionId);
  }
}
