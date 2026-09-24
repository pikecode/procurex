import { randomUUID } from 'node:crypto';

export const TRACE_ID_HEADER = 'x-trace-id';

export type TraceableRequest = {
  headers: Record<string, string | string[] | undefined>;
  traceId?: string;
};

export function headerValue(headers: TraceableRequest['headers'], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function getOrCreateTraceId(request: TraceableRequest): string {
  if (request.traceId) {
    return request.traceId;
  }

  const traceId = headerValue(request.headers, TRACE_ID_HEADER);
  request.traceId = traceId && traceId.trim().length > 0 ? traceId : randomUUID();

  return request.traceId;
}
