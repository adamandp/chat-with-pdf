import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  const logger = app.get(Logger);

  app.useLogger(logger);

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
