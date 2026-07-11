import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';
import { timingSafeEqualString } from './crypto.util';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const provided =
      (req.headers['x-admin-token'] as string | undefined) ||
      (req.headers['x-bootstrap-token'] as string | undefined) ||
      '';

    const expected =
      this.config.get<string>('ADMIN_TOKEN') ||
      this.config.get<string>('BOOTSTRAP_TOKEN') ||
      '';

    if (!expected || !provided || !timingSafeEqualString(provided, expected)) {
      throw new UnauthorizedException('Invalid admin token');
    }
    return true;
  }
}
