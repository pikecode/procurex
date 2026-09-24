import { createHash } from 'node:crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue | undefined };

export function requestHash(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  const entries: Array<[string, JsonValue]> = [];

  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue !== undefined) {
      entries.push([key, entryValue]);
    }
  }

  entries.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
}
