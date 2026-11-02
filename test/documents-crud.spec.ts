import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const { DocumentsService } = require('../dist/model/documents/documents.service');
const { DocumentsModule } = require('../dist/model/documents/documents.module');
const { DocumentUploadModule } = require('../dist/model/document-upload/document-upload.module');
const { DocumentsProcessor } = require('../dist/model/document-upload/queue/documents.processor');
const { DocumentsListener } = require('../dist/model/document-upload/queue/document-progress.service');
const { DocumentsController } = require('../dist/model/documents/documents.controller');
const { DocumentUploadController } = require('../dist/model/document-upload/document-upload.controller');

describe('document module separation', () => {
  it('registers the worker only in DocumentUploadModule and separates route prefixes', () => {
    expect(Reflect.getMetadata('path', DocumentUploadController)).toBe('document-upload');
    expect(Reflect.getMetadata('path', DocumentsController)).toBe('documents');
    const uploadProviders = Reflect.getMetadata('providers', DocumentUploadModule);
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
        count: vi.fn().mockResolvedValue(1),
        updateManyAndReturn: vi.fn().mockResolvedValue([{
          id: 'doc', fileName: 'a.pdf', updatedAt: new Date('2026-11-02'),
        }]),
        delete: vi.fn(),
      },
      sessionDocument: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([{
        id: 'doc', fileName: 'a.pdf', updatedAt: new Date('2026-11-02'),
      }]),
      $transaction: vi.fn((input: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
        typeof input === 'function' ? input(prisma) : Promise.all(input)),
    };
    const logger = { setContext: vi.fn(), trace: vi.fn(), info: vi.fn() };
    const storage = { bucket: 'documents', removeObject: vi.fn().mockResolvedValue(undefined) };
    const milvus = { delete: vi.fn().mockResolvedValue({ status: { error_code: 'Success' } }) };
    const service = new DocumentsService(logger, prisma, storage, milvus);
    return { service, prisma, storage, milvus };
  }

  it('lists only deleted documents in Trash and serializes BigInt', async () => {
    const { service, prisma } = setup();
    const result = await service.findDeleted('owner', { page: 1, limit: 10 });
    expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner', deletedAt: { not: null } },
    }));
    expect(prisma.document.count).toHaveBeenCalledWith({
      where: { userId: 'owner', deletedAt: { not: null } },
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
      where: { id: 'doc', userId: 'owner', deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  });

  it('blocks permanent deletion while a SessionDocument relation exists', async () => {
    const { service, prisma, storage, milvus } = setup();
    prisma.sessionDocument.findFirst.mockResolvedValue({ documentId: 'doc' });
    await expect(service.removePermanently('owner', 'doc')).rejects.toMatchObject({
      status: 409,
    });
    expect(milvus.delete).not.toHaveBeenCalled();
    expect(storage.removeObject).not.toHaveBeenCalled();
    expect(prisma.document.delete).not.toHaveBeenCalled();
  });

  it('permanently removes an unlinked trashed document from Milvus, MinIO and Prisma', async () => {
    const { service, prisma, storage, milvus } = setup();
    await service.removePermanently('owner', 'doc');
    expect(milvus.delete).toHaveBeenCalledWith({
      collection_name: 'document_chunks',
      filter: 'document_id == "doc"',
    });
    expect(storage.removeObject).toHaveBeenCalledWith('documents', 'doc');
    expect(prisma.document.delete).toHaveBeenCalledWith({ where: { id: 'doc', userId: 'owner' } });
  });

  it('does not remove the MinIO object or DB row if Milvus deletion fails', async () => {
    const { service, prisma, storage, milvus } = setup();
    milvus.delete.mockResolvedValue({ status: { error_code: 'UnexpectedError' } });
    await expect(service.removePermanently('owner', 'doc')).rejects.toMatchObject({
      status: 503,
    });
    expect(storage.removeObject).not.toHaveBeenCalled();
    expect(prisma.document.delete).not.toHaveBeenCalled();
  });
});
