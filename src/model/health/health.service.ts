import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { WebResponse } from '../../common/common.interface';
import type { HealthResponse } from './health.interface';
import { StorageService } from '../../common/storage/storage.service';
import { GeminiService } from '../../common/ai/gemini.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MilvusService } from '../../common/milvus/milvus.service';
import { PinoLogger } from 'nestjs-pino';
import { GroqService } from '../../common/ai/groq.service';
import { Messages, ErrorMessage } from '../../utils/message.helper';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly milvus: MilvusService,
    private readonly gemini: GeminiService,
    private readonly groq: GroqService,
    private readonly storage: StorageService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HealthService.name);
  }

  // check minio health
  async checkMinio(): Promise<WebResponse<HealthResponse>> {
    try {
      // check buckets
      if (!(await this.storage.bucketExists(this.storage.bucket)))
        throw new Error('Bucket not found');

      // return healthy
      return {
        message: Messages.get('MinIO connection'),
        data: {
          status: 'ok',
          connection: 'up',
        },
      };
    } catch {
      // return unhealthy
      throw new ServiceUnavailableException({
        errors: ErrorMessage.get('MinIO connection'),
        data: {
          status: 'error',
          connection: 'down',
        },
      });
    }
  }

  // check postgres
  async checkPostgres(): Promise<WebResponse<HealthResponse>> {
    try {
      // check query to postgres
      await this.prisma.$queryRaw`
        SELECT
          1
      `;

      // return healthy
      return {
        message: Messages.get('Postgres connection'),
        data: {
          status: 'ok',
          connection: 'up',
        },
      };
    } catch {
      // return unhealthy
      throw new ServiceUnavailableException({
        errors: ErrorMessage.get('Postgres connection'),
        data: {
          status: 'error',
          connection: 'down',
        },
      });
    }
  }

  async checkMilvus(): Promise<WebResponse<HealthResponse>> {
    try {
      // check milvus
      const result = await this.milvus.checkHealth();

      if (!result.isHealthy) throw new Error('Milvus is unhealthy');

      // return healthy
      return {
        message: Messages.get('Milvus connection'),
        data: {
          status: 'ok',
          connection: 'up',
        },
      };
    } catch {
      // return unhealthy
      throw new ServiceUnavailableException({
        errors: ErrorMessage.get('Milvus connection'),
        data: {
          status: 'error',
          database: 'down',
        },
      });
    }
  }

  // check ai health
  async checkGemini(): Promise<WebResponse<HealthResponse>> {
    try {
      // check ai
      await this.gemini
        .chatModel()
        .invoke(
          'Reply with only OK.',
          {
            timeout: 1000,
          },
        );
      return {
        message: Messages.get('AI connection'),
        data: {
          status: 'ok',
          connection: 'up',
        },
      };
    } catch (error) {
      // return unhealthy

      this.logger.error('Gemini health check failed:', error);

      throw new ServiceUnavailableException({
        errors: ErrorMessage.get('AI connection'),
        data: {
          status: 'error',
          connection: 'down',
        },
      });
    }
  }

  async checkGroq(): Promise<WebResponse<HealthResponse>> {
    try {
      // check ai
      await this.groq
        .chatModel()
        .invoke(
          'Reply with only OK.',
          {
            timeout: 1000,
          },
        );
      return {
        message: Messages.get('AI connection'),
        data: {
          status: 'ok',
          connection: 'up',
        },
      };
    } catch (error) {
      // return unhealthy

      this.logger.error('Groq health check failed:', error);

      throw new ServiceUnavailableException({
        errors: ErrorMessage.get('AI connection'),
        data: {
          status: 'error',
          connection: 'down',
        },
      });
    }
  }
}
