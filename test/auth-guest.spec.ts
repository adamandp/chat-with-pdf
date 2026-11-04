import { createRequire } from 'node:module';
import { UnauthorizedException } from '@nestjs/common';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const { AuthService } = require('../dist/model/auth/auth.service');

const GUEST_ID = '9be4f913-822e-49c0-9771-1ca9f395e931';
const tokens = { accessToken: 'access-token', refreshToken: 'refresh-token' };

function setup(existing = false) {
  const user = {
    create: vi.fn(async () => ({ id: GUEST_ID, accountType: 'GUEST' })),
    delete: vi.fn(),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; username?: string } }) =>
      where.id ? { accountType: 'GUEST' } : null,
    ),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  const authSession = { updateMany: vi.fn(async () => ({ count: 1 })) };
  const prisma = {
    user,
    $transaction: vi.fn(async (callback: (tx: { user: typeof user; authSession: typeof authSession }) => Promise<void>) =>
      callback({ user, authSession }),
    ),
  };
  const session = {
    validateToken: vi.fn(async () => {
      if (!existing) throw new UnauthorizedException();
      return { sub: GUEST_ID, sid: 'session-id' };
    }),
    refreshAccessToken: vi.fn(async () => ({ data: { accessToken: tokens.accessToken } })),
    createToken: vi.fn(async () => tokens),
  };
  const limiter = { consumeGuest: vi.fn(), consume: vi.fn() };
  const logger = { setContext: vi.fn(), error: vi.fn() };
  const service = new AuthService(logger, prisma, session, limiter);
  const request = { cookies: existing ? { refreshToken: 'cookie' } : {} };
  return { service, request, user, authSession, session, limiter };
}

describe('lazy guest authentication', () => {
  it('creates a guest only when called without a valid session', async () => {
    const { service, request, user, session, limiter } = setup();
    const result = await service.createGuest(request);

    expect(user.create).toHaveBeenCalledWith({ data: { accountType: 'GUEST' } });
    expect(limiter.consumeGuest).toHaveBeenCalledWith(request);
    expect(session.createToken).toHaveBeenCalledWith({ payload: { sub: GUEST_ID } });
    expect(result.data).toEqual(tokens);
  });

  it('reuses a valid session without creating another guest', async () => {
    const { service, request, user, session, limiter } = setup(true);
    const result = await service.createGuest(request);

    expect(result.data).toEqual({ accessToken: tokens.accessToken });
    expect(session.refreshAccessToken).toHaveBeenCalledWith(request);
    expect(user.create).not.toHaveBeenCalled();
    expect(limiter.consumeGuest).not.toHaveBeenCalled();
  });

  it('upgrades the same user and revokes guest sessions on register', async () => {
    const { service, request, user, authSession } = setup(true);
    await service.register({ username: 'adam-test', password: 'Example12345' }, request);

    expect(user.create).not.toHaveBeenCalled();
    expect(user.updateMany).toHaveBeenCalledWith({
      where: { id: GUEST_ID, accountType: 'GUEST', isActive: true, deletedAt: null },
      data: expect.objectContaining({
        username: 'adam-test',
        accountType: 'REGISTERED',
        passwordHash: expect.any(String),
      }),
    });
    expect(authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: GUEST_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('refuses registering again from a registered session', async () => {
    const { service, request, user } = setup(true);
    user.findUnique.mockResolvedValue({ accountType: 'REGISTERED' });
    await expect(
      service.register({ username: 'another', password: 'Example12345' }, request),
    ).rejects.toMatchObject({ status: 400 });
    expect(user.updateMany).not.toHaveBeenCalled();
  });
});
