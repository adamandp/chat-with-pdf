import { createZodDto } from 'nestjs-zod';
import { ChatSchema } from '../chat.validation';

export class CreateChatDto extends createZodDto(ChatSchema) {}
