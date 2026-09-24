import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES_METADATA } from './roles.decorator.js';
import type { AuthenticatedRequest } from './auth.guard.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES_METADATA, [context.getHandler(), context.getClass()]) ?? [];

    if (requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userRoles = new Set(request.auth?.user.roles ?? []);
    if (requiredRoles.some((role) => userRoles.has(role))) {
      return true;
    }

    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Current user is not allowed to perform this action',
    });
  }
}
