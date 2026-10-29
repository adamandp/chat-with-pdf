import { ConfigService } from '@nestjs/config';
import type { BullRootModuleOptions } from '@nestjs/bullmq';

export function appQueueConfig(
  config: ConfigService,
): BullRootModuleOptions {
  return {
    connection: {
      host: config.getOrThrow<string>('REDIS_HOST'),
      port: Number(config.getOrThrow<string>('REDIS_PORT')),
      username: config.getOrThrow<string>('REDIS_USERNAME'),
      password: config.getOrThrow<string>('REDIS_PASSWORD'),
      connectTimeout: 5000,
    },
  };
}
