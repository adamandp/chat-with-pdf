import { randomUUID } from 'node:crypto';
import { chatRequestContext } from './chat-request-log';
import {
  Injectable,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { VectorService } from '../documents/processing/vector.service';
import { ChatModelService } from './chat-model.service';
import { ChatRepository } from './chat.repository';
import { traceChatOperation } from './chat-trace';
import { buildChatGraph } from './chat.graph';
import { runDirectChat } from './chat-direct';
import { withChatDeadline } from './chat-deadline';
import { isRateLimitError, chatErrorDetails } from './chat.errors';
import type { CreateChatDto } from './dto/create-chat.dto';
import type { ChatState, ChatProgress } from './chat.interface';

@Injectable()
export class ChatService {
  private readonly graph: ReturnType<typeof buildChatGraph>;

  constructor(
    private readonly repository: ChatRepository,
    private readonly vectors: VectorService,
    private readonly model: ChatModelService,
    private readonly logger: PinoLogger,
    private readonly config: ConfigService,
  ) {
    this.logger.setContext(ChatService.name);
    // Compile once; every invocation carries its own isolated state.
    this.graph = buildChatGraph(
      model,
      (userId, ids, query) => traceChatOperation(
        this.logger,
        {
          operation: 'retrieve',
          documentCount: ids.length,
          queryCharacters: query.length,
        },
        () => vectors.search(
          userId,
          ids,
          query,
        ),
      ),
    );
  }

  async create(
    userId: string,
    body: CreateChatDto,
    onProgress?: (progress: ChatProgress) => void,
    signal?: AbortSignal,
  ) {
    const ids = [...new Set(body.document_ids)];

    const mode = body.mode ?? 'quick';

    const { sessionId, parent, history } = await traceChatOperation(
      this.logger,
      {
        operation: 'load_context',
        documentCount: ids.length,
      },
      () => this.repository.prepare(
        userId,
        ids,
        body.session_id,
        mode,
      ),
    );

    const generationSignal = signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(110_000),
        ])
      : AbortSignal.timeout(110_000);

    let result: ChatState = {
      question: body.question,
      standaloneQuestion: body.question,
      query: body.question,
      userId,
      documentIds: ids,
      history,
      chunks: [],
      attempts: 0,
      enough: false,
      answer: '',
      sources: [],
    };

    let stage: ChatProgress['stage'] = 'preparing';

    const reportProgress = (progress: ChatProgress) => {
      stage = progress.stage;
      this.logger.trace(
        {
          event: 'stage_started',
          stage,
          sessionId,
          attempt: progress.attempt,
          chunks: result.chunks.length,
          enough: result.enough,
        },
        'Chat progress',
      );
      onProgress?.(progress);
    };

    await chatRequestContext.run(
      {
        sessionId,
        turnId: randomUUID(),
        mode,
      },
      async () => {
        try {
          generationSignal.throwIfAborted();
          reportProgress(
            {
              stage: 'preparing',
              message: 'Memahami pertanyaan dan konteks percakapan.',
            },
          );

          if (mode !== 'ultra') {
            result = await withChatDeadline(
              (callSignal) => runDirectChat(
                result,
                mode,
                this.model,
                (user, documents, query, limit) => traceChatOperation(
                  this.logger,
                  {
                    operation: 'retrieve',
                    mode,
                    documentCount: documents.length,
                    queryCharacters: query.length,
                    limit,
                  },
                  () => this.vectors.search(
                    user,
                    documents,
                    query,
                    limit,
                  ),
                ),
                reportProgress,
                callSignal,
              ),
              generationSignal,
              110_000,
            );
          } else {
            const updates = await this.graph.stream(
              result,
              {
                streamMode: 'updates',
                recursionLimit: 16,
                signal: generationSignal,
              },
            );

            for await (const update of updates) {
              for (const [
                node,
                state,
              ] of Object.entries(update)) {
                result = {
                  ...result,
                  ...state,
                };

                if (node === 'prepare') {
                  reportProgress(
                    {
                      stage: 'searching',
                      message: 'Mencari informasi di dokumen.',
                      attempt: 1,
                    },
                  );
                } else if (node === 'search') {
                  reportProgress(result.chunks.length
                    ? {
                        stage: 'evaluating',
                        message: 'Memeriksa kecukupan informasi.',
                        attempt: result.attempts,
                      }
                    : {
                        stage: 'answering',
                        message: 'Menyiapkan jawaban dari hasil pencarian.',
                      });
                } else if (node === 'evaluate') {
                  reportProgress(result.enough || result.attempts >= 3
                    ? {
                        stage: 'answering',
                        message: 'Menyusun jawaban dan sumber.',
                      }
                    : {
                        stage: 'searching',
                        message: 'Mencari informasi tambahan.',
                        attempt: result.attempts + 1,
                      });
                }
              }
            }
          }

          generationSignal.throwIfAborted();
        } catch (error) {
          this.logger.error(
            {
              errorType: error instanceof Error ? error.name : 'Unknown',
              stage,
              mode,
              searchAttempts: result.attempts,
              chatModel: this.config.get(
                'GEMINI_CHAT_MODEL',
                'gemini-3.5-flash',
              ),
              embeddingModel: this.config.get(
                'GEMINI_EMBEDDING_MODEL',
                'gemini-embedding-001',
              ),
              errors: chatErrorDetails(
                error,
                this.config.get<string>(
                  'GEMINI_API_KEY',
                ),
              ),
            },
            'Chat generation failed',
          );

          if ((error instanceof Error && error.name === 'TimeoutError')
            || generationSignal.reason?.name === 'TimeoutError') {
            throw new HttpException(
              'Layanan AI terlalu lama merespons. Silakan coba lagi.',
              HttpStatus.GATEWAY_TIMEOUT,
            );
          }

          if (isRateLimitError(error)) {
            throw new HttpException(
              'Batas pemakaian atau kuota layanan AI tercapai. Coba lagi nanti; jika berlanjut, periksa kuota provider.',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }

          throw new ServiceUnavailableException(
            'Chat generation failed; try again later',
          );
        }
      },
    );

    reportProgress({
      stage: 'saving',
      message: 'Menyimpan percakapan.',
    });
    signal?.throwIfAborted();

    // Model calls run outside the transaction; save checks for concurrent changes.
    const messageId = await traceChatOperation(
      this.logger,
      {
        operation: 'save',
        sessionId,
      },
      () => this.repository.save({
        userId,
        documentIds: ids,
        question: body.question,
        existingSessionId: body.session_id,
        sessionId,
        parent,
        result,
      }),
    );

    return {
      data: {
        mode,
        session_id: sessionId,
        message_id: messageId,
        answer: result.answer,
        sources: result.sources,
        search_attempts: result.attempts,
        context_sufficient: mode === 'ultra' || !result.chunks.length ? result.enough : null,
      },
    };
  }
}
