import { z } from 'zod';

export const userSchema = z.object({
  id: z.uuid(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(
      /^[a-zA-Z0-9_.-]+$/,
      'Username may only contain letters, numbers, underscores, dots, and hyphens',
    )
    .nullable(),
  name: z.string().max(255).nullable(),
  passwordHash: z.string().nullable(),
  role: z.string().max(20),
  isActive: z.boolean(),

  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
});

export type UserDto = z.infer<typeof userSchema>;
