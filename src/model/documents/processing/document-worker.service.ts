import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { createHash } from 'node:crypto';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../../common/storage/storage.service';
import { DocumentStatus } from '../../../generated/prisma/enums';
import type { Document } from '../../../generated/prisma/client';
import { DOCUMENT_QUEUE } from '../queue/document-queue.constants';
import { PdfService } from './pdf.service';
import { VectorService } from './vector.service';
import type {
  Chunk,
  DocumentProgress,
  ProcessDocumentJob,
} from '../documents.interface';

type ProgressReporter = {
  value: number;
  update(value: number, status?: DocumentStatus, error?: string): Promise<void>;
};

@Processor(DOCUMENT_QUEUE, { concurrency: 1 })
export class DocumentWorkerService extends WorkerHost {
  private readonly logger = new Logger(DocumentWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
    private readonly vectors: VectorService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessDocumentJob> | undefined,
    error: Error,
  ): Promise<void> {
    // A crashed worker can exhaust stalled-job recovery outside process().
    if (!job || !error.message.includes('stalled')) return;

    await this.prisma.document
      .updateMany({
        where: {
          id: job.data.documentId,
          status: {
            in: [
              DocumentStatus.QUEUED,
              DocumentStatus.PROCESSING,
            ],
          },
        },
        data: {
          status: DocumentStatus.FAILED,
          errorMessage: 'PDF processing failed',
        },
      })
      .catch(() => this.logger.error('Could not record document failure'));
  }

  async process(job: Job<ProcessDocumentJob>): Promise<void> {
    const progress = this.createProgressReporter(job);

    try {
      const document = await this.findDocument(job.data);

      if (document.status === DocumentStatus.READY) {
        await this.reportReady(progress);

        return;
      }

      await this.startProcessing(document);

      await progress.update(1);

      // STEP 1 (1–5%): Download the PDF from MinIO.
      const data = await this.downloadPdf(document.id);

      await progress.update(5);

      // STEP 2 (5–10%): Validate PDF bytes, calculate SHA-256, and save metadata.
      await this.savePdfMetadata(document.id, data);

      await progress.update(10);

      // STEP 3 (10–35%): Extract text and count pages. No OCR yet.
      const pages = await this.extractPages(
        document.id,
        data,
        progress,
      );

      // STEP 4 (35–40%): Split page text into overlapping chunks.
      const chunks = await this.createChunks(document, pages);

      await progress.update(40);

      // STEP 5–6 (40–95%): Embed each batch and save it to Milvus.
      await this.embedAndStoreChunks(
        document,
        chunks,
        progress,
      );

      // STEP 7 (95–100%): Mark READY after all storage operations succeed.
      await this.completeDocument(
        document.id,
        pages.length,
        chunks.length,
      );

      await this.reportReady(progress);
    } catch (error) {
      await this.failDocument(
        job.data,
        error,
        progress,
      );
    }
  }

  private createProgressReporter(job: Job<ProcessDocumentJob>): ProgressReporter {
    // Keep progress local to this job, so concurrent jobs never share its value.
    const reporter: ProgressReporter = {
      value: 0,
      update: async (value, status = DocumentStatus.PROCESSING, error) => {
        reporter.value = value;

        const event: DocumentProgress = {
          document_id: job.data.documentId,
          progress: value,
          status,
          ...(error ? { error } : {}),
        };

        await job.updateProgress(event);
      },
    };

    return reporter;
  }

