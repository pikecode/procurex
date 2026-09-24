import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService, type AuthenticatedSession } from './auth.service.js';
import { headerValue, type TraceableRequest } from '../common/request-context.js';

export type AuthenticatedRequest = TraceableRequest & {
  auth?: AuthenticatedSession;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessToken = bearerToken(request);

    if (!accessToken) {
      throw new UnauthorizedException({
        code: 'MISSING_AUTH_TOKEN',
        message: 'Bearer token is required',
      });
    }

    const authenticated = await this.authService.authenticate(accessToken);
    if (!authenticated) {
      throw new UnauthorizedException({
        code: 'INVALID_AUTH_TOKEN',
        message: 'Bearer token is invalid or expired',
      });
    }

    request.auth = authenticated;
    return true;
  }
}

export function bearerToken(request: TraceableRequest): string | undefined {
  const authorization = headerValue(request.headers, 'authorization');
  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || token.trim().length === 0) {
    return undefined;
  }

  return token;
}
