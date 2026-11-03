import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { WebResponse } from '../../common/common.interface';
import {
  ChatHistoryStatus,
  DocumentStatus,
  type ChatHistory,
  type Prisma,
} from '../../generated/prisma/client';
import { Messages, ErrorMessage } from '../../utils/message.helper';
import type {
  ChatHistoryContext,
  ChatDetailSourceDto,
  FindChatDetailResDto,
  PreparedChat,
  ChatSource,
  SendChatDTO,
  SendChatDoneDTO,
  SendChatEvent,
  ForkChatDTO,
  ForkChatResDTO,
  RegenerateChatDTO,
} from './chat.interface';
import { RagService } from './chat-retrieval';
import type { ToggleChatFeedbackDto } from './dto/toggle-chat-feedback.dto';

function selectSources(value: unknown): ChatDetailSourceDto[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((source: unknown) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return [];
    }

    const { documentId, pageNumber } = source as Record<string, unknown>;
    if (
      typeof documentId !== 'string' ||
      !Number.isInteger(pageNumber) ||
      (pageNumber as number) < 1
    ) {
      return [];
    }

    return [{ documentId, pageNumber: pageNumber as number }];
  });
}

type LockedSession = {
  id: string;
  title: string | null;
  answerMode: string | null;
  activeLeafMessageId: string | null;
};

type ForkMessage = Pick<
  ChatHistory,
  | 'id'
  | 'parentMessageId'
  | 'versionGroupId'
  | 'role'
  | 'content'
  | 'sources'
  | 'answerMode'
  | 'status'
