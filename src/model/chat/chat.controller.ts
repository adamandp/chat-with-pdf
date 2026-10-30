import { Body, Controller, Sse, RequestMethod } from '@nestjs/common';
import { CurrentUser } from '../../decorators/current-user.decorator';
import type { JwtPayload } from '../session/session.interface';
import { ChatService } from './chat.service';
import { Observable } from 'rxjs';
import { SendChatDTO, type SendChatEvent } from './chat.interface';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Sse('send', { method: RequestMethod.POST })
  send(
    @CurrentUser() user: JwtPayload,
    @Body() body: SendChatDTO,
  ): Promise<Observable<SendChatEvent>> {
    return this.chat.send(user.sub, body);
  }
}
