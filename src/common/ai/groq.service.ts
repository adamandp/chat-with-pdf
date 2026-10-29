import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGroq } from '@langchain/groq';

@Injectable()
export class GroqService {
  private chat?: ChatGroq;

  constructor(private readonly config: ConfigService) {}

  chatModel() {
    return (this.chat ??= new ChatGroq({
      apiKey: this.config.getOrThrow('GROQ_API_KEY'),
      model: this.config.get('GROQ_CHAT_MODEL'),
      maxRetries: 1,
    }));
  }
}