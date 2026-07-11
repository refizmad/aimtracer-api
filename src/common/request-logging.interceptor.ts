import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Structured-ish HTTP access log: method path status duration ip.
 * Skips health probes to keep Coolify noise down.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const res = http.getResponse<FastifyReply>();
    const method = req.method;
    const url = req.url || '';
    const path = url.split('?')[0];
    const start = Date.now();
    const quiet = path === '/health' || path === '/health/ready' || path === '/';

    return next.handle().pipe(
      tap({
        next: () => {
          if (quiet) return;
          const ms = Date.now() - start;
          const status = res.statusCode ?? 200;
          const ip = clientIp(req);
          this.logger.log(
            `${method} ${path} ${status} ${ms}ms ip=${ip}${authHint(req)}`,
          );
        },
        error: (err: { status?: number; statusCode?: number; message?: string }) => {
          const ms = Date.now() - start;
          const status = err?.status ?? err?.statusCode ?? 500;
          const ip = clientIp(req);
          const msg = (err?.message || 'error').slice(0, 160);
          if (status >= 500) {
            this.logger.error(
              `${method} ${path} ${status} ${ms}ms ip=${ip} ${msg}`,
            );
          } else if (!quiet) {
            this.logger.warn(
              `${method} ${path} ${status} ${ms}ms ip=${ip} ${msg}`,
            );
          }
        },
      }),
    );
  }
}

export function clientIp(req: FastifyRequest): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) {
    return xf.split(',')[0].trim();
  }
  if (Array.isArray(xf) && xf[0]) {
    return String(xf[0]).split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function authHint(req: FastifyRequest): string {
  if (req.headers['x-machine-token']) return ' auth=worker';
  if (req.headers['x-admin-token'] || req.headers['x-bootstrap-token']) {
    return ' auth=admin';
  }
  if (req.headers['authorization'] || req.headers['x-session-token']) {
    return ' auth=session';
  }
  return '';
}
