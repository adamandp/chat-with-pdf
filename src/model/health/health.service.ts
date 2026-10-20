import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { WebResponse } from '../../common/common.interface.js';
import type { HealthResponse } from './health.interface.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<WebResponse<HealthResponse>> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        message: 'Database connection is healthy',
        data: { status: 'ok', database: 'up' },
      };
    } catch {
      throw new ServiceUnavailableException({
        errors: 'Database connection failed',
        data: { status: 'error', database: 'down' },
      } satisfies WebResponse<HealthResponse>);
    }
  }
}
