import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { PinoLogger } from 'nestjs-pino';
import { initializeCollections } from './milvus.collection';

@Injectable()
export class MilvusService
  extends MilvusClient
  implements OnModuleInit, OnApplicationShutdown {
  constructor(
    readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    super({
      address: configService.getOrThrow<string>('MILVUS_ADDRESS'),
      token: configService.get<string>('MILVUS_TOKEN') || undefined,
      ssl: configService.get<string>('MILVUS_SSL', 'false') === 'true',
      database: configService.get<string>('MILVUS_DATABASE', 'default'),
      logLevel: 'error',
    });

    this.logger.setContext(MilvusService.name);
  }

  async onModuleInit() {
    await this.connectPromise;

    await initializeCollections(this);
  }

  async onApplicationShutdown() {
    await this.closeConnection();
  }
}
