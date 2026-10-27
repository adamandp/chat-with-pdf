import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { CreateChatDto } from './dto/create-chat.dto';
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}
  @Post()
  @HttpCode(200)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateChatDto) {
    return this.chat.create(user.id, body);
  }
}
