import type { Document } from '../../generated/prisma/client';

export type DocumentProcessDTO = Pick<Document, 'id' | 'status'>;

export interface PresignUrlDTO {
  document_id: string;
  upload_url: string;
  expires_in: number;
}

export type ProcessDocumentType = {
  userId: string;
  documentId: string;
};

export type PdfPage = {
  pageNumber: number;
  content: string;
};

export type PdfExtraction = {
  pages: PdfPage[];
  pageCount: number;
};

export type Chunk = {
  id: string;
  documentId: string;
  userId: string;
  chunkIndex: number;
  pageNumber: number;
  content: string;
  metadata: Record<string, string | number>;
};

export type EmbeddedChunk = Chunk & { embedding: number[] };
