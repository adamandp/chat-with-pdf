import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { appLoggerConfig } from './app-logger.config';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: appLoggerConfig,
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}
