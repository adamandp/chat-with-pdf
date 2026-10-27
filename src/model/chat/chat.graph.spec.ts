import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { buildChatGraph } from './chat.graph';
import type { ChatEngine, ChatState } from './chat.interface';
import type { Chunk } from '../documents/documents.interface';

const chunk: Chunk = {
  id: 'chunk-1',
  user_id: 'user',
  document_id: 'doc',
  filename: 'policy.pdf',
  page: 2,
  text: 'The risk is inflation.',
};

const initial = (): ChatState => ({
  question: 'What are its risks?',
  standaloneQuestion: '',
  query: '',
  userId: 'user',
  documentIds: ['doc'],
  history: [],
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
  evaluate: vi
    .fn()
    .mockResolvedValue({
      enough: true,
      next_query: '',
    }),
  answer: vi
    .fn()
    .mockResolvedValue(
      {
        answer: 'Inflation [1].',
        source_ids: [
          1,
          1,
          99,
          -1,
        ],
      },
    ),
});

describe(
  'chat graph',
  () => {
    it(
      'uses the resolved follow-up question for retrieval, evaluation and answering',
      async () => {
        const model = engine();

        const retrieve = vi
          .fn()
          .mockResolvedValue([chunk]);

        const state = initial();

        state.history = [
          {
            role: 'user',
            content: 'Tell me about bonds.',
          },
        ];

        const result = await buildChatGraph(model, retrieve)
          .invoke(state);

        expect(retrieve)
          .toHaveBeenCalledWith(
            'user',
            ['doc'],
            'What are the risks of bonds?',
          );
        expect(model.evaluate)
          .toHaveBeenCalledWith(
            'What are the risks of bonds?',
            [chunk],
            expect.any(
              AbortSignal,
            ),
          );
        expect(model.answer)
          .toHaveBeenCalledWith(
            'What are the risks of bonds?',
            [chunk],
            true,
            expect.any(
              AbortSignal,
            ),
          );
        expect(result.sources)
          .toEqual([
            {
              source_id: 1,
              document_id: 'doc',
              filename: 'policy.pdf',
              page: 2,
              chunk_id: 'chunk-1',
            },
          ]);
      },
    );

    it(
      'bounds retries and deduplicates retrieved chunks',
      async () => {
        const model = engine();

        vi
          .mocked(model.evaluate)
          .mockResolvedValue(
            {
              enough: false,
              next_query: 'targeted search',
            },
          );

        const retrieve = vi
          .fn()
          .mockResolvedValue([chunk]);

        const result = await buildChatGraph(model, retrieve)
          .invoke(
            initial(),
            { recursionLimit: 16 },
          );

        expect(retrieve)
          .toHaveBeenCalledTimes(3);
        expect(result.chunks)
          .toHaveLength(1);
        expect(result.enough)
          .toBe(false);
        expect(model.answer)
          .toHaveBeenCalledWith(
            initial().question,
            [chunk],
            false,
            expect.any(
              AbortSignal,
            ),
          );
      },
    );

    it(
      'returns an honest fallback without model calls when retrieval is empty',
      async () => {
        const model = engine();

        const result = await buildChatGraph(model, async () => [])
          .invoke(initial());

        expect(model.evaluate).not.toHaveBeenCalled();
        expect(model.answer).not.toHaveBeenCalled();
        expect(result.sources)
          .toEqual([]);
        expect(result.answer)
          .toContain('belum ditemukan');
      },
    );

    it(
      'propagates dependency failures to the service',
      async () => {
        await expect(buildChatGraph(
          engine(),
          async () => {
            throw new Error(
              'unavailable',
            );
          },
        )
          .invoke(initial())).rejects.toThrow('unavailable');
      },
    );
  },
);
