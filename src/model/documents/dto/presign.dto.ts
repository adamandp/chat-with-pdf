import { createZodDto } from 'nestjs-zod';
import { presignUrlSchema } from '../documents.validation';

export class CreatePresignUrlDTO extends createZodDto(presignUrlSchema) {}
