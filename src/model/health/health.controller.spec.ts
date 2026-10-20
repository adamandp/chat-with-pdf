import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  it('returns the database health check', async () => {
    const result = {
      message: 'Database connection is healthy',
      data: { status: 'ok', database: 'up' },
    } as const;
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: { check: vi.fn().mockResolvedValue(result) },
        },
      ],
    }).compile();
    await expect(module.get(HealthController).check()).resolves.toEqual(result);
  });
});
