import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../packages/backend/generated/prisma/client.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  readonly client: InstanceType<typeof PrismaClient>;

  constructor() {
    const connectionString =
      process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

    this.client = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }
}
