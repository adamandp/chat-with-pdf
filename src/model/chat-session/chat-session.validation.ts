import z from 'zod';
import { baseDate, baseUUID, stringMinMax } from '../../utils/zod.helper';

export const BaseChatSessionSchema = z
  .object({
    id: baseUUID('Chat Session ID'),
    userId: baseUUID('User ID'),
    title: stringMinMax('Title', 1, 255).nullable(),
    answerMode: stringMinMax('Answer Mode', 1, 30).nullable(),
    activeLeafMessageId: baseUUID('Active Leaf Message ID').nullable(),
    lastMessageAt: baseDate('Last Message At').nullable(),
    createdAt: baseDate('Created At').nullable(),
    updatedAt: baseDate('Updated At').nullable(),
    deletedAt: baseDate('Deleted At').nullable(),
  })
  .strict();
