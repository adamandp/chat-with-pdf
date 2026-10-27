import { z } from 'zod';
export const ChatSchema = z
  .object({
    question: z.string().trim().min(1).max(8000),
    document_ids: z.array(z.uuid()).min(1).max(10),
    conversation_id: z.uuid().optional(),
  })
  .strict();
