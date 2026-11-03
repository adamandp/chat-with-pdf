import { createZodDto } from 'nestjs-zod';
import { coerceNumberMinMax } from '../utils/zod.helper';
import z from 'zod';

export const BaseQuerySchema = z.object({
  page: coerceNumberMinMax('Page', 1, 100).int().optional().default(1),

  limit: coerceNumberMinMax('Limit', 1, 100).int().optional().default(10),

  q: z.string().trim().max(255).optional(),

  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

export class BaseQueryDto
  extends createZodDto(BaseQuerySchema)
  implements z.infer<typeof BaseQuerySchema> {}
