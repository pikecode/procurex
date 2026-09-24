import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { TemplatesService, type TemplateStoresView, type TemplateView } from './templates.service.js';
import { validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type CreateTemplateBody = { code?: unknown; name?: unknown };
type PutTemplateStoresBody = { expectedVersion?: unknown; storeIds?: unknown };

@Controller('templates')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN', 'PURCHASER')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  listTemplates(): Promise<TemplateView[]> {
    return this.templatesService.listTemplates();
  }

  @Post()
  createTemplate(@Body() body: CreateTemplateBody): Promise<TemplateView> {
    const input = parseCreateTemplateBody(body);
    return this.templatesService.createTemplate(input);
  }

  @Put(':id/stores')
  replaceStores(@Param('id') id: string, @Body() body: PutTemplateStoresBody): Promise<TemplateStoresView> {
    const input = parsePutTemplateStoresBody(id, body);
    return this.templatesService.replaceTemplateStores(id, input.expectedVersion, input.storeIds);
  }
}

function parseCreateTemplateBody(body: CreateTemplateBody): { code: string; name: string } {
  const issues: ValidationIssue[] = [];
  const code = requiredTrimmedString('code', body.code, issues);
  const name = requiredTrimmedString('name', body.name, issues);
  throwIfInvalid(issues);
  return { code: code!, name: name! };
}

function parsePutTemplateStoresBody(id: string, body: PutTemplateStoresBody): { expectedVersion: number; storeIds: string[] } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const storeIds: string[] = [];
  if (!Array.isArray(body.storeIds)) {
    issues.push({ field: 'storeIds', code: 'INVALID_STORE_IDS', message: 'storeIds must be an array' });
  } else {
    for (const [index, storeId] of body.storeIds.entries()) {
      issues.push(...validateUuid(`storeIds.${index}`, storeId));
      if (typeof storeId === 'string') {
        storeIds.push(storeId);
      }
    }
  }

  throwIfInvalid(issues);
  return { expectedVersion: body.expectedVersion as number, storeIds };
}

function requiredTrimmedString(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, code: 'REQUIRED_STRING', message: `${field} is required` });
    return undefined;
  }
  return value.trim();
}
