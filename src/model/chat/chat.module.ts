import { Module } from '@nestjs/common';
import { AiModule } from '../../common/ai/ai.module';
import { MilvusModule } from '../../common/milvus/milvus.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatController } from './chat.controller';
import { RagService } from './chat-retrieval';
import { ChatService } from './chat.service';

@Module({
  imports: [PrismaModule, AiModule, MilvusModule],
  controllers: [ChatController],
  providers: [ChatService, RagService],
})
export class ChatModule {}
