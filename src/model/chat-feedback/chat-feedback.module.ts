import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatFeedbackController } from './chat-feedback.controller';
import { ChatFeedbackService } from './chat-feedback.service';

@Module({
  imports: [PrismaModule],
  controllers: [ChatFeedbackController],
  providers: [ChatFeedbackService],
})
export class ChatFeedbackModule {}
