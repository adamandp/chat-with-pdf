import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { DocumentStatus } from '../../generated/prisma/enums';
import { DocumentResDTO, PresignUrlResDTO } from './documents.interface';
import { WebResponse } from '../../common/common.interface';
import { DocumentQueueService } from './queue/document-queue.service';
import { DocumentProgressService } from './queue/document-progress.service';
import type { DocumentProgress } from './documents.interface';
import { CreatePresignUrlDTO } from './dto/presign.dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: DocumentQueueService,
    private readonly documentProgress: DocumentProgressService,
  ) {}

  private async ownedDocument(userId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
      },
    });

    if (!document) throw new NotFoundException('Document not found');

    return document;
  }

  async process(
    userId: string,
    id: string,
  ): Promise<WebResponse<DocumentProgress>> {
    // validate document owner
    const document = await this.ownedDocument(userId, id);

    // validate documents status
    if (
      document.status === DocumentStatus.READY
      || document.status === DocumentStatus.DELETING
      || document.status === DocumentStatus.DELETED
    ) {
      throw new ConflictException(
        'Document cannot be processed in its current status',
      );
    }

    // if document is already processing, return progress
    if (document.status === DocumentStatus.PROCESSING) {
      return {
        data: {
          document_id: id,
          status: document.status,
          progress: 0,
        },
      };
    }

    // update document status
    const claimed = await this.prisma.document.updateMany({
      where: {
        id,
        userId,
        deletedAt: null,
        status: {
          in: [
            DocumentStatus.PENDING_UPLOAD,
            DocumentStatus.FAILED,
          ],
        },
      },
      data: {
        status: DocumentStatus.QUEUED,
        errorMessage: null,
      },
    });

    // Repeated requests reuse the same BullMQ job ID, including an enqueue interrupted by a restart.
    try {
      // process job
      await this.jobs.enqueue({
        documentId: id,
        userId,
      });
    } catch {
      // revert document status
      if (claimed.count) {
        await this.prisma.document.updateMany({
          where: {
            id,
            userId,
            status: DocumentStatus.QUEUED,
          },
          data: {
            status: document.status,
            errorMessage: document.errorMessage,
          },
        });
      }

      throw new ServiceUnavailableException(
        'Document queue unavailable; please retry',
      );
    }

    return {
      data: {
        document_id: id,
        status: DocumentStatus.QUEUED,
        progress: 0,
      },
    };
  }

  async progress(userId: string, id: string) {
    const document = await this.ownedDocument(userId, id);

    return this.documentProgress.stream(
      id,
      {
        document_id: id,
        status: document.status,
        progress: document.status === DocumentStatus.READY ? 100 : 0,
        ...(document.errorMessage ? { error: document.errorMessage } : {}),
      },
    );
  }

  async findOne(
    userId: string,
    id: string,
  ): Promise<WebResponse<DocumentResDTO>> {
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
        fileSize: document.fileSize?.toString() ?? null,
        download_url: downloadUrl,
      },
    };
  }

  async createPresignUrl(
    userId: string,
    body: CreatePresignUrlDTO,
  ): Promise<WebResponse<PresignUrlResDTO>> {
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
}
