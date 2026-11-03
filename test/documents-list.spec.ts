import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const {
  DocumentsService,
} = require('../dist/model/documents/documents.service');
const { BaseQuerySchema } = require('../dist/common/common.dto');
const { DocumentQuerySchema } = require('../dist/model/documents/documents.validation');

describe('DocumentsService.findAll', () => {
  function setup(documents: object[] = [], totalItems = 0) {
    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue(documents),
        count: vi.fn().mockResolvedValue(totalItems),
      },
      $transaction: vi.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const logger = { setContext: vi.fn(), trace: vi.fn() };
    const service = new DocumentsService(logger, prisma, {}, {});

    return { service, prisma };
  }

  it('scopes both the page and total to ready documents owned by the user', async () => {
    const { service, prisma } = setup(
      [
        { id: 'document-id', fileSize: 9007199254740993n },
        { id: 'ready-document-id', fileSize: null },
      ],
      5,
    );

    const response = await service.findAll(
      'owner-id',
      BaseQuerySchema.parse({ page: 2, limit: 2 }),
    );

    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner-id', status: 'READY', deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 2,
      take: 2,
    });
    expect(prisma.document.count).toHaveBeenCalledWith({
      where: { userId: 'owner-id', status: 'READY', deletedAt: null },
    });
    expect(response).toEqual({
      message: '📦 Documents retrieved successfully! Smooth sailing! 😎',
      data: [
        { id: 'document-id', fileSize: '9007199254740993' },
        { id: 'ready-document-id', fileSize: null },
      ],
      paging: { currentPage: 2, pageSize: 2, totalItems: 5, totalPages: 3 },
    });
    expect(() => JSON.stringify(response)).not.toThrow();
  });

  it('returns an empty page with zero totals for a user without documents', async () => {
    const { service } = setup();

    expect(
      await service.findAll('owner-id', BaseQuerySchema.parse({})),
    ).toEqual({
      message: '📦 Documents retrieved successfully! Smooth sailing! 😎',
      data: [],
      paging: { currentPage: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
    });
  });

  it('validates shared query fields and coerces pagination', () => {
    expect(
      BaseQuerySchema.parse({
        page: '2',
        limit: '20',
        q: '  report  ',
        order: 'asc',
      }),
    ).toEqual({
      page: 2,
      limit: 20,
      q: 'report',
      order: 'asc',
    });
    expect(BaseQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 10,
      order: 'desc',
    });
    for (const query of [
      { page: '0' },
      { limit: '101' },
      { page: '1.5' },
      { limit: 'abc' },
      { q: 123 },
      { q: 'a'.repeat(256) },
      { order: 'newest' },
    ]) {
      expect(BaseQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('supports case-insensitive filename search, order and total counts for ready documents', async () => {
    const { service, prisma } = setup([], 2);
    const result = await service.findAll(
      'owner',
      DocumentQuerySchema.parse({
        page: 2,
        limit: 4,
        q: '  RePoRt  ',
        sort: 'name',
        order: 'asc',
      }),
    );
    const where = {
      userId: 'owner',
      status: 'READY',
      deletedAt: null,
      fileName: { contains: 'RePoRt', mode: 'insensitive' },
    };
    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where,
      orderBy: [
        { fileName: { sort: 'asc', nulls: 'last' } },
        { id: 'asc' },
      ],
      skip: 4,
      take: 4,
    });
    expect(prisma.document.count).toHaveBeenCalledWith({ where });
    expect(result.paging).toEqual({
      currentPage: 2,
      pageSize: 4,
      totalItems: 2,
      totalPages: 1,
    });
  });

  it('applies search and page-count sorting to Trash without leaking active documents', async () => {
    const { service, prisma } = setup();
    await service.findDeleted(
      'owner',
      DocumentQuerySchema.parse({ q: 'invoice', sort: 'pages', order: 'desc' }),
    );
    const where = {
      userId: 'owner',
      status: 'READY',
      deletedAt: { not: null },
      fileName: { contains: 'invoice', mode: 'insensitive' },
    };
    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where,
      orderBy: [
        { pageCount: { sort: 'desc', nulls: 'last' } },
        { id: 'desc' },
      ],
      skip: 0,
      take: 10,
    });
    expect(prisma.document.count).toHaveBeenCalledWith({ where });
  });

  it('uses modified date sorting by default and supports ascending order', async () => {
    const { service, prisma } = setup();
    await service.findAll('owner', DocumentQuerySchema.parse({ order: 'asc' }));
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    await service.findAll('owner', DocumentQuerySchema.parse({ q: '   ' }));
    expect(prisma.document.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 'owner', status: 'READY', deletedAt: null },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('validates document-specific sort and inherits base pagination defaults', () => {
    expect(DocumentQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 10,
      order: 'desc',
      sort: 'modified',
    });
    expect(
      DocumentQuerySchema.parse({
        page: '2',
        limit: '5',
        q: '  file  ',
        sort: 'pages',
        order: 'asc',
      }),
    ).toEqual({
      page: 2,
      limit: 5,
      q: 'file',
      order: 'asc',
      sort: 'pages',
    });
    for (const sort of ['created', 'size', 'invalid']) {
      expect(DocumentQuerySchema.safeParse({ sort }).success).toBe(false);
    }
  });
});
