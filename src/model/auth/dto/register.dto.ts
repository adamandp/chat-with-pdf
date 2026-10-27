import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { userSchema } from '../auth.validation.js';

const registerSchema = userSchema
  .pick({
    username: true,
    name: true,
  })
  .extend({
    password: z
      .string()
      .min(8)
      .max(100),
  });

export class RegisterDTO
  extends createZodDto(registerSchema)
  implements z.infer<typeof registerSchema> {
  constructor() {
    super();
  }
}
