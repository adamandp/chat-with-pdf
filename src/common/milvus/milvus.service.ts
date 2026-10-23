import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

@Injectable()
export class MilvusService
  extends MilvusClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    super({
      address: configService.getOrThrow<string>('MILVUS_ADDRESS'),
      token: configService.get<string>('MILVUS_TOKEN') || undefined,
      ssl: configService.get<string>('MILVUS_SSL', 'false') === 'true',
      database: configService.get<string>('MILVUS_DATABASE', 'default'),
    });
  }

  async onModuleInit() {
    await this.connectPromise;
  }

  async onModuleDestroy() {
    await this.closeConnection();
  }
}
