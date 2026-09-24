import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get('live')
  readLiveness(): { status: 'ok'; service: 'procurex-api' } {
    return {
      status: 'ok',
      service: 'procurex-api',
    };
  }

  @Get('ready')
  async readReadiness(): Promise<{ status: 'ok'; database: 'reachable' }> {
    await this.database.ping();
    return {
      status: 'ok',
      database: 'reachable',
    };
  }
}
