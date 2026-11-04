import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Messages, ErrorMessage } from '../../utils/message.helper';
import { StorageService } from '../../common/storage/storage.service';
import { DocumentStatus } from '../../generated/prisma/enums';
import type { WebResponse } from '../../common/common.interface';
import type {
  DocumentProcessDTO,
  DocumentProgressDTO,
  DocumentProgressEvent,
  PresignUrlDTO,
  ProcessDocumentType,
} from './document-upload.interface';
import { CreatePresignUrlDTO } from './dto/presign.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { DOCUMENT_QUEUE } from './queue/documents.constants';
import { Observable, Subject, filter, map, takeWhile } from 'rxjs';
import {
  assertPdfObject,
  isMissingObject,
  maxPdfBytes,
} from './document-upload.validation';

@Injectable()
export class DocumentUploadService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(DOCUMENT_QUEUE.DOCUMENTS.NAME)
    readonly queue: Queue<ProcessDocumentType>,
    private readonly config: ConfigService,
  ) {
    this.logger.setContext(DocumentUploadService.name);
  }

  private readonly progress$ = new Subject<{
    documentId: string;
    event: DocumentProgressEvent;
  }>();

  emitProgress(
    documentId: string,
    type: 'message',
    data: DocumentProgressDTO,
  ): void {
    this.progress$.next({ documentId, event: { type, data } });
  }

  async progress(
    userId: string,
    documentId: string,
  ): Promise<Observable<DocumentProgressEvent>> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!document) {
      throw new NotFoundException(ErrorMessage.notFound('Document'));
    }

    // Subscribe before loading the snapshot so updates during the read aren't lost.
    return new Observable<DocumentProgressEvent>((subscriber) => {
      let loading = true;
      const pending: DocumentProgressEvent[] = [];
      const updates = this.progress$
        .pipe(
          filter((item) => item.documentId === documentId),
          map((item) => item.event),
        )
        .subscribe((event) => {
          if (loading) pending.push(event);
          else subscriber.next(event);
        });
      const heartbeat = setInterval(() => {
        if (!loading) subscriber.next({ type: 'heartbeat', data: {} });
      }, 15000);

      void Promise.all([
        this.prisma.document.findFirstOrThrow({
          where: { id: documentId, userId, deletedAt: null },
          select: { status: true, errorMessage: true },
        }),
        this.queue.getJob(documentId),
      ])
        .then(([snapshot, job]) => {
          if (subscriber.closed) return;
          subscriber.next({
            type: 'message',
            data: {
              document_id: documentId,
              status: snapshot.status,
              progress:
                snapshot.status === DocumentStatus.READY
                  ? 100
                  : typeof job?.progress === 'number'
                    ? job.progress
                    : 0,
              ...(snapshot.errorMessage
                ? { error: snapshot.errorMessage }
                : {}),
            },
          });
          loading = false;
          for (const event of pending) subscriber.next(event);
        })
        .catch((error: unknown) => subscriber.error(error));

      return () => {
        clearInterval(heartbeat);
        updates.unsubscribe();
      };
    }).pipe(
      takeWhile((event) => {
        if (event.type === 'heartbeat') return true;
        return (
          event.data.status !== DocumentStatus.READY &&
          event.data.status !== DocumentStatus.FAILED
        );
      }, true),
    );
  }

  async createPresignUrl(
    userId: string,
    body: CreatePresignUrlDTO,
  ): Promise<WebResponse<PresignUrlDTO>> {
    const expired_url = 900;
    const limit = maxPdfBytes(this.config);
    if (body.fileSize != null && body.fileSize > limit) {
      throw new BadRequestException(`PDF exceeds ${limit} byte upload limit`);
    }

    const document = await this.prisma.document.create({
      data: {
        userId,
        fileName: body.fileName,
        fileSize: body.fileSize == null ? null : BigInt(body.fileSize),
        mimeType: body.mimeType ?? null,
        sha256Hash: body.sha256Hash?.toLowerCase() ?? null,
        status: DocumentStatus.PENDING_UPLOAD,
      },
    });

    try {
      const url = await this.storage.presignedPutObject(
        this.storage.bucket,
        document.id,
        expired_url,
      );

      return {
        message: Messages.create('Presigned upload URL'),
        data: {
          document_id: document.id,
          upload_url: url,
          expires_in: expired_url,
        },
      };
    } catch (error) {
      await this.prisma.document.delete({ where: { id: document.id } });
      throw error;
    }
  }

  async documentProcess(
    userId: string,
    id: string,
  ): Promise<WebResponse<DocumentProcessDTO>> {
    // Do not inspect a storage object until ownership and deletion guards pass.
    const existing = await this.prisma.document.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
        status: { notIn: [DocumentStatus.DELETING, DocumentStatus.DELETED] },
      },
      select: { fileSize: true },
    });
    if (!existing) {
      throw new NotFoundException(ErrorMessage.notFound('Active document'));
    }

    try {
      const object = await this.storage.statObject(this.storage.bucket, id);
      assertPdfObject(object, maxPdfBytes(this.config), existing.fileSize);
    } catch (error) {
      if (isMissingObject(error)) {
        throw new BadRequestException('PDF has not been uploaded to storage');
      }
      throw error;
    }

    const documents = await this.prisma.document.updateManyAndReturn({
      where: {
        id,
        userId,
        deletedAt: null,
        status: { notIn: [DocumentStatus.DELETING, DocumentStatus.DELETED] },
      },
      data: { status: DocumentStatus.QUEUED },
    });
    if (!documents.length) {
      throw new NotFoundException(ErrorMessage.notFound('Active document'));
    }

    try {
      await this.queue.add(
        DOCUMENT_QUEUE.DOCUMENTS.NAME,
        { userId, documentId: id },
        { jobId: id },
      );
    } catch {
      await this.prisma.document.updateMany({
        where: { id, userId, status: DocumentStatus.QUEUED },
        data: { status: DocumentStatus.FAILED },
      });

      throw new ServiceUnavailableException(
        ErrorMessage.create('Document processing job'),
      );
    }

    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id, userId },
      select: { id: true, status: true },
    });

    return {
      message: Messages.create('Document processing job'),
      data: document,
    };
  }

  retry(_userId: string, _id: string): void {
    // TODO: Implement document processing retry. Coming soon.
  }
}
