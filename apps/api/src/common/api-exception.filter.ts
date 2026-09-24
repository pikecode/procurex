import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { getOrCreateTraceId, type TraceableRequest } from './request-context.js';

type ErrorResponse = {
  status(statusCode: number): {
    json(body: unknown): void;
  };
};

type ErrorBody = {
  code: string;
  message: string;
  traceId: string;
  details?: unknown;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<TraceableRequest>();
    const response = http.getResponse<ErrorResponse>();
    const traceId = getOrCreateTraceId(request);

    const statusCode = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = this.toErrorBody(exception, statusCode, traceId);

    response.status(statusCode).json(body);
  }

  private toErrorBody(exception: unknown, statusCode: number, traceId: string): ErrorBody {
    if (!(exception instanceof HttpException)) {
      return {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        traceId,
      };
    }

    const response = exception.getResponse();
    if (typeof response === 'string') {
      return {
        code: this.defaultCode(statusCode),
        message: response,
        traceId,
      };
    }

    if (this.isHttpExceptionResponse(response)) {
      return {
        code: typeof response.code === 'string' ? response.code : this.defaultCode(statusCode),
        message: this.normalizeMessage(response.message),
        traceId,
        details: response.details,
      };
    }

    return {
      code: this.defaultCode(statusCode),
      message: exception.message,
      traceId,
    };
  }

  private isHttpExceptionResponse(response: object): response is { code?: unknown; message?: unknown; details?: unknown } {
    return 'message' in response || 'code' in response || 'details' in response;
  }

  private normalizeMessage(message: unknown): string {
    if (Array.isArray(message)) {
      return message.join('; ');
    }

    return typeof message === 'string' && message.length > 0 ? message : 'Request failed';
  }

  private defaultCode(statusCode: number): string {
    switch (statusCode) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'TOO_MANY_REQUESTS';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'SERVICE_UNAVAILABLE';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
