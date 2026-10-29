import {
  OnQueueEvent,
  QueueEventsHost,
  QueueEventsListener,
} from '@nestjs/bullmq';
import { PinoLogger } from 'nestjs-pino';
import { DOCUMENT_QUEUE } from './documents.constants';
import { DocumentsService } from '../documents.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { DocumentStatus } from '../../../generated/prisma/enums';

@QueueEventsListener(DOCUMENT_QUEUE.DOCUMENTS.NAME)
export class DocumentsListener extends QueueEventsHost {
  constructor(
    private readonly logger: PinoLogger,
    private readonly documents: DocumentsService,
    private readonly prisma: PrismaService,
  ) {
    super();
    this.logger.setContext(DocumentsListener.name);
  }

  @OnQueueEvent(DOCUMENT_QUEUE.DOCUMENTS.EVENTS.WAITING)
  onWaiting({ jobId }: { jobId: string }) {
    this.logger.info({ jobId }, 'Document job waiting');
    this.documents.emitProgress(jobId, 'message', { document_id: jobId, status: 'QUEUED', progress: 0 });
  }

  @OnQueueEvent(DOCUMENT_QUEUE.DOCUMENTS.EVENTS.ACTIVE)
  onActive({ jobId }: { jobId: string }) {
    this.logger.info({ jobId }, 'Document job active');
    this.documents.emitProgress(jobId, 'message', { document_id: jobId, status: 'PROCESSING', progress: 0 });
  }

  @OnQueueEvent(DOCUMENT_QUEUE.DOCUMENTS.EVENTS.PROGRESS)
  onProgress({ jobId, data }: { jobId: string;
    data: unknown; }) {
    this.logger.info(
      {
        jobId,
        progress: data,
      },
      'Document job progress',
    );
    this.documents.emitProgress(jobId, 'message', { document_id: jobId, status: 'PROCESSING', progress: data });
  }

  @OnQueueEvent(DOCUMENT_QUEUE.DOCUMENTS.EVENTS.COMPLETED)
  onCompleted({
    jobId,
    returnvalue,
  }: {
    jobId: string;
    returnvalue: unknown;
  }) {
    this.logger.info(
      {
        jobId,
        returnvalue,
      },
      'Document job completed',
    );
    this.documents.emitProgress(jobId, 'message', { document_id: jobId, status: 'READY', progress: 100 });
  }

  @OnQueueEvent(DOCUMENT_QUEUE.DOCUMENTS.EVENTS.FAILED)
  async onFailed({
    jobId,
    failedReason,
  }: {
    jobId: string;
    failedReason: string;
  }) {
    this.logger.error(
      {
        jobId,
        failedReason,
      },
      'Document job failed',
    );
    try {
      await this.prisma.document.updateMany({
        where: { id: jobId },
        data: { status: DocumentStatus.FAILED, errorMessage: failedReason },
      });
    } catch (error) {
      this.logger.error({ jobId, err: error }, 'Failed to persist document failure');
    }
    this.documents.emitProgress(jobId, 'message', {
      document_id: jobId, status: 'FAILED', progress: 0, error: failedReason,
    });
  }

  @OnQueueEvent(DOCUMENT_QUEUE.DOCUMENTS.EVENTS.DELAYED)
  onDelayed({
    jobId,
    delay,
  }: {
    jobId: string;
    delay: number;
  }) {
    this.logger.info(
      {
        jobId,
        delay,
      },
      'Document job delayed',
    );
  }

  @OnQueueEvent(DOCUMENT_QUEUE.DOCUMENTS.EVENTS.STALLED)
  onStalled({ jobId }: { jobId: string }) {
    this.logger.warn({ jobId }, 'Document job stalled');
  }

  @OnQueueEvent(DOCUMENT_QUEUE.DOCUMENTS.EVENTS.REMOVED)
  onRemoved({ jobId }: { jobId: string }) {
    this.logger.info({ jobId }, 'Document job removed');
  }
}
