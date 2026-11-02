import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import type { JwtPayload } from '../session/session.interface';
import { WebResponse } from '../../common/common.interface';
import { PaginationDto } from '../../common/common.dto';
import {
  DocumentFindOneDTO,
  DocumentFindAllDTO,
  DocumentFindAllDeletedDTO,
  DocumentRemoveDTO,
  DocumentRestoreDTO,
  DocumentRemovePermanentlyDTO,
} from './documents.interface';
import { PinoLogger } from 'nestjs-pino';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DocumentsController.name);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() pagination: PaginationDto,
  ): Promise<WebResponse<DocumentFindAllDTO>> {
    return this.documents.findAll(user.sub, pagination);
  }

  @Get('deleted')
  findDeleted(
    @CurrentUser() user: JwtPayload,
    @Query() pagination: PaginationDto,
  ): Promise<WebResponse<DocumentFindAllDeletedDTO>> {
    return this.documents.findDeleted(user.sub, pagination);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<DocumentFindOneDTO>> {
    return this.documents.findOne(user.sub, id);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<DocumentRemoveDTO>> {
    return this.documents.remove(user.sub, id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<DocumentRestoreDTO>> {
    return this.documents.restore(user.sub, id);
  }

  @Delete(':id/permanent')
  removePermanently(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<DocumentRemovePermanentlyDTO>> {
    return this.documents.removePermanently(user.sub, id);
  }
}
