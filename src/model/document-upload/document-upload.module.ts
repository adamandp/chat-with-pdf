import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../../common/queue/queue.module';
import { DOCUMENT_QUEUE } from './queue/documents.constants';
import { DocumentUploadController } from './document-upload.controller';
import { DocumentUploadService } from './document-upload.service';
import { DocumentsProcessor } from './queue/documents.processor';
import { DocumentsListener } from './queue/document-progress.service';

@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({
      name: DOCUMENT_QUEUE.DOCUMENTS.NAME,
      defaultJobOptions: { attempts: 1 },
    }),
  ],
  controllers: [DocumentUploadController],
  providers: [DocumentUploadService, DocumentsProcessor, DocumentsListener],
})
export class DocumentUploadModule {}
