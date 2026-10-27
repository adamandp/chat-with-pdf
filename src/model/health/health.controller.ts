import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import type { WebResponse } from '../../common/common.interface';
import type { HealthResponse } from './health.interface';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // check minio health
  @Get('minio')
  checkMinio(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.checkMinio();
  }

  // check ai health
  @Get('ai')
  checkAi(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.checkAi();
  }

  // check postgres health
  @Get('postgres')
  checkPostgres(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.checkPostgres();
  }

  // check milvus health
  @Get('milvus')
  checkMilvus(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.checkMilvus();
  }
}
