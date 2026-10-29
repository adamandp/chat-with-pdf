import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const { DocumentsService } = require('../dist/model/documents/documents.service');
const { DocumentsListener } = require('../dist/model/documents/queue/document-progress.service');
const { DocumentsModule } = require('../dist/model/documents/documents.module');
const { DocumentsProcessor } = require('../dist/model/documents/queue/documents.processor');

describe('document queue progress', () => {
  function setup(status = 'QUEUED', progress = 0) {
    const prisma = { document: {
      findFirst: vi.fn().mockResolvedValue({ id: 'doc' }),
      findFirstOrThrow: vi.fn().mockResolvedValue({ status, errorMessage: null }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } };
    const logger = { setContext: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const queue = { getJob: vi.fn().mockResolvedValue({ progress }) };
    const service = new DocumentsService(logger, prisma, {}, queue);
    const listener = new DocumentsListener(logger, service, prisma);
    return { prisma, logger, queue, service, listener };
  }

  afterEach(() => vi.useRealTimers());

  it('registers both the worker and queue event consumer', () => {
    const providers = Reflect.getMetadata('providers', DocumentsModule);
    expect(providers).toContain(DocumentsProcessor);
    expect(providers).toContain(DocumentsListener);
  });

  it('sends the current snapshot, then queue progress, then completion and closes', async () => {
    const { service, listener } = setup('PROCESSING', 40);
    const events: any[] = [];
    const complete = vi.fn();
    const stream = await service.progress('owner', 'doc');
    stream.subscribe({ next: (event: unknown) => events.push(event), complete });
    await Promise.resolve();
    await Promise.resolve();
    expect(events[0].data).toEqual({ document_id: 'doc', status: 'PROCESSING', progress: 40 });
    listener.onProgress({ jobId: 'another-doc', data: 60 });
    expect(events).toHaveLength(1);
    listener.onProgress({ jobId: 'doc', data: 70 });
    listener.onCompleted({ jobId: 'doc' });
    expect(events.map((event) => event.data.progress)).toEqual([40, 70, 100]);
    expect(events[2].data.status).toBe('READY');
    expect(complete).toHaveBeenCalledOnce();
  });

  it('keeps queue events arriving during snapshot loading', async () => {
    const { service, listener, queue } = setup();
    let resolveJob!: (job: object) => void;
    queue.getJob.mockReturnValue(new Promise((resolve) => { resolveJob = resolve; }));
    const events: any[] = [];
    const stream = await service.progress('owner', 'doc');
    const subscription = stream.subscribe((event: unknown) => events.push(event));
    listener.onProgress({ jobId: 'doc', data: 15 });
    resolveJob({ progress: 0 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(events.map((event) => event.data.progress)).toEqual([0, 15]);
    subscription.unsubscribe();
  });

  it('emits heartbeat and cleans up on disconnect', async () => {
    vi.useFakeTimers();
    const { service } = setup();
    const events: any[] = [];
    const subscription = (await service.progress('owner', 'doc')).subscribe((event: unknown) => events.push(event));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15000);
    expect(events.at(-1)).toEqual({ type: 'heartbeat', data: {} });
    subscription.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('persists a failed job and delivers its terminal error', async () => {
    const { service, listener, prisma } = setup();
    const events: any[] = [];
    const complete = vi.fn();
    (await service.progress('owner', 'doc')).subscribe({ next: (event: unknown) => events.push(event), complete });
    await Promise.resolve();
    await Promise.resolve();
    await listener.onFailed({ jobId: 'doc', failedReason: 'PDF extraction failed' });
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'doc' }, data: { status: 'FAILED', errorMessage: 'PDF extraction failed' },
    });
    expect(events.at(-1).data).toMatchObject({ status: 'FAILED', error: 'PDF extraction failed' });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('immediately closes when reconnecting to a finished document', async () => {
    const { service } = setup('READY');
    const complete = vi.fn();
    const events: any[] = [];
    (await service.progress('owner', 'doc')).subscribe({ next: (event: unknown) => events.push(event), complete });
    await Promise.resolve();
    await Promise.resolve();
    expect(events[0].data).toMatchObject({ status: 'READY', progress: 100 });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('rejects inaccessible documents before reading queue progress', async () => {
    const { service, prisma, queue } = setup();
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(service.progress('other-owner', 'doc')).rejects.toThrow('Document not found');
    expect(queue.getJob).not.toHaveBeenCalled();
  });
});
