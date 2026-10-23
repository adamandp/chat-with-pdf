import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SessionService } from './session.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CookieRequest } from '../../common/common.interface';

const sub = '8e29e1d5-2268-4ccb-aa11-e2e3c8020a6e';
const sid = '125f5373-de3b-487b-95ed-e61c9584b566';
const request = (token: string) =>
  ({ cookies: { refreshToken: token } }) as CookieRequest;

describe('SessionService', () => {
  const jwt = new JwtService();
  const config = new ConfigService({
    ACCESS_JWT_SECRET: 'access-secret',
    REFRESH_JWT_SECRET: 'refresh-secret',
  });
  const db = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    authSession: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  };
  let service: SessionService;
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation((fn) => fn(db));
    db.authSession.findMany.mockResolvedValue([]);
    db.authSession.updateMany.mockResolvedValue({ count: 1 });
    service = new SessionService(config, jwt, db as unknown as PrismaService);
  });

  it('creates a unique session and stores only the refresh token hash', async () => {
    const tokens = await service.createToken({ payload: { sub } });
    const access = jwt.verify(tokens.accessToken, { secret: 'access-secret' });
    const refresh = jwt.verify(tokens.refreshToken, {
      secret: 'refresh-secret',
    });
    expect(access.sid).toBe(refresh.sid);
    expect(access.exp - access.iat).toBe(900);
    expect(refresh.exp - refresh.iat).toBe(604800);
    expect(db.authSession.create.mock.calls[0][0].data).toMatchObject({
      id: access.sid,
      userId: sub,
      refreshTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('evicts the least recently used existing session when a sixth logs in', async () => {
    db.authSession.findMany.mockResolvedValue(
      ['oldest', 'b', 'c', 'd', 'e'].map((id) => ({ id })),
    );
    await service.createToken({ payload: { sub } });
    expect(db.$queryRaw).toHaveBeenCalledBefore(db.authSession.findMany);
    expect(db.authSession.findMany.mock.calls[0][0].orderBy[0]).toEqual({
      lastUsedAt: 'asc',
    });
    expect(db.authSession.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['oldest'] } },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('does not evict sessions below the device limit', async () => {
    db.authSession.findMany.mockResolvedValue([{ id: 'one' }]);
    await service.createToken({ payload: { sub } });
    expect(db.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects expired or tampered tokens before accessing the DB', async () => {
    const expired = jwt.sign(
      { sub, sid },
      { secret: 'refresh-secret', expiresIn: -1 },
    );
    await expect(service.validateToken(expired, 'refresh')).rejects.toThrow();
    await expect(
      service.validateToken(expired + 'tampered', 'refresh'),
    ).rejects.toThrow();
    expect(db.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects legacy tokens without a session id', async () => {
    const legacy = jwt.sign({ sub }, { secret: 'access-secret' });
    await expect(service.validateToken(legacy, 'access')).rejects.toThrow();
    expect(db.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects revoked, expired, missing sessions or inactive users even with valid JWTs', async () => {
    db.authSession.updateMany.mockResolvedValue({ count: 0 });
    const token = jwt.sign({ sub, sid }, { secret: 'access-secret' });
    await expect(service.validateToken(token, 'access')).rejects.toThrow();
    expect(db.authSession.updateMany.mock.calls[0][0].where).toMatchObject({
      id: sid,
      userId: sub,
      revokedAt: null,
      expiresAt: { gt: expect.any(Date) },
      user: { isActive: true, deletedAt: null },
    });
  });

  it('checks the refresh hash and updates activity before refreshing', async () => {
    const token = jwt.sign({ sub, sid }, { secret: 'refresh-secret' });
    const result = await service.refreshAccessToken(request(token));
    expect(
      jwt.verify(result.data!.accessToken, { secret: 'access-secret' }).sid,
    ).toBe(sid);
    expect(db.authSession.updateMany.mock.calls[0][0]).toMatchObject({
      where: { refreshTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it('revokes the current session on logout', async () => {
    const token = jwt.sign({ sub, sid }, { secret: 'refresh-secret' });
    await service.revokeCurrent(request(token));
    expect(db.authSession.updateMany).toHaveBeenLastCalledWith({
      where: { id: sid, userId: sub, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokes all sessions for only the authenticated user', async () => {
    await service.revokeAll(sub);
    expect(db.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: sub, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
