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
