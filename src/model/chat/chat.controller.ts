import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Sse,
  RequestMethod,
} from '@nestjs/common';
import { CurrentUser } from '../../decorators/current-user.decorator';
import type { WebResponse } from '../../common/common.interface';
import type { JwtPayload } from '../session/session.interface';
import { ChatService } from './chat.service';
import { Observable } from 'rxjs';
import {
  SendChatDTO,
  type SendChatEvent,
  type FindChatDetailResDto,
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
}
