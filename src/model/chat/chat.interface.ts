import type { Chunk, Source } from '../documents/documents.interface';
export interface ChatState {
  question: string;
  query: string;
  userId: string;
  documentIds: string[];
  history: { role: string; content: string }[];
  chunks: Chunk[];
  attempts: number;
  enough: boolean;
  answer: string;
  sources: Source[];
}
export interface ChatEngine {
  rewrite(
    question: string,
    history: ChatState['history'],
    signal?: AbortSignal,
  ): Promise<string>;
  evaluate(
    question: string,
    chunks: Chunk[],
    signal?: AbortSignal,
  ): Promise<{ enough: boolean; next_query: string }>;
  answer(
    question: string,
    chunks: Chunk[],
    enough: boolean,
    signal?: AbortSignal,
  ): Promise<{ answer: string; source_ids: number[] }>;
}
