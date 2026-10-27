import {
  Body,
  Controller,
  Get,
  HttpCode,
  Sse,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { DocumentProgress } from './documents.interface';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import type { JwtPayload } from '../session/session.interface';
import { WebResponse } from '../../common/common.interface';
import { DocumentResDTO, PresignUrlResDTO } from './documents.interface';
import { CreatePresignUrlDTO } from './dto/presign.dto';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('presigned-url')
  presign(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreatePresignUrlDTO,
  ): Promise<WebResponse<PresignUrlResDTO>> {
    return this.documents.createPresignUrl(user.sub, body);
  }

  @Post(':id/process')
  @HttpCode(202)
  process(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<DocumentProgress>> {
    return this.documents.process(user.sub, id);
  }

  @Sse(':id/progress')
  progress(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Observable<MessageEvent>> {
    return this.documents.progress(user.sub, id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<DocumentResDTO>> {
    return this.documents.findOne(user.sub, id);
  }
}
