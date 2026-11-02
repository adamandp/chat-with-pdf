import type { Document } from '../../generated/prisma/client';

export type DocumentFindOneDTO = Omit<Document, 'fileSize'> & {
  fileSize: string | null;
  download_url: string;
};

export type DocumentFindAllDTO = (Omit<Document, 'fileSize'> & {
  fileSize: string | null;
})[];

export type DocumentMutationDTO = Pick<Document, 'id' | 'fileName' | 'updatedAt'>;
