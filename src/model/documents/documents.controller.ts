import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import { PresignDto } from './dto/presign.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}
  @Post('presigned-url')
  @HttpCode(200)
  presign(@CurrentUser() user: AuthenticatedUser, @Body() body: PresignDto) {
    return this.documents.presign(user.id, body.filename);
  }
  @Post('documents/upload')
  @HttpCode(202)
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UploadDocumentDto,
  ) {
    return this.documents.upload(user.id, body.upload_id);
  }
  @Get('documents/:id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.documents.findOne(user.id, id);
  }
}
