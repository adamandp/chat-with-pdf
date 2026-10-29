import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

@Injectable()
export class StorageService extends Client implements OnModuleInit {
  readonly bucket: string;

  constructor(config: ConfigService) {
    const secure = config.get('MINIO_SECURE', 'false') === 'true';

    const url = new URL(
      `${secure ? 'https' : 'http'}://${config.get(
        'MINIO_ENDPOINT',
        'localhost:9000',
      )}`,
    );

    super({
      endPoint: url.hostname,
      port: Number(url.port || (secure ? 443 : 80)),
      useSSL: secure,
      accessKey: config.getOrThrow('MINIO_ACCESS_KEY'),
      secretKey: config.getOrThrow('MINIO_SECRET_KEY'),
      region: 'us-east-1',
    });

    this.bucket = config.get('MINIO_BUCKET', 'documents');
  }

  async onModuleInit(): Promise<void> {
    if (!(await this.bucketExists(this.bucket))) {
      await this.makeBucket(this.bucket, 'us-east-1');
    }
  }
}
