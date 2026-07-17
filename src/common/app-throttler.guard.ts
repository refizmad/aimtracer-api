import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { FastifyRequest } from 'fastify';
import { clientIp } from './request-logging.interceptor';

/**
 * Rate-limit guard with:
 * - trust of X-Forwarded-For (Coolify / reverse proxy)
 * - skip health + `/worker/*` only (long-poll lease must not 429; header alone is not enough)
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const path = (req.url || '').split('?')[0];

    if (path === '/health' || path === '/health/ready' || path === '/') {
      return true;
    }

    // Only skip throttling for worker routes. Do NOT skip whenever a client
    // merely sends X-Machine-Token — that would let anyone bypass rate limits
    // on auth/admin/public endpoints with a dummy header.
    if (path === '/worker' || path.startsWith('/worker/')) {
      return true;
    }

    return false;
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Nest throttler passes the raw request; FastifyRequest-compatible.
    return clientIp(req as FastifyRequest);
  }
}
