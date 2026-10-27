import { z } from 'zod';
export const PresignSchema = z
  .object({
    filename: z
      .string()
      .min(5)
      .max(255)
      .regex(
        /^[^/\\]+\.pdf$/i,
        'A PDF filename without path components is required',
      )
      .refine(
        (value) =>
          [...value].every((character) => character.charCodeAt(0) >= 32),
        'Control characters are not allowed',
      ),
  })
  .strict();
export const UploadSchema = z.object({ upload_id: z.uuid() }).strict();
