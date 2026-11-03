import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { getDocument as loadPdf } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { DOCUMENT_QUEUE } from './documents.constants';
import {
  Chunk,
  EmbeddedChunk,
  PdfExtraction,
  PdfPage,
  ProcessDocumentType,
} from '../document-upload.interface';
import { StorageService } from '../../../common/storage/storage.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MilvusService } from '../../../common/milvus/milvus.service';
import { DocumentStatus } from '../../../generated/prisma/enums';
import { GeminiService } from '../../../common/ai/gemini.service';
import { ConflictException } from '@nestjs/common';

@Processor(DOCUMENT_QUEUE.DOCUMENTS.NAME)
export class DocumentsProcessor extends WorkerHost {
  constructor(
    private readonly logger: PinoLogger,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly milvus: MilvusService,
    private readonly gemini: GeminiService,
  ) {
    super();
    this.logger.setContext(DocumentsProcessor.name);
  }

  private async getDocument(documentId: string): Promise<Uint8Array> {
    const stream = await this.storage.getObject(
      this.storage.bucket,
      documentId,
    );

    const buffers: Buffer[] = [];

    for await (const part of stream) buffers.push(Buffer.from(part));

    return new Uint8Array(Buffer.concat(buffers));
  }

  private async extractDocument(data: Uint8Array): Promise<PdfExtraction> {
    const task = loadPdf({
      data,
      useSystemFonts: true,
    });

    const pdf = await task.promise;

    try {
      const pages: PdfPage[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);

        const text = await page.getTextContent();

        const content = text.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .trim();

        pages.push({
          pageNumber,
          content,
        });
        page.cleanup();
      }

      return {
        pages,
        pageCount: pdf.numPages,
      };
    } finally {
      await task.destroy();
    }
  }

  private async chunkDocument(
    extracted: PdfExtraction,
    document: { id: string; userId: string; fileName: string | null },
  ): Promise<Chunk[]> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const chunks: Chunk[] = [];

    for (const page of extracted.pages) {
      if (!page.content) continue;

      const texts = await splitter.splitText(page.content);

      for (const content of texts) {
        chunks.push({
          id: randomUUID(),
          documentId: document.id,
          userId: document.userId,
          chunkIndex: chunks.length,
          pageNumber: page.pageNumber,
          content,
          metadata: {},
        });
      }
    }

    return chunks;
  }

  private async enrichChunk(
    chunks: Chunk[],
    fileName: string | null,
  ): Promise<Chunk[]> {
    return chunks.map((chunk) => ({
      ...chunk,
      metadata: {
        filename: fileName ?? '',
        page_number: chunk.pageNumber,
        chunk_index: chunk.chunkIndex,
      },
    }));
  }

  private async embedDocument(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    if (chunks.length === 0) return [];

    const embeddings = this.gemini.embeddings();

    const result: EmbeddedChunk[] = [];

    const batchSize = 50;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      const vectors = await embeddings.embedDocuments(
        batch.map((c) => c.content),
      );

      if (vectors.length !== batch.length) {
        throw new Error('Embedding count does not match chunk count');
      }

      result.push(
        ...batch.map((chunk, index) => ({
          ...chunk,
          embedding: vectors[index],
        })),
      );
    }

    return result;
  }

  private async saveVectors(chunks: EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    await this.milvus.insert({
      collection_name: 'document_chunks',
      data: chunks.map((chunk) => ({
        id: chunk.id,
        document_id: chunk.documentId,
        user_id: chunk.userId,
        chunk_index: chunk.chunkIndex,
        page_number: chunk.pageNumber,
        content: chunk.content,
        embedding: chunk.embedding,
        metadata: chunk.metadata,
      })),
    });
  }

  private async saveMetadata(
    documentId: string,
    pageCount: number,
    chunkCount: number,
  ) {
    const result = await this.prisma.document.updateMany({
      where: {
        id: documentId,
        status: DocumentStatus.PROCESSING,
        deletedAt: null,
      },
      data: {
        pageCount,
        chunkCount,
        status: DocumentStatus.READY,
        errorMessage: null,
      },
    });
    if (!result.count) {
      throw new ConflictException('Document is no longer processing');
    }
  }

  async process(job: Job<ProcessDocumentType>): Promise<void> {
    const { documentId, userId } = job.data;

    const claimed = await this.prisma.document.updateManyAndReturn({
      where: {
        id: documentId,
        userId,
        status: DocumentStatus.QUEUED,
        deletedAt: null,
      },
      data: {
        status: DocumentStatus.PROCESSING,
        errorMessage: null,
      },
    });
    if (!claimed.length) {
      this.logger.warn(
        { documentId },
        'Skipping document outside queued lifecycle',
      );
      return;
    }

    const document = claimed[0];

    await job.updateProgress(5);

    const data = await this.getDocument(documentId);

    await job.updateProgress(15);

    const extracted = await this.extractDocument(data);

    await job.updateProgress(40);

    const chunks = await this.chunkDocument(extracted, document);

    await job.updateProgress(60);

    const enriched = await this.enrichChunk(chunks, document.fileName);

    await job.updateProgress(70);

    const embedded = await this.embedDocument(enriched);

    await job.updateProgress(90);

    await this.saveVectors(embedded);

    await job.updateProgress(95);

    await this.saveMetadata(documentId, extracted.pageCount, embedded.length);

    await job.updateProgress(100);

    this.logger.info(
      {
        documentId,
        chunkCount: embedded.length,
      },
      'Document processed',
    );
  }
}
