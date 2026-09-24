import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { User } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type UserView = {
  id: string;
  username: string;
  displayName: string;
  phone: string | null;
  status: UserStatus;
  version: number;
  roles: string[];
  createdAt: string;
  updatedAt: string;
};

export type UpdateUserInput = {
  expectedVersion: number;
  status?: UserStatus;
  displayName?: string;
};

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  async listUsers(): Promise<UserView[]> {
    const users = await this.database.client.user.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { roles: { include: { role: true } } },
    });

    return users.map(toUserView);
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<UserView> {
    const existing = await this.database.client.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });

    if (!existing) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User was not found',
      });
    }

    const version = userVersion(existing);
    if (version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'User version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: version },
      });
    }

    const updated = await this.database.client.user.update({
      where: { id },
      data: {
        status: input.status,
        displayName: input.displayName,
      },
      include: { roles: { include: { role: true } } },
    });

    return toUserView(updated);
  }
}

function toUserView(user: User & { roles: Array<{ role: { code: string } }> }): UserView {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    phone: user.phone,
    status: user.status,
    version: userVersion(user),
    roles: user.roles.map((entry) => entry.role.code).sort(),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function userVersion(user: Pick<User, 'updatedAt'>): number {
  return user.updatedAt.getTime();
}
