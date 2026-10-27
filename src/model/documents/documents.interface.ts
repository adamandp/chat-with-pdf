import type { DocumentStatus } from '../../generated/prisma/enums';
import type { Document } from '../../generated/prisma/client';

export type DocumentResDTO = Omit<Document, 'fileSize'> & {
  fileSize: string | null;
  download_url: string;
};

export interface Chunk {
  id: string;
  user_id: string;
  document_id: string;
  filename: string;
  page: number;
  text: string;
}
export interface Source {
  source_id: number;
  document_id: string;
  filename: string;
  page: number;
  chunk_id: string;
}
export interface DocumentJob {
  id: string;
  documentId: string;
  attempts: number;
  leaseId: string;
}

export interface PresignUrlResDTO {
  document_id: string;
  upload_url: string;
  expires_in: number;
}

export interface ProcessDocumentJob {
  documentId: string;
  userId: string;
}

export interface DocumentProgress {
  document_id: string;
  progress: number;
  status: DocumentStatus;
  error?: string;
}
