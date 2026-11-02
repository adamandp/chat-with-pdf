import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);

const { ConfigModule } = require('@nestjs/config');

const { AiModule } = require('../dist/common/ai/ai.module');

const { HealthController } = require('../dist/model/health/health.controller');

const { HealthService } = require('../dist/model/health/health.service');
const { GeminiService } = require('../dist/common/ai/gemini.service');
const { PinoLogger } = require('nestjs-pino');

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
          { provide: PinoLogger, useValue: { setContext: vi.fn(), error: vi.fn() } },
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
      .get('/health/gemini')
      .expect(200);

    expect(response.body)
      .toEqual({
        message: "📦 AI connection retrieved successfully! Smooth sailing! 😎",
        data: {
          status: 'ok',
          connection: 'up',
        },
      });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(checkHealth).not.toHaveBeenCalled();
  }, 15000);
  it(
    'returns safe 503 when Gemini is unreachable',
    async () => {
      const gemini = app.get(GeminiService);
      const modelSpy = vi.spyOn(gemini, 'chatModel').mockReturnValue({
        invoke: vi.fn().mockRejectedValue(new Error('upstream offline')),
      } as never);
      try {
        const response = await request(app.getHttpServer())
          .get('/health/gemini')
          .expect(503);

        expect(response.body)
          .toEqual({
            errors: "🚨 Whoops! Couldn't retrieve AI connection. Maybe it's playing hide and seek? 🤔",
            data: {
              status: 'error',
              connection: 'down',
            },
          });
      } finally {
        modelSpy.mockRestore();
      }
    },
    15000,
  );
});
