import { createZodDto } from 'nestjs-zod';
import { PresignSchema } from '../documents.validation';
export class PresignDto extends createZodDto(PresignSchema) {}
