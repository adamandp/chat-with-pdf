import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import type { WebResponse } from '../../common/common.interface';
import type { HealthResponse } from './health.interface';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('minio')
  checkMinio(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.checkMinio();
  }

  @Get('ai')
  checkAi(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.checkAi();
  }

  @Get('postgres')
  checkPostgres(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.checkPostgres();
  }

  @Get('milvus')
  checkMilvus(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.checkMilvus();
  }
}
