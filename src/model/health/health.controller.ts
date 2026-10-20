import { Controller, Get } from '@nestjs/common';
import type { WebResponse } from '../../common/common.interface.js';
import type { HealthResponse } from './health.interface.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.check();
  }
}