  private async findDocument(
    { documentId, userId }: ProcessDocumentJob,
  ): Promise<Document> {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        userId,
        deletedAt: null,
      },
    });

    if (!document) throw new Error('Document not found');

    return document;
  }

  private async startProcessing(document: Document): Promise<void> {
    if (
      document.status !== DocumentStatus.QUEUED
      && document.status !== DocumentStatus.PROCESSING
    ) {
      throw new Error('Document is not queued for processing');
    }

    await this.prisma.document.update({
      where: { id: document.id },
      data: {
        status: DocumentStatus.PROCESSING,
        errorMessage: null,
      },
    });
  }

  private async downloadPdf(documentId: string): Promise<Buffer> {
    const stat = await this.storage.statObject(this.storage.bucket, documentId);

    if (stat.size < 5 || stat.size > this.pdf.maxBytes) {
      throw new Error('PDF is empty or exceeds the size limit');
    }

    const stream = await this.storage.getObject(this.storage.bucket, documentId);

    const buffers: Buffer[] = [];

    let size = 0;

    try {
      for await (const part of stream) {
        const buffer = Buffer.from(part);

        size += buffer.length;

        if (size > this.pdf.maxBytes) throw new Error(
          'PDF exceeds the size limit',
        );

        buffers.push(buffer);
      }
    } finally {
      stream.destroy();
    }

    return Buffer.concat(buffers);
  }

  private async savePdfMetadata(documentId: string, data: Buffer): Promise<void> {
    const hash = this.pdf.validate(data);

    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        fileSize: BigInt(data.length),
        mimeType: 'application/pdf',
        sha256Hash: hash,
      },
    });
  }

  private async extractPages(
    documentId: string,
    data: Buffer,
    progress: ProgressReporter,
  ): Promise<string[]> {
    const pages = await this.pdf.extract(
      data,
      async (page, total) => {
        const value = 10 + Math.floor(25 * page / total);

        if (value > progress.value) await progress.update(value);
      },
    );

    if (!pages.some((page) => page.trim())) {
      throw new Error(
        'PDF has no extractable text; OCR is required for scanned PDFs',
      );
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: { pageCount: pages.length },
    });

    return pages;
  }

  private async createChunks(
    document: Document,
    pages: string[],
  ): Promise<Chunk[]> {
    const splitter = new RecursiveCharacterTextSplitter(
      {
        chunkSize: 1000,
        chunkOverlap: 150,
      },
    );

    const chunks: Chunk[] = [];

    for (let page = 0; page < pages.length; page++) {
      for (const text of await splitter.splitText(pages[page])) {
        if (!text.trim()) continue;

        chunks.push({
          id: createHash('sha256')
            .update(`${document.id}:${chunks.length}`)
            .digest(
              'hex',
            ),
          user_id: document.userId,
          document_id: document.id,
          filename: document.fileName || document.id,
          page: page + 1,
          text,
        });

        if (chunks.length > 30000) throw new Error('PDF chunk limit exceeded');
      }
    }

    if (!chunks.length) throw new Error(
      'PDF has no extractable text; OCR is required for scanned PDFs',
    );

    return chunks;
  }

  private async embedAndStoreChunks(
    document: Document,
    chunks: Chunk[],
    progress: ProgressReporter,
  ): Promise<void> {
    await this.vectors.ensureCollection();

    // Remove partial results from previous attempts before rebuilding the document.
    await this.vectors.deleteDocument(document.userId, document.id);

    for (let offset = 0; offset < chunks.length; offset += 64) {
      const batch = chunks.slice(offset, offset + 64);

      // STEP 5: Generate embeddings using the configured model.
      const embeddings = await this.vectors.embed(batch);

      // STEP 6: Save embeddings and chunk text to Milvus.
      await this.vectors.upsertEmbedded(batch, embeddings);

      const completed = Math.min(offset + batch.length, chunks.length);

      await progress.update(40 + Math.floor(55 * completed / chunks.length));
    }

    await this.vectors.flush();
  }

  private async completeDocument(
    documentId: string,
    pageCount: number,
    chunkCount: number,
  ): Promise<void> {
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.READY,
        pageCount,
        chunkCount,
        errorMessage: null,
      },
    });
  }

  private async reportReady(progress: ProgressReporter): Promise<void> {
    await progress
      .update(100, DocumentStatus.READY)
      .catch(() => {
        this.logger.warn(
          'Document is READY; final progress will be recovered from PostgreSQL',
        );
      });
  }

  private async failDocument(
    { documentId, userId }: ProcessDocumentJob,
    error: unknown,
    progress: ProgressReporter,
  ): Promise<never> {
    const message = error instanceof Error && /PDF|OCR|Invalid PDF|Unreadable/.test(
      error.message,
    )
      ? error.message
      : 'PDF processing failed';

    await this.prisma.document.updateMany({
      where: {
        id: documentId,
        userId,
        status: {
          in: [
            DocumentStatus.QUEUED,
            DocumentStatus.PROCESSING,
          ],
        },
      },
      data: {
        status: DocumentStatus.FAILED,
        errorMessage: message,
      },
    });

    await progress
      .update(
        progress.value,
        DocumentStatus.FAILED,
        message,
      )
      .catch(
        () => undefined,
      );

    this.logger.error(
      {
        documentId,
        errorType: error instanceof Error ? error.name : 'Unknown',
      },
      message,
    );
    throw new Error(message);
  }
}
