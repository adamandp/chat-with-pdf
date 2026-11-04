import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DocumentQuerySchema } from '../documents.validation';

export class DocumentQueryDto
  extends createZodDto(DocumentQuerySchema)
  implements z.infer<typeof DocumentQuerySchema> {}
