import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix('api/v1');

  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port, host);
}

void bootstrap();
