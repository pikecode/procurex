import { BadRequestException } from '@nestjs/common';
import { validateIdempotencyKey, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type HeaderMap = Record<string, string | string[] | undefined>;

export function requireIdempotencyKey(headers: HeaderMap): string {
  const headerValue = headers['idempotency-key'];
  const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  throwIfInvalid(validateIdempotencyKey(idempotencyKey));

  if (typeof idempotencyKey !== 'string') {
    throwIfInvalid(validateIdempotencyKey(idempotencyKey));
    throw new Error('unreachable');
  }

  return idempotencyKey.trim();
}

export function throwIfInvalid(issues: ValidationIssue[]): void {
  if (issues.length === 0) {
    return;
  }

  throw new BadRequestException({
    code: issues[0]?.code ?? 'BAD_REQUEST',
    message: 'Request validation failed',
    details: { issues },
  });
}
