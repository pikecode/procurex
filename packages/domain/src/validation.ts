export type ValidationIssue = {
  field: string;
  code: string;
  message: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

export function validateUuid(field: string, value: unknown): ValidationIssue[] {
  if (typeof value !== 'string') {
    return [
      {
        field,
        code: 'INVALID_UUID',
        message: `${field} must be a UUID string`,
      },
    ];
  }

  if (!UUID_PATTERN.test(value)) {
    return [
      {
        field,
        code: 'INVALID_UUID',
        message: `${field} must be a UUID string`,
      },
    ];
  }

  return [];
}

export function validateExpectedVersion(field: string, value: unknown): ValidationIssue[] {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return [
      {
        field,
        code: 'INVALID_EXPECTED_VERSION',
        message: `${field} must be an integer greater than or equal to 1`,
      },
    ];
  }

  return [];
}

export function validateIdempotencyKey(value: unknown): ValidationIssue[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [
      {
        field: 'Idempotency-Key',
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required',
      },
    ];
  }

  if (value.length > 128) {
    return [
      {
        field: 'Idempotency-Key',
        code: 'IDEMPOTENCY_KEY_TOO_LONG',
        message: 'Idempotency-Key must be 128 characters or fewer',
      },
    ];
  }

  return [];
}

export function validateDecimalString(field: string, value: unknown, maxScale: number): ValidationIssue[] {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    return [
      {
        field,
        code: 'INVALID_DECIMAL_STRING',
        message: `${field} must be a non-negative decimal string`,
      },
    ];
  }

  const scale = value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
  if (scale > maxScale) {
    return [
      {
        field,
        code: 'DECIMAL_SCALE_EXCEEDED',
        message: `${field} must have at most ${maxScale} decimal places`,
      },
    ];
  }

  return [];
}
