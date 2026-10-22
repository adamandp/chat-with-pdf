import { Controller, Get } from '@nestjs/common';
import type { WebResponse } from '../../common/common.interface';
import type { HealthResponse } from './health.interface';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): Promise<WebResponse<HealthResponse>> {
    return this.healthService.check();
  }
}
