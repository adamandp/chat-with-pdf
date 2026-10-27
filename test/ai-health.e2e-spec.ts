import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);

const { ConfigModule } = require('@nestjs/config');

const { AiModule } = require('../dist/common/ai/ai.module');

const { HealthController } = require('../dist/model/health/health.controller');

const { HealthService } = require('../dist/model/health/health.service');

const { PrismaService } = require('../dist/common/prisma/prisma.service');

const { StorageService } = require('../dist/common/storage/storage.service');

const { MilvusService } = require('../dist/common/milvus/milvus.service');

// Tests controller routing and the real LangChain HTTP client; no DB or vector call is made.
// Authentication remains the application's existing global guard, outside this isolated fixture.
describe.skipIf(process.env.RUN_AI_HEALTH_INTEGRATION !== '1')('AI health over HTTP', () => {
  let app: INestApplication;

  const queryRaw = vi.fn();

  const checkHealth = vi.fn();

  beforeAll(async () => {
    const module = await Test
      .createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          AiModule,
        ],
        controllers: [HealthController],
        providers: [
          HealthService,
          {
            provide: StorageService,
            useValue: {},
          },
          {
            provide: PrismaService,
            useValue: { $queryRaw: queryRaw },
          },
          {
            provide: MilvusService,
            useValue: { checkHealth },
          },
        ],
      })
      .compile();

    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('probes the configured model through its actual HTTP client', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ai')
      .expect(200);

    expect(response.body)
      .toEqual({
        message: 'AI connection is healthy',
        data: {
          status: 'ok',
          ai: 'up',
        },
      });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(checkHealth).not.toHaveBeenCalled();
  }, 15000);
  it.skipIf(process.env.LLM_PROVIDER !== 'openai')(
    'returns safe 503 when the provider is unreachable',
    async () => {
      const previous = process.env.OPENAI_BASE_URL;

      process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1';
      try {
        const response = await request(app.getHttpServer())
          .get('/health/ai')
          .expect(503);

        expect(response.body)
          .toEqual({
            errors: 'AI connection failed',
            data: {
              status: 'error',
              ai: 'down',
            },
          });
      } finally {
        process.env.OPENAI_BASE_URL = previous;
      }
    },
    15000,
  );
});
