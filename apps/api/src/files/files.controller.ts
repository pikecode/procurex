import { Controller, Get, Headers, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import type { AuthenticatedSession } from '../auth/auth.service.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { FilesService } from './files.service.js';

@Controller('files')
@UseGuards(AuthGuard, RolesGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload-sessions')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  create(@CurrentAuth() auth: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const body = (request as AuthenticatedRequest & { body?: { purpose?: string; filename?: string; mimeType?: string; sizeBytes?: number } }).body;
    return this.files.create(auth.user.id, { purpose: body?.purpose ?? '', filename: body?.filename ?? '', mimeType: body?.mimeType ?? '', sizeBytes: body?.sizeBytes ?? 0 });
  }

  @Post(':id/content')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  async upload(@CurrentAuth() auth: AuthenticatedSession, @Param('id') id: string, @Headers('x-upload-token') token: string, @Req() request: AuthenticatedRequest) {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request as unknown as AsyncIterable<Buffer>) {
      length += chunk.length;
      if (length > 10 * 1024 * 1024) break;
      chunks.push(chunk);
    }
    if (length > 10 * 1024 * 1024) return this.files.upload(auth.user.id, id, token, Buffer.alloc(10 * 1024 * 1024 + 1));
    return this.files.upload(auth.user.id, id, token, Buffer.concat(chunks));
  }

  @Post(':id/complete')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  complete(@CurrentAuth() auth: AuthenticatedSession, @Param('id') id: string) { return this.files.complete(auth.user.id, id); }

  @Get(':id/download')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  async download(@CurrentAuth() auth: AuthenticatedSession, @Param('id') id: string, @Res() response: { setHeader(name: string, value: string): void; end(bytes: Buffer): void }) {
    const result = await this.files.download(auth.user.id, id, auth.user.scope, auth.user.roles);
    response.setHeader('content-type', result.file.mimeType);
    response.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(result.file.filename)}"`);
    response.end(result.bytes);
  }
}
