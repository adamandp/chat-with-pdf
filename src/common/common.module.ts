import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { AppLoggerModule } from './app-logger/app-logger.module';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { MilvusModule } from './milvus/milvus.module';

@Global()
@Module({
  imports: [
    PrismaModule,
    MilvusModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AppLoggerModule,
  ],
  providers: [
    AppLoggerModule,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
  exports: [PrismaModule, MilvusModule],
})
export class CommonModule {}
