import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Observable } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChatHistoryStatus, type Prisma } from '../../generated/prisma/client';
import type {
  ChatHistoryContext,
  PreparedChat,
  ChatSource,
  SendChatDTO,
  SendChatDoneDTO,
  SendChatEvent,
} from './chat.interface';
import { RagService } from './chat-retrieval';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChatService.name);
  }

  private async prepare(
    userId: string,
    body: SendChatDTO,
  ): Promise<PreparedChat> {
    const model = this.config.getOrThrow<string>('GROQ_CHAT_MODEL');

    // Validate Document mode
    if (body.answerMode === 'document_only' && !body.documentIds?.length) {
      throw new BadRequestException(
        'Document mode requires at least one document',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let session: {
        id: string;
        activeLeafMessageId: string | null;
      };

      // Validate session
      if (body.sessionId) {
        // Lock session
        const [locked] = await tx.$queryRaw<(typeof session)[]>`
          SELECT id, active_leaf_message_id AS "activeLeafMessageId"
          FROM chat_session
          WHERE id = ${body.sessionId}::uuid
            AND user_id = ${userId}::uuid
            AND deleted_at IS NULL
          FOR UPDATE
        `;

        // Check if session exists
        if (!locked) {
          throw new NotFoundException('Chat session not found');
        }

        session = locked;
      } else {
        // Create new session
        session = await tx.chatSession.create({
          data: {
            userId,
            title: body.question.slice(0, 100),
            answerMode: body.answerMode,
          },
          select: {
            id: true,
            activeLeafMessageId: true,
          },
        });
      }

      // Check if chat generation already in progress
      if (session.activeLeafMessageId) {
        // Check if chat generation already in progress
        const active = await tx.chatHistory.findUnique({
          where: { id: session.activeLeafMessageId },
          select: { status: true },
        });

        // Throw if chat generation already in progress
        if (active?.status === ChatHistoryStatus.STREAMING) {
          throw new ConflictException('Chat generation already in progress');
        }
      }

      // Synchronize documents w session document
      const documentIds = body.documentIds ?? [];

      if (documentIds.length) {
        await tx.sessionDocument.createMany({
          data: documentIds.map((documentId) => ({
            documentId,
            sessionId: session.id,
          })),
          skipDuplicates: true,
        });
      }

      // Get history for context
      const history: ChatHistoryContext[] = session.activeLeafMessageId
        ? await tx.$queryRaw<ChatHistoryContext[]>`
              WITH RECURSIVE ancestors AS (
                SELECT
                  id, parent_message_id, role,
                  content, status, 0 AS depth
                FROM chat_history
                WHERE id = ${session.activeLeafMessageId}::uuid
                  AND session_id = ${session.id}::uuid

                UNION ALL

                SELECT
                  h.id, h.parent_message_id, h.role,
                  h.content, h.status, a.depth + 1
                FROM chat_history h
                JOIN ancestors a
                  ON h.id = a.parent_message_id
                WHERE h.session_id = ${session.id}::uuid
                  AND a.depth < 9
              )
              SELECT role, content
              FROM ancestors
              WHERE status = 'completed'
                AND role IN ('user', 'assistant')
              ORDER BY depth DESC
            `
        : [];

      const userMessage = await tx.chatHistory.create({
        data: {
          sessionId: session.id,
          parentMessageId: session.activeLeafMessageId,
          role: 'user',
          content: body.question,
          answerMode: body.answerMode,
          status: ChatHistoryStatus.COMPLETED,
        },
        select: { id: true },
      });

      const assistant = await tx.chatHistory.create({
        data: {
          sessionId: session.id,
          parentMessageId: userMessage.id,
          role: 'assistant',
          content: '',
          answerMode: body.answerMode,
          status: ChatHistoryStatus.STREAMING,
        },
        select: { id: true },
      });

      const completion = await tx.completion.create({
        data: {
          chatHistoryId: assistant.id,
          model,
          provider: 'groq',
          status: ChatHistoryStatus.STREAMING,
        },
        select: { id: true },
      });

      await tx.chatSession.update({
        where: { id: session.id },
        data: {
          answerMode: body.answerMode,
          activeLeafMessageId: assistant.id,
          lastMessageAt: new Date(),
        },
        select: { id: true },
      });

      return {
        sessionId: session.id,
        assistantId: assistant.id,
        completionId: completion.id,
        documentIds,
        history,
        model,
      };
    });
  }

  async send(
    userId: string,
    body: SendChatDTO,
  ): Promise<Observable<SendChatEvent>> {
    // Validasi dan persistence dilakukan sebelum SSE dimulai.
    // Kalau gagal, Nest masih bisa mengembalikan HTTP 4xx.
    const prepared = await this.prepare(userId, body);

    return new Observable<SendChatEvent>((subscriber) => {
      const abort = new AbortController();
      const startedAt = Date.now();

      let answer = '';
      let sources: ChatSource[] = [];
      let firstTokenMs: number | null = null;

      subscriber.next({
        type: 'started',
        data: {
          id: prepared.assistantId,
          sessionId: prepared.sessionId,
          status: 'streaming',
        },
      });

      void (async () => {
        try {
          const result = await this.rag.run({
            userId,
            question: body.question,
            documentIds: prepared.documentIds,
            answerMode: body.answerMode,
            history: prepared.history,
            model: prepared.model,
            signal: abort.signal,

            onSources: (value) => {
              sources = value;

              if (!subscriber.closed) {
                subscriber.next({
                  type: 'sources',
                  data: { sources: value },
                });
              }
            },

            onToken: (content) => {
              firstTokenMs ??= Date.now() - startedAt;
              answer += content;

              if (!subscriber.closed) {
                subscriber.next({
                  type: 'token',
                  data: { content },
                });
              }
            },
          });

          abort.signal.throwIfAborted();

          await this.prisma.$transaction([
            this.prisma.chatHistory.update({
              where: { id: prepared.assistantId },
              data: {
                status: ChatHistoryStatus.COMPLETED,
                content: answer,
                sources: sources as unknown as Prisma.InputJsonValue,
              },
            }),
            this.prisma.completion.update({
              where: { id: prepared.completionId },
              data: {
                status: ChatHistoryStatus.COMPLETED,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                totalTokens: result.totalTokens,
                latencyMs: Date.now() - startedAt,
                timeToFirstTokenMs: firstTokenMs,
                completedAt: new Date(),
              },
            }),
          ]);

          const done: SendChatDoneDTO = {
            id: prepared.assistantId,
            sessionId: prepared.sessionId,
            status: 'completed',
            content: answer,
            sources,
            mode: body.mode,
          };

          if (!subscriber.closed) {
            subscriber.next({
              type: 'done',
              data: done,
            });
            subscriber.complete();
          }
        } catch (error) {
          const status = abort.signal.aborted
            ? ChatHistoryStatus.CANCELLED
            : ChatHistoryStatus.FAILED;

          this.logger.error(
            { err: error, messageId: prepared.assistantId },
            'Chat generation failed',
          );

          try {
            await this.prisma.$transaction([
              this.prisma.chatHistory.update({
                where: { id: prepared.assistantId },
                data: {
                  status,
                  content: answer,
                  sources: sources as unknown as Prisma.InputJsonValue,
                },
              }),
              this.prisma.completion.update({
                where: { id: prepared.completionId },
                data: {
                  status,
                  errorMessage:
                    error instanceof Error
                      ? error.message.slice(0, 2000)
                      : 'Unknown error',
                  latencyMs: Date.now() - startedAt,
                  timeToFirstTokenMs: firstTokenMs,
                  completedAt: new Date(),
                },
              }),
            ]);
          } catch (persistError) {
            this.logger.error(
              { err: persistError },
              'Failed to persist chat failure',
            );
          }

          if (!subscriber.closed) {
            subscriber.next({
              type: 'error',
              data: {
                messageId: prepared.assistantId,
                message: 'Chat generation failed',
              },
            });
            subscriber.complete();
          }
        }
      })();

      // NestJS unsubscribe ketika SSE selesai/client disconnect.
      return () => abort.abort();
    });
  }
}
