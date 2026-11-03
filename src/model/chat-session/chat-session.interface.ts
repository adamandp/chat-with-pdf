import type { ChatHistory } from '../../generated/prisma/client';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { BaseChatSessionSchema } from './chat-session.validation';

export class BaseChatSessionDto
  extends createZodDto(BaseChatSessionSchema)
  implements z.infer<typeof BaseChatSessionSchema> {}

export type ChatSessionSummaryDto = Pick<
  BaseChatSessionDto,
  'id' | 'title' | 'isPinned' | 'updatedAt'
>;

export type FindAllChatSessionResDto = ChatSessionSummaryDto[];
export type FindChatsResDto = ChatHistory[];
export type UpdateChatSessionResDto = ChatSessionSummaryDto;
