import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { MilvusService } from '../../common/milvus/milvus.service';
import { DocumentStatus } from '../../generated/prisma/enums';
import { Messages, ErrorMessage } from '../../utils/message.helper';
import type { WebResponse } from '../../common/common.interface';
import type { Prisma } from '../../generated/prisma/client';
import type { DocumentQueryDto } from './dto/document-query.dto';
import type {
  DocumentFindAllDTO,
  DocumentFindAllDeletedDTO,
  DocumentFindOneDTO,
  DocumentRemoveDTO,
  DocumentRestoreDTO,
  DocumentRemovePermanentlyDTO,
} from './documents.interface';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly milvus: MilvusService,
  ) {
    this.logger.setContext(DocumentsService.name);
  }

  async findAll(
    userId: string,
    { page, limit, q, order = 'desc', sort = 'modified' }: DocumentQueryDto,
  ): Promise<WebResponse<DocumentFindAllDTO>> {
    this.logger.trace({ userId, page, limit, q, order, sort }, 'Finding ready documents');

    const search = q?.trim();
    const where = {
      userId,
      status: DocumentStatus.READY,
      deletedAt: null,
      ...(search
        ? { fileName: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const [documents, totalItems] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        orderBy: this.getDocumentOrderBy(sort, order),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      message: Messages.get('Documents'),
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

  async findDeleted(
    userId: string,
    { page, limit, q, order = 'desc', sort = 'modified' }: DocumentQueryDto,
  ): Promise<WebResponse<DocumentFindAllDeletedDTO>> {
    this.logger.trace({ userId, page, limit, q, order, sort }, 'Finding deleted documents');

    const search = q?.trim();
    const where = {
      userId,
      status: DocumentStatus.READY,
      deletedAt: { not: null },
      ...(search
        ? { fileName: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const [documents, totalItems] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        orderBy: this.getDocumentOrderBy(sort, order),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      message: Messages.get('Deleted documents'),
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

  private getDocumentOrderBy(
    sort: DocumentQueryDto['sort'],
    order: DocumentQueryDto['order'],
  ): Prisma.DocumentOrderByWithRelationInput[] {
    switch (sort) {
      case 'name':
        return [{ fileName: { sort: order, nulls: 'last' } }, { id: order }];
      case 'pages':
        return [{ pageCount: { sort: order, nulls: 'last' } }, { id: order }];
      default:
        return [{ updatedAt: order }, { id: order }];
    }
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
        status: { notIn: [DocumentStatus.DELETING, DocumentStatus.DELETED] },
      },
    });

    if (!document) throw new NotFoundException('Document not found');

    const downloadUrl = await this.storage.presignedGetObject(
      this.storage.bucket,
      document.id,
      900,
    );

    return {
      message: Messages.get('Document'),
      data: {
        ...document,
        fileSize: document.fileSize?.toString() ?? null,
        download_url: downloadUrl,
      },
    };
  }

  async remove(
    userId: string,
    id: string,
  ): Promise<WebResponse<DocumentRemoveDTO>> {
    const documents = await this.prisma.document.updateManyAndReturn({
      where: {
        id,
        userId,
        status: DocumentStatus.READY,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    if (!documents.length) {
      throw new NotFoundException(ErrorMessage.notFound('Ready document'));
    }

    const document = documents[0];
    this.logger.info({ userId, documentId: id }, 'Document soft-deleted');
    return {
      message: Messages.delete('Document'),
      data: {
        id: document.id,
        fileName: document.fileName,
        updatedAt: document.updatedAt,
      },
    };
  }

  async restore(
    userId: string,
    id: string,
  ): Promise<WebResponse<DocumentRestoreDTO>> {
    const documents = await this.prisma.document.updateManyAndReturn({
      where: {
        id,
        userId,
        status: DocumentStatus.READY,
        deletedAt: { not: null },
      },
      data: { deletedAt: null },
    });

    if (!documents.length) {
      throw new NotFoundException(ErrorMessage.notFound('Deleted document'));
    }

    const document = documents[0];
    this.logger.info({ userId, documentId: id }, 'Document restored');
    return {
      message: Messages.restore('Document'),
      data: {
        id: document.id,
        fileName: document.fileName,
        updatedAt: document.updatedAt,
      },
    };
  }

  async removePermanently(
    userId: string,
    id: string,
  ): Promise<WebResponse<DocumentRemovePermanentlyDTO>> {
    // The conditional update is an atomic claim. A failed cleanup is immediately
    // retryable; an interrupted cleanup may be reclaimed after its lease expires.
    // External storage calls deliberately run outside a database transaction.
    const staleLease = new Date(Date.now() - 30 * 60 * 1000);
    const claimed = await this.prisma.document.updateManyAndReturn({
      where: {
        id,
        userId,
        deletedAt: { not: null },
        OR: [
          { status: DocumentStatus.READY },
          { status: DocumentStatus.DELETING, errorMessage: { not: null } },
          { status: DocumentStatus.DELETING, updatedAt: { lt: staleLease } },
        ],
      },
      data: { status: DocumentStatus.DELETING, errorMessage: null },
    });

    if (!claimed.length) {
      const existing = await this.prisma.document.findFirst({
        where: { id, userId, deletedAt: { not: null } },
        select: { status: true },
      });
      if (existing?.status === DocumentStatus.DELETING) {
        throw new ConflictException('Document deletion already in progress');
      }
      throw new NotFoundException(ErrorMessage.notFound('Deleted document'));
    }

    const document = claimed[0];
    const lease = {
      id,
      userId,
      status: DocumentStatus.DELETING,
      updatedAt: document.updatedAt,
    };

    try {
      const vectorDeletion = await this.milvus.delete({
        collection_name: 'document_chunks',
        filter: `document_id == ${JSON.stringify(id)}`,
      });
      if (vectorDeletion.status?.error_code !== 'Success') {
        throw new ServiceUnavailableException(
          'Failed to delete document vectors',
        );
      }

      try {
        await this.storage.removeObject(this.storage.bucket, id);
      } catch (error) {
        // An absent object is already cleaned up, including on retries.
        const code = (error as { code?: string })?.code;
        if (code !== 'NoSuchKey' && code !== 'NotFound') throw error;
      }

      const finished = await this.prisma.document.updateManyAndReturn({
        where: lease,
        data: { status: DocumentStatus.DELETED, errorMessage: null },
      });
      if (!finished.length) {
        throw new ConflictException('Document deletion lease was lost');
      }

      this.logger.info(
        { userId, documentId: id },
        'Document permanently deleted',
      );
      return {
        message: Messages.delete('Document permanently'),
        data: {
          id: finished[0].id,
          fileName: finished[0].fileName,
          updatedAt: finished[0].updatedAt,
        },
      };
    } catch (error) {
      await this.prisma.document.updateMany({
        where: lease,
        data: {
          errorMessage:
            error instanceof Error
              ? error.message.slice(0, 2000)
              : 'Document cleanup failed',
        },
      });
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException(
        'Document cleanup failed; retry permanent deletion',
      );
    }
  }
}
