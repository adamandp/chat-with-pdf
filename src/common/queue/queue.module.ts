import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { createQueueConfig } from './queue.config';
import { QueueConnectionService } from './queue-connection.service';

@Module({
  imports: [
    ConfigModule,
    DiscoveryModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createQueueConfig,
    }),
  ],
  providers: [QueueConnectionService],
  exports: [
    BullModule,
    QueueConnectionService,
  ],
})
export class QueueModule {}
