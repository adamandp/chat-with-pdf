import type {
  ChatHistory,
  ChatSession,
  Document,
  FeedbackType,
} from '../../generated/prisma/client';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { BaseChatSessionSchema } from './chat-session.validation';

export class BaseChatSessionDto
  extends createZodDto(BaseChatSessionSchema)
  implements z.infer<typeof BaseChatSessionSchema> {}

export type ChatSessionSummaryDto = Pick<
  BaseChatSessionDto,
  'id' | 'title' | 'updatedAt'
>;

export type FindAllChatSessionResDto = ChatSessionSummaryDto[];
export type FindChatsResDto = ChatHistory[];
export type UpdateChatSessionResDto = ChatSessionSummaryDto;

export type ChatSessionDocumentDto = Pick<
  Document,
  'id' | 'fileName' | 'pageCount' | 'status' | 'deletedAt'
>;

export interface ChatSessionSourceDto {
  documentId: string;
  pageNumber: number;
}

export type ChatSessionMessageDto = Pick<
  ChatHistory,
  'id' | 'role' | 'content' | 'status' | 'createdAt'
> & {
  sources: ChatSessionSourceDto[];
  feedback: FeedbackType | null;
};

export type FindChatSessionDetailResDto = Pick<
  ChatSession,
  'id' | 'title' | 'answerMode' | 'createdAt' | 'updatedAt'
> & {
  documents: ChatSessionDocumentDto[];
  messages: ChatSessionMessageDto[];
};
