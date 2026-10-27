import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DOCUMENT_QUEUE } from './queue/document-queue.constants';
import { DocumentProgressService } from './queue/document-progress.service';
import { QueueModule } from '../../common/queue/queue.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentQueueService } from './queue/document-queue.service';
import { DocumentWorkerService } from './processing/document-worker.service';
import { PdfService } from './processing/pdf.service';
import { VectorService } from './processing/vector.service';

@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({
      name: DOCUMENT_QUEUE,
      defaultJobOptions: { attempts: 1 },
    }),
  ],
  controllers: [DocumentsController],
  exports: [VectorService],
  providers: [
    DocumentsService,
    DocumentQueueService,
    DocumentProgressService,
    DocumentWorkerService,
    PdfService,
    VectorService,
  ],
})
export class DocumentsModule {}
