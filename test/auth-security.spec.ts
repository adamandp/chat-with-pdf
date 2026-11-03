import { createRequire } from 'node:module';
import { BadRequestException } from '@nestjs/common';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const { AuthService } = require('../dist/model/auth/auth.service');
const { AuthController } = require('../dist/model/auth/auth.controller');
const {
  SessionController,
} = require('../dist/model/session/session.controller');
const {
  LoginRateLimitService,
  LoginRateLimitException,
} = require('../dist/model/auth/login-rate-limit.service');
const {
  assertTrustedCookieOrigin,
} = require('../dist/model/session/refresh-cookie');

function setupUser(overrides: Record<string, unknown> = {}) {
  const user = {
    id: 'user-id',
    username: 'adam',
    name: 'Adam',
    passwordHash:
      '$2b$10$uRtv7HO4c3p4Mx4DBSB9w.x3xMqCiSIXH6ALdI8zzvVbXGPtIIomu',
    isActive: true,
    deletedAt: null,
    ...overrides,
  };
  const prisma = {
    user: {
      findUnique: vi.fn(async () => user),
      create: vi.fn(async () => user),
    },
  };
  const session = {
    createToken: vi.fn(async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
    })),
    validateToken: vi.fn(),
    revokeCurrent: vi.fn(),
    revokeAll: vi.fn(),
  };
  const rate = { consume: vi.fn() };
  const logger = { setContext: vi.fn(), error: vi.fn() };
  return {
    service: new AuthService(logger, prisma, session, rate),
    prisma,
    session,
    rate,
    request: { ip: '127.0.0.1', cookies: {} },
  };
}

describe('AuthService security regressions', () => {
  it.each([{ isActive: false }, { deletedAt: new Date() }])(
    'rejects login for inactive and deleted users',
    async (overrides) => {
      const { service, request, session, rate } = setupUser(overrides);
      await expect(
        service.login({ username: 'adam', password: 'Password123!' }, request),
      ).rejects.toMatchObject({ status: 401 });
      expect(session.createToken).not.toHaveBeenCalled();
      expect(rate.consume).toHaveBeenCalledOnce();
    },
  );

  it('maps a concurrent username unique violation to the existing 400 response', async () => {
    const { service, prisma, request } = setupUser();
    prisma.user.findUnique.mockResolvedValueOnce(null as never);
    prisma.user.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      service.register({ username: 'adam', password: 'Password123!' }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checks rate limits before reading user credentials', async () => {
    const { service, prisma, rate, request } = setupUser();
    rate.consume.mockRejectedValueOnce({ status: 429 });
    await expect(
      service.login({ username: 'adam', password: 'Password123!' }, request),
    ).rejects.toMatchObject({ status: 429 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('Auth cookie response contract', () => {
  const response = () => ({ cookie: vi.fn(), clearCookie: vi.fn() });
  const request = {
    cookies: { refreshToken: 'old' },
    get: vi.fn(() => undefined),
  };

  it('refreshes access without changing the cookie or response fields', async () => {
    const controller = new SessionController(
      {
        refreshAccessToken: vi.fn(async () => ({
          message: 'ok',
          data: { accessToken: 'access' },
        })),
      },
      { setContext: vi.fn(), debug: vi.fn() },
    );
    expect(await controller.refreshAccessToken(request)).toEqual({
      message: 'ok',
      data: { accessToken: 'access' },
    });
  });

  it('clears an expired or revoked cookie even if logout returns 401', async () => {
    const controller = new AuthController(
      {
        logout: vi.fn(async () => {
          throw { status: 401 };
        }),
      },
      { setContext: vi.fn() },
    );
    const res = response();
    await expect(controller.logout(request, res)).rejects.toMatchObject({
      status: 401,
    });
    expect(res.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.objectContaining({ path: '/', sameSite: 'lax' }),
    );
  });

  it('adds Retry-After header to HTTP 429 login responses', async () => {
    const controller = new AuthController(
      {
        login: vi.fn(async () => {
          throw new LoginRateLimitException(42);
        }),
      },
      { setContext: vi.fn() },
    );
    const res = { ...response(), setHeader: vi.fn() };
    await expect(
      controller.login(
        { username: 'adam', password: 'Password123!' },
        request,
        res,
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '42');
  });

  it('rejects cookie requests from untrusted origins', () => {
    expect(() =>
      assertTrustedCookieOrigin({ get: () => 'https://untrusted.example' }),
    ).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('PostgreSQL login rate limit', () => {
  it('uses two atomic counters and returns 429 above either documented threshold', async () => {
    const resetAt = new Date(Date.now() + 600_000);
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ attempts: 30, resetAt }])
      .mockResolvedValueOnce([{ attempts: 10, resetAt }])
      .mockResolvedValueOnce([{ attempts: 31, resetAt }])
      .mockResolvedValueOnce([{ attempts: 11, resetAt }]);
    const rate = new LoginRateLimitService({ $queryRaw: queryRaw });
    const req = { ip: '127.0.0.1', cookies: {} };
    await expect(rate.consume(req, ' ADAM ')).resolves.toBeUndefined();
    await expect(rate.consume(req, 'adam')).rejects.toMatchObject({
      status: 429,
    });
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('allows attempts after counters reset', async () => {
    const queryRaw = vi.fn(async () => [
      { attempts: 1, resetAt: new Date(Date.now() + 900_000) },
    ]);
    const rate = new LoginRateLimitService({ $queryRaw: queryRaw });
    await expect(
      rate.consume({ ip: '127.0.0.1' }, 'adam'),
    ).resolves.toBeUndefined();
  });
});
