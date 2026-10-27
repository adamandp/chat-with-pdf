import type { MessageEvent } from '@nestjs/common';
import {
  InjectQueue,
  OnQueueEvent,
  QueueEventsHost,
  QueueEventsListener,
} from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Observable, Subject } from 'rxjs';
import { QueueConnectionService } from '../../../common/queue/queue-connection.service';
import { DocumentStatus } from '../../../generated/prisma/enums';
import { DOCUMENT_QUEUE } from './document-queue.constants';
import type { DocumentProgress, ProcessDocumentJob } from '../documents.interface';

type DocumentQueueEvent
  = | { type: 'progress';
    jobId: string;
    data: unknown; }
    | { type: 'completed';
      jobId: string; }
      | { type: 'failed';
        jobId: string; };

// Nest creates and closes the Redis QueueEvents listener for this class.
@QueueEventsListener(DOCUMENT_QUEUE)
export class DocumentProgressService extends QueueEventsHost {
  private readonly updates = new Subject<DocumentQueueEvent>();

  constructor(
    @InjectQueue(DOCUMENT_QUEUE)
    private readonly queue: Queue<ProcessDocumentJob>,
    private readonly connection: QueueConnectionService,
  ) {
    super();
  }

  @OnQueueEvent('progress')
  onProgress(event: { jobId: string;
    data: unknown; }): void {
    this.updates.next({
      type: 'progress',
      ...event,
    });
  }

  @OnQueueEvent('completed')
  onCompleted(event: { jobId: string }): void {
    this.updates.next({
      type: 'completed',
      jobId: event.jobId,
    });
  }

  @OnQueueEvent('failed')
  onFailed(event: { jobId: string }): void {
    this.updates.next({
      type: 'failed',
      jobId: event.jobId,
    });
  }

  stream(
    documentId: string,
    initial: DocumentProgress,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      let latest = initial;

      let receivedEvent = false;

      const emit = (value: DocumentProgress) => {
        if (subscriber.closed) return;

        latest = value;
        subscriber.next({ data: value });

        if (
          value.status === DocumentStatus.READY
          || value.status === DocumentStatus.FAILED
        ) {
          subscriber.complete();
        }
      };

      const progress = ({ jobId, data }: { jobId: string;
        data: unknown; }) => {
        if (
          jobId !== documentId
          || !data
          || typeof data !== 'object'
          || !('progress' in data)
        ) return;

        receivedEvent = true;

        const value = data as DocumentProgress;

        // FAILED progress carries the safe error, but wait for BullMQ to finish
        // the job before closing SSE so an immediate retry can be enqueued.
        if (value.status === DocumentStatus.FAILED) latest = value;
        else emit(value);
      };

      const completed = ({ jobId }: { jobId: string }) => {
        if (jobId !== documentId) return;

        receivedEvent = true;
        emit({
          document_id: documentId,
          progress: 100,
          status: DocumentStatus.READY,
        });
      };

      const failed = ({ jobId }: { jobId: string }) => {
        if (jobId !== documentId) return;

        receivedEvent = true;
        emit({
          ...latest,
          status: DocumentStatus.FAILED,
          error: latest.error || 'PDF processing failed',
        });
      };

      // Listen before reading the snapshot so fast jobs cannot finish in the gap.
      const subscription = this.updates.subscribe((event) => {
        if (event.type === 'progress') progress(event);
        else if (event.type === 'completed') completed(event);
        else failed(event);
      });

      void this.connection
        .run(
          this.queueEvents,
          async () => {
            const job = await this.queue.getJob(documentId);

            const state = await job?.getState();

            if (receivedEvent || subscriber.closed) return;

            if (
              state === 'completed'
              || initial.status === DocumentStatus.READY
            ) {
              emit({
                document_id: documentId,
                progress: 100,
                status: DocumentStatus.READY,
              });
            } else if (state === 'failed') {
              const saved = job && typeof job.progress === 'object' ? job.progress as DocumentProgress : initial;

              emit({
                ...saved,
                status: DocumentStatus.FAILED,
                error: initial.error || saved.error || 'PDF processing failed',
              });
            } else if (job && typeof job.progress === 'object') {
              const value = job.progress as DocumentProgress;

              if (value.status === DocumentStatus.FAILED) latest = value;
              else emit(value);
            } else {
              emit(initial);
            }
          },
        )
        .catch(() => subscriber.error(
          new Error('Document progress unavailable'),
        ));

      const heartbeat = setInterval(
        () => {
          if (!subscriber.closed) subscriber.next({
            type: 'heartbeat',
            data: {},
          });
        },
        15000,
      );

      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
      };
    });
  }
}
