import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createHash, randomUUID } from 'node:crypto';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DocumentsService } from './documents.service';
import { PdfService } from './pdf.service';
import { VectorService } from './vector.service';
import type { Chunk, DocumentJob } from './documents.interface';

@Injectable()
export class DocumentWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private controller?: AbortController;

  private running?: Promise<void>;

  onApplicationBootstrap(): void {
    this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) return;
    this.controller = new AbortController();
    this.running = this
      .run(this.controller.signal)
      .catch(() => {
        this.logger.error('Document processing loop stopped unexpectedly');
      });
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    await this.running;
    this.running = undefined;
    this.controller = undefined;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
    private readonly vectors: VectorService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DocumentWorkerService.name);
  }

  async claim(): Promise<DocumentJob | undefined> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`WITH exhausted AS (
        UPDATE document_jobs SET status='failed',error_message='Worker retry limit reached'
        WHERE status='processing' AND locked_at < now()-interval '15 minutes' AND attempts>=3 RETURNING document_id
      ) UPDATE documents SET status='failed',error_message='Worker retry limit reached',updated_at=now()
        WHERE id IN (SELECT document_id FROM exhausted)`;

      const jobs = await tx.$queryRaw<
        DocumentJob[]
      >`SELECT id,document_id AS "documentId",attempts FROM document_jobs
        WHERE attempts<3 AND ((status='queued' AND available_at<=now()) OR
        (status='processing' AND locked_at<now()-interval '15 minutes'))
        ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1`;

      if (!jobs.length) return undefined;

      const job = {
        ...jobs[0],
        attempts: jobs[0].attempts + 1,
        leaseId: randomUUID(),
      };

      await tx.documentJob.update({
        where: { id: job.id },
        data: {
          status: 'processing',
          attempts: job.attempts,
          lockedAt: new Date(),
          leaseId: job.leaseId,
        },
      });
      await tx.document.update({
        where: { id: job.documentId },
        data: {
          status: 'processing',
          errorMessage: null,
          updatedAt: new Date(),
        },
      });

      return job;
    });
  }

  async heartbeat(job: DocumentJob) {
    const result = await this.prisma.documentJob.updateMany({
      where: {
        id: job.id,
        leaseId: job.leaseId,
        status: 'processing',
      },
      data: { lockedAt: new Date() },
    });

    if (result.count !== 1) throw new Error('Job lease lost');
  }

  async process(job: DocumentJob) {
    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: job.documentId },
    });

    const { data, hash } = await this.documents.readPdf(doc.filePath);

    if (hash !== doc.sha256Hash) throw new Error('Finalized PDF hash mismatch');

    const pages = await this.pdf.extract(data);

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 150,
    });

    const chunks: Chunk[] = [];

    for (let page = 0; page < pages.length; page++) {
      for (const text of await splitter.splitText(pages[page])) {
        if (!text.trim()) continue;
        chunks.push({
          id: createHash('sha256')
            .update(`${doc.id}:${chunks.length}`)
            .digest('hex'),
          user_id: doc.userId,
          document_id: doc.id,
          filename: doc.filename,
          page: page + 1,
          text,
        });
        if (chunks.length > 30000) throw new Error('PDF chunk limit exceeded');
      }
      if (page % 10 === 0) await this.heartbeat(job);
    }
    if (!chunks.length)
      throw new Error(
        'PDF has no extractable text; OCR is required for scanned PDFs',
      );
    await this.vectors.ensureCollection();
    for (let i = 0; i < chunks.length; i += 64) {
      await this.heartbeat(job);
      await this.vectors.upsert(chunks.slice(i, i + 64));
    }
    await this.vectors.flush();
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.documentJob.updateMany({
        where: {
          id: job.id,
          leaseId: job.leaseId,
          status: 'processing',
        },
        data: {
          status: 'done',
          lockedAt: null,
          errorMessage: null,
        },
      });

      if (owned.count)
        await tx.document.update({
          where: { id: doc.id },
          data: {
            status: 'ready',
            pageCount: pages.length,
            chunkCount: chunks.length,
            errorMessage: null,
            updatedAt: new Date(),
          },
        });
    });
  }

  async fail(job: DocumentJob, error: unknown) {
    const final = job.attempts >= 3;

    const message
      = error instanceof Error && error.message.includes('OCR is required')
        ? 'PDF has no extractable text; OCR is required for scanned PDFs'
        : 'PDF processing failed';

    this.logger.error(
      {
        documentId: job.documentId,
        attempt: job.attempts,
        errorType: error instanceof Error ? error.name : 'Unknown',
      },
      message,
    );
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.documentJob.updateMany({
        where: {
          id: job.id,
          leaseId: job.leaseId,
          status: 'processing',
        },
        data: {
          status: final ? 'failed' : 'queued',
          lockedAt: null,
          errorMessage: message,
          availableAt: new Date(Date.now() + 10000 * 2 ** job.attempts),
        },
      });

      if (owned.count)
        await tx.document.update({
          where: { id: job.documentId },
          data: {
            status: final ? 'failed' : 'queued',
            errorMessage: message,
            updatedAt: new Date(),
          },
        });
    });
  }

  async run(signal: AbortSignal) {
    const { setTimeout } = await import('node:timers/promises');

    while (!signal.aborted) {
      let job: DocumentJob | undefined;

      try {
        job = await this.claim();
        if (job) await this.process(job);
      } catch (error) {
        if (job) {
          try {
            await this.fail(job, error);
          } catch {
            this.logger.error(
              'Could not record failure; lease recovery will retry',
            );
          }
        } else this.logger.error('Could not claim a document job');
      }
      if (!signal.aborted)
        await setTimeout(2000, undefined, { signal })
          .catch(() => undefined);
    }
  }
}
