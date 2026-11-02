import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { FeedbackType } from '../../../generated/prisma/client';

export const toggleChatFeedbackSchema = z
  .object({
    type: z.enum(FeedbackType),
  })
  .strict();

export class ToggleChatFeedbackDto
  extends createZodDto(toggleChatFeedbackSchema)
  implements z.infer<typeof toggleChatFeedbackSchema> {}
