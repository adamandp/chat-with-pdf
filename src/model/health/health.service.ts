import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { WebResponse } from '../../common/common.interface';
import type { HealthResponse } from './health.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MilvusService } from '../../common/milvus/milvus.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly milvus: MilvusService,
  ) {}

  async checkPostgres(): Promise<WebResponse<HealthResponse>> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        message: 'Postgres connection is healthy',
        data: { status: 'ok', database: 'up' },
      };
    } catch {
      throw new ServiceUnavailableException({
        errors: 'Postgres connection failed',
        data: { status: 'error', database: 'down' },
      } satisfies WebResponse<HealthResponse>);
    }
  }

  async checkMilvus(): Promise<WebResponse<HealthResponse>> {
    try {
      const result = await this.milvus.checkHealth();

      if (!result.isHealthy) throw new Error('Milvus is unhealthy');

      return {
        message: 'Milvus connection is healthy',
        data: { status: 'ok', database: 'up' },
      };
    } catch {
      throw new ServiceUnavailableException({
        errors: 'Milvus connection failed',
        data: { status: 'error', database: 'down' },
      });
    }
  }
}
