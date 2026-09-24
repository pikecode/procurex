import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, bearerToken, type AuthenticatedRequest } from './auth.guard.js';
import { AuthService, type AuthenticatedSession, type LoginResult } from './auth.service.js';
import { CurrentAuth } from './current-auth.decorator.js';
import { throwIfInvalid } from '../common/request-contract.js';
import type { ValidationIssue } from '../../../../packages/domain/src/validation.js';

type LoginBody = {
  username?: unknown;
  password?: unknown;
  client?: unknown;
};

type LoginResponse = {
  accessToken: string;
  expiresAt: string;
  user: LoginResult['user'];
};

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/login')
  async login(@Body() body: LoginBody): Promise<LoginResponse> {
    const input = parseLoginBody(body);
    const result = await this.authService.login(input);

    return {
      accessToken: result.accessToken,
      expiresAt: result.session.expiresAt.toISOString(),
      user: result.user,
    };
  }

  @Post('auth/logout')
  @UseGuards(AuthGuard)
  async logout(@Req() request: AuthenticatedRequest): Promise<{ revoked: true }> {
    const token = bearerToken(request);
    if (token) {
      await this.authService.logout(token);
    }

    return { revoked: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  readMe(@CurrentAuth() auth: AuthenticatedSession): {
    user: LoginResult['user'];
    session: { id: string; client: string; expiresAt: string };
  } {
    return {
      user: auth.user,
      session: {
        id: auth.session.id,
        client: auth.session.client,
        expiresAt: auth.session.expiresAt.toISOString(),
      },
    };
  }
}

function parseLoginBody(body: LoginBody): { username: string; password: string; client: string } {
  const issues: ValidationIssue[] = [];

  if (typeof body.username !== 'string' || body.username.trim().length === 0) {
    issues.push({ field: 'username', code: 'INVALID_USERNAME', message: 'username is required' });
  }

  if (typeof body.password !== 'string' || body.password.length === 0) {
    issues.push({ field: 'password', code: 'INVALID_PASSWORD', message: 'password is required' });
  }

  if (typeof body.client !== 'string' || body.client.trim().length === 0) {
    issues.push({ field: 'client', code: 'INVALID_CLIENT', message: 'client is required' });
  }

  throwIfInvalid(issues);

  return {
    username: (body.username as string).trim(),
    password: body.password as string,
    client: (body.client as string).trim(),
  };
}
