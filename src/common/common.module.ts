import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { ConfigModule } from '@nestjs/config';
import { AppLoggerModule } from './app-logger/app-logger.module.js';

@Global()
@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AppLoggerModule,
  ],
  providers: [AppLoggerModule],
  exports: [PrismaModule],
})
export class CommonModule {}
