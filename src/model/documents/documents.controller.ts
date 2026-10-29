import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import type { JwtPayload } from '../session/session.interface';
import { WebResponse } from '../../common/common.interface';
import { PaginationDto } from '../../common/common.dto';
import {
  DocumentProcessDTO,
  DocumentFindOneDTO,
  DocumentFindAllDTO,
  PresignUrlDTO,
} from './documents.interface';
import { CreatePresignUrlDTO } from './dto/presign.dto';
import { PinoLogger } from 'nestjs-pino';
import { Observable } from 'rxjs';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DocumentsController.name);
  }

  @Post('presigned-url')
  presign(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreatePresignUrlDTO,
  ): Promise<WebResponse<PresignUrlDTO>> {
    return this.documents.createPresignUrl(user.sub, body);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() pagination: PaginationDto,
  ): Promise<WebResponse<DocumentFindAllDTO>> {
    return this.documents.findAll(user.sub, pagination);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<DocumentFindOneDTO>> {
    return this.documents.findOne(user.sub, id);
  }

  @Post(':id/process')
  process(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<DocumentProcessDTO>> {
    return this.documents.documentProcess(user.sub, id);
  }

  // @Sse(':id/progress')
  // progress(
  //   @CurrentUser() user: JwtPayload,
  //   @Param('id', new ParseUUIDPipe()) id: string,
  // ): Promise<Observable<MessageEvent>> {
  //   return this.documents.progress(user.sub, id);
  // }

  @Sse(':id/progress')
  progress(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Observable<MessageEvent>> {
    return this.documents.progress(user.sub, id);
  }
}
