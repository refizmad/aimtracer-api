import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { clientIp } from './request-logging.interceptor';

/**
 * Ensures unhandled errors are logged with request context and that
 * production responses do not leak stack traces.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let body: string | object = {
      statusCode: status,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };

    if (isHttp) {
      const resp = exception.getResponse();
      body =
        typeof resp === 'string'
          ? { statusCode: status, message: resp }
          : (resp as object);
    }

    const method = req.method;
    const path = (req.url || '').split('?')[0];
    const ip = clientIp(req);
    const errMsg =
      exception instanceof Error ? exception.message : String(exception);

    if (status >= 500) {
      this.logger.error(
        `${method} ${path} ${status} ip=${ip} ${errMsg}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (status !== HttpStatus.NOT_FOUND) {
      // 404s are common probes; skip warn noise
      this.logger.warn(`${method} ${path} ${status} ip=${ip} ${errMsg}`);
    }

    // Never attach stack to the client response.
    res.status(status).send(body);
  }
}
