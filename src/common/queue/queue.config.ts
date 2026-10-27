import { ConfigService } from '@nestjs/config';
import type { BullRootModuleOptions } from '@nestjs/bullmq';

export function createQueueConfig(config: ConfigService): BullRootModuleOptions {
  const url = new URL(config.get('REDIS_URL', 'redis://localhost:6379'));

  return {
    prefix: config.get(
      'QUEUE_PREFIX',
      config.get(
        'DOCUMENT_QUEUE_PREFIX',
        'chat-pdf',
      ),
    ),
    connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      db: Number(url.pathname.slice(1) || 0),
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
      connectTimeout: 5000,
    },
  };
}
