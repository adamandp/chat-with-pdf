import type { Chunk, Source } from '../documents/documents.interface';

export type ChatMode = 'quick' | 'pro' | 'ultra';

// These limits affect model context only; persistence always stores full messages.
export const CHAT_MODES = {
  quick: {
    thinkingLevel: 'LOW',
    historyMessages: 4,
    historyCharacters: 1000,
    historyBudget: 4000,
    chunks: 3,
    evidenceBudget: 6000,
  },
  pro: {
    thinkingLevel: 'MEDIUM',
    historyMessages: 1000,
    historyCharacters: 8000,
    historyBudget: 64000,
    chunks: 6,
    evidenceBudget: 24000,
  },
  ultra: {
    thinkingLevel: 'HIGH',
    historyMessages: 10,
    historyCharacters: 8000,
    historyBudget: 80000,
    chunks: 6,
    evidenceBudget: 24000,
  },
} as const;

export function compactEvidence(chunks: Chunk[], mode: 'quick' | 'pro'): Chunk[] {
  const policy = CHAT_MODES[mode];

  let remaining = policy.evidenceBudget;

  const found = new Map<string, Chunk>();

  for (const chunk of chunks) {
    if (found.has(chunk.id) || !chunk.text.trim()) continue;

    if (remaining <= 0 || found.size >= policy.chunks) break;

    const text = chunk.text.slice(0, remaining);

    found.set(
      chunk.id,
      {
        ...chunk,
        text,
      },
    );
    remaining -= text.length;
  }

  return [...found.values()];
}

export function citedSources(chunks: Chunk[], sourceIds: number[]): Source[] {
  return [...new Set(sourceIds)]
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= chunks.length)
    .map((id) => {
      const chunk = chunks[id - 1];

      return {
        source_id: id,
        document_id: chunk.document_id,
        filename: chunk.filename,
        page: chunk.page,
        chunk_id: chunk.id,
      };
    });
}
