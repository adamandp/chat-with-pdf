import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { VectorService } from '../documents/vector.service';
import { ChatModelService } from './chat-model.service';
import { buildChatGraph } from './chat.graph';
import type { CreateChatDto } from './dto/create-chat.dto';
import type { ChatState } from './chat.interface';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vectors: VectorService,
    private readonly model: ChatModelService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChatService.name);
  }
  async create(userId: string, body: CreateChatDto) {
    const ids = [...new Set(body.document_ids)];
    const docs = await this.prisma.document.findMany({
      where: { id: { in: ids }, userId, deletedAt: null },
    });
    if (docs.length !== ids.length)
      throw new NotFoundException('Document not found');
    if (docs.some((d) => d.status !== 'ready'))
      throw new ConflictException(
        'All documents must be ready before chatting',
      );
    const sid = body.conversation_id ?? randomUUID();
    let parent: string | null = null;
    if (body.conversation_id) {
      const session = await this.prisma.chatSession.findFirst({
        where: { id: sid, userId, deletedAt: null },
      });
      if (!session) throw new NotFoundException('Conversation not found');
      parent = session.activeLeafMessageId;
    }
    const history = await this.prisma.$queryRaw<
      ChatState['history']
    >`WITH RECURSIVE branch AS (
      SELECT id,parent_message_id,role,content,1 AS depth FROM chat_history
      WHERE id=${parent}::uuid AND session_id=${sid}::uuid AND deleted_at IS NULL
      UNION ALL SELECT h.id,h.parent_message_id,h.role,h.content,b.depth+1
      FROM chat_history h JOIN branch b ON h.id=b.parent_message_id
      WHERE h.session_id=${sid}::uuid AND h.deleted_at IS NULL AND b.depth<10
    ) SELECT role,left(content,8000) AS content FROM branch ORDER BY depth DESC`;
    let result: ChatState;
    try {
      result = await buildChatGraph(this.model, (u, d, q) =>
        this.vectors.search(u, d, q),
      ).invoke(
        {
          question: body.question,
          query: body.question,
          userId,
          documentIds: ids,
          history,
          chunks: [],
          attempts: 0,
          enough: false,
          answer: '',
          sources: [],
        },
        { recursionLimit: 16, signal: AbortSignal.timeout(110000) },
      );
    } catch (error) {
      this.logger.error(
        { errorType: error instanceof Error ? error.name : 'Unknown' },
        'Chat generation failed',
      );
      throw new ServiceUnavailableException(
        'Chat generation failed; try again later',
      );
    }
    const userMessage = randomUUID(),
      assistantMessage = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const available = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM documents
        WHERE id IN (${Prisma.join(ids)}) AND user_id=${userId}::uuid AND deleted_at IS NULL AND status='ready' FOR SHARE`;
      if (available.length !== ids.length)
        throw new ConflictException('Document availability changed; try again');
      if (body.conversation_id) {
        const current = await tx.$queryRaw<
          { active_leaf_message_id: string | null }[]
        >`SELECT active_leaf_message_id FROM chat_session
          WHERE id=${sid}::uuid AND user_id=${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
        if (!current.length)
          throw new NotFoundException('Conversation not found');
        if (current[0].active_leaf_message_id !== parent)
          throw new ConflictException(
            'Conversation changed; retry your question',
          );
      } else
        await tx.chatSession.create({
          data: { id: sid, userId, title: body.question.slice(0, 255) },
        });
      await tx.sessionDocument.createMany({
        data: ids.map((documentId) => ({ sessionId: sid, documentId })),
        skipDuplicates: true,
      });
      await tx.chatHistory.create({
        data: {
          id: userMessage,
          sessionId: sid,
          parentMessageId: parent,
          versionGroupId: userMessage,
          role: 'user',
          content: body.question,
          status: 'completed',
          answerMode: 'document_only',
          sources: [],
        },
      });
      await tx.chatHistory.create({
        data: {
          id: assistantMessage,
          sessionId: sid,
          parentMessageId: userMessage,
          versionGroupId: assistantMessage,
          role: 'assistant',
          content: result.answer,
          status: 'completed',
          answerMode: 'document_only',
          sources: result.sources as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.chatSession.update({
        where: { id: sid },
        data: {
          activeLeafMessageId: assistantMessage,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });
    return {
      data: {
        conversation_id: sid,
        message_id: assistantMessage,
        answer: result.answer,
        sources: result.sources,
        search_attempts: result.attempts,
        context_sufficient: result.enough,
      },
    };
  }
}
