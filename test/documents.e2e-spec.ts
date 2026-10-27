import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import 'dotenv/config';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);

const { AppModule } = require('../dist/app.module');

const { PrismaService } = require('../dist/common/prisma/prisma.service');

const { MilvusService } = require('../dist/common/milvus/milvus.service');

const { SessionService } = require('../dist/model/session/session.service');

const {
  DocumentWorkerService,
} = require('../dist/model/documents/document-worker.service');

const { VectorService } = require('../dist/model/documents/vector.service');

function examplePdf(text = 'Annual revenue in 2024 was 100 million rupiah.') {
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let result = '%PDF-1.4\n';

  const offsets = [0];

  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xref = Buffer.byteLength(result);

  result += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((v) => `${String(v).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return Buffer.from(result);
}

const enabled = process.env.RUN_RAG_INTEGRATION === '1';

describe.skipIf(!enabled)(
  'document pipeline over HTTP with real storage and database',
  () => {
    let app: INestApplication;

    let db: InstanceType<typeof PrismaService>;

    let worker: InstanceType<typeof DocumentWorkerService>;

    let token: string, foreignToken: string, userId: string;

    const collection = process.env.MILVUS_COLLECTION!;

    beforeAll(async () => {
      expect(new URL(process.env.DATABASE_URL!).pathname).toBe('/rag_test');
      expect(collection.startsWith('test_')).toBe(true);

      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = module.createNestApplication();

      // This suite claims jobs manually; automatic startup is covered by the lifecycle test.
      const bootstrap = vi.spyOn(DocumentWorkerService.prototype, 'onApplicationBootstrap').mockImplementation(() => {});

      try {
        await app.init();
      } finally {
        bootstrap.mockRestore();
      }
      db = app.get(PrismaService);
      // Only the explicitly guarded disposable database: abandon leftovers from an interrupted test.
      await db.documentJob.updateMany({
        where: {
          status: {
            in: [
              'queued',
              'processing',
            ],
          },
        },
        data: { status: 'failed' },
      });
      await db.document.updateMany({
        where: {
          status: {
            in: [
              'queued',
              'processing',
            ],
          },
        },
        data: { status: 'failed' },
      });
      worker = app.get(DocumentWorkerService);
      if (process.env.LIVE_PDF_PATH) {
        const vectors = app.get(VectorService);

        const search = vectors.search.bind(vectors);

        vectors.search = async (...args: [string, string[], string]) => {
          const chunks = await search(...args);

          console.log('Retrieval diagnostics:', {
            count: chunks.length,
            pages: chunks.map((c: { page: number }) => c.page),
            namePresent: chunks.some((c: { text: string }) =>
              /adam.*ananda/is.test(c.text),
            ),
          });

          return chunks;
        };
      }
      userId = randomUUID();

      const other = randomUUID();

      await db.user.createMany({
        data: [
          { id: userId },
          { id: other },
        ],
      });

      const sessions = app.get(SessionService);

      token = (await sessions.createToken({ payload: { sub: userId } }))
        .accessToken;
      foreignToken = (await sessions.createToken({ payload: { sub: other } }))
        .accessToken;
    });
    afterAll(async () => {
      if (app) {
        const milvus = app.get(MilvusService);

        if ((await milvus.hasCollection({ collection_name: collection })).value)
          await milvus.dropCollection({ collection_name: collection });
        await app.close();
      }
    });

    it('uploads, freezes, processes, chats, stores citations, isolates owners and handles retries', async () => {
      const server = app.getHttpServer();

      await request(server)
        .post('/presigned-url')
        .send({ filename: 'x.pdf' })
        .expect(401);
      await request(server)
        .post('/presigned-url')
        .auth(token, { type: 'bearer' })
        .send({ filename: '../x.pdf' })
        .expect(400);

      const file = process.env.LIVE_PDF_PATH
        ? await readFile(process.env.LIVE_PDF_PATH)
        : examplePdf();

      const reservation = (
        await request(server)
          .post('/presigned-url')
          .auth(token, { type: 'bearer' })
          .send({ filename: 'example.pdf' })
          .expect(200)
      ).body.data;

      expect(
        (await fetch(reservation.upload_url, { method: 'PUT', body: file }))
          .status,
      ).toBe(200);
      await request(server)
        .post('/documents/upload')
        .auth(foreignToken, { type: 'bearer' })
        .send({ upload_id: reservation.upload_id })
        .expect(404);

      const doc = (
        await request(server)
          .post('/documents/upload')
          .auth(token, { type: 'bearer' })
          .send({ upload_id: reservation.upload_id })
          .expect(202)
      ).body.data;

      const again = await request(server)
        .post('/documents/upload')
        .auth(token, { type: 'bearer' })
        .send({ upload_id: reservation.upload_id })
        .expect(202);

      expect(again.body.data.id).toBe(doc.id);
      expect(
        await db.documentJob.count({ where: { documentId: doc.id } }),
      ).toBe(1);

      const question = {
        question: process.env.LIVE_PDF_PATH
          ? 'Siapa nama pemilik CV ini dan ringkasan pengalaman kerjanya?'
          : 'What was annual revenue in 2024?',
        document_ids: [doc.id],
      };

      await request(server)
        .post('/chat')
        .auth(token, { type: 'bearer' })
        .send(question)
        .expect(409);
      await fetch(reservation.upload_url, {
        method: 'PUT',
        body: 'mutated source',
      });
      expect(
        Buffer.from(await (await fetch(doc.download_url)).arrayBuffer())
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');

      const job = await worker.claim();

      expect(job.documentId).toBe(doc.id);
      expect(await worker.claim()).toBeUndefined();
      await worker.process(job);

      const ready = await request(server)
        .get('/documents/' + doc.id)
        .auth(token, { type: 'bearer' })
        .expect(200);

      expect(ready.body.data.status).toBe('ready');
      expect(ready.body.data.chunk_count).toBeGreaterThan(0);
      await request(server)
        .get('/documents/' + doc.id)
        .auth(foreignToken, { type: 'bearer' })
        .expect(404);

      const response = await request(server)
        .post('/chat')
        .auth(token, { type: 'bearer' })
        .send(question)
        .expect(200);

      const answer = response.body.data;

      console.log('Chat diagnostics:', {
        searches: answer.search_attempts,
        sufficient: answer.context_sufficient,
      });
      expect(answer.sources[0].document_id).toBe(doc.id);
      expect(answer.sources[0].page).toBeGreaterThanOrEqual(1);
      if (process.env.LLM_PROVIDER === 'openai')
        expect(answer.search_attempts).toBe(3);
      else expect(answer.search_attempts).toBeLessThanOrEqual(3);
      expect(answer.answer.toLowerCase()).toContain(
        process.env.LIVE_PDF_PATH ? 'adam' : '100',
      );
      await request(server)
        .post('/chat')
        .auth(foreignToken, { type: 'bearer' })
        .send(question)
        .expect(404);

      const otherSession = await db.chatSession.create({
        data: {
          userId: (
            await db.authSession.findFirstOrThrow({
              where: { userId: { not: userId } },
            })
          ).userId,
        },
      });

      await request(server)
        .post('/chat')
        .auth(token, { type: 'bearer' })
        .send({ ...question, conversation_id: otherSession.id })
        .expect(404);

      const history = await request(server)
        .get(`/chat-sessions/${answer.conversation_id}/chats`)
        .auth(token, { type: 'bearer' })
        .expect(200);

      expect(history.body.data).toHaveLength(2);
      expect(history.body.data[1].sources).toEqual(answer.sources);
      if (process.env.LLM_PROVIDER === 'openai') {
        await request(server)
          .post('/chat')
          .auth(token, { type: 'bearer' })
          .send({
            ...question,
            question: 'What year was that?',
            conversation_id: answer.conversation_id,
          })
          .expect(200);
        expect(
          await db.chatHistory.count({
            where: { sessionId: answer.conversation_id },
          }),
        ).toBe(4);
      }

      const blank = (
        await request(server)
          .post('/presigned-url')
          .auth(token, { type: 'bearer' })
          .send({ filename: 'scan.pdf' })
          .expect(200)
      ).body.data;

      await fetch(blank.upload_url, { method: 'PUT', body: examplePdf('') });

      const failed = (
        await request(server)
          .post('/documents/upload')
          .auth(token, { type: 'bearer' })
          .send({ upload_id: blank.upload_id })
          .expect(202)
      ).body.data;

      for (let attempt = 0; attempt < 3; attempt++) {
        const queued = await worker.claim();

        try {
          await worker.process(queued);
          throw new Error('Expected text extraction failure');
        } catch (error) {
          expect((error as Error).message).toContain('OCR is required');
          await worker.fail(queued, error);
        }
        await db.documentJob.update({
          where: { documentId: failed.id },
          data: { availableAt: new Date(0) },
        });
      }
      expect(
        (await db.document.findUniqueOrThrow({ where: { id: failed.id } }))
          .status,
      ).toBe('failed');
      console.log('Verified PDF chat:', {
        searches: answer.search_attempts,
        citations: answer.sources.length,
      });
    }, 180000);
  },
);
