import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  MessageEvent,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { DocumentStatus } from '../../generated/prisma/enums';
import { WebResponse } from '../../common/common.interface';
import type { PaginationDto } from '../../common/common.dto';
import type {
  DocumentFindAllDTO,
  DocumentFindOneDTO,
  DocumentProcessDTO,
  PresignUrlDTO,
  ProcessDocumentType,
} from './documents.interface';
import { CreatePresignUrlDTO } from './dto/presign.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { DOCUMENT_QUEUE } from './queue/documents.constants';
import {
  Observable,
  Subject,
  filter,
  map,
  takeWhile,
} from 'rxjs';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(DOCUMENT_QUEUE.DOCUMENTS.NAME)
    readonly queue: Queue<ProcessDocumentType>,
  ) {
    this.logger.setContext(DocumentsService.name);
  }

  private readonly progress$ = new Subject<{
    documentId: string;
    event: MessageEvent;
  }>();

  emitProgress(
    documentId: string,
    type: string,
    data: object,
  ): void {
    this.progress$.next({
      documentId,
      event: {
        type,
        data,
      },
    });
  }

  async progress(
    userId: string,
    documentId: string,
  ): Promise<Observable<MessageEvent>> {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        userId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Subscribe before loading the snapshot so updates during the read aren't lost.
    return new Observable<MessageEvent>((subscriber) => {
      let loading = true;
      const pending: MessageEvent[] = [];
      const updates = this.progress$.pipe(
        filter((item) => item.documentId === documentId),
        map((item) => item.event),
      ).subscribe((event) => {
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
      ]).then(([snapshot, job]) => {
        if (subscriber.closed) return;
        subscriber.next({
          type: 'message',
          data: {
            document_id: documentId,
            status: snapshot.status,
            progress: snapshot.status === DocumentStatus.READY ? 100
              : typeof job?.progress === 'number' ? job.progress : 0,
            ...(snapshot.errorMessage ? { error: snapshot.errorMessage } : {}),
          },
        });
        loading = false;
        for (const event of pending) subscriber.next(event);
      }).catch((error: unknown) => subscriber.error(error));

      return () => {
        clearInterval(heartbeat);
        updates.unsubscribe();
      };
    }).pipe(
      takeWhile((event) => {
        const data = event.data as { status?: string };
        return data.status !== DocumentStatus.READY && data.status !== DocumentStatus.FAILED;
      }, true),
    );
  }

  async createPresignUrl(
    userId: string,
    body: CreatePresignUrlDTO,
  ): Promise<WebResponse<PresignUrlDTO>> {
    const expired_url = 900;

    // create metadata to postgre
    const document = await this.prisma.document.create({
      data: {
        userId,
        fileName: body.fileName,
        status: DocumentStatus.PENDING_UPLOAD,
      },
    });

    try {
      // create presigned url
      const url = await this.storage.presignedPutObject(
        this.storage.bucket,
        document.id,
        expired_url,
      );

      // return data
      return {
        data: {
          document_id: document.id,
          upload_url: url,
          expires_in: expired_url,
        },
      };
    } catch (error) {
      await this.prisma.document.delete({
        where: { id: document.id },
      });

      throw error;
    }
  }

  async findAll(
    userId: string,
    { page, limit }: PaginationDto,
  ): Promise<WebResponse<DocumentFindAllDTO>> {
    this.logger.trace(
      {
        userId,
        page,
        limit,
      },
      'Finding active documents',
    );

    const where = {
      userId,
      deletedAt: null,
    };

    const [
      documents,
      totalItems,
    ] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        orderBy: [
          { updatedAt: 'desc' },
          { id: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      data: documents.map((document) => ({
        ...document,
        fileSize: document.fileSize?.toString() ?? null,
      })),
      paging: {
        currentPage: page,
        pageSize: limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      },
    };
  }

  async findOne(
    userId: string,
    id: string,
  ): Promise<WebResponse<DocumentFindOneDTO>> {
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
      },
    });

    if (!document) throw new NotFoundException('Document not found');

    const downloadUrl = await this.storage.presignedGetObject(
      this.storage.bucket,
      document?.id,
      900,
    );

    return {
      data: {
        ...document,
        download_url: downloadUrl,
      },
    };
  }

  async documentProcess(
    userId: string,
    id: string,
  ): Promise<WebResponse<DocumentProcessDTO>> {
    try {
      await this.prisma.document.updateMany({
        where: {
          id,
          userId,
        },
        data: {
          status: DocumentStatus.QUEUED,
        },
      });

      await this.queue.add(
        DOCUMENT_QUEUE.DOCUMENTS.NAME,
        {
          userId: userId,
          documentId: id,
        },
        {
          jobId: id,
        },
      );
    } catch {
      await this.prisma.document.updateMany({
        where: {
          id,
          userId,
        },
        data: {
          status: DocumentStatus.FAILED,
        },
      });

      throw new ServiceUnavailableException(
        'Document queue unavailable; please retry',
      );
    }

    const document = await this.prisma.document.findUniqueOrThrow({
      where: {
        id,
        userId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    return {
      message: 'Document queued for processing',
      data: document,
    };
  }
}
