import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { ChatState, ChatEngine } from './chat.interface';
import type { Chunk } from '../documents/documents.interface';

const State = Annotation.Root({
  question: Annotation<string>(),
  query: Annotation<string>(),
  userId: Annotation<string>(),
  documentIds: Annotation<string[]>(),
  history: Annotation<ChatState['history']>(),
  chunks: Annotation<Chunk[]>(),
  attempts: Annotation<number>(),
  enough: Annotation<boolean>(),
  answer: Annotation<string>(),
  sources: Annotation<ChatState['sources']>(),
});

export function buildChatGraph(
  engine: ChatEngine,
  retrieve: (userId: string, ids: string[], query: string) => Promise<Chunk[]>,
) {
  return new StateGraph(State)
    .addNode('prepare', async (s, config) => ({
      query: s.history.length
        ? (await engine.rewrite(s.question, s.history, config.signal)).slice(
            0,
            2000,
          )
        : s.question,
    }))
    .addNode('search', async (s) => {
      const found = await retrieve(s.userId, s.documentIds, s.query);
      const chunks = new Map(s.chunks.map((c) => [c.id, c]));
      for (const chunk of found) chunks.set(chunk.id, chunk);
      return { chunks: [...chunks.values()], attempts: s.attempts + 1 };
    })
    .addNode('evaluate', async (s, config) => {
      const result = await engine.evaluate(s.question, s.chunks, config.signal);
      return {
        enough: result.enough,
        query: result.next_query.slice(0, 2000) || s.query,
      };
    })
    .addNode('generate', async (s, config) => {
      if (!s.chunks.length)
        return {
          answer: 'Informasi yang relevan belum ditemukan di dokumen.',
          sources: [],
        };
      const result = await engine.answer(
        s.question,
        s.chunks,
        s.enough,
        config.signal,
      );
      const sources = [...new Set(result.source_ids)]
        .filter(
          (id) => Number.isInteger(id) && id >= 1 && id <= s.chunks.length,
        )
        .map((id) => {
          const c = s.chunks[id - 1];
          return {
            source_id: id,
            document_id: c.document_id,
            filename: c.filename,
            page: c.page,
            chunk_id: c.id,
          };
        });
      return { answer: result.answer, sources };
    })
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'search')
    .addEdge('search', 'evaluate')
    .addConditionalEdges(
      'evaluate',
      (s) => (s.enough || s.attempts >= 3 ? 'generate' : 'search'),
      { generate: 'generate', search: 'search' },
    )
    .addEdge('generate', END)
    .compile();
}
