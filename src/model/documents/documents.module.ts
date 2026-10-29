import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DOCUMENT_QUEUE } from './queue/documents.constants';
import { QueueModule } from '../../common/queue/queue.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
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
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsProcessor, DocumentsListener],
})
export class DocumentsModule {}
