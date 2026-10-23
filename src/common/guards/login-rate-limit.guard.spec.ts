import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import type { PrismaService } from '../prisma/prisma.service';

describe('LoginRateLimitGuard', () => {
  function setup(attempts: number[]) {
    const query = vi.fn();
    for (const count of attempts)
      query.mockResolvedValueOnce([{ attempts: count, retryAfter: 500 }]);
    const setHeader = vi.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          ip: '127.0.0.1',
          socket: {},
          body: { username: 'TESTUSER' },
        }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
    return {
      guard: new LoginRateLimitGuard({
        $queryRaw: query,
      } as unknown as PrismaService),
      context,
      query,
      setHeader,
    };
  }
  it('allows the configured limits', async () => {
    const { guard, context, query } = setup([30, 10]);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it.each([
    [31, 1],
    [1, 11],
  ])(
    'rejects excess IP or account attempts with 429 and Retry-After (%i, %i)',
    async (ip, username) => {
      const { guard, context, setHeader } = setup([ip, username]);
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 429,
      });
      expect(setHeader).toHaveBeenCalledWith('Retry-After', 500);
    },
  );
});
