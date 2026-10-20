import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module.js';
import { HealthService } from './health.service.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
