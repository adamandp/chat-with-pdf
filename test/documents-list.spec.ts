import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const {
  DocumentsService,
} = require('../dist/model/documents/documents.service');
const { BaseQuerySchema } = require('../dist/common/common.dto');

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
});
