import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { buildSteamOpenIdUrl, verifySteamOpenId } from './steam-openid';
import { randomToken, sha256Hex } from '../common/crypto.util';
import { PlayerStatus } from '@prisma/client';

const STATE_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PublicPlayer {
  id: string;
  steamId64: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: PlayerStatus;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Start Steam OpenID. returnTo is the *web* callback URL (BFF), not the API.
   */
  async beginSteamLogin(opts: {
    inviteCode?: string;
    returnTo: string;
  }): Promise<{ redirectUrl: string; state: string }> {
    const allowedOrigins = this.getAllowedWebOrigins();
    if (allowedOrigins.length === 0) {
      throw new BadRequestException(
        'AUTH_RETURN_BASE_URL is not configured (public web origin, e.g. http://127.0.0.1:3000)',
      );
    }

    // Validate against allowlist; keep the browser's host (localhost vs 127.0.0.1).
    const returnTo = this.sanitizeReturnTo(opts.returnTo, allowedOrigins);
    const realm = new URL(returnTo).origin;
    const state = randomToken('as_', 16);

    // Embed state into return_to so Steam echoes it back (and we also store it).
    const callbackWithState = appendQuery(returnTo, { state });

    await this.prisma.authState.create({
      data: {
        state,
        inviteCode: opts.inviteCode?.trim() || null,
        returnTo: callbackWithState,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });

    // Opportunistic cleanup of expired states
    this.prisma.authState
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => {});

    const redirectUrl = buildSteamOpenIdUrl({
      returnTo: callbackWithState,
      realm,
    });

    return { redirectUrl, state };
  }

  async completeSteamLogin(opts: {
    query: Record<string, string | string[] | undefined>;
    state?: string;
  }): Promise<{ sessionToken: string; player: PublicPlayer; returnTo: string }> {
    const state =
      opts.state ||
      first(opts.query['state']) ||
      first(opts.query['openid.return_to'])?.match(/[?&]state=([^&]+)/)?.[1];

    if (!state) {
      throw new BadRequestException('Missing auth state');
    }

    const authState = await this.prisma.authState.findUnique({ where: { state } });
    if (!authState || authState.expiresAt.getTime() <= Date.now()) {
      if (authState) {
        await this.prisma.authState.delete({ where: { id: authState.id } }).catch(() => {});
      }
      throw new UnauthorizedException('Auth state expired or unknown — try again');
    }

    // One-time use
    await this.prisma.authState.delete({ where: { id: authState.id } });

    const verified = await verifySteamOpenId(opts.query);
    if (verified.ok === false) {
      this.logger.warn(`Steam OpenID failed: ${verified.reason}`);
      throw new UnauthorizedException('Steam login verification failed');
    }

    const steamId64 = verified.steamId64;
    let player = await this.prisma.player.findUnique({ where: { steamId64 } });

    if (player?.status === PlayerStatus.DISABLED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DISABLED',
        message: 'This account has been disabled',
      });
    }

    if (!player) {
      // Friends-only: first login requires a valid invite
      const inviteCode = authState.inviteCode;
      if (!inviteCode) {
        throw new ForbiddenException({
          code: 'INVITE_REQUIRED',
          message: 'This beta is invite-only. Ask a friend for an invite link.',
        });
      }
      player = await this.consumeInviteAndCreatePlayer(inviteCode, steamId64);
    }

    // Refresh persona if we have a Steam Web API key
    const persona = await this.fetchSteamPersona(steamId64);
    if (persona) {
      player = await this.prisma.player.update({
        where: { id: player.id },
        data: {
          displayName: persona.displayName,
          avatarUrl: persona.avatarUrl,
        },
      });
    }

    const sessionToken = randomToken('st_', 32);
    await this.prisma.session.create({
      data: {
        tokenHash: sha256Hex(sessionToken),
        playerId: player.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    return {
      sessionToken,
      player: toPublicPlayer(player),
      returnTo: stripStateParam(authState.returnTo),
    };
  }

  async getMe(playerId: string): Promise<PublicPlayer & { enrollment: null | {
    status: string;
    authCodeLast4: string;
    knownShareCode: string;
    lastShareCode: string;
    lastPolledAt: string | null;
    lastError: string | null;
  } }> {
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      include: { enrollment: true },
    });
    const e = player.enrollment;
    return {
      ...toPublicPlayer(player),
      enrollment: e
        ? {
            status: e.status,
            authCodeLast4: e.authCodeLast4,
            knownShareCode: e.knownShareCode,
            lastShareCode: e.lastShareCode,
            lastPolledAt: e.lastPolledAt?.toISOString() ?? null,
            lastError: e.lastError,
          }
        : null,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
  }

  private async consumeInviteAndCreatePlayer(code: string, steamId64: string) {
    const invite = await this.prisma.invite.findUnique({ where: { code } });
    if (!invite) {
      throw new ForbiddenException({
        code: 'INVITE_INVALID',
        message: 'Invite code is not valid',
      });
    }
    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException({
        code: 'INVITE_EXPIRED',
        message: 'Invite code has expired',
      });
    }
    if (invite.useCount >= invite.maxUses) {
      throw new ForbiddenException({
        code: 'INVITE_EXHAUSTED',
        message: 'Invite code has already been used',
      });
    }

    // Transaction: increment use + create player
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.invite.updateMany({
        where: {
          id: invite.id,
          useCount: { lt: invite.maxUses },
        },
        data: { useCount: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ForbiddenException({
          code: 'INVITE_EXHAUSTED',
          message: 'Invite code has already been used',
        });
      }

      const player = await tx.player.create({
        data: {
          steamId64,
          status: PlayerStatus.ACTIVE,
        },
      });

      // Track first consumer for single-use invites
      if (invite.maxUses === 1) {
        await tx.invite.update({
          where: { id: invite.id },
          data: { usedById: player.id },
        });
      }

      return player;
    });
  }

  /**
   * Comma-separated AUTH_RETURN_BASE_URL values, plus localhost ↔ 127.0.0.1 aliases
   * so local dev works whether the user opens either host.
   */
  private getAllowedWebOrigins(): string[] {
    const raw = this.config.get<string>('AUTH_RETURN_BASE_URL') || '';
    const origins = new Set<string>();
    for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      try {
        const u = new URL(part);
        origins.add(u.origin);
        // Localhost alias pair (same port)
        if (u.hostname === '127.0.0.1') {
          origins.add(`${u.protocol}//localhost:${u.port || defaultPort(u.protocol)}`);
        } else if (u.hostname === 'localhost') {
          origins.add(`${u.protocol}//127.0.0.1:${u.port || defaultPort(u.protocol)}`);
        }
      } catch {
        /* skip bad entry */
      }
    }
    return [...origins];
  }

  private sanitizeReturnTo(returnTo: string, allowedOrigins: string[]): string {
    try {
      // Prefer absolute returnTo from the BFF; fall back to first allowed origin.
      const target = new URL(returnTo, allowedOrigins[0]);
      if (!allowedOrigins.includes(target.origin)) {
        this.logger.warn(
          `Rejected returnTo origin ${target.origin}; allowed: ${allowedOrigins.join(', ')}`,
        );
        throw new Error('origin mismatch');
      }
      // Force Steam callback path (don't let clients pick arbitrary paths).
      target.pathname = '/api/auth/steam/callback';
      target.search = '';
      target.hash = '';
      return target.toString();
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(
        `Invalid returnTo URL (allowed origins: ${allowedOrigins.join(', ')})`,
      );
    }
  }

  private async fetchSteamPersona(
    steamId64: string,
  ): Promise<{ displayName: string; avatarUrl: string } | null> {
    const key = this.config.get<string>('STEAM_API_KEY') || this.config.get<string>('STEAM_WEBAPI_KEY');
    if (!key) return null;
    try {
      const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
      url.searchParams.set('key', key);
      url.searchParams.set('steamids', steamId64);
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        response?: { players?: Array<{ personaname?: string; avatarfull?: string }> };
      };
      const p = data.response?.players?.[0];
      if (!p) return null;
      return {
        displayName: p.personaname || steamId64,
        avatarUrl: p.avatarfull || '',
      };
    } catch {
      return null;
    }
  }
}

function toPublicPlayer(p: {
  id: string;
  steamId64: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: PlayerStatus;
}): PublicPlayer {
  return {
    id: p.id,
    steamId64: p.steamId64,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    status: p.status,
  };
}

function appendQuery(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

function stripStateParam(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('state');
    // Prefer app page, not API callback, for final redirect
    if (u.pathname.includes('/api/auth/steam/callback')) {
      u.pathname = '/clips';
      u.search = '';
    }
    return u.toString();
  } catch {
    return '/clips';
  }
}

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function defaultPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80';
}
