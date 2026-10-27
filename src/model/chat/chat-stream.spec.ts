import { describe, expect, it, vi } from 'vitest';
import { ChatModelService } from './chat-model.service';
import { chatRequestContext } from './chat-request-log';

const evidence = [{ id: 'chunk', text: 'Evidence', user_id: 'user', document_id: 'doc', filename: 'a.pdf', page: 1 }];

describe('streamed answers', () => {
  it('emits text incrementally and returns the complete answer and cited IDs', async () => {
    const stream = vi.fn().mockResolvedValue((async function* () {
      yield { content: 'Hello ' };
      yield { content: [{ type: 'text', text: 'world [1].' }] };
    })());
    const ai = { chatModel: vi.fn().mockReturnValue({ stream }) };
    const config = { get: vi.fn((_key: string, fallback: unknown) => fallback) };
    const logger = { trace: vi.fn(), warn: vi.fn() };
    const model = new ChatModelService(ai as never, config as never, logger as never);
    const onToken = vi.fn();
    const result = await chatRequestContext.run(
      { sessionId: 'session', turnId: 'turn', mode: 'quick', onToken },
      () => model.answer('Question?', evidence, null),
    );
    expect(onToken.mock.calls).toEqual([['Hello '], ['world [1].']]);
    expect(result).toEqual({ answer: 'Hello world [1].', source_ids: [1] });
    expect(stream).toHaveBeenCalledOnce();
  });

  it('rejects an empty model stream instead of saving an empty answer', async () => {
    const ai = { chatModel: () => ({ stream: async () => (async function* () {})() }) };
    const config = { get: (_key: string, fallback: unknown) => fallback };
    const logger = { trace: vi.fn(), warn: vi.fn() };
    const model = new ChatModelService(ai as never, config as never, logger as never);
    await expect(chatRequestContext.run(
      { sessionId: 'session', turnId: 'turn', mode: 'quick', onToken: vi.fn() },
      () => model.answer('Question?', evidence, null),
    )).rejects.toThrow('Model returned an empty answer');
  });
});
