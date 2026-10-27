import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueConnectionService } from '../../../common/queue/queue-connection.service';
import { DOCUMENT_QUEUE, PROCESS_DOCUMENT_JOB } from './document-queue.constants';
import type { ProcessDocumentJob } from '../documents.interface';

// Producer: add or retry jobs. Connection policies live in common/queue.
@Injectable()
export class DocumentQueueService {
  constructor(
    @InjectQueue(DOCUMENT_QUEUE) readonly queue: Queue<ProcessDocumentJob>,
    private readonly connection: QueueConnectionService,
  ) {}

  async enqueue(data: ProcessDocumentJob): Promise<void> {
    await this.connection.run(
      this.queue,
      async () => {
        const existing = await this.queue.getJob(data.documentId);

        if (existing && await existing.getState() === 'failed') {
          await existing.updateProgress(0);

          await existing.retry();

          return;
        }

        // Add a job, using the document ID to prevent duplicates.
        await this.queue.add(
          PROCESS_DOCUMENT_JOB,
          data,
          { jobId: data.documentId },
        );
      },
    );
  }
}
