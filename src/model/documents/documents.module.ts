import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentWorkerService } from './document-worker.service';
import { PdfService } from './pdf.service';
import { VectorService } from './vector.service';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentWorkerService,
    PdfService,
    VectorService,
  ],
  exports: [
    VectorService,
    DocumentWorkerService,
  ],
})
export class DocumentsModule {}
