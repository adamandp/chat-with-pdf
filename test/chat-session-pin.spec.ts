import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const {
  ChatSessionService,
} = require('../dist/model/chat-session/chat-session.service');
const {
  UpdateChatSessionSchema,
} = require('../dist/model/chat-session/dto/update-chat-session.dto');

describe('ChatSession pin/unpin', () => {
  function setup() {
    const row = {
      id: 'session',
      title: 'Original',
      isPinned: false,
      updatedAt: new Date('2026-11-03T00:00:00Z'),
    };
    const prisma = {
      chatSession: {
        findMany: vi.fn().mockResolvedValue([row]),
        count: vi.fn().mockResolvedValue(1),
        updateManyAndReturn: vi.fn().mockResolvedValue([row]),
      },
      $transaction: vi.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const logger = {
      setContext: vi.fn(),
      trace: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };
    return { service: new ChatSessionService(prisma, logger), prisma };
  }

  it('validates title-only, pin-only and combined updates, but rejects empty payloads', () => {
    expect(UpdateChatSessionSchema.parse({ isPinned: true })).toEqual({
      isPinned: true,
    });
    expect(
      UpdateChatSessionSchema.parse({ title: '  Rename  ', isPinned: false }),
    ).toEqual({
      title: 'Rename',
      isPinned: false,
    });
    expect(UpdateChatSessionSchema.safeParse({}).success).toBe(false);
    expect(
      UpdateChatSessionSchema.safeParse({ isPinned: 'true' }).success,
    ).toBe(false);
    expect(UpdateChatSessionSchema.safeParse({ title: '  ' }).success).toBe(
      false,
    );
  });

  it('orders pinned sessions first before applying pagination', async () => {
    const { service, prisma } = setup();
    const result = await service.findAll('owner', { page: 2, limit: 5 });
    expect(prisma.chatSession.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner', deletedAt: null },
      select: { id: true, title: true, isPinned: true, updatedAt: true },
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      skip: 5,
      take: 5,
    });
    expect(result.data[0].isPinned).toBe(false);
  });

  it('includes pin state in Trash without pinned-first sorting', async () => {
    const { service, prisma } = setup();
    await service.findDeleted('owner', { page: 1, limit: 10 });
    expect(prisma.chatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, title: true, isPinned: true, updatedAt: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('updates pin, unpin, and rename atomically with user ownership enforced', async () => {
    const { service, prisma } = setup();
    await service.update('owner', 'session', { isPinned: true });
    await service.update('owner', 'session', {
      isPinned: false,
      title: 'Renamed',
    });
    expect(prisma.chatSession.updateManyAndReturn).toHaveBeenNthCalledWith(1, {
      where: { id: 'session', userId: 'owner', deletedAt: null },
      data: { isPinned: true, updatedAt: expect.any(Date) },
    });
    expect(prisma.chatSession.updateManyAndReturn).toHaveBeenNthCalledWith(2, {
      where: { id: 'session', userId: 'owner', deletedAt: null },
      data: { isPinned: false, title: 'Renamed', updatedAt: expect.any(Date) },
    });
    prisma.chatSession.updateManyAndReturn.mockResolvedValueOnce([]);
    await expect(
      service.update('other-user', 'session', { isPinned: true }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
