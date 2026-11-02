import { createZodDto } from 'nestjs-zod';
import { presignUrlSchema } from '../document-upload.validation';

export class CreatePresignUrlDTO extends createZodDto(presignUrlSchema) {}
