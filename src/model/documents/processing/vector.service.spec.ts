import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ConfigService } from '@nestjs/config';
import { VectorService } from './vector.service';
import type { MilvusService } from '../../../common/milvus/milvus.service';
import type { AiService } from '../../../common/ai/ai.service';

// Isolates search projection/mapping; does not test provider HTTP or live Milvus.
function fixture(missingId = false) {
  const search = vi.fn(async (request: { output_fields: string[] }) => ({
    status: { error_code: 'Success' },
    results: [
      'chunk-a',
      'chunk-b',
    ].map((id) => ({
      ...(request.output_fields.includes('id') && !missingId ? { id } : {}),
      user_id: 'user',
      document_id: 'doc',
      filename: 'validation.pdf',
      page: 5,
      text: id,
    })),
  }));

  const service = new VectorService(
    { search } as unknown as MilvusService,
    new ConfigService({ EMBEDDING_DIMENSIONS: '1' }),
    { embeddings: () => ({ embedQuery: async () => [1] }) } as unknown as AiService,
  );

  return {
    service,
    search,
  };
}

describe(
  'vector search metadata',
  () => {
    it(
      'explicitly requests primary keys and preserves distinct chunk IDs',
      async () => {
        const { service, search } = fixture();

        const chunks = await service.search(
          'user',
          ['doc'],
          'validation',
        );

        expect(search.mock.calls[0][0].output_fields)
          .toContain('id');
        expect(chunks.map((chunk) => chunk.id))
          .toEqual([
            'chunk-a',
            'chunk-b',
          ]);
        expect(chunks[0].filename)
          .toBe('validation.pdf');
      },
    );

    it(
      'rejects missing IDs instead of emitting the string undefined',
      async () => {
        await expect(fixture(true).service.search(
          'user',
          ['doc'],
          'validation',
        ))
          .rejects.toThrow('missing a chunk ID');
      },
    );
  },
);
