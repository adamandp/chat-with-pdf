import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { GroqService } from './groq.service';

@Module({
  providers: [GeminiService, GroqService],
  exports: [GeminiService, GroqService],
})
  
export class AiModule {}
