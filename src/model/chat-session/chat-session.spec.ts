import type { PinoLogger } from 'nestjs-pino';
import { describe, it, expect, vi } from 'vitest';
import {
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { authenticatedUser } from '../../decorators/current-user.decorator';
import { ZodValidationPipe } from 'nestjs-zod';
import { PaginationDto } from '../../common/common.dto';
import { UpdateChatSessionDto } from './dto/update-chat-session.dto';
import { ChatSessionService } from './chat-session.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

const logger = {
  setContext: vi.fn(),
  trace: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as PinoLogger;

const userId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';

describe('Chat session access and lifecycle', () => {
  it('rejects caller-controlled query identity without authenticated identity', () => {
    expect(() => authenticatedUser({ query: { userId } } as never)).toThrow(
      UnauthorizedException,
    );
  });

  it('validates request DTOs through the shared Zod pipe', () => {
    const pipe = new ZodValidationPipe();
    const query = { type: 'query' as const, metatype: PaginationDto };
    const body = { type: 'body' as const, metatype: UpdateChatSessionDto };
    for (const value of [
      { page: '0' },
      { page: '101' },
      { limit: '101' },
      { page: '1.5' },
      { limit: ['2', '3'] },
    ]) {
      expect(() => pipe.transform(value, query)).toThrow(BadRequestException);
    }
    for (const value of [
      { title: ' ' },
      { title: null },
      {},
      { title: 'a'.repeat(256) },
    ]) {
      expect(() => pipe.transform(value, body)).toThrow(BadRequestException);
    }
    expect(pipe.transform({}, query)).toEqual({ page: 1, limit: 10 });
    expect(pipe.transform({ page: '2', limit: '5' }, query)).toEqual({
      page: 2,
      limit: 5,
    });
    expect(pipe.transform({ title: '  New title  ' }, body)).toEqual({
      title: 'New title',
    });
  });

  it.each([
    ['findAll', null],
    ['findDeleted', { not: null }],
  ] as const)(
    '%s scopes pagination to the correct session state',
    async (method, deletedAt) => {
      const findMany = vi.fn().mockResolvedValue([]);
      const count = vi.fn().mockResolvedValue(12);
      const service = new ChatSessionService(
        {
          chatSession: { findMany, count },
          $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
        } as unknown as PrismaService,
        logger,
      );
      const response = await service[method](userId, { page: 2, limit: 5 });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 5,
          where: { userId, deletedAt },
        }),
      );
      expect(response.paging).toEqual({
        currentPage: 2,
        pageSize: 5,
        totalItems: 12,
        totalPages: 3,
      });
    },
  );

  it('scopes message access to the owner and hides unavailable sessions', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ChatSessionService(
      {
        chatSession: { findFirst },
      } as unknown as PrismaService,
      logger,
    );
    await expect(service.findChats(userId, id)).rejects.toThrow(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, userId, deletedAt: null } }),
    );
  });

  it('restores only deleted sessions belonging to the caller', async () => {
    const updateManyAndReturn = vi.fn().mockResolvedValue([]);
    const service = new ChatSessionService(
      {
        chatSession: { updateManyAndReturn },
      } as unknown as PrismaService,
      logger,
    );
    await expect(service.restore(userId, id)).rejects.toThrow(
      NotFoundException,
    );
    expect(updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, userId, deletedAt: { not: null } },
        data: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });

  it('does not remove dependents when no owned deleted session is locked', async () => {
    const deleteMany = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      chatHistory: { deleteMany },
    };
    const service = new ChatSessionService(
      {
        $transaction: (callback: (client: unknown) => unknown) => callback(tx),
      } as unknown as PrismaService,
      logger,
    );
    await expect(service.removePermanently(userId, id)).rejects.toThrow(
      NotFoundException,
    );
    expect(deleteMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([id, userId]);
    expect(
      tx.$queryRaw.mock.calls[0][0].join('').replace(/\s+/g, ' '),
    ).toContain('deleted_at IS NOT NULL FOR UPDATE');
  });
});
