import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ApiExceptionFilter } from './src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from './src/common/response-envelope.interceptor.js';
import { AppModule } from './src/app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());

  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port, host);
}

void bootstrap();
