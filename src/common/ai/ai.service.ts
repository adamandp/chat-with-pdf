import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

@Injectable()
export class AiService {
  constructor(private readonly config: ConfigService) {}

  chatModel(thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH') {
    return new ChatGoogleGenerativeAI({
      apiKey: this.config.getOrThrow('GEMINI_API_KEY'),
      model: this.config.get('GEMINI_CHAT_MODEL', 'gemini-3.5-flash'),
      baseUrl: this.config.get<string>('GEMINI_CHAT_BASE_URL'),
      temperature: 0,
      maxRetries: 1,
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
    });
  }

  embeddings() {
    const dimensions = Number(this.config.get('EMBEDDING_DIMENSIONS', '1536'));

    return new GoogleGenerativeAIEmbeddings({
      apiKey: this.config.getOrThrow('GEMINI_API_KEY'),
      model: this.config.get('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001'),
      outputDimensionality: dimensions,
      baseUrl: this.config.get<string>('GEMINI_EMBEDDING_BASE_URL'),
      maxRetries: 1,
    });
  }
}
