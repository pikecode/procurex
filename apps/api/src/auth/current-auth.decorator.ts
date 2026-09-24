import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';
import type { AuthenticatedSession } from './auth.service.js';

export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedSession => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) {
    throw new Error('CurrentAuth used without AuthGuard');
  }

  return request.auth;
});
