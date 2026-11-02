import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const { PATH_METADATA, METHOD_METADATA } = require('@nestjs/common/constants');
const { RequestMethod } = require('@nestjs/common');
const { ChatService } = require('../dist/model/chat/chat.service');
const { ChatController } = require('../dist/model/chat/chat.controller');
const {
  ChatSessionController,
} = require('../dist/model/chat-session/chat-session.controller');

describe('Chat detail endpoint', () => {
  it('registers GET /chat/:id/details and removes the old session detail route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ChatController)).toBe('chat');
    expect(
      Reflect.getMetadata(PATH_METADATA, ChatController.prototype.findOne),
    ).toBe(':id/details');
    expect(
      Reflect.getMetadata(METHOD_METADATA, ChatController.prototype.findOne),
    ).toBe(RequestMethod.GET);
    expect(ChatSessionController.prototype.findOne).toBeUndefined();
  });

  it('delegates the authenticated user and session id to ChatService', async () => {
    const response = { message: 'ok', data: { messages: [] } };
    const findOne = vi.fn().mockResolvedValue(response);
    const controller = new ChatController({ findOne });

    await expect(
      controller.findOne({ sub: 'user-id' }, 'session-id'),
    ).resolves.toEqual(response);
    expect(findOne).toHaveBeenCalledExactlyOnceWith('user-id', 'session-id');
  });
});

