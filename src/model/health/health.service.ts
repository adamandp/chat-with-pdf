import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { WebResponse } from '../../common/common.interface';
import type { HealthResponse } from './health.interface';
import { StorageService } from '../../common/storage/storage.service';
import { AiService } from '../../common/ai/ai.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MilvusService } from '../../common/milvus/milvus.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly milvus: MilvusService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
  ) {}

  async checkMinio(): Promise<WebResponse<HealthResponse>> {
    try {
      if (!(await this.storage.bucketExists(this.storage.bucket)))
        throw new Error('Bucket not found');

      return {
        message: 'MinIO connection is healthy',
        data: {
          status: 'ok',
          connection: 'up',
        },
      };
    } catch {
      throw new ServiceUnavailableException({
        errors: 'MinIO connection failed',
        data: {
          status: 'error',
          connection: 'down',
        },
      });
    }
  }

  async checkAi(): Promise<WebResponse<HealthResponse>> {
    try {
      await this.ai
        .chatModel()
        .invoke('Reply with only OK.', {
          signal: AbortSignal.timeout(10_000),
        });

      return {
        message: 'AI connection is healthy',
        data: {
          status: 'ok',
          connection: 'up',
        },
      };
    } catch {
      throw new ServiceUnavailableException({
        errors: 'AI connection failed',
        data: {
          status: 'error',
          connection: 'down',
        },
      });
    }
  }

  async checkPostgres(): Promise<WebResponse<HealthResponse>> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        message: 'Postgres connection is healthy',
        data: {
          status: 'ok',
          connection: 'up',
        },
      };
    } catch {
      throw new ServiceUnavailableException({
        errors: 'Postgres connection failed',
        data: {
          status: 'error',
          connection: 'down',
        },
      });
    }
  }

  async checkMilvus(): Promise<WebResponse<HealthResponse>> {
    try {
      const result = await this.milvus.checkHealth();

      if (!result.isHealthy) throw new Error('Milvus is unhealthy');

      return {
        message: 'Milvus connection is healthy',
        data: {
          status: 'ok',
          connection: 'up',
        },
      };
    } catch {
      throw new ServiceUnavailableException({
        errors: 'Milvus connection failed',
        data: {
          status: 'error',
          database: 'down',
        },
      });
    }
  }
}
