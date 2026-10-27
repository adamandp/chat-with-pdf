import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

@Injectable()
export class AiService {
  constructor(private readonly config: ConfigService) {}

  chatModel() {
    return new ChatGoogleGenerativeAI({
      apiKey: this.config.getOrThrow('GEMINI_API_KEY'),
      model: this.config.get('GEMINI_CHAT_MODEL', 'gemini-3.5-flash'),
      temperature: 0,
      maxRetries: 1,
    });
  }

  embeddings() {
    const dimensions = Number(this.config.get('EMBEDDING_DIMENSIONS', '1536'));

    return new GoogleGenerativeAIEmbeddings({
      apiKey: this.config.getOrThrow('GEMINI_API_KEY'),
      model: this.config.get('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001'),
      outputDimensionality: dimensions,
      maxRetries: 1,
    });
  }
}
