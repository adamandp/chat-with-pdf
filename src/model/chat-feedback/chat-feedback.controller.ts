import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../decorators/current-user.decorator';
import type { JwtPayload } from '../session/session.interface';
import { ChatFeedbackService } from './chat-feedback.service';
import { ToggleChatFeedbackDto } from './dto/toggle-chat-feedback.dto';

@Controller('chat')
export class ChatFeedbackController {
  constructor(private readonly feedback: ChatFeedbackService) {}

  @Post(':messageId/feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  toggle(
    @CurrentUser() user: JwtPayload,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() body: ToggleChatFeedbackDto,
  ): Promise<void> {
    return this.feedback.toggle(user.sub, messageId, body);
  }
}
