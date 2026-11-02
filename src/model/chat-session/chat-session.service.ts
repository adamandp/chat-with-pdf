import { PinoLogger } from 'nestjs-pino';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Messages, ErrorMessage } from '../../utils/message.helper';

import type { WebResponse } from '../../common/common.interface';
import type { PaginationDto } from '../../common/common.dto';
import type { UpdateChatSessionDto } from './dto/update-chat-session.dto';
import type {
  FindAllChatSessionResDto,
  FindChatsResDto,
  UpdateChatSessionResDto,
} from './chat-session.interface';

@Injectable()
export class ChatSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChatSessionService.name);
  }

  async findAll(
    userId: string,
    { page, limit }: PaginationDto,
  ): Promise<WebResponse<FindAllChatSessionResDto>> {
    this.logger.trace({ userId, page, limit }, 'Finding active chat sessions');

    const where = { userId, deletedAt: null };

    const [data, totalItems] = await this.prisma.$transaction([
      this.prisma.chatSession.findMany({
        where,
        select: { id: true, title: true, updatedAt: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.chatSession.count({ where }),
    ]);

    return {
      message: Messages.get('Chat sessions'),
      data,
      paging: {
        currentPage: page,
        pageSize: limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      },
    };
  }

  async findDeleted(
    userId: string,
    { page, limit }: PaginationDto,
  ): Promise<WebResponse<FindAllChatSessionResDto>> {
    this.logger.trace({ userId, page, limit }, 'Finding deleted chat sessions');

    const where = { userId, deletedAt: { not: null } };

    const [data, totalItems] = await this.prisma.$transaction([
      this.prisma.chatSession.findMany({
        where,
        select: { id: true, title: true, updatedAt: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.chatSession.count({ where }),
    ]);

    return {
      message: Messages.get('Deleted chat sessions'),
      data,
      paging: {
        currentPage: page,
        pageSize: limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      },
    };
  }

  async findChats(
    userId: string,
    id: string,
  ): Promise<WebResponse<FindChatsResDto>> {
    this.logger.trace(
      { userId, sessionId: id },
      'Finding chat session messages',
    );

    const session = await this.prisma.chatSession.findFirst({
      where: { id, userId, deletedAt: null },
      include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });

    if (!session) {
      this.logger.warn(
        { userId, sessionId: id },
        'Active chat session not found',
      );
      throw new NotFoundException(ErrorMessage.notFound('Chat session'));
    }
    return {
      message: Messages.get('Chat session messages'),
      data: session.messages,
    };
  }

  async update(
    userId: string,
    id: string,
    { title }: UpdateChatSessionDto,
  ): Promise<WebResponse<UpdateChatSessionResDto>> {
    this.logger.trace({ userId, sessionId: id }, 'Updating chat session');
    const sessions = await this.prisma.chatSession.updateManyAndReturn({
      where: { id, userId, deletedAt: null },
      data: { title, updatedAt: new Date() },
    });
    if (!sessions.length) {
      this.logger.warn(
        { userId, sessionId: id },
        'Active chat session not found',
      );
      throw new NotFoundException(ErrorMessage.notFound('Chat session'));
    }
    this.logger.info({ userId, sessionId: id }, 'Chat session updated');
    return {
      message: Messages.update('Chat session'),
      data: {
        id: sessions[0].id,
        title: sessions[0].title,
        updatedAt: sessions[0].updatedAt,
      },
    };
  }

  async remove(
    userId: string,
    id: string,
  ): Promise<WebResponse<UpdateChatSessionResDto>> {
    this.logger.trace({ userId, sessionId: id }, 'Soft-deleting chat session');
    const sessions = await this.prisma.chatSession.updateManyAndReturn({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date(), updatedAt: new Date() },
    });
    if (!sessions.length) {
      this.logger.warn(
        { userId, sessionId: id },
        'Active chat session not found',
      );
      throw new NotFoundException(ErrorMessage.notFound('Chat session'));
    }
    this.logger.info({ userId, sessionId: id }, 'Chat session soft-deleted');
    return {
      message: Messages.delete('Chat session'),
      data: {
        id: sessions[0].id,
        title: sessions[0].title,
        updatedAt: sessions[0].updatedAt,
      },
    };
  }

  async restore(
    userId: string,
    id: string,
  ): Promise<WebResponse<UpdateChatSessionResDto>> {
    this.logger.trace({ userId, sessionId: id }, 'Restoring chat session');
    const sessions = await this.prisma.chatSession.updateManyAndReturn({
      where: { id, userId, deletedAt: { not: null } },
      data: { deletedAt: null, updatedAt: new Date() },
    });
    if (!sessions.length) {
      this.logger.warn(
        { userId, sessionId: id },
        'Deleted chat session not found',
      );
      throw new NotFoundException(ErrorMessage.notFound('Chat session'));
    }
    this.logger.info({ userId, sessionId: id }, 'Chat session restored');
    return {
      message: Messages.restore('Chat session'),
      data: {
        id: sessions[0].id,
        title: sessions[0].title,
        updatedAt: sessions[0].updatedAt,
      },
    };
  }

  async removePermanently(userId: string, id: string): Promise<WebResponse<UpdateChatSessionResDto>> {
    this.logger.trace(
      { userId, sessionId: id },
      'Permanently deleting chat session',
    );
    const response = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; title: string; updatedAt: Date }[]>`
        SELECT id, title, updated_at AS "updatedAt"
        FROM chat_session
        WHERE id = ${id}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NOT NULL
        FOR UPDATE
      `;
      if (!locked.length) {
        this.logger.warn(
          { userId, sessionId: id },
          'Deleted chat session not found',
        );
        throw new NotFoundException(ErrorMessage.notFound('Deleted chat session'));
      }

      const chatHistory = { sessionId: id };

      await tx.chatSession.update({
        where: { id, userId },
        data: { activeLeafMessageId: null },
      });

      await tx.chatFeedback.deleteMany({ where: { chatHistory } });
      await tx.completion.deleteMany({ where: { chatHistory } });
      await tx.chatHistory.deleteMany({ where: { sessionId: id } });
      await tx.sessionDocument.deleteMany({ where: { sessionId: id } });
      await tx.chatSession.delete({ where: { id, userId } });

      return {
        message: Messages.delete('Chat session permanently'),
        data: {
          id: locked[0].id,
          title: locked[0].title,
          updatedAt: locked[0].updatedAt,
        },
      };
    });

    this.logger.info(
      { userId, sessionId: id },
      'Chat session permanently deleted',
    );

    return response;
  }
}
