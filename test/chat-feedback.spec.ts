import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const {
  ChatFeedbackService,
} = require('../dist/model/chat-feedback/chat-feedback.service');
const {
  ChatFeedbackController,
} = require('../dist/model/chat-feedback/chat-feedback.controller');
const {
  toggleChatFeedbackSchema,
} = require('../dist/model/chat-feedback/dto/toggle-chat-feedback.dto');
const {
  METHOD_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA,
} = require('@nestjs/common/constants');
const { RequestMethod } = require('@nestjs/common');

function setup(
  initial: 'LIKE' | 'DISLIKE' | null = null,
  role = 'assistant',
  status = 'completed',
) {
  let feedback: 'LIKE' | 'DISLIKE' | null = initial;
  const row = { role, status };
  const chatFeedback = {
    findUnique: vi.fn(async () => (feedback ? { type: feedback } : null)),
    create: vi.fn(async ({ data }: { data: { type: 'LIKE' | 'DISLIKE' } }) => {
      feedback = data.type;
    }),
    update: vi.fn(async ({ data }: { data: { type: 'LIKE' | 'DISLIKE' } }) => {
      feedback = data.type;
    }),
    delete: vi.fn(async () => {
      feedback = null;
    }),
  };
  const tx = {
    $queryRaw: vi.fn(async () => [row]),
    chatFeedback,
  };
  // A mutex models the Postgres row lock used by the service.
  let tail = Promise.resolve();
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: typeof tx) => Promise<void>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await fn(tx);
      } finally {
        release();
      }
    }),
  };
  return {
    service: new ChatFeedbackService(prisma),
    chatFeedback,
    tx,
    prisma,
    getFeedback: () => feedback,
  };
}

describe('POST /chat/:messageId/feedback', () => {
  it('registers POST and responds with 204 No Content', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ChatFeedbackController)).toBe(
      'chat',
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        ChatFeedbackController.prototype.toggle,
      ),
    ).toBe(':messageId/feedback');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        ChatFeedbackController.prototype.toggle,
      ),
    ).toBe(RequestMethod.POST);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        ChatFeedbackController.prototype.toggle,
      ),
    ).toBe(204);
  });

  it.each([
    [null, 'LIKE', 'LIKE', 'create'],
    [null, 'DISLIKE', 'DISLIKE', 'create'],
    ['LIKE', 'LIKE', null, 'delete'],
    ['DISLIKE', 'DISLIKE', null, 'delete'],
    ['LIKE', 'DISLIKE', 'DISLIKE', 'update'],
    ['DISLIKE', 'LIKE', 'LIKE', 'update'],
  ] as const)(
    '%s → %s = %s',
    async (initial, requested, expected, mutation) => {
      const { service, chatFeedback, getFeedback } = setup(initial);
      await expect(
        service.toggle('owner', 'message', { type: requested }),
      ).resolves.toBeUndefined();
      expect(getFeedback()).toBe(expected);
      expect(chatFeedback[mutation]).toHaveBeenCalledOnce();
    },
  );

  it('accepts only Prisma enum LIKE and DISLIKE', () => {
    expect(toggleChatFeedbackSchema.safeParse({ type: 'LIKE' }).success).toBe(
      true,
    );
    expect(
      toggleChatFeedbackSchema.safeParse({ type: 'DISLIKE' }).success,
    ).toBe(true);
    expect(toggleChatFeedbackSchema.safeParse({ type: 'love' }).success).toBe(
      false,
    );
    expect(
      toggleChatFeedbackSchema.safeParse({ type: 'LIKE', extra: true }).success,
    ).toBe(false);
  });

  it('returns 404 for unavailable or foreign messages', async () => {
    const x = setup();
    x.tx.$queryRaw.mockResolvedValue([]);
    await expect(
      x.service.toggle('owner', 'foreign', { type: 'LIKE' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(x.chatFeedback.create).not.toHaveBeenCalled();
  });

  it.each([
    ['user', 'completed'],
    ['assistant', 'streaming'],
  ])('rejects invalid message role/status %s/%s', async (role, status) => {
    const x = setup(null, role, status);
    await expect(
      x.service.toggle('owner', 'message', { type: 'LIKE' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(x.chatFeedback.create).not.toHaveBeenCalled();
  });

  it('serializes simultaneous equal toggles so two likes cancel out', async () => {
    const x = setup();
    await Promise.all([
      x.service.toggle('owner', 'message', { type: 'LIKE' }),
      x.service.toggle('owner', 'message', { type: 'LIKE' }),
    ]);
    expect(x.getFeedback()).toBeNull();
    expect(x.chatFeedback.create).toHaveBeenCalledOnce();
    expect(x.chatFeedback.delete).toHaveBeenCalledOnce();
  });
});
