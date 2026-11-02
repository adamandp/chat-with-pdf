import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Sse,
  RequestMethod,
} from '@nestjs/common';
import { CurrentUser } from '../../decorators/current-user.decorator';
import type { WebResponse } from '../../common/common.interface';
import type { JwtPayload } from '../session/session.interface';
import { ChatService } from './chat.service';
import { Observable } from 'rxjs';
import { ToggleChatFeedbackDto } from './dto/toggle-chat-feedback.dto';
import {
  SendChatDTO,
  type SendChatEvent,
  type FindChatDetailResDto,
  ForkChatDTO,
  type ForkChatResDTO,
  RegenerateChatDTO,
} from './chat.interface';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(':id/details')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WebResponse<FindChatDetailResDto>> {
    return this.chat.findOne(user.sub, id);
  }

  @Sse('send', { method: RequestMethod.POST })
  send(
    @CurrentUser() user: JwtPayload,
    @Body() body: SendChatDTO,
  ): Promise<Observable<SendChatEvent>> {
    return this.chat.send(user.sub, body);
  }

  @Post(':messageId/feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  toggleFeedback(
    @CurrentUser() user: JwtPayload,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() body: ToggleChatFeedbackDto,
  ): Promise<void> {
    return this.chat.toggleFeedback(user.sub, messageId, body);
  }

  @Post(':id/fork')
  fork(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ForkChatDTO,
  ): Promise<WebResponse<ForkChatResDTO>> {
    return this.chat.fork(user.sub, id, body);
  }

  @Sse(':messageId/regenerate', { method: RequestMethod.POST })
  regenerate(
    @CurrentUser() user: JwtPayload,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() body: RegenerateChatDTO,
  ): Promise<Observable<SendChatEvent>> {
    return this.chat.regenerate(user.sub, messageId, body);
  }

  @Sse(':messageId/edit', { method: RequestMethod.POST })
  edit(
    @CurrentUser() user: JwtPayload,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() body: SendChatDTO,
  ): Promise<Observable<SendChatEvent>> {
    return this.chat.edit(user.sub, messageId, body);
  }

  @Patch(':messageId/activate')
  activate(
    @CurrentUser() user: JwtPayload,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<WebResponse<{ activeLeafMessageId: string }>> {
    return this.chat.activate(user.sub, messageId);
  }
}
