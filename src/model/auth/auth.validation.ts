import { z } from 'zod';

const userSchema = z.object({
  id: z.uuid(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(
      /^[a-zA-Z0-9_.-]+$/,
      'Username may only contain letters, numbers, underscores, dots, and hyphens',
    ),
  name: z.string().optional(),
  passwordHash: z.string().min(8),

  createdAt: z.date(),
  updatedAt: z.date(),
});

export { userSchema };
