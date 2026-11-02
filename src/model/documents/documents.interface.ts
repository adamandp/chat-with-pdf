import type { Document } from '../../generated/prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { documentSchema } from './documents.validation';

export class DocumentDTO
  extends createZodDto(documentSchema)
  implements z.infer<typeof documentSchema> {}

export type DocumentFindOneDTO = Omit<Document, 'fileSize'> & {
  fileSize: string | null;
  download_url: string;
};

export type DocumentFindAllDTO = (Omit<Document, 'fileSize'> & {
  fileSize: string | null;
})[];

export type DocumentFindAllDeletedDTO = DocumentFindAllDTO;

export type DocumentMutationDTO = Pick<
  DocumentDTO,
  'id' | 'fileName' | 'updatedAt'
>;
