import { createRequire } from 'node:module';
import { lastValueFrom, toArray } from 'rxjs';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const { ChatService } = require('../dist/model/chat/chat.service');
const { ChatController } = require('../dist/model/chat/chat.controller');
const { PATH_METADATA, METHOD_METADATA } = require('@nestjs/common/constants');
const { RequestMethod } = require('@nestjs/common');

const userId = 'a3b2a618-a806-4b7c-b6d8-bc080f933283';
const sessionId = 'b7067365-f7b5-4e65-8d50-c68a345fc590';
const questionId = '0e6f86f8-59eb-4d31-b5da-10d5194c2f47';
const answerId = '9fc8683b-f5de-4b7d-859e-b98f3ddc8306';
const docId = '1ec57392-fb19-4a75-9d2e-1a85df0325f3';
const group = '74716862-7f3c-46cd-bb41-1b1041c36d46';

function setup() {
  const session = {
    id: sessionId,
    title: 'Machine Learning',
    answerMode: 'general',
    activeLeafMessageId: answerId,
  };
  const history = [{ role: 'user', content: 'Earlier question' }];
  const tx = {
    $queryRaw: vi
      .fn()
      .mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('FROM chat_session')) return [session];
        if (
          sql.includes('WITH RECURSIVE ancestors') &&
          sql.includes('version_group_id')
        ) {
          return [
            {
              id: questionId,
              parentMessageId: null,
              versionGroupId: group,
              role: 'user',
              content: 'Original question',
              sources: [],
              answerMode: 'general',
              status: 'COMPLETED',
            },
            {
              id: answerId,
              parentMessageId: questionId,
              versionGroupId: group,
              role: 'assistant',
              content: 'Original answer',
              sources: [{ documentId: docId }],
              answerMode: 'general',
              status: 'COMPLETED',
            },
          ];
        }
        if (sql.includes('WITH RECURSIVE descendants'))
          return [{ id: answerId }];
        return history;
      }),
    chatHistory: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ sessionId, deletedAt: null, status: 'COMPLETED' }),
      findFirst: vi.fn().mockResolvedValue({
        role: 'assistant',
        status: 'COMPLETED',
        parentMessageId: questionId,
        versionGroupId: group,
        answerMode: 'general',
        id: answerId,
      }),
      create: vi
        .fn()
        .mockImplementation(
          async ({ data }: { data: { id?: string; role?: string } }) => ({
            id:
              data.id ??
              (data.role === 'user' ? 'edited-user' : 'new-assistant'),
          }),
        ),
      update: vi.fn().mockResolvedValue({}),
    },
    chatSession: {
      create: vi.fn().mockResolvedValue({
        id: 'forked-session',
        title: 'Fork → Machine Learning',
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    completion: {
      create: vi.fn().mockResolvedValue({ id: 'new-completion' }),
      update: vi.fn().mockResolvedValue({}),
    },
    sessionDocument: {
      findMany: vi.fn().mockResolvedValue([{ documentId: docId }]),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    document: { count: vi.fn().mockResolvedValue(1) },
  };
  const prisma = {
    $transaction: vi.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(tx) : Promise.all(arg),
    ),
    chatHistory: { update: vi.fn().mockResolvedValue({}) },
    completion: { update: vi.fn().mockResolvedValue({}) },
  };
  const rag = {
    run: vi.fn(
      async (input: {
        onToken: (s: string) => void;
        onSources: (s: unknown[]) => void;
      }) => {
        input.onSources([]);
        input.onToken('New answer');
        return { inputTokens: 2, outputTokens: 2, totalTokens: 4 };
      },
    ),
  };
  const logger = { setContext: vi.fn(), trace: vi.fn(), error: vi.fn() };
  const service = new ChatService(
    prisma,
    rag,
    { getOrThrow: () => 'groq-model' },
    logger,
  );
  return { tx, prisma, service, rag, session };
}

describe('chat fork / regenerate / edit / activate', () => {
  it('registers fork, regenerate, edit and version activation under /chat', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ChatController)).toBe('chat');
    for (const [method, path, verb] of [
      ['fork', ':id/fork', RequestMethod.POST],
      ['regenerate', ':messageId/regenerate', RequestMethod.POST],
      ['edit', ':messageId/edit', RequestMethod.POST],
      ['activate', ':messageId/activate', RequestMethod.PATCH],
    ] as const) {
      expect(
        Reflect.getMetadata(PATH_METADATA, ChatController.prototype[method]),
      ).toBe(path);
      expect(
        Reflect.getMetadata(METHOD_METADATA, ChatController.prototype[method]),
      ).toBe(verb);
    }
  });

  it('forks only the ancestor path with new ids, parents, version groups, and shared documents', async () => {
    const x = setup();
    const response = await x.service.fork(userId, sessionId, {
      messageId: answerId,
    });
    expect(response.data).toEqual({
      id: 'forked-session',
      title: 'Fork → Machine Learning',
    });
    const rows = x.tx.chatHistory.create.mock.calls.map(
      ([input]: any[]) => input.data,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sessionId: 'forked-session',
      role: 'user',
      content: 'Original question',
      parentMessageId: null,
    });
    expect(rows[1]).toMatchObject({
      sessionId: 'forked-session',
      role: 'assistant',
      content: 'Original answer',
      parentMessageId: rows[0].id,
    });
    expect(rows[0].id).not.toBe(questionId);
    expect(rows[1].id).not.toBe(answerId);
    expect(rows[0].versionGroupId).not.toBe(group);
    expect(rows[0].versionGroupId).toBe(rows[1].versionGroupId);
    expect(x.tx.chatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'forked-session' },
        data: { activeLeafMessageId: rows[1].id },
      }),
    );
    expect(x.tx.sessionDocument.createMany).toHaveBeenCalledWith({
      data: [{ sessionId: 'forked-session', documentId: docId }],
    });
    expect(x.tx.completion.create).not.toHaveBeenCalled();
  });

  it('rejects unknown, foreign or incomplete fork targets before creating the session', async () => {
    const x = setup();
    x.tx.chatHistory.findFirst.mockResolvedValue(null);
    await expect(
      x.service.fork(userId, sessionId, { messageId: answerId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(x.tx.chatSession.create).not.toHaveBeenCalled();
    x.tx.chatHistory.findFirst.mockResolvedValue({ status: 'STREAMING' });
    await expect(
      x.service.fork(userId, sessionId, { messageId: answerId }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('propagates a fork write failure from the transaction', async () => {
    const x = setup();
    x.tx.sessionDocument.createMany.mockRejectedValue(
      new Error('DB insert failed'),
    );
    await expect(
      x.service.fork(userId, sessionId, { messageId: answerId }),
    ).rejects.toThrow('DB insert failed');
    expect(x.prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('regenerates the active answer without adding a user message and reuses SSE', async () => {
    const x = setup();
    x.tx.chatHistory.findFirst
      .mockResolvedValueOnce({
        role: 'assistant',
        status: 'COMPLETED',
        parentMessageId: questionId,
        versionGroupId: group,
        answerMode: 'general',
      })
      .mockResolvedValueOnce({
        role: 'user',
        status: 'COMPLETED',
        parentMessageId: null,
        content: 'Original question',
        answerMode: 'general',
      });
    const events = await lastValueFrom(
      (await x.service.regenerate(userId, answerId, { mode: 'quick' })).pipe(
        toArray(),
      ),
    );
    expect(events.map((event: { type: string }) => event.type)).toEqual([
      'started',
      'sources',
      'token',
      'done',
    ]);
    expect(x.rag.run.mock.calls[0][0]).toMatchObject({
      question: 'Original question',
      history: [],
      documentIds: [docId],
    });
    expect(x.tx.chatHistory.create).toHaveBeenCalledOnce();
    expect(x.tx.chatHistory.create.mock.calls[0][0].data).toMatchObject({
      role: 'assistant',
      parentMessageId: questionId,
      versionGroupId: group,
      status: 'STREAMING',
    });
    expect(x.tx.completion.create).toHaveBeenCalledOnce();
  });

  it('rejects regenerating an inactive answer', async () => {
    const x = setup();
    x.session.activeLeafMessageId = 'another-answer';
    await expect(
      x.service.regenerate(userId, answerId, { mode: 'quick' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(x.tx.chatHistory.create).not.toHaveBeenCalled();
  });

  it('restores the earlier active leaf when regeneration fails', async () => {
    const x = setup();
    x.tx.chatHistory.findFirst
      .mockResolvedValueOnce({
        role: 'assistant',
        status: 'COMPLETED',
        parentMessageId: questionId,
        versionGroupId: group,
        answerMode: 'general',
      })
      .mockResolvedValueOnce({
        role: 'user',
        status: 'COMPLETED',
        parentMessageId: null,
        content: 'Original question',
        answerMode: 'general',
      });
    x.rag.run.mockRejectedValue(new Error('Groq unavailable'));
    const events = await lastValueFrom(
      (await x.service.regenerate(userId, answerId, { mode: 'quick' })).pipe(
        toArray(),
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(x.tx.chatSession.updateMany).toHaveBeenCalledWith({
      where: { id: sessionId, activeLeafMessageId: 'new-assistant' },
      data: { activeLeafMessageId: answerId },
    });
  });

  it('edits an old user question by branching under the original parent', async () => {
    const x = setup();
    x.tx.chatHistory.findFirst.mockResolvedValueOnce({
      role: 'user',
      status: 'COMPLETED',
      parentMessageId: null,
      versionGroupId: group,
    });
    const events = await lastValueFrom(
      (
        await x.service.edit(userId, questionId, {
          sessionId,
          question: 'Edited question',
          mode: 'quick',
          answerMode: 'general',
          documentIds: [docId],
        })
      ).pipe(toArray()),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    const [edited, assistant] = x.tx.chatHistory.create.mock.calls.map(
      ([input]: any[]) => input.data,
    );
    expect(edited).toMatchObject({
      role: 'user',
      content: 'Edited question',
      parentMessageId: null,
      versionGroupId: group,
    });
    expect(assistant).toMatchObject({
      role: 'assistant',
      parentMessageId: 'edited-user',
      status: 'STREAMING',
    });
    expect(assistant.versionGroupId).toBeUndefined();
    expect(x.rag.run.mock.calls[0][0]).toMatchObject({
      question: 'Edited question',
      documentIds: [docId],
      history: [],
    });
  });

  it('refuses editing foreign messages and leaves the original branch intact', async () => {
    const x = setup();
    x.tx.chatHistory.findFirst.mockResolvedValue(null);
    await expect(
      x.service.edit(userId, questionId, {
        sessionId,
        question: 'Edited',
        answerMode: 'general',
        mode: 'quick',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(x.tx.chatHistory.create).not.toHaveBeenCalled();
  });

  it('activates an existing branch to restore its descendant leaf', async () => {
    const x = setup();
    const result = await x.service.activate(userId, questionId);
    expect(result.data).toEqual({ activeLeafMessageId: answerId });
    expect(x.tx.chatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activeLeafMessageId: answerId }),
      }),
    );
  });

  it('preserves /chat/send SSE behavior and validates selected document ownership', async () => {
    const x = setup();
    const body = {
      question: 'Next question',
      sessionId,
      mode: 'quick',
      answerMode: 'general',
      documentIds: [docId],
    };
    const events = await lastValueFrom(
      (await x.service.send(userId, body)).pipe(toArray()),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { content: 'New answer' },
    });
    expect(x.tx.document.count).toHaveBeenCalledWith({
      where: { id: { in: [docId] }, userId, deletedAt: null, status: 'READY' },
    });

    const y = setup();
    y.tx.document.count.mockResolvedValue(0);
    await expect(y.service.send(userId, body)).rejects.toMatchObject({
      status: 404,
    });
    expect(y.tx.chatHistory.create).not.toHaveBeenCalled();
  });
});
