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
import type { PaginationDto } from '../../common/common.dto';
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
    { page, limit }: PaginationDto,
  ): Promise<WebResponse<DocumentFindAllDTO>> {
    this.logger.trace({ userId, page, limit }, 'Finding ready documents');

    const where = {
      userId,
      status: DocumentStatus.READY,
      deletedAt: null,
    };

    const [documents, totalItems] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
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
    { page, limit }: PaginationDto,
  ): Promise<WebResponse<DocumentFindAllDeletedDTO>> {
    this.logger.trace({ userId, page, limit }, 'Finding deleted documents');

    const where = { userId, deletedAt: { not: null } };

    const [documents, totalItems] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
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

  async findOne(
    userId: string,
    id: string,
  ): Promise<WebResponse<DocumentFindOneDTO>> {
    const document = await this.prisma.document.findFirst({
      where: { id, userId, deletedAt: null },
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
      where: { id, userId, deletedAt: { not: null } },
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
    const result = await this.prisma.$transaction(async (tx) => {
      const [document] = await tx.$queryRaw<{
        id: string;
        fileName: string | null;
        updatedAt: Date | null;
      }[]>`
        SELECT id, filename AS "fileName", updated_at AS "updatedAt"
        FROM documents
        WHERE id = ${id}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NOT NULL
        FOR UPDATE
      `;

      if (!document) {
        throw new NotFoundException(ErrorMessage.notFound('Deleted document'));
      }

      const relation = await tx.sessionDocument.findFirst({
        where: { documentId: id },
        select: { documentId: true },
      });
      if (relation) {
        throw new ConflictException('Document is still linked to a chat session');
      }

      const vectorDeletion = await this.milvus.delete({
        collection_name: 'document_chunks',
        filter: `document_id == ${JSON.stringify(id)}`,
      });
      if (vectorDeletion.status?.error_code !== 'Success') {
        throw new ServiceUnavailableException('Failed to delete document vectors');
      }
      await this.storage.removeObject(this.storage.bucket, id);
      await tx.document.delete({ where: { id, userId } });

      return document;
    }, { timeout: 30_000 });

    this.logger.info({ userId, documentId: id }, 'Document permanently deleted');
    return {
      message: Messages.delete('Document permanently'),
      data: result,
    };
  }
}
