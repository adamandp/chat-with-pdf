import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  const checkPostgres = vi.fn();
  const checkMilvus = vi.fn();

  beforeEach(async () => {
    checkPostgres.mockReset();
    checkMilvus.mockReset();
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useValue: { checkPostgres, checkMilvus } },
      ],
    }).compile();
    controller = module.get(HealthController);
  });

  it.each(['Postgres', 'Milvus'] as const)(
    'delegates the %s check to its own service method',
    async (dependency) => {
      const method = dependency === 'Postgres' ? checkPostgres : checkMilvus;
      const otherMethod =
        dependency === 'Postgres' ? checkMilvus : checkPostgres;
      const result = {
        message: `${dependency} connection is healthy`,
        data: { status: 'ok', database: 'up' },
      } as const;
      method.mockResolvedValue(result);
      await expect(controller[`check${dependency}`]()).resolves.toEqual(result);
      expect(method).toHaveBeenCalledOnce();
      expect(otherMethod).not.toHaveBeenCalled();
    },
  );

  it.each(['Postgres', 'Milvus'] as const)(
    'propagates the %s service failure',
    async (dependency) => {
      const method = dependency === 'Postgres' ? checkPostgres : checkMilvus;
      const error = new ServiceUnavailableException('Connection failed');
      method.mockRejectedValue(error);
      await expect(controller[`check${dependency}`]()).rejects.toBe(error);
    },
  );
});
