import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  const logger = app.get(Logger);

  app.useLogger(logger);
  const config = app.get(ConfigService);
  app.enableCors({
    origin: config
      .get<string>('FRONTEND_ORIGINS', 'http://localhost:3001')
      .split(',')
      .map((value) => value.trim()),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.use(cookieParser());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
