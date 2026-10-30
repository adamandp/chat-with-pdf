import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { MessageEvent } from '@nestjs/common';
import type { DocumentChunk } from '../../common/milvus/milvus.interface';
import {
  sendChatSchema,
  chatHistorySchema,
  completionSchema,
} from './chat.validation';

export class CompletionDTO
  extends createZodDto(completionSchema)
  implements z.infer<typeof completionSchema> {}

export class SendChatDTO
  extends createZodDto(sendChatSchema)
  implements z.infer<typeof sendChatSchema> {}

export class ChatHistoryDTO
  extends createZodDto(chatHistorySchema)
  implements z.infer<typeof chatHistorySchema> {}

export type ChatHistoryContext = Pick<ChatHistoryDTO, 'role' | 'content'>;

export type ChatMessageState = Pick<
  ChatHistoryDTO,
  'id' | 'sessionId' | 'status'
>;

export type ChatTokenDTO = Pick<ChatHistoryDTO, 'content'>;

export interface ChatSource {
  documentId: DocumentChunk['document_id'];
  chunkId: DocumentChunk['id'];
  pageNumber: DocumentChunk['page_number'];
  filename: string | null;
}

export type SendChatDoneDTO = Pick<
  ChatHistoryDTO,
  'id' | 'sessionId' | 'content'
> & {
  status: 'completed';
  sources: ChatSource[];
  mode: SendChatDTO['mode'];
};

export type SendChatStartedDTO = Omit<ChatMessageState, 'status'> & {
  status: 'streaming';
};

export interface SendChatSourcesDTO {
  sources: ChatSource[];
}

export interface SendChatErrorDTO {
  messageId: ChatHistoryDTO['id'];
  message: string;
}

export type SendChatEvent = Omit<MessageEvent, 'type' | 'data'> & (
  | { type: 'started'; data: SendChatStartedDTO }
  | { type: 'sources'; data: SendChatSourcesDTO }
  | { type: 'token'; data: ChatTokenDTO }
  | { type: 'done'; data: SendChatDoneDTO }
  | { type: 'error'; data: SendChatErrorDTO }
);

export type RagInput = Pick<SendChatDTO, 'question' | 'answerMode'> &
  Pick<CompletionDTO, 'model'> & {
    userId: string;
    documentIds: NonNullable<SendChatDTO['documentIds']>;
    history: ChatHistoryContext[];
    signal: AbortSignal;
    onSources: (sources: ChatSource[]) => void;
    onToken: (content: ChatHistoryDTO['content']) => void;
  };

export type RagResult = Pick<
  CompletionDTO,
  'inputTokens' | 'outputTokens' | 'totalTokens'
>;

export type ChatEvidence = Pick<ChatHistoryDTO, 'content'> & {
  source: ChatSource;
};

export type PreparedChat = Pick<RagInput, 'documentIds' | 'history' | 'model'> &
  Pick<ChatHistoryDTO, 'sessionId'> & {
    assistantId: ChatHistoryDTO['id'];
    completionId: CompletionDTO['id'];
  };
