import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { ConfigModule } from '@nestjs/config';

@Global()
@Module({
  imports: [PrismaModule, ConfigModule.forRoot({ isGlobal: true })],
  exports: [PrismaModule],
})
export class CommonModule {}