describe('ChatService.findOne', () => {
  const sessionId = 'f27f6302-a3d9-4e52-9011-6631aafda7f0';
  const userId = '48bc0e16-1864-49ae-9680-aaeaa094d40c';
  const userMessageId = '77e78720-5302-4494-8c37-1cae998ac46c';
  const assistantMessageId = '5132f3ab-b51d-4356-b091-9e70515bc351';
  const createdAt = new Date('2026-11-02T10:00:00Z');

  function setup({
    session = {
      id: sessionId,
      title: 'Annual Report',
      answerMode: 'document_only',
      createdAt,
      updatedAt: createdAt,
      activeLeafMessageId: assistantMessageId,
      sessionDocuments: [
        {
          document: {
            id: 'c14161ef-8ea9-475f-902d-d7127d6c34cc',
            fileName: 'Annual Report.pdf',
            pageCount: 120,
            status: 'READY',
            deletedAt: null,
          },
        },
      ],
    },
    messageIds = [{ id: userMessageId }, { id: assistantMessageId }],
    histories = [
      {
        id: assistantMessageId,
        parentMessageId: userMessageId,
        versionGroupId: 'group-assistant',
        role: 'assistant',
        content: 'Revenue increased [1].',
        status: 'COMPLETED',
        createdAt,
        sources: [
          {
            documentId: 'c14161ef-8ea9-475f-902d-d7127d6c34cc',
            chunkId: 'internal-chunk-id',
            pageNumber: 12,
            filename: 'Annual Report.pdf',
          },
        ],
        feedback: { type: 'LIKE' },
      },
      {
        id: userMessageId,
        parentMessageId: null,
        versionGroupId: 'group-user',
        role: 'user',
        content: 'Summarize the report',
        status: 'COMPLETED',
        createdAt,
        sources: [],
        feedback: null,
      },
    ],
  }: {
    session?: object | null;
    messageIds?: { id: string }[];
    histories?: object[];
  } = {}) {
    const versions = histories.map((history) => {
      const row = history as {
        id: string;
        versionGroupId?: string;
        status: string;
        createdAt: Date;
      };
      return {
        id: row.id,
        versionGroupId: row.versionGroupId,
        status: row.status,
        createdAt: row.createdAt,
      };
    });
    const prisma = {
      chatSession: { findFirst: vi.fn().mockResolvedValue(session) },
      chatHistory: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce(histories)
          .mockResolvedValueOnce(versions),
      },
      $queryRaw: vi.fn().mockResolvedValue(messageIds),
    };
    const logger = { setContext: vi.fn(), trace: vi.fn() };
    const service = new ChatService(prisma, { run: vi.fn() }, {}, logger);
    return { prisma, service };
  }

  it('returns only the active message path, in conversation order, with Prisma feedback values', async () => {
    const { service, prisma } = setup();

    const result = await service.findOne(userId, sessionId);

    expect(prisma.chatSession.findFirst).toHaveBeenCalledWith({
      where: { id: sessionId, userId, deletedAt: null },
      select: expect.objectContaining({
        activeLeafMessageId: true,
        sessionDocuments: expect.any(Object),
      }),
    });
    expect(prisma.chatHistory.findMany).toHaveBeenCalledWith({
      where: {
        sessionId,
        id: { in: [userMessageId, assistantMessageId] },
        deletedAt: null,
      },
      select: expect.objectContaining({ feedback: { select: { type: true } } }),
    });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    const sql = prisma.$queryRaw.mock.calls[0][0].join(' ');
    expect(sql).toContain('WITH RECURSIVE ancestors');
    expect(sql).toContain('ORDER BY depth DESC');

    expect(result.data).toMatchObject({
      id: sessionId,
      title: 'Annual Report',
      answerMode: 'document_only',
      createdAt,
      updatedAt: createdAt,
      activeLeafMessageId: assistantMessageId,
      documents: [
        {
          id: 'c14161ef-8ea9-475f-902d-d7127d6c34cc',
          fileName: 'Annual Report.pdf',
          pageCount: 120,
          status: 'READY',
          deletedAt: null,
        },
      ],
      messages: [
        {
          id: userMessageId,
          role: 'user',
          content: 'Summarize the report',
          status: 'COMPLETED',
          createdAt,
          sources: [],
          feedback: null,
          parentMessageId: null,
          versionGroupId: 'group-user',
          versionCount: 1,
        },
        {
          id: assistantMessageId,
          role: 'assistant',
          content: 'Revenue increased [1].',
          status: 'COMPLETED',
          createdAt,
          sources: [
            {
              documentId: 'c14161ef-8ea9-475f-902d-d7127d6c34cc',
              pageNumber: 12,
            },
          ],
          feedback: 'LIKE',
          parentMessageId: userMessageId,
          versionGroupId: 'group-assistant',
          versionCount: 1,
        },
      ],
    });
  });

  it('returns an empty message list for a session without an active leaf', async () => {
    const { service, prisma } = setup({
      session: {
        id: sessionId,
        title: 'New Chat',
        answerMode: null,
        createdAt,
        updatedAt: createdAt,
        activeLeafMessageId: null,
        sessionDocuments: [],
      },
    });

    const result = await service.findOne(userId, sessionId);

    expect(result.data?.messages).toEqual([]);
    expect(result.data?.documents).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.chatHistory.findMany).not.toHaveBeenCalled();
  });

  it('hides a missing, deleted, or foreign-owned session behind a 404', async () => {
    const { service, prisma } = setup({ session: null });

    await expect(service.findOne(userId, sessionId)).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('preserves DISLIKE and excludes messages outside the active path', async () => {
    const { service } = setup({
      histories: [
        {
          id: assistantMessageId,
          parentMessageId: userMessageId,
          versionGroupId: 'group-assistant',
          role: 'assistant',
          content: 'Answer',
          status: 'COMPLETED',
          createdAt,
          sources: [
            { documentId: 'doc-id', pageNumber: 3 },
            null,
            { pageNumber: 2 },
          ],
          feedback: { type: 'DISLIKE' },
        },
        {
          id: 'old-inactive-message',
          parentMessageId: userMessageId,
          versionGroupId: 'group-assistant',
          role: 'assistant',
          content: 'Old branch',
          status: 'COMPLETED',
          createdAt,
          sources: [],
          feedback: null,
        },
      ],
    });

    const result = await service.findOne(userId, sessionId);

    expect(result.data?.messages).toMatchObject([
      {
        id: assistantMessageId,
        role: 'assistant',
        content: 'Answer',
        status: 'COMPLETED',
        createdAt,
        sources: [{ documentId: 'doc-id', pageNumber: 3 }],
        feedback: 'DISLIKE',
        versionCount: 2,
      },
    ]);
  });
});
