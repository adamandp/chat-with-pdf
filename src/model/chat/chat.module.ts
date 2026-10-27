import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatModelService } from './chat-model.service';
@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatModelService,
  ],
})
export class ChatModule {}
