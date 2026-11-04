import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const {
  DocumentUploadService,
} = require('../dist/model/document-upload/document-upload.service');
const {
  DocumentsProcessor,
} = require('../dist/model/document-upload/queue/documents.processor');
const {
  presignUrlSchema,
} = require('../dist/model/document-upload/document-upload.validation');

const logger = {
  setContext: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
const config = { get: vi.fn((_key: string, fallback: number) => fallback) };
const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
const pdfHash = createHash('sha256').update(pdf).digest('hex');
const object = (size = pdf.length, mime = 'application/pdf') => ({
  size,
  metaData: { 'content-type': mime },
});

describe('PDF upload boundary validation', () => {
  beforeEach(() => vi.clearAllMocks());

  function createUploadService(expectedSize: bigint | null = null) {
    const prisma = {
      document: {
        create: vi.fn().mockResolvedValue({ id: 'document-id' }),
        delete: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({ fileSize: expectedSize }),
        updateManyAndReturn: vi
          .fn()
          .mockResolvedValue([{ id: 'document-id', status: 'QUEUED' }]),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ id: 'document-id', status: 'QUEUED' }),
      },
    };
    const storage = {
      bucket: 'documents',
      presignedPutObject: vi.fn().mockResolvedValue('https://storage/upload'),
      statObject: vi.fn().mockResolvedValue(object()),
    };
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const service = new DocumentUploadService(
      logger,
      prisma,
      storage,
      queue,
      config,
    );
    return { prisma, storage, queue, service };
  }

  it('rejects non-PDF names and malformed declared metadata', () => {
    expect(
      presignUrlSchema.safeParse({ fileName: 'archive.zip' }).success,
    ).toBe(false);
    expect(
      presignUrlSchema.safeParse({ fileName: 'a.pdf', mimeType: 'text/plain' })
        .success,
    ).toBe(false);
    expect(
      presignUrlSchema.safeParse({ fileName: 'a.pdf', sha256Hash: 'invalid' })
        .success,
    ).toBe(false);
    expect(presignUrlSchema.safeParse({ fileName: 'a.PDF' }).success).toBe(
      true,
    );
  });

  it('rejects declared oversized files before creating a document', async () => {
    const { service, prisma } = createUploadService();
    await expect(
      service.createPresignUrl('owner', {
        fileName: 'large.pdf',
        fileSize: 20 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it('preserves filename-only FE uploads and records optional declarations', async () => {
    const { service, prisma } = createUploadService();
    await service.createPresignUrl('owner', { fileName: 'legacy.pdf' });
    expect(prisma.document.create).toHaveBeenCalledWith({
      data: {
        userId: 'owner',
        fileName: 'legacy.pdf',
        fileSize: null,
        mimeType: null,
        sha256Hash: null,
        status: 'PENDING_UPLOAD',
      },
    });

    await service.createPresignUrl('owner', {
      fileName: 'declared.pdf',
      fileSize: pdf.length,
      mimeType: 'application/pdf',
      sha256Hash: pdfHash.toUpperCase(),
    });
    expect(prisma.document.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        fileSize: BigInt(pdf.length),
        mimeType: 'application/pdf',
        sha256Hash: pdfHash,
      }),
    });
  });

  it.each([
    ['empty object', object(0)],
    ['oversized object', object(20 * 1024 * 1024 + 1)],
    ['wrong content type', object(pdf.length, 'image/png')],
  ])('rejects %s before mutating status or enqueueing', async (_name, stat) => {
    const { service, storage, prisma, queue } = createUploadService();
    storage.statObject.mockResolvedValue(stat);
    await expect(
      service.documentProcess('owner', 'document-id'),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.document.updateManyAndReturn).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects absent objects and mismatched sizes without queueing', async () => {
    const { service, storage, prisma, queue } = createUploadService(
      BigInt(pdf.length + 1),
    );
    await expect(
      service.documentProcess('owner', 'document-id'),
    ).rejects.toMatchObject({
      status: 400,
    });
    storage.statObject.mockRejectedValue({ code: 'NoSuchKey' });
    await expect(
      service.documentProcess('owner', 'document-id'),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.document.updateManyAndReturn).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enqueues a correctly uploaded object', async () => {
    const { service, queue } = createUploadService(BigInt(pdf.length));
    const result = await service.documentProcess('owner', 'document-id');
    expect(result.data).toEqual({ id: 'document-id', status: 'QUEUED' });
    expect(queue.add).toHaveBeenCalledOnce();
  });

  function createProcessor(
    bytes: Buffer = pdf,
    metadata = object(bytes.length),
    expectedHash: string | null = null,
  ) {
    const prisma = {
      document: {
        updateManyAndReturn: vi.fn().mockResolvedValue([
          {
            id: 'document-id',
            userId: 'owner',
            fileName: 'a.pdf',
            fileSize: null,
            sha256Hash: expectedHash,
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const storage = {
      bucket: 'documents',
      statObject: vi.fn().mockResolvedValue(metadata),
      getObject: vi.fn().mockImplementation(async () => Readable.from([bytes])),
    };
    const milvus = { insert: vi.fn().mockResolvedValue(undefined) };
    const gemini = {
      embeddings: vi
        .fn()
        .mockReturnValue({ embedDocuments: vi.fn().mockResolvedValue([[1]]) }),
    };
    const processor = new DocumentsProcessor(
      logger,
      storage,
      prisma,
      milvus,
      gemini,
      config,
    );
    const job = {
      data: { documentId: 'document-id', userId: 'owner' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };
    return { processor, prisma, storage, milvus, job };
  }

  it('rejects fake PDF contents even with application/pdf metadata', async () => {
    const { processor, job, milvus } = createProcessor(
      Buffer.from('not a PDF'),
    );
    await expect(processor.process(job)).rejects.toThrow(
      'Invalid PDF file signature',
    );
    expect(milvus.insert).not.toHaveBeenCalled();
  });

  it('rejects content hash mismatch before embedding or writing vectors', async () => {
    const { processor, job, milvus } = createProcessor(
      pdf,
      object(),
      'f'.repeat(64),
    );
    await expect(processor.process(job)).rejects.toThrow(
      'SHA-256 checksum mismatch',
    );
    expect(milvus.insert).not.toHaveBeenCalled();
  });

  it('limits streamed data even if MinIO HEAD reported a smaller size', async () => {
    const tooLarge = Buffer.concat([pdf, Buffer.alloc(20 * 1024 * 1024)]);
    const { processor, job, milvus } = createProcessor(
      tooLarge,
      object(pdf.length),
    );
    await expect(processor.process(job)).rejects.toThrow('upload limit');
    expect(milvus.insert).not.toHaveBeenCalled();
  });

  it('persists SHA-256, size and MIME from verified bytes on READY', async () => {
    const { processor, job, prisma } = createProcessor();
    vi.spyOn(processor, 'extractDocument').mockResolvedValue({
      pages: [{ pageNumber: 1, content: 'Hello PDF' }],
      pageCount: 1,
    });
    await processor.process(job);
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'document-id', status: 'PROCESSING', deletedAt: null },
      data: expect.objectContaining({
        fileSize: BigInt(pdf.length),
        mimeType: 'application/pdf',
        sha256Hash: pdfHash,
        status: 'READY',
      }),
    });
  });
});
