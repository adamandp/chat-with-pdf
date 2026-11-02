import { documentSchema } from '../documents/documents.validation';

export const presignUrlSchema = documentSchema.pick({
  fileName: true,
});
