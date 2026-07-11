import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedPlayer } from './player-session.guard';

export const CurrentPlayer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPlayer => {
    const req = ctx.switchToHttp().getRequest();
    return req.player;
  },
);
