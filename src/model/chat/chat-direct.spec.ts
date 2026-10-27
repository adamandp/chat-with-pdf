import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { runDirectChat } from './chat-direct';
import { ChatSchema } from './chat.validation';
import type { ChatEngine, ChatState } from './chat.interface';
import type { Chunk } from '../documents/documents.interface';

const chunk = (id: string, text = 'Bond evidence'): Chunk => ({
  id,
  text,
  user_id: 'user',
  document_id: 'doc',
  filename: 'bonds.pdf',
  page: 1,
});

const initial = (): ChatState => ({
  question: 'What are its risks?',
  standaloneQuestion: '',
  query: '',
  userId: 'user',
  documentIds: ['doc'],
  history: [
    {
      role: 'user',
      content: 'Tell me about bonds.',
    },
  ],
  chunks: [],
  attempts: 0,
  enough: false,
  answer: '',
  sources: [],
});

const engine = (): ChatEngine => ({
  rewrite: vi
    .fn()
    .mockResolvedValue('What are the risks of bonds?'),
  evaluate: vi.fn(),
  answer: vi
    .fn()
    .mockResolvedValue(
      {
        answer: 'Risk [1].',
        source_ids: [
          1,
          1,
          99,
        ],
      },
    ),
});

describe(
  'direct chat modes',
  () => {
    it(
      'defaults to quick and rejects unsupported modes',
      () => {
        const body = {
          question: 'Hi',
          document_ids: ['550e8400-e29b-41d4-a716-446655440000'],
        };

        expect(ChatSchema.parse(body).mode)
          .toBe('quick');
        expect(ChatSchema.safeParse({
          ...body,
          mode: 'medium',
        }).success)
          .toBe(
            false,
          );
      },
    );

    it(
      'quick makes one search and one answer call, keeping evidence and citations aligned',
      async () => {
        const model = engine();

        const retrieve = vi
          .fn()
          .mockResolvedValue([
            chunk('a', 'x'.repeat(4000)),
            chunk('a'),
            chunk('b', 'y'.repeat(4000)),
            chunk(
              'c',
            ),
          ]);

        const report = vi.fn();

        const state = initial();

        const result = await runDirectChat(
          state,
          'quick',
          model,
          retrieve,
          report,
          new AbortController().signal,
        );

        expect(retrieve)
          .toHaveBeenCalledExactlyOnceWith(
            'user',
            ['doc'],
            expect.stringContaining(
              'bonds',
            ),
            3,
          );
        expect(model.rewrite).not.toHaveBeenCalled();
        expect(model.evaluate).not.toHaveBeenCalled();
        expect(model.answer)
          .toHaveBeenCalledExactlyOnceWith(
            state.question,
            expect.arrayContaining(
              [
                expect.objectContaining(
                  {
                    id: 'b',
                    text: 'y'.repeat(
                      2000,
                    ),
                  },
                ),
              ],
            ),
            null,
            expect.any(AbortSignal),
            {
              history: state.history,
              compact: true,
            },
          );
        expect(result.chunks)
          .toHaveLength(2);
        expect(result.sources.map((source) => source.chunk_id))
          .toEqual(['a']);
        expect(report.mock.calls.map(([progress]) => progress.stage))
          .toEqual(
            [
              'searching',
              'answering',
            ],
          );
      },
    );

    it(
      'pro uses full supplied history for rewrite and generation without evaluation',
      async () => {
        const model = engine();

        const state = initial();

        state.history = Array.from(
          { length: 20 },
          (_, i) => ({
            role: i % 2 ? 'assistant' : 'user',
            content: String(
              i,
            ),
          }),
        );

        const retrieve = vi
          .fn()
          .mockResolvedValue([chunk('a')]);

        await runDirectChat(
          state,
          'pro',
          model,
          retrieve,
          vi.fn(),
          new AbortController().signal,
        );

        expect(model.rewrite)
          .toHaveBeenCalledWith(
            state.question,
            state.history,
            expect.any(
              AbortSignal,
            ),
          );
        expect(retrieve)
          .toHaveBeenCalledExactlyOnceWith(
            'user',
            ['doc'],
            'What are the risks of bonds?',
            6,
          );
        expect(model.evaluate).not.toHaveBeenCalled();
        expect(model.answer)
          .toHaveBeenCalledWith(
            'What are the risks of bonds?',
            [
              chunk(
                'a',
              ),
            ],
            null,
            expect.any(AbortSignal),
            {
              history: state.history,
              compact: false,
            },
          );
      },
    );

    it(
      'does not generate an answer when retrieval is empty',
      async () => {
        const model = engine();

        const result = await runDirectChat(
          initial(),
          'quick',
          model,
          async () => [],
          vi.fn(),
          new AbortController().signal,
        );

        expect(model.answer).not.toHaveBeenCalled();
        expect(result.sources)
          .toEqual([]);
        expect(result.answer)
          .toContain('belum ditemukan');
      },
    );

    it(
      'stops before generation if retrieval finishes after cancellation',
      async () => {
        const model = engine();

        const abort = new AbortController();

        await expect(runDirectChat(
          initial(),
          'quick',
          model,
          async () => {
            abort.abort();

            return [chunk('a')];
          },
          vi.fn(),
          abort.signal,
        )).rejects.toThrow();

        expect(model.answer).not.toHaveBeenCalled();
      },
    );
  },
);
