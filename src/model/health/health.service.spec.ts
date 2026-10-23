import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MilvusService } from '../../common/milvus/milvus.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  const queryRaw = vi.fn();
  const checkHealth = vi.fn();

  beforeEach(async () => {
    queryRaw.mockReset().mockResolvedValue([]);
    checkHealth.mockReset().mockResolvedValue({ isHealthy: true });
    const module = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
        { provide: MilvusService, useValue: { checkHealth } },
      ],
    }).compile();
    service = module.get(HealthService);
  });

  it('checks PostgreSQL independently', async () => {
    await expect(service.checkPostgres()).resolves.toEqual({
      message: 'Postgres connection is healthy',
      data: { status: 'ok', database: 'up' },
    });
    expect(queryRaw).toHaveBeenCalledWith(['SELECT 1']);
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it('checks Milvus independently', async () => {
    await expect(service.checkMilvus()).resolves.toEqual({
      message: 'Milvus connection is healthy',
      data: { status: 'ok', database: 'up' },
    });
    expect(checkHealth).toHaveBeenCalledOnce();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it.each(['Postgres', 'Milvus', 'Milvus unhealthy'] as const)(
    'returns 503 for %s failure without exposing internal details',
    async (dependency) => {
      if (dependency === 'Postgres')
        queryRaw.mockRejectedValue(new Error('private details'));
      else if (dependency === 'Milvus')
        checkHealth.mockRejectedValue(new Error('private details'));
      else
        checkHealth.mockResolvedValue({
          isHealthy: false,
          reasons: ['private details'],
        });

      const result =
        dependency === 'Postgres'
          ? service.checkPostgres()
          : service.checkMilvus();
      await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(result).rejects.toMatchObject({
        status: 503,
        response: {
          errors: `${dependency === 'Postgres' ? 'Postgres' : 'Milvus'} connection failed`,
          data: { status: 'error', database: 'down' },
        },
      });
    },
  );
});
