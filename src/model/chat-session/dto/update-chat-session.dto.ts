import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { BaseChatSessionSchema } from '../chat-session.validation';

export const UpdateChatSessionSchema = BaseChatSessionSchema.pick({
  title: true,
}).extend({
  title: BaseChatSessionSchema.shape.title.unwrap().trim().min(1),
});

export class UpdateChatSessionDto
  extends createZodDto(UpdateChatSessionSchema)
  implements z.infer<typeof UpdateChatSessionSchema> {}
