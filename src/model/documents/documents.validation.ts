import { z } from 'zod';
import { DocumentStatus } from '../../generated/prisma/enums';

export const documentSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  fileName: z.string().min(1).max(255).nullable(),
  fileSize: z.number().int().positive().nullable(),
  mimeType: z.string().max(100).nullable(),
  sha256Hash: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .nullable(),
  pageCount: z.number().int().positive().nullable(),
  chunkCount: z.number().int().nonnegative().nullable(),
  status: z.enum(DocumentStatus),
  errorMessage: z.string().nullable(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
});

export type DocumentDto = z.infer<typeof documentSchema>;

export const presignUrlSchema = documentSchema.pick({
  fileName: true,
});
