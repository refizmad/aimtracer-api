import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedWorker } from './worker-auth.guard';

export const CurrentWorker = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthenticatedWorker => {
    const request = ctx.switchToHttp().getRequest();
    return request.worker;
  },
);
