// Run after `bun run build`, with the Postman simulation on localhost:14900.
// Uses real local PostgreSQL + Redis; creates and removes only its own records/queue.
require('dotenv/config');
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const { BullModule, Processor, WorkerHost, getQueueToken } = require('@nestjs/bullmq');
const { ZodValidationPipe } = require('nestjs-zod');
const { DocumentsModule } = require('../../dist/model/documents/documents.module');
const { DocumentQueueService } = require('../../dist/model/documents/queue/document-queue.service');
const { PrismaService } = require('../../dist/common/prisma/prisma.service');
const { StorageService } = require('../../dist/common/storage/storage.service');
const { MilvusService } = require('../../dist/common/milvus/milvus.service');
const { AiService } = require('../../dist/common/ai/ai.service');

const REUSABLE_QUEUE = 'queue-lifecycle-test';
let started;
let finishStarted;
let finished = false;
class AdditionalWorker extends WorkerHost {
  async process() {
    finishStarted();
    await new Promise(resolve => setTimeout(resolve, 100));
    finished = true;
  }
}
Processor(REUSABLE_QUEUE)(AdditionalWorker);

(async () => {
  started = new Promise(resolve => { finishStarted = resolve; });
  const config = new ConfigService({
    ...process.env,
    MINIO_ENDPOINT: 'localhost:14900', MINIO_SECURE: 'false', MINIO_BUCKET: 'documents',
    MINIO_ACCESS_KEY: 'simulation', MINIO_SECRET_KEY: 'simulation-secret',
    GEMINI_API_KEY: 'simulation-key', GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
    GEMINI_EMBEDDING_BASE_URL: 'http://localhost:14900/gemini',
    EMBEDDING_DIMENSIONS: '1536', QUEUE_PREFIX: `document-test-${randomUUID()}`,
  });
  const prisma = new PrismaService(config);
  const vectors = new Map();
  const success = { error_code: 'Success' };
  const milvus = {
    hasCollection: async () => ({ status: success, value: true }),
    loadCollectionSync: async () => success,
    deleteEntities: async () => ({ status: success }),
    upsert: async ({ data }) => { data.forEach(row => vectors.set(row.id, row)); return { status: success }; },
    flushSync: async () => ({ status: success }),
  };
  const storage = new StorageService(config);
  let app, queue, owner;
  try {
    await prisma.$connect();
    owner = await prisma.user.create({ data: { username: `document-test-${randomUUID()}` } });
    const module = await Test.createTestingModule({
      imports: [DocumentsModule, BullModule.registerQueue({ name: REUSABLE_QUEUE })],
      providers: [AdditionalWorker],
    })
      .overrideProvider(ConfigService).useValue(config)
      .useMocker(token => {
        if (token === ConfigService) return config;
        if (token === PrismaService) return prisma;
        if (token === StorageService) return storage;
        if (token === MilvusService) return milvus;
        if (token === AiService) return new AiService(config);
      }).compile();
    app = module.createNestApplication({ logger: false });
    app.use((req, _res, next) => { req.user = { sub: req.headers['x-test-user'] || owner.id }; next(); });
    app.useGlobalPipes(new ZodValidationPipe());
    await app.listen(0, '127.0.0.1');
    queue = app.get(DocumentQueueService);
    const base = await app.getUrl();
    const call = (path, options = {}) => fetch(base + path, { ...options, signal: AbortSignal.timeout(30000) });
    const docId = suffix => randomUUID().slice(0, 24) + suffix;
    const create = async suffix => prisma.document.create({ data: { id: docId(suffix), userId: owner.id, fileName: 'integration.pdf' } });
    const events = async id => {
      const response = await call(`/documents/${id}/progress`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      return response.text();
    };
    const parse = text => text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).filter(data => 'progress' in data);

    assert.equal((await call('/documents/not-a-uuid/process', { method: 'POST' })).status, 400);
    assert.equal((await call(`/documents/${randomUUID()}/process`, { method: 'POST' })).status, 404);
    const presign = await call('/documents/presigned-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: 'from-fe.pdf' }) });
    assert.equal(presign.status, 201);
    const presigned = (await presign.json()).data;
    const created = await prisma.document.findUniqueOrThrow({ where: { id: presigned.document_id } });
    assert.equal(created.fileName, 'from-fe.pdf');
    assert.equal(created.sha256Hash, null);
    assert.equal((await call('/documents/presigned-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
    const doc = await create('000000000001');
    assert.equal((await call(`/documents/${doc.id}/process`, { method: 'POST', headers: { 'x-test-user': randomUUID() } })).status, 404);
    assert.equal((await call(`/documents/${doc.id}/progress`, { headers: { 'x-test-user': randomUUID() } })).status, 404);
    const stream = events(doc.id);
    await queue.queue.pause();
    const responses = await Promise.all(Array.from({ length: 4 }, () => call(`/documents/${doc.id}/process`, { method: 'POST' })));
    assert(responses.every(response => response.status === 202));
    assert.equal((await queue.queue.getJobs(['paused', 'waiting'])).length, 1);
    await queue.queue.resume();
    const received = parse(await stream);
    assert.equal(received.at(-1).status, 'READY');
    assert.equal(received.at(-1).progress, 100);
    assert(received.some(event => event.progress > 0 && event.progress < 100));
    assert(received.every((event, index) => !index || event.progress >= received[index - 1].progress));
    const ready = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    assert.match(ready.sha256Hash, /^[a-f0-9]{64}$/);
    assert.equal(ready.mimeType, 'application/pdf');
    assert.equal(ready.pageCount, 1);
    assert(ready.chunkCount > 0 && ready.fileSize > 0n);
    assert(vectors.size > 0);
    assert([...vectors.values()].every(row => row.vector.length === 1536 && row.user_id === owner.id));
    assert.equal((await call(`/documents/${doc.id}/process`, { method: 'POST' })).status, 409);
    assert.equal(parse(await events(doc.id)).at(-1).progress, 100);
    const metadata = await (await call(`/documents/${doc.id}`)).json();
    assert.equal(typeof metadata.data.fileSize, 'string');
    assert.match(metadata.data.download_url, /X-Amz-Signature=/);

    for (const [suffix, error] of [['000000000002', /Invalid PDF/], ['000000000003', /OCR/], ['000000000004', /PDF processing failed/]]) {
      const invalid = await create(suffix);
      const stream = events(invalid.id);
      assert.equal((await call(`/documents/${invalid.id}/process`, { method: 'POST' })).status, 202);
      const received = parse(await stream);
      assert.equal(received.at(-1).status, 'FAILED');
      assert(received.at(-1).progress < 100);
      const failed = await prisma.document.findUniqueOrThrow({ where: { id: invalid.id } });
      assert.equal(failed.status, 'FAILED');
      assert.match(failed.errorMessage, error);
      const snapshot = parse(await events(invalid.id));
      assert.equal(snapshot.at(-1).status, 'FAILED');
    }
    const retryDoc = await prisma.document.findFirstOrThrow({ where: { userId: owner.id, status: 'FAILED' } });
    // Subscribe before retry and verify the next attempt reaches a terminal state.
    assert.equal((await call(`/documents/${retryDoc.id}/process`, { method: 'POST' })).status, 202);
    const retried = parse(await events(retryDoc.id));
    assert.equal(retried.at(-1).status, 'FAILED');
    assert.equal(await (await queue.queue.getJob(retryDoc.id)).getState(), 'failed');
    // A second feature has no lifecycle hooks: common/queue drains its active job.
    const additionalQueue = app.get(getQueueToken(REUSABLE_QUEUE));
    await additionalQueue.add('test-shutdown', {});
    await started;
    await app.close();
    app = undefined;
    assert.equal(finished, true, 'Shared shutdown must finish active jobs from every queue');
    console.log('PASS: process/SSE, ownership, metadata, duplicate suppression, invalid PDFs, provider failure, retry, and shared shutdown of a second queue without feature lifecycle hooks');
  } finally {
    await app?.close();
    if (queue) {
      const { Queue } = require('bullmq');
      for (const name of ['document-processing', REUSABLE_QUEUE]) {
        const cleanup = new Queue(name, { connection: queue.queue.opts.connection, prefix: queue.queue.opts.prefix });
        await cleanup.obliterate({ force: true });
        await cleanup.close();
      }
    }
    if (owner) {
      await prisma.document.deleteMany({ where: { userId: owner.id } });
      await prisma.user.delete({ where: { id: owner.id } });
    }
    await prisma.$disconnect();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
