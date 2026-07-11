import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthenticatedWorker {
  id: string;
  name: string;
  machineToken: string;
}

@Injectable()
export class WorkerAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { worker?: AuthenticatedWorker }>();

    const token =
      (req.headers['x-machine-token'] as string) ||
      (req.headers['authorization']?.replace(/^Bearer\s+/i, '') as string);

    if (!token) {
      throw new UnauthorizedException('Missing X-Machine-Token or Authorization header');
    }

    const worker = await this.prisma.worker.findUnique({
      where: { machineToken: token },
    });

    if (!worker || !worker.enabled) {
      throw new UnauthorizedException('Invalid or disabled machine token');
    }

    // Update last seen (fire and forget, best effort)
    this.prisma.worker
      .update({
        where: { id: worker.id },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => {});

    req.worker = {
      id: worker.id,
      name: worker.name,
      machineToken: worker.machineToken,
    };

    return true;
  }
}
