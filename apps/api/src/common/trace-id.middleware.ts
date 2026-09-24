import { Injectable, NestMiddleware } from '@nestjs/common';
import { getOrCreateTraceId, TRACE_ID_HEADER, type TraceableRequest } from './request-context.js';

type TraceableResponse = {
  setHeader(name: string, value: string): void;
};

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(request: TraceableRequest, response: TraceableResponse, next: () => void): void {
    const traceId = getOrCreateTraceId(request);
    response.setHeader(TRACE_ID_HEADER, traceId);
    next();
  }
}
