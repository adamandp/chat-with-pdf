import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { BaseChatSessionSchema } from '../chat-session.validation';

export const UpdateChatSessionSchema = BaseChatSessionSchema.pick({
  title: true,
  isPinned: true,
})
  .extend({
    title: BaseChatSessionSchema.shape.title.unwrap().trim().min(1).optional(),
    isPinned: BaseChatSessionSchema.shape.isPinned.optional(),
  })
  .refine(
    (value) => value.title !== undefined || value.isPinned !== undefined,
    {
      message: 'At least one of title or isPinned is required',
    },
  );

export class UpdateChatSessionDto
  extends createZodDto(UpdateChatSessionSchema)
  implements z.infer<typeof UpdateChatSessionSchema> {}
