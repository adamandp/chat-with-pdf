import type { SearchResultData } from '@zilliz/milvus2-sdk-node';

export interface DocumentChunk {
  id: string;
  document_id: string;
  user_id: string;
  chunk_index: number;
  page_number: number;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export type DocumentChunkSearchHit = Pick<
  DocumentChunk,
  'id' | 'document_id' | 'content' | 'page_number' | 'metadata'
> & Pick<SearchResultData, 'score'>;
