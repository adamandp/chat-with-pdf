import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

@Injectable()
export class GeminiService {
  constructor(private readonly config: ConfigService) { }

  chatModel() {
    return new ChatGoogleGenerativeAI({
      apiKey: this.config.getOrThrow('GEMINI_API_KEY'),
      model: this.config.get('GEMINI_CHAT_MODEL'),
    });
  }

  embeddings() {
    return new GoogleGenerativeAIEmbeddings({
      apiKey: this.config.getOrThrow('GEMINI_API_KEY'),
      model: this.config.get('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001'),
      outputDimensionality: 1536,
      baseUrl: this.config.get<string>('GEMINI_EMBEDDING_BASE_URL'),
      maxRetries: 1,
    });
  }
}
