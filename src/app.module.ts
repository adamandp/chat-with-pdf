import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { ChatSessionModule } from './model/chat-session/chat-session.module';
import { AuthModule } from './model/auth/auth.module';
import { HealthModule } from './model/health/health.module';
import { DocumentsModule } from './model/documents/documents.module';
import { DocumentUploadModule } from './model/document-upload/document-upload.module';
import { ChatModule } from './model/chat/chat.module';
import { ChatFeedbackModule } from './model/chat-feedback/chat-feedback.module';

@Module({
  imports: [
    CommonModule,
    HealthModule,
    ChatSessionModule,
    AuthModule,
    DocumentsModule,
    DocumentUploadModule,
    ChatModule,
    ChatFeedbackModule,
  ],
})
export class AppModule {}
