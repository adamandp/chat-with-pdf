import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const {
  DocumentsService,
} = require('../dist/model/documents/documents.service');
const { DocumentsModule } = require('../dist/model/documents/documents.module');
const {
  DocumentUploadModule,
} = require('../dist/model/document-upload/document-upload.module');
const {
  DocumentsProcessor,
} = require('../dist/model/document-upload/queue/documents.processor');
const {
  DocumentsListener,
} = require('../dist/model/document-upload/queue/document-progress.service');
const {
  DocumentsController,
} = require('../dist/model/documents/documents.controller');
const {
  DocumentUploadController,
} = require('../dist/model/document-upload/document-upload.controller');

describe('document module separation', () => {
  it('registers the worker only in DocumentUploadModule and separates route prefixes', () => {
    expect(Reflect.getMetadata('path', DocumentUploadController)).toBe(
      'document-upload',
    );
    expect(Reflect.getMetadata('path', DocumentsController)).toBe('documents');
    const uploadProviders = Reflect.getMetadata(
      'providers',
      DocumentUploadModule,
    );
    const documentProviders = Reflect.getMetadata('providers', DocumentsModule);
    expect(uploadProviders).toContain(DocumentsProcessor);
    expect(uploadProviders).toContain(DocumentsListener);
    expect(documentProviders).not.toContain(DocumentsProcessor);
    expect(documentProviders).not.toContain(DocumentsListener);
  });
});

describe('DocumentsService CRUD', () => {
  function setup() {
    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue([{ id: 'doc', fileSize: 4n }]),
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(1),
        updateManyAndReturn: vi.fn().mockResolvedValue([
          {
            id: 'doc',
            fileName: 'a.pdf',
            updatedAt: new Date('2026-11-02'),
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn(
        (input: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
          typeof input === 'function' ? input(prisma) : Promise.all(input),
      ),
    };
    const logger = { setContext: vi.fn(), trace: vi.fn(), info: vi.fn() };
    const storage = {
      bucket: 'documents',
      removeObject: vi.fn().mockResolvedValue(undefined),
    };
    const milvus = {
      delete: vi.fn().mockResolvedValue({ status: { error_code: 'Success' } }),
    };
    const service = new DocumentsService(logger, prisma, storage, milvus);
    return { service, prisma, storage, milvus };
  }

  it('lists only deleted documents in Trash and serializes BigInt', async () => {
    const { service, prisma } = setup();
    const result = await service.findDeleted('owner', { page: 1, limit: 10 });
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'owner', status: 'READY', deletedAt: { not: null } },
      }),
    );
    expect(prisma.document.count).toHaveBeenCalledWith({
      where: { userId: 'owner', status: 'READY', deletedAt: { not: null } },
    });
    expect(result.data[0].fileSize).toBe('4');
  });

  it('only soft-deletes READY documents owned by the user', async () => {
    const { service, prisma } = setup();
    const result = await service.remove('owner', 'doc');
    expect(prisma.document.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'doc', userId: 'owner', status: 'READY', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(result.data.id).toBe('doc');
  });

  it('restores only deleted documents owned by the user', async () => {
    const { service, prisma } = setup();
    await service.restore('owner', 'doc');
    expect(prisma.document.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        id: 'doc',
        userId: 'owner',
        status: 'READY',
        deletedAt: { not: null },
      },
      data: { deletedAt: null },
    });
  });

  it('permanently deletes PDF data even with multiple chat links and preserves DB records', async () => {
    const { service, prisma, storage, milvus } = setup();
    const result = await service.removePermanently('owner', 'doc');
    expect(result.data).toMatchObject({ id: 'doc', fileName: 'a.pdf' });
    expect(prisma.document.updateManyAndReturn).toHaveBeenCalledTimes(2);
    expect(prisma.document.updateManyAndReturn.mock.calls[0][0]).toMatchObject({
      where: {
        id: 'doc',
        userId: 'owner',
        deletedAt: { not: null },
        OR: expect.arrayContaining([{ status: 'READY' }]),
      },
      data: { status: 'DELETING', errorMessage: null },
    });
    expect(prisma.document.updateManyAndReturn.mock.calls[1][0]).toMatchObject({
      data: { status: 'DELETED', errorMessage: null },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.document.delete).toBeUndefined();
    expect(prisma.sessionDocument).toBeUndefined();
    expect(milvus.delete).toHaveBeenCalledOnce();
    expect(storage.removeObject).toHaveBeenCalledOnce();
  });

  it('removes an unlinked trashed PDF from Milvus and MinIO without deleting its row', async () => {
    const { service, prisma, storage, milvus } = setup();
    await service.removePermanently('owner', 'doc');
    expect(milvus.delete).toHaveBeenCalledWith({
      collection_name: 'document_chunks',
      filter: 'document_id == "doc"',
    });
    expect(storage.removeObject).toHaveBeenCalledWith('documents', 'doc');
    expect(prisma.document.updateManyAndReturn).toHaveBeenCalledTimes(2);
  });

  it('keeps status DELETING and allows retry after Milvus fails', async () => {
    const { service, prisma, storage, milvus } = setup();
    milvus.delete.mockResolvedValueOnce({
      status: { error_code: 'UnexpectedError' },
    });
    await expect(
      service.removePermanently('owner', 'doc'),
    ).rejects.toMatchObject({
      status: 503,
    });
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'DELETING' }),
      data: { errorMessage: expect.stringContaining('vectors') },
    });
    expect(storage.removeObject).not.toHaveBeenCalled();
    await service.removePermanently('owner', 'doc');
    expect(milvus.delete).toHaveBeenCalledTimes(2);
    expect(storage.removeObject).toHaveBeenCalledOnce();
  });

  it('handles missing MinIO objects and records cleanup errors for retry', async () => {
    const x = setup();
    x.storage.removeObject.mockRejectedValueOnce(
      new Error('connection refused'),
    );
    await expect(
      x.service.removePermanently('owner', 'doc'),
    ).rejects.toMatchObject({ status: 503 });
    expect(x.prisma.document.updateMany).toHaveBeenCalledOnce();
    x.storage.removeObject.mockRejectedValueOnce({ code: 'NoSuchKey' });
    await x.service.removePermanently('owner', 'doc');
    expect(
      x.prisma.document.updateManyAndReturn.mock.calls.at(-1)?.[0].data.status,
    ).toBe('DELETED');
  });

  it('rejects concurrent deletion and disallows restore when no longer READY', async () => {
    const x = setup();
    x.prisma.document.updateManyAndReturn.mockResolvedValueOnce([]);
    x.prisma.document.findFirst.mockResolvedValueOnce({ status: 'DELETING' });
    await expect(
      x.service.removePermanently('owner', 'doc'),
    ).rejects.toMatchObject({ status: 409 });
    expect(x.milvus.delete).not.toHaveBeenCalled();
    x.prisma.document.updateManyAndReturn.mockResolvedValueOnce([]);
    await expect(x.service.restore('owner', 'doc')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('does not issue download URLs to DELETING or DELETED documents', async () => {
    const x = setup();
    x.prisma.document.findFirst.mockResolvedValue(null);
    await expect(x.service.findOne('owner', 'doc')).rejects.toMatchObject({
      status: 404,
    });
    expect(x.prisma.document.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'doc',
        userId: 'owner',
        deletedAt: null,
        status: { notIn: ['DELETING', 'DELETED'] },
      },
    });
  });
});
