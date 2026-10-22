import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  const queryRaw = vi.fn();

  beforeEach(async () => {
    queryRaw.mockReset();

    const module = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();

    service = module.get(HealthService);
  });

  it('queries the database and reports it as up', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.check()).resolves.toEqual({
      message: 'Database connection is healthy',
      data: { status: 'ok', database: 'up' },
    });

    expect(queryRaw).toHaveBeenCalledWith(['SELECT 1']);
  });

  it('returns 503 without exposing database errors', async () => {
    queryRaw.mockRejectedValue(new Error('private database details'));

    try {
      await service.check();
      expect.unreachable('Expected a health check failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const exception = error as ServiceUnavailableException;
      expect(exception.getStatus()).toBe(503);
      expect(exception.getResponse()).toEqual({
        errors: 'Database connection failed',
        data: { status: 'error', database: 'down' },
      });
    }
  });
});
