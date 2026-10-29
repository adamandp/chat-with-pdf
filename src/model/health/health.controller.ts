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

  // check gemini health
  @Get('gemini')
  checkAi(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.checkGemini();
  }

  // check groq health
  @Get('groq')
  checkGroq(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.checkGroq();
  }
}
