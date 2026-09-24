import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { getOrCreateTraceId, type TraceableRequest } from './request-context.js';

type ApiSuccessEnvelope<T> = {
  data: T;
  traceId: string;
};

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccessEnvelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessEnvelope<T>> {
    const request = context.switchToHttp().getRequest<TraceableRequest>();

    return next.handle().pipe(
      map((data) => ({
        data,
        traceId: getOrCreateTraceId(request),
      })),
    );
  }
}