>;

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

  async send(
    userId: string,
    body: SendChatDTO,
  ): Promise<Observable<SendChatEvent>> {
    // Validasi dan persistence dilakukan sebelum SSE dimulai.
    // Kalau gagal, Nest masih bisa mengembalikan HTTP 4xx.
    const prepared = await this.prepareSend(userId, body);

    return this.streamResponse(userId, prepared);
  }

  async edit(
    userId: string,
    messageId: string,
    body: SendChatDTO,
  ): Promise<Observable<SendChatEvent>> {
    return this.streamResponse(
      userId,
      await this.prepareEdit(userId, messageId, body),
    );
  }

  async regenerate(
    userId: string,
    messageId: string,
    body: RegenerateChatDTO,
  ): Promise<Observable<SendChatEvent>> {
    return this.streamResponse(
      userId,
      await this.prepareRegenerate(userId, messageId, body),
    );
  }

  async fork(
    userId: string,
    sessionId: string,
    body: ForkChatDTO,
  ): Promise<WebResponse<ForkChatResDTO>> {
    return this.prisma.$transaction(
      async (tx) => {
        const original = await this.lockSession(tx, userId, sessionId);
        const target = await tx.chatHistory.findFirst({
          where: { id: body.messageId, sessionId, deletedAt: null },
          select: { id: true, status: true },
        });
        if (!target)
          throw new NotFoundException(ErrorMessage.notFound('Chat message'));
        if (target.status !== ChatHistoryStatus.COMPLETED) {
          throw new ConflictException('Only completed messages can be forked');
        }

        const path = await tx.$queryRaw<ForkMessage[]>`
        WITH RECURSIVE ancestors AS (
          SELECT id, parent_message_id, version_group_id, role, content,
                 sources, answer_mode, status, ARRAY[id] AS visited, 0 AS depth
          FROM chat_history
          WHERE id = ${body.messageId}::uuid AND session_id = ${sessionId}::uuid
            AND deleted_at IS NULL
          UNION ALL
          SELECT h.id, h.parent_message_id, h.version_group_id, h.role, h.content,
                 h.sources, h.answer_mode, h.status, a.visited || h.id, a.depth + 1
          FROM chat_history h
          JOIN ancestors a ON h.id = a.parent_message_id
          WHERE h.session_id = ${sessionId}::uuid AND h.deleted_at IS NULL
            AND NOT (h.id = ANY(a.visited))
        )
        SELECT id, parent_message_id AS "parentMessageId",
               version_group_id AS "versionGroupId", role, content, sources,
               answer_mode AS "answerMode", UPPER(status::text) AS status
        FROM ancestors ORDER BY depth DESC
      `;
        if (!path.length || path[0].parentMessageId !== null) {
          throw new ConflictException('Cannot fork an incomplete message path');
        }

        const attached = await tx.sessionDocument.findMany({
          where: { sessionId },
          select: { documentId: true },
        });
        const documentIds = attached.map(({ documentId }) => documentId);
        if (documentIds.length) {
          const count = await tx.document.count({
            where: { id: { in: documentIds }, userId },
          });
          if (count !== documentIds.length) {
            throw new ConflictException(
              'Session contains inaccessible documents',
            );
          }
        }

        const title = `Fork → ${original.title ?? 'New Chat'}`.slice(0, 255);
        const forked = await tx.chatSession.create({
          data: {
            userId,
            title,
            answerMode: original.answerMode,
            lastMessageAt: new Date(),
          },
          select: { id: true, title: true },
        });

        const messageIds = new Map<string, string>();
        const versionGroups = new Map<string, string>();
        for (const message of path) {
          const newId = randomUUID();
          const versionGroupId =
            versionGroups.get(message.versionGroupId) ?? randomUUID();
          versionGroups.set(message.versionGroupId, versionGroupId);
          const parentMessageId = message.parentMessageId
            ? messageIds.get(message.parentMessageId)
            : null;
          if (message.parentMessageId && !parentMessageId) {
            throw new ConflictException('Invalid message parent in fork path');
          }
          await tx.chatHistory.create({
            data: {
              id: newId,
              sessionId: forked.id,
              parentMessageId,
              versionGroupId,
              role: message.role,
              content: message.content,
              sources: message.sources as Prisma.InputJsonValue,
              answerMode: message.answerMode,
              status: message.status,
            },
          });
          messageIds.set(message.id, newId);
        }

        if (attached.length) {
          await tx.sessionDocument.createMany({
            data: attached.map(({ documentId }) => ({
              sessionId: forked.id,
              documentId,
            })),
          });
        }
        await tx.chatSession.update({
          where: { id: forked.id },
          data: { activeLeafMessageId: messageIds.get(body.messageId) },
        });
        return {
          message: Messages.create('Chat session fork'),
          data: { id: forked.id, title: forked.title ?? title },
        };
      },
      { timeout: 30_000 },
    );
  }

  async activate(
    userId: string,
    messageId: string,
  ): Promise<WebResponse<{ activeLeafMessageId: string }>> {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.chatHistory.findUnique({
        where: { id: messageId },
        select: { sessionId: true, deletedAt: true },
      });
      if (!message || message.deletedAt)
        throw new NotFoundException(ErrorMessage.notFound('Chat message'));
      const session = await this.lockSession(tx, userId, message.sessionId);
      await this.assertNoGeneration(tx, session.activeLeafMessageId);
      const target = await tx.chatHistory.findFirst({
        where: { id: messageId, sessionId: session.id, deletedAt: null },
        select: { status: true },
      });
      if (!target)
        throw new NotFoundException(ErrorMessage.notFound('Chat message'));
      if (target.status !== ChatHistoryStatus.COMPLETED) {
        throw new ConflictException(
          'Only completed message versions can be activated',
        );
      }

      const [leaf] = await tx.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE descendants AS (
          SELECT id, created_at AS "createdAt", 0 AS depth, ARRAY[id] AS visited
          FROM chat_history
          WHERE id = ${messageId}::uuid AND session_id = ${session.id}::uuid
            AND deleted_at IS NULL AND status = 'completed'
          UNION ALL
          SELECT h.id, h.created_at, d.depth + 1, d.visited || h.id
          FROM chat_history h
          JOIN descendants d ON h.parent_message_id = d.id
          WHERE h.session_id = ${session.id}::uuid
            AND h.deleted_at IS NULL AND h.status = 'completed'
            AND NOT (h.id = ANY(d.visited))
        )
        SELECT id FROM descendants
        ORDER BY depth DESC, "createdAt" DESC NULLS LAST, id DESC LIMIT 1
      `;
      if (!leaf) throw new ConflictException('Selected branch is unavailable');
      await tx.chatSession.update({
        where: { id: session.id },
        data: { activeLeafMessageId: leaf.id, lastMessageAt: new Date() },
      });
      return {
        message: Messages.update('Active chat version'),
        data: { activeLeafMessageId: leaf.id },
      };
    });
  }

  async toggleFeedback(
    userId: string,
    messageId: string,
    body: ToggleChatFeedbackDto,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Lock the message row so simultaneous toggles execute sequentially.
      const [message] = await tx.$queryRaw<{ role: string; status: string }[]>`
        SELECT h.role, h.status::text AS status
        FROM chat_history h
        JOIN chat_session s ON s.id = h.session_id
        WHERE h.id = ${messageId}::uuid
          AND s.user_id = ${userId}::uuid
          AND s.deleted_at IS NULL
          AND h.deleted_at IS NULL
        FOR UPDATE OF h
      `;
      if (!message) {
        throw new NotFoundException(ErrorMessage.notFound('Chat message'));
      }
      if (
        message.role !== 'assistant' ||
        message.status.toUpperCase() !== ChatHistoryStatus.COMPLETED
      ) {
        throw new ConflictException(
          'Feedback requires a completed assistant message',
        );
      }

      const existing = await tx.chatFeedback.findUnique({
        where: { chatHistoryId: messageId },
        select: { type: true },
      });
      if (!existing) {
        await tx.chatFeedback.create({
          data: { chatHistoryId: messageId, type: body.type },
        });
      } else if (existing.type === body.type) {
        await tx.chatFeedback.delete({ where: { chatHistoryId: messageId } });
      } else {
        await tx.chatFeedback.update({
          where: { chatHistoryId: messageId },
          data: { type: body.type },
        });
      }
    });
  }

  async findOne(
    userId: string,
    id: string,
  ): Promise<WebResponse<FindChatDetailResDto>> {
    this.logger.trace({ userId, sessionId: id }, 'Finding chat session detail');

    const session = await this.prisma.chatSession.findFirst({
      where: { id, userId, deletedAt: null },
      select: {
        id: true,
        title: true,
        answerMode: true,
        createdAt: true,
        updatedAt: true,
        activeLeafMessageId: true,
        sessionDocuments: {
          orderBy: [{ createdAt: 'asc' }, { documentId: 'asc' }],
          select: {
            document: {
              select: {
                id: true,
                fileName: true,
                pageCount: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(ErrorMessage.notFound('Chat session'));
    }

    const messageIds = session.activeLeafMessageId
      ? await this.prisma.$queryRaw<{ id: string }[]>`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_message_id, ARRAY[id] AS visited, 0 AS depth
            FROM chat_history
            WHERE id = ${session.activeLeafMessageId}::uuid
              AND session_id = ${id}::uuid

            UNION ALL

            SELECT h.id, h.parent_message_id, a.visited || h.id, a.depth + 1
            FROM chat_history h
            JOIN ancestors a ON h.id = a.parent_message_id
            WHERE h.session_id = ${id}::uuid
              AND NOT (h.id = ANY(a.visited))
          )
          SELECT id FROM ancestors ORDER BY depth DESC
        `
      : [];

    const histories = messageIds.length
      ? await this.prisma.chatHistory.findMany({
          where: {
            sessionId: id,
            id: { in: messageIds.map((message) => message.id) },
            deletedAt: null,
          },
          select: {
            id: true,
            role: true,
            content: true,
            status: true,
            createdAt: true,
            sources: true,
            parentMessageId: true,
            versionGroupId: true,
            feedback: { select: { type: true } },
          },
        })
      : [];

    const versionGroups = [
      ...new Set(histories.map((history) => history.versionGroupId)),
    ];
    const versions = versionGroups.length
      ? await this.prisma.chatHistory.findMany({
          where: {
            sessionId: id,
            deletedAt: null,
            versionGroupId: { in: versionGroups },
          },
          select: {
            id: true,
            versionGroupId: true,
            status: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : [];
    const versionsByGroup = new Map<string, typeof versions>();
    for (const version of versions) {
      const group = versionsByGroup.get(version.versionGroupId) ?? [];
      group.push(version);
      versionsByGroup.set(version.versionGroupId, group);
    }

    const historiesById = new Map(
      histories.map((message) => [message.id, message]),
    );
    const messages = messageIds.flatMap(({ id: messageId }) => {
      const message = historiesById.get(messageId);
      if (!message) return [];

      return [
        {
          id: message.id,
          role: message.role,
          content: message.content,
          status: message.status,
          createdAt: message.createdAt,
          parentMessageId: message.parentMessageId,
          versionGroupId: message.versionGroupId,
          versionCount: (versionsByGroup.get(message.versionGroupId) ?? [])
            .length,
          versions: (versionsByGroup.get(message.versionGroupId) ?? []).map(
            (version) => ({
              id: version.id,
              status: version.status,
              createdAt: version.createdAt,
              active: version.id === message.id,
            }),
          ),
          sources:
            message.role === 'assistant' ? selectSources(message.sources) : [],
          feedback:
            message.role === 'assistant'
              ? (message.feedback?.type ?? null)
              : null,
        },
      ];
    });

    return {
      message: Messages.get('Chat session'),
      data: {
        id: session.id,
        title: session.title,
        answerMode: session.answerMode,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        activeLeafMessageId: session.activeLeafMessageId,
        documents: session.sessionDocuments.map(({ document }) => document),
        messages,
      },
    };
  }

  private async prepareSend(
    userId: string,
    body: SendChatDTO,
  ): Promise<PreparedChat> {
    const model = this.config.getOrThrow<string>('GROQ_CHAT_MODEL');

    return this.prisma.$transaction(async (tx) => {
      let session: Pick<LockedSession, 'id' | 'activeLeafMessageId'>;

      if (body.sessionId) {
        session = await this.lockSession(tx, userId, body.sessionId);
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

      await this.assertNoGeneration(tx, session.activeLeafMessageId);

      // Synchronize documents w session document
      const documentIds = body.documentIds ?? [];
      await this.attachDocuments(tx, userId, session.id, documentIds);

      // Get history for context
      const history = await this.getHistory(
        tx,
        session.id,
        session.activeLeafMessageId,
      );

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

      const { assistantId, completionId } = await this.createStreamingAssistant(
        tx,
        {
          sessionId: session.id,
          parentMessageId: userMessage.id,
          answerMode: body.answerMode,
          model,
        },
      );

      await tx.chatSession.update({
        where: { id: session.id },
        data: {
          answerMode: body.answerMode,
          activeLeafMessageId: assistantId,
          lastMessageAt: new Date(),
        },
        select: { id: true },
      });

      return {
        sessionId: session.id,
        assistantId,
        completionId,
        documentIds,
        history,
        model,
        question: body.question,
        answerMode: body.answerMode,
        mode: body.mode,
      };
    });
  }

  private async prepareEdit(
    userId: string,
    messageId: string,
    body: SendChatDTO,
  ): Promise<PreparedChat> {
    if (!body.sessionId)
      throw new BadRequestException('sessionId is required for editing');
    const model = this.config.getOrThrow<string>('GROQ_CHAT_MODEL');
    return this.prisma.$transaction(async (tx) => {
      const session = await this.lockSession(tx, userId, body.sessionId!);
      await this.assertNoGeneration(tx, session.activeLeafMessageId);
      const original = await tx.chatHistory.findFirst({
        where: { id: messageId, sessionId: session.id, deletedAt: null },
        select: {
          role: true,
          status: true,
          parentMessageId: true,
          versionGroupId: true,
        },
      });
      if (!original)
        throw new NotFoundException(ErrorMessage.notFound('Chat message'));
      if (
        original.role !== 'user' ||
        original.status !== ChatHistoryStatus.COMPLETED
      ) {
        throw new ConflictException(
          'Only completed user messages can be edited',
        );
      }
      const documentIds = body.documentIds ?? [];
      const answerMode = body.answerMode ?? 'general';
      await this.attachDocuments(tx, userId, session.id, documentIds);

      const history = await this.getHistory(
        tx,
        session.id,
        original.parentMessageId,
      );
      const editedUser = await tx.chatHistory.create({
        data: {
          sessionId: session.id,
          parentMessageId: original.parentMessageId,
          versionGroupId: original.versionGroupId,
          role: 'user',
          content: body.question,
          answerMode,
          status: ChatHistoryStatus.COMPLETED,
        },
        select: { id: true },
      });
      const { assistantId, completionId } = await this.createStreamingAssistant(
        tx,
        {
          sessionId: session.id,
          parentMessageId: editedUser.id,
          answerMode,
          model,
        },
      );
      await tx.chatSession.update({
        where: { id: session.id },
        data: {
          answerMode,
          activeLeafMessageId: assistantId,
          lastMessageAt: new Date(),
        },
      });
      return {
        sessionId: session.id,
        assistantId,
        completionId,
        question: body.question,
        answerMode,
        mode: body.mode,
        documentIds,
        history,
        model,
        previousActiveLeafMessageId: session.activeLeafMessageId,
      };
    });
  }

  private async prepareRegenerate(
    userId: string,
    messageId: string,
    body: RegenerateChatDTO,
  ): Promise<PreparedChat> {
    const model = this.config.getOrThrow<string>('GROQ_CHAT_MODEL');
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.chatHistory.findUnique({
        where: { id: messageId },
        select: { sessionId: true, deletedAt: true },
      });
      if (!message || message.deletedAt) {
        throw new NotFoundException(ErrorMessage.notFound('Chat message'));
      }
      const session = await this.lockSession(tx, userId, message.sessionId);
      await this.assertNoGeneration(tx, session.activeLeafMessageId);

      const original = await tx.chatHistory.findFirst({
        where: { id: messageId, sessionId: session.id, deletedAt: null },
        select: {
          role: true,
          status: true,
          parentMessageId: true,
          versionGroupId: true,
          answerMode: true,
        },
      });
      if (!original)
        throw new NotFoundException(ErrorMessage.notFound('Chat message'));
      if (
        original.role !== 'assistant' ||
        original.status !== ChatHistoryStatus.COMPLETED
      ) {
        throw new ConflictException(
          'Only completed assistant messages can be regenerated',
        );
      }
      const question = original.parentMessageId
        ? await tx.chatHistory.findFirst({
            where: {
              id: original.parentMessageId,
              sessionId: session.id,
              deletedAt: null,
            },
            select: {
              content: true,
              role: true,
              status: true,
              parentMessageId: true,
              answerMode: true,
            },
          })
        : null;
      if (
        !question ||
        question.role !== 'user' ||
        question.status !== ChatHistoryStatus.COMPLETED
      ) {
        throw new ConflictException('Original user question is unavailable');
      }

      const attached = await tx.sessionDocument.findMany({
        where: {
          sessionId: session.id,
          document: { userId, deletedAt: null, status: DocumentStatus.READY },
        },
        select: { documentId: true },
      });
      const documentIds = attached.map(({ documentId }) => documentId);
      const answerMode =
        original.answerMode ??
        question.answerMode ??
        session.answerMode ??
        'general';
      if (answerMode !== 'general' && answerMode !== 'document_only') {
        throw new BadRequestException(
          'Unsupported answer mode on original message',
        );
      }
      const history = await this.getHistory(
        tx,
        session.id,
        question.parentMessageId,
      );
      const { assistantId, completionId } = await this.createStreamingAssistant(
        tx,
        {
          sessionId: session.id,
          parentMessageId: original.parentMessageId,
          versionGroupId: original.versionGroupId,
          answerMode,
          model,
        },
      );
      await tx.chatSession.update({
        where: { id: session.id },
        data: { activeLeafMessageId: assistantId, lastMessageAt: new Date() },
      });
      return {
        sessionId: session.id,
        assistantId,
        completionId,
        documentIds,
        history,
        model,
        question: question.content,
        answerMode,
        mode: body.mode,
        // On failure restore the branch that was active before regeneration,
        // not necessarily the assistant selected for regeneration.
        previousActiveLeafMessageId: session.activeLeafMessageId,
      };
    });
  }

  private async lockSession(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string,
  ): Promise<LockedSession> {
    const [session] = await tx.$queryRaw<LockedSession[]>`
      SELECT id, title, answer_mode AS "answerMode",
             active_leaf_message_id AS "activeLeafMessageId"
      FROM chat_session
      WHERE id = ${sessionId}::uuid
        AND user_id = ${userId}::uuid
        AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (!session)
      throw new NotFoundException(ErrorMessage.notFound('Chat session'));
    return session;
  }

  private async assertNoGeneration(
    tx: Prisma.TransactionClient,
    activeLeafMessageId: string | null,
  ): Promise<void> {
    if (!activeLeafMessageId) return;
    const active = await tx.chatHistory.findUnique({
      where: { id: activeLeafMessageId },
      select: { status: true },
    });
    if (active?.status === ChatHistoryStatus.STREAMING) {
      throw new ConflictException('Chat generation already in progress');
    }
  }

  private async validateDocuments(
    tx: Prisma.TransactionClient,
    userId: string,
    documentIds: string[],
  ): Promise<void> {
    if (!documentIds.length) return;
    const unique = [...new Set(documentIds)];
    const count = await tx.document.count({
      where: {
        id: { in: unique },
        userId,
        deletedAt: null,
        status: DocumentStatus.READY,
      },
    });
    if (count !== unique.length) {
      throw new NotFoundException(ErrorMessage.notFound('Ready document'));
    }
  }

  private async attachDocuments(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string,
    documentIds: string[],
  ): Promise<void> {
    await this.validateDocuments(tx, userId, documentIds);
    if (!documentIds.length) return;

    await tx.sessionDocument.createMany({
      data: [...new Set(documentIds)].map((documentId) => ({
        sessionId,
        documentId,
      })),
      skipDuplicates: true,
    });
  }

  private async getHistory(
    tx: Prisma.TransactionClient,
    sessionId: string,
    leafId: string | null,
  ): Promise<ChatHistoryContext[]> {
    if (!leafId) return [];
    return tx.$queryRaw<ChatHistoryContext[]>`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_message_id, role, content, status, 0 AS depth
        FROM chat_history
        WHERE id = ${leafId}::uuid AND session_id = ${sessionId}::uuid
        UNION ALL
        SELECT h.id, h.parent_message_id, h.role, h.content, h.status, a.depth + 1
        FROM chat_history h
        JOIN ancestors a ON h.id = a.parent_message_id
        WHERE h.session_id = ${sessionId}::uuid AND a.depth < 9
      )
      SELECT role, content FROM ancestors
      WHERE status = 'completed' AND role IN ('user', 'assistant')
      ORDER BY depth DESC
    `;
  }

  private async createStreamingAssistant(
    tx: Prisma.TransactionClient,
    input: {
      sessionId: string;
      parentMessageId: string | null;
      versionGroupId?: string;
      answerMode: SendChatDTO['answerMode'];
      model: string;
    },
  ): Promise<{ assistantId: string; completionId: string }> {
    const assistant = await tx.chatHistory.create({
      data: {
        sessionId: input.sessionId,
        parentMessageId: input.parentMessageId,
        versionGroupId: input.versionGroupId,
        role: 'assistant',
        content: '',
        answerMode: input.answerMode,
        status: ChatHistoryStatus.STREAMING,
      },
      select: { id: true },
    });
    const completion = await tx.completion.create({
      data: {
        chatHistoryId: assistant.id,
        model: input.model,
        provider: 'groq',
        status: ChatHistoryStatus.STREAMING,
      },
      select: { id: true },
    });

    return { assistantId: assistant.id, completionId: completion.id };
  }

  private streamResponse(
    userId: string,
    prepared: PreparedChat,
  ): Observable<SendChatEvent> {
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
            question: prepared.question,
            documentIds: prepared.documentIds,
            answerMode: prepared.answerMode,
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
            mode: prepared.mode,
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
            await this.prisma.$transaction(async (tx) => {
              await tx.chatHistory.update({
                where: { id: prepared.assistantId },
                data: {
                  status,
                  content: answer,
                  sources: sources as unknown as Prisma.InputJsonValue,
                },
              });
              await tx.completion.update({
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
              });
              if (prepared.previousActiveLeafMessageId !== undefined) {
                await tx.chatSession.updateMany({
                  where: {
                    id: prepared.sessionId,
                    activeLeafMessageId: prepared.assistantId,
                  },
                  data: {
                    activeLeafMessageId: prepared.previousActiveLeafMessageId,
                  },
                });
              }
            });
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
