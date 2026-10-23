import { PinoLogger } from 'nestjs-pino';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ChatSessionService } from './chat-session.service';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../decorators/current-user.decorator';
import { PaginationDto } from '../../common/common.dto';
import { UpdateChatSessionDto } from './dto/update-chat-session.dto';
import type { WebResponse } from '../../common/common.interface';
import type {
  FindAllChatSessionResDto,
  FindChatsResDto,
  UpdateChatSessionResDto,
} from './chat-session.interface';

@Controller('chat-sessions')
export class ChatSessionController {
  constructor(
    private readonly chatSessionService: ChatSessionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChatSessionController.name);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() pagination: PaginationDto,
  ): Promise<WebResponse<FindAllChatSessionResDto>> {
    return this.chatSessionService.findAll(user.id, pagination);
  }

  @Get('deleted')
  findDeleted(
    @CurrentUser() user: AuthenticatedUser,
    @Query() pagination: PaginationDto,
  ): Promise<WebResponse<FindAllChatSessionResDto>> {
    return this.chatSessionService.findDeleted(user.id, pagination);
  }

  @Get(':id/chats')
  findChats(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<FindChatsResDto>> {
    return this.chatSessionService.findChats(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateChatSessionDto,
  ): Promise<WebResponse<UpdateChatSessionResDto>> {
    return this.chatSessionService.update(user.id, id, body);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<UpdateChatSessionResDto>> {
    return this.chatSessionService.remove(user.id, id);
  }

  @Delete(':id/permanent')
  removePermanently(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse> {
    return this.chatSessionService.removePermanently(user.id, id);
  }

  @Post(':id/restore')
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<UpdateChatSessionResDto>> {
    return this.chatSessionService.restore(user.id, id);
  }
}
