import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { CurrentUser } from '../../decorators/current-user.decorator';
import type { JwtPayload } from '../session/session.interface';
import type { WebResponse } from '../../common/common.interface';
import { DocumentUploadService } from './document-upload.service';
import { CreatePresignUrlDTO } from './dto/presign.dto';
import type {
  DocumentProcessDTO,
  DocumentProgressEvent,
  PresignUrlDTO,
} from './document-upload.interface';

@Controller('document-upload')
export class DocumentUploadController {
  constructor(private readonly upload: DocumentUploadService) {}

  @Post('presigned-url')
  presign(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreatePresignUrlDTO,
  ): Promise<WebResponse<PresignUrlDTO>> {
    return this.upload.createPresignUrl(user.sub, body);
  }

  @Post(':id/process')
  process(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<DocumentProcessDTO>> {
    return this.upload.documentProcess(user.sub, id);
  }

  @Sse(':id/progress')
  progress(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Observable<DocumentProgressEvent>> {
    return this.upload.progress(user.sub, id);
  }

  @Post(':id/retry')
  retry(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): void {
    this.upload.retry(user.sub, id);
  }
}
