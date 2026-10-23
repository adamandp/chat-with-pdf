import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { userSchema } from '../auth.validation.js';

const LoginSchema = userSchema
  .pick({
    username: true,
  })
  .extend({
    password: z.string().min(8).max(100),
  });

class LoginDto
  extends createZodDto(LoginSchema)
  implements z.infer<typeof LoginSchema>
{
  constructor() {
    super();
  }
}

export { LoginDto, LoginSchema };
