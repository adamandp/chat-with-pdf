import { EventEmitter } from 'node:events';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { WorkerHost, QueueEventsHost } from '@nestjs/bullmq';
import { Queue, Worker } from 'bullmq';

type QueueConnection = { waitUntilReady(): Promise<unknown> };

/** Shared connection policy. Nest's BullModule still creates all BullMQ clients. */
@Injectable()
export class QueueConnectionService implements OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger(QueueConnectionService.name);

  private readonly workers = new Set<Worker>();

  private readonly listeners = new Map<EventEmitter, () => void>();

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    // Discover every registered Nest queue/processor/listener once, including future features.
    for (const provider of this.discovery.getProviders()) {
      const instance: unknown = provider.instance;

      if (instance instanceof Queue) {
        this.observe(instance);
      } else if (instance instanceof WorkerHost) {
        this.workers.add(instance.worker);
        this.observe(instance.worker);
      } else if (instance instanceof QueueEventsHost) {
        this.observe(instance.queueEvents);
      }
    }
  }

  private observe(connection: EventEmitter & { name: string }): void {
    if (this.listeners.has(connection)) return;

    const listener = () => this.logger.error(
      `Redis connection failed: ${connection.name}`,
    );

    connection.on('error', listener);
    this.listeners.set(connection, listener);
  }

  async run<T>(
    connection: QueueConnection,
    operation: () => Promise<T>,
  ): Promise<T> {
    // This checks an existing connection; it never creates a new Redis connection.
    await this.waitUntilReady(connection);

    return operation();
  }

  private async waitUntilReady(connection: QueueConnection): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        connection.waitUntilReady(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(
              new Error(
                'Queue connection timed out',
              ),
            ),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Drain all workers before Prisma/MinIO/Milvus shut down. Features need no shutdown hooks.
    await Promise.all([...this.workers].map((worker) => worker.close()));
  }

  onApplicationShutdown(): void {
    // BullModule/QueueEventsHost own the actual connection shutdown.
    for (const [
      connection,
      listener,
    ] of this.listeners) connection.off(
      'error',
      listener,
    );
    this.listeners.clear();
    this.workers.clear();
  }
}
