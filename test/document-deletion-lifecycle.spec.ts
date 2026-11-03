import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const {
  DocumentUploadService,
} = require('../dist/model/document-upload/document-upload.service');
const {
  DocumentsProcessor,
} = require('../dist/model/document-upload/queue/documents.processor');
const {
  DocumentsListener,
} = require('../dist/model/document-upload/queue/document-progress.service');

const logger = {
  setContext: vi.fn(),
  trace: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('PDF processing lifecycle guards', () => {
  it('never enqueues permanently deleted or trashed documents', async () => {
    const prisma = {
      document: {
        updateManyAndReturn: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
    };
    const queue = { add: vi.fn() };
    const service = new DocumentUploadService(logger, prisma, {}, queue);
    await expect(
      service.documentProcess('owner', 'deleted-doc'),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.document.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        id: 'deleted-doc',
        userId: 'owner',
        deletedAt: null,
        status: { notIn: ['DELETING', 'DELETED'] },
      },
      data: { status: 'QUEUED' },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not run a stale queue job for a document no longer QUEUED', async () => {
    const prisma = {
      document: { updateManyAndReturn: vi.fn().mockResolvedValue([]) },
    };
    const storage = { getObject: vi.fn() };
    const milvus = { insert: vi.fn() };
    const processor = new DocumentsProcessor(
      logger,
      storage,
      prisma,
      milvus,
      {},
    );
    const job = {
      data: { documentId: 'doc', userId: 'owner' },
      updateProgress: vi.fn(),
    };
    await processor.process(job);
    expect(prisma.document.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'doc', userId: 'owner', status: 'QUEUED', deletedAt: null },
      data: { status: 'PROCESSING', errorMessage: null },
    });
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(milvus.insert).not.toHaveBeenCalled();
    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it('never overwrites DELETING or DELETED with FAILED on old queue failures', async () => {
    const prisma = {
      document: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const documents = { emitProgress: vi.fn() };
    const listener = new DocumentsListener(logger, documents, prisma);
    await listener.onFailed({ jobId: 'doc', failedReason: 'old job failed' });
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'doc',
        deletedAt: null,
        status: { in: ['QUEUED', 'PROCESSING'] },
      },
      data: { status: 'FAILED', errorMessage: 'old job failed' },
    });
  });
});
