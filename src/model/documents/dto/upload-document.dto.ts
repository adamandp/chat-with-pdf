import { createZodDto } from 'nestjs-zod';
import { UploadSchema } from '../documents.validation';
export class UploadDocumentDto extends createZodDto(UploadSchema) {}
