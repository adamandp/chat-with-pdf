import type { Chunk, Source } from '../documents/documents.interface';
import type { ChatMode } from './chat-mode';
export interface ChatState {
  question: string;
  standaloneQuestion: string;
  query: string;
  userId: string;
  documentIds: string[];
  history: { role: string;
    content: string; }[];
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
  ): Promise<{ enough: boolean;
    next_query: string; }>;
  answer(
    question: string,
    chunks: Chunk[],
    enough: boolean | null,
    signal?: AbortSignal,
    options?: { history: ChatState['history'];
      compact: boolean; },
  ): Promise<{ answer: string;
    source_ids: number[]; }>;
}

export interface ChatProgress {
  stage: 'preparing' | 'searching' | 'evaluating' | 'answering' | 'saving';
  message: string;
  attempt?: number;
}

export interface ChatResult {
  mode: ChatMode;
  session_id: string;
  message_id: string;
  answer: string;
  sources: Source[];
  search_attempts: number;
  context_sufficient: boolean | null;
}

export type ChatStreamEvent
  = | { type: 'progress';
    data: ChatProgress; }
    | { type: 'token';
      data: { text: string }; }
    | { type: 'done';
      data: ChatResult; }
      | { type: 'error';
        data: { status_code: number;
          message: string; }; };
