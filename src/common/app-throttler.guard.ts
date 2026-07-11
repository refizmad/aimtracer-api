import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { FastifyRequest } from 'fastify';
import { clientIp } from './request-logging.interceptor';

/**
 * Rate-limit guard with:
 * - trust of X-Forwarded-For (Coolify / reverse proxy)
 * - skip health + worker machine-token traffic (long-poll lease must not 429)
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

    // Authenticated workers poll/lease frequently; limit elsewhere (session/admin/auth).
    if (typeof req.headers['x-machine-token'] === 'string') {
      return true;
    }

    return false;
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Nest throttler passes the raw request; FastifyRequest-compatible.
    return clientIp(req as FastifyRequest);
  }
}
