import { randomUUID } from 'node:crypto';

export const TRACE_ID_HEADER = 'x-trace-id';

export type TraceableRequest = {
  headers: Record<string, string | string[] | undefined>;
  traceId?: string;
};

export function getOrCreateTraceId(request: TraceableRequest): string {
  if (request.traceId) {
    return request.traceId;
  }

  const headerValue = request.headers[TRACE_ID_HEADER];
  const traceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  request.traceId = traceId && traceId.trim().length > 0 ? traceId : randomUUID();

  return request.traceId;
}
