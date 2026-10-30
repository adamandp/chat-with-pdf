import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const { RagService } = require('../dist/model/chat/chat-retrieval');

function setup(documentIds: string[] = ['document']) {
  const embedQuery = vi.fn().mockResolvedValue(Array(1536).fill(0));
  const stream = vi.fn(async function* () {
    yield {
      content: 'Answer',
      usage_metadata: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
    };
  });
  const gemini = { embeddings: vi.fn(() => ({ embedQuery })) };
  const groq = { chatModel: vi.fn(() => ({ stream })) };
  const milvus = {
    search: vi.fn().mockResolvedValue({ results: [{
      id: 'chunk', document_id: 'document', content: 'Evidence',
      page_number: '2', metadata: { filename: 'example.pdf' }, score: 1,
    }] }),
  };
  const input = {
    userId: 'owner', question: 'Question', documentIds, answerMode: 'general',
    history: [], model: 'model', signal: new AbortController().signal,
    onSources: vi.fn(), onToken: vi.fn(),
  };
  return { service: new RagService(gemini, groq, milvus), input, gemini, groq, milvus, embedQuery, stream };
}

describe('chat retrieval orchestration (local service doubles)', () => {
  it('rejects search results missing document fields before calling Groq', async () => {
    const x = setup();
    x.milvus.search.mockResolvedValue({ results: [{ id: 'chunk', score: 1 }] });
    await expect(x.service.run(x.input)).rejects.toThrow('Invalid document search result');
    expect(x.groq.chatModel).not.toHaveBeenCalled();
  });

  it('uses Gemini for embeddings, Groq for chat and preserves sources and usage', async () => {
    const x = setup();
    expect(await x.service.run(x.input)).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 12 });
    expect(x.embedQuery).toHaveBeenCalledWith('Question');
    expect(x.groq.chatModel).toHaveBeenCalledOnce();
    expect(x.stream).toHaveBeenCalledWith(expect.any(Array), { signal: x.input.signal });
    expect(x.milvus.search.mock.calls[0][0].filter).toContain('user_id == "owner"');
    expect(x.input.onSources).toHaveBeenCalledWith([{
      documentId: 'document', chunkId: 'chunk', pageNumber: 2, filename: 'example.pdf',
    }]);
    expect(x.input.onToken).toHaveBeenCalledWith('Answer');
  });

  it('skips embeddings and retrieval for general chat without documents', async () => {
    const x = setup([]);
    await x.service.run(x.input);
    expect(x.gemini.embeddings).not.toHaveBeenCalled();
    expect(x.milvus.search).not.toHaveBeenCalled();
    expect(x.groq.chatModel).toHaveBeenCalledOnce();
  });

  it('returns document-only fallback without calling Groq when no evidence exists', async () => {
    const x = setup();
    x.input.answerMode = 'document_only';
    x.milvus.search.mockResolvedValue({ results: [] });
    expect(await x.service.run(x.input)).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
    expect(x.groq.chatModel).not.toHaveBeenCalled();
    expect(x.input.onToken).toHaveBeenCalledWith(expect.stringContaining('tidak ditemukan'));
  });

  it('stops before search and chat when the embedding dimension is incompatible', async () => {
    const x = setup();
    x.embedQuery.mockResolvedValue([0]);
    await expect(x.service.run(x.input)).rejects.toThrow('Embedding dimension mismatch');
    expect(x.milvus.search).not.toHaveBeenCalled();
    expect(x.groq.chatModel).not.toHaveBeenCalled();
  });
});
