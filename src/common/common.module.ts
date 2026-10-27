import { PassportModule } from '@nestjs/passport';
import { SessionModule } from '../model/session/session.module';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './common.strategy';
import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AppLoggerModule } from './app-logger/app-logger.module';
import { AuthGuard } from './guards/auth.guard';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { MilvusModule } from './milvus/milvus.module';
import { StorageModule } from './storage/storage.module';
import { AiModule } from './ai/ai.module';
import { QueueModule } from './queue/queue.module';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({ global: true }),
    SessionModule,
    PassportModule.register({
      defaultStrategy: 'jwt',
      session: false,
    }),
    PrismaModule,
    MilvusModule,
    StorageModule,
    AiModule,
    QueueModule,
    AppLoggerModule,
  ],
  providers: [
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    AppLoggerModule,
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
  exports: [
    PrismaModule,
    MilvusModule,
    StorageModule,
    AiModule,
    QueueModule,
  ],
})
export class CommonModule {}
