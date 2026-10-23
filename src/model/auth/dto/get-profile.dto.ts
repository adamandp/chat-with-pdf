import { createZodDto } from 'nestjs-zod';
import { userSchema } from '../auth.validation.js';
import z from 'zod';

const getProfileSchema = userSchema
  .pick({
    id: true,
  })
  .partial();

class GetProfileDTO
  extends createZodDto(getProfileSchema)
  implements z.infer<typeof getProfileSchema>
{
  constructor() {
    super();
  }
}

export { GetProfileDTO, getProfileSchema };
