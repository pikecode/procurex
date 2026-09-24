import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES_METADATA = 'requiredRoles';

export function RequireRoles(...roles: string[]): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRED_ROLES_METADATA, roles);
}
