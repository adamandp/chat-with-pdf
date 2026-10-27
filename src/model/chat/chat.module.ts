import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatRepository } from './chat.repository';
import { ChatModelService } from './chat-model.service';

@Module({
  imports: [DocumentsModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatRepository,
    ChatModelService,
  ],
})
export class ChatModule {}
