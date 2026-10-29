import type { Document } from '../../generated/prisma/client';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { documentSchema } from './documents.validation';

class DocumentDTO
  extends createZodDto(documentSchema)
  implements z.infer<typeof documentSchema> { }

type DocumentProcessDTO = Pick<Document, 'id'>;

interface PresignUrlDTO {
  document_id: string;
  upload_url: string;
  expires_in: number;
}

type DocumentFindOneDTO = Document & {
  download_url: string;
};

type DocumentFindAllDTO = (Omit<Document, 'fileSize'> & {
  fileSize: string | null;
})[];

type ProcessDocumentType = {
  userId: string;
  documentId: string;
};

type ProcessDocumentDTO = Pick<
  DocumentDTO,
  'id' | 'status'
>;

type PdfPage = { pageNumber: number;
  content: string; };

type PdfExtraction = { pages: PdfPage[];
  pageCount: number; };

type Chunk = {
  id: string;
  documentId: string;
  userId: string;
  chunkIndex: number;
  pageNumber: number;
  content: string;
  metadata: Record<string, string | number>;
};

type EmbeddedChunk = Chunk & { embedding: number[] };

export type {
  DocumentDTO,
  DocumentProcessDTO,
  PresignUrlDTO,
  DocumentFindOneDTO,
  DocumentFindAllDTO,
  ProcessDocumentType,
  PdfPage,
  PdfExtraction,
  Chunk,
  EmbeddedChunk,
};
