import type { ChatHistory } from '../../generated/prisma/client';
import z from 'zod';
import { BaseChatSessionSchema } from './chat-session.validation';

export type BaseChatSessionDto = z.infer<typeof BaseChatSessionSchema>;

export type FindAllChatSessionResDto = BaseChatSessionDto[];
export type FindChatsResDto = ChatHistory[];
export type UpdateChatSessionResDto = BaseChatSessionDto;
