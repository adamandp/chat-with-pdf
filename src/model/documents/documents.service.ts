import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { PdfService } from './pdf.service';
import type { Document } from '../../generated/prisma/client';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
  ) {}

  async presign(userId: string, filename: string) {
    const id = randomUUID();

    const key = `${userId}/${id}.pdf`;

    const url = await this.storage.presignedPutObject(this.storage.bucket, key, 900);

    await this.prisma.documentUpload.create({
      data: {
        id,
        userId,
        objectKey: key,
        filename,
        expiresAt: new Date(Date.now() + 900000),
      },
    });

    return {
      data: {
        upload_id: id,
        object_key: key,
        upload_url: url,
        method: 'PUT',
        expires_in: 900,
      },
    };
  }

  async response(doc: Document) {
    return {
      id: doc.id,
      filename: doc.filename,
      status: doc.status,
      page_count: doc.pageCount,
      chunk_count: doc.chunkCount,
      error_message: doc.errorMessage,
      download_url: await this.storage.presignedGetObject(this.storage.bucket, doc.filePath, 900),
    };
  }

  async upload(userId: string, uploadId: string) {
    const doc = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM document_uploads WHERE id=${uploadId}::uuid AND user_id=${userId}::uuid FOR UPDATE`;

        const reservation = await tx.documentUpload.findFirst({
          where: {
            id: uploadId,
            userId,
          },
        });

        if (!reservation)
          throw new NotFoundException('Upload reservation not found');
        if (reservation.documentId)
          return tx.document.findUniqueOrThrow({
            where: { id: reservation.documentId },
          });
        if (reservation.expiresAt.getTime() < Date.now())
          throw new GoneException(
            'Upload reservation expired; request a new upload URL',
          );

        const { data, hash } = await this.readPdf(
          reservation.objectKey,
        );

        const pages = await this.pdf.extract(data);

        const id = randomUUID();

        const key = `${userId}/final/${id}.pdf`;

        await this.storage.putObject(this.storage.bucket, key, data, data.length, {
          'Content-Type': 'application/pdf',
        });

        const document = await tx.document.create({
          data: {
            id,
            userId,
            filename: reservation.filename,
            filePath: key,
            fileSize: BigInt(data.length),
            mimeType: 'application/pdf',
            sha256Hash: hash,
            pageCount: pages.length,
            status: 'queued',
          },
        });

        await tx.documentJob.create({
          data: {
            id: randomUUID(),
            documentId: id,
          },
        });
        await tx.documentUpload.update({
          where: { id: uploadId },
          data: { documentId: id },
        });

        return document;
      },
      { timeout: 120000 },
    );

    return { data: await this.response(doc) };
  }

  async findOne(userId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
      },
    });

    if (!doc) throw new NotFoundException('Document not found');

    return { data: await this.response(doc) };
  }

  async readPdf(key: string) {
    try {
      const stat = await this.storage.statObject(this.storage.bucket, key);

      if (stat.size < 5 || stat.size > this.pdf.maxBytes) {
        throw new BadRequestException('PDF is empty or exceeds the size limit');
      }

      const stream = await this.storage.getObject(this.storage.bucket, key);

      const chunks: Buffer[] = [];

      let size = 0;

      for await (const part of stream) {
        const chunk = Buffer.from(part);

        size += chunk.length;
        if (size > this.pdf.maxBytes) {
          stream.destroy();
          throw new BadRequestException('PDF exceeds the size limit');
        }
        chunks.push(chunk);
      }

      const data = Buffer.concat(chunks);

      return {
        data,
        hash: this.pdf.validate(data),
      };
    } catch (error) {
      if ((error as { code?: string }).code === 'NoSuchKey') {
        throw new NotFoundException('Uploaded object not found');
      }
      throw error;
    }
  }
}
