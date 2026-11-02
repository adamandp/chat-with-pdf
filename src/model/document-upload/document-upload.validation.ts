import { z } from 'zod';

export const presignUrlSchema = z.object({
  fileName: z.string().min(1).max(255).nullable(),
});
