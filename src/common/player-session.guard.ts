import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { sha256Hex } from './crypto.util';
import { PlayerStatus } from '../prisma/client';

export interface AuthenticatedPlayer {
  id: string;
  steamId64: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: PlayerStatus;
  sessionId: string;
}

@Injectable()
export class PlayerSessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<FastifyRequest & { player?: AuthenticatedPlayer }>();

    const token = extractSessionToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing session token');
    }

    const tokenHash = sha256Hex(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { player: true },
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) {
        await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      }
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (session.player.status === PlayerStatus.DISABLED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DISABLED',
        message: 'This account has been disabled',
      });
    }

    req.player = {
      id: session.player.id,
      steamId64: session.player.steamId64,
      displayName: session.player.displayName,
      avatarUrl: session.player.avatarUrl,
      status: session.player.status,
      sessionId: session.id,
    };

    return true;
  }
}

function extractSessionToken(req: FastifyRequest): string | null {
  const header = req.headers['x-session-token'];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  return null;
}
