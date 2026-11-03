import { createRequire } from 'node:module';
import { JwtService } from '@nestjs/jwt';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);
const { SessionService } = require('../dist/model/session/session.service');

const USER_ID = '042e0b4b-9981-40f0-8247-b9e796dc0545';
const ACCESS_SECRET = 'test-access-secret-long-enough-for-auth';
const REFRESH_SECRET = 'test-refresh-secret-long-enough-for-auth';

type Row = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
};

function setup() {
  const rows = new Map<string, Row>();
  const jwt = new JwtService();
  const authSession = {
    findMany: vi.fn(async () =>
      [...rows.values()]
        .filter((row) => !row.revokedAt && row.expiresAt > new Date())
        .sort((a, b) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime())
        .map((row) => ({ id: row.id })),
    ),
    create: vi.fn(async ({ data }: { data: Row }) => {
      rows.set(data.id, { ...data, revokedAt: null, createdAt: new Date() });
    }),
    updateMany: vi.fn(
      async ({ where, data }: { where: any; data: Partial<Row> }) => {
        let count = 0;
        for (const row of rows.values()) {
          if (typeof where.id === 'string' && row.id !== where.id) continue;
          if (where.id?.in && !where.id.in.includes(row.id)) continue;
          if (where.userId && row.userId !== where.userId) continue;
          if (where.revokedAt === null && row.revokedAt !== null) continue;
          if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt)
            continue;
          if (
            where.refreshTokenHash &&
            row.refreshTokenHash !== where.refreshTokenHash
          )
            continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
    ),
  };
  const tx = { $queryRaw: vi.fn(async () => []), authSession };
  const prisma = {
    authSession,
    $transaction: vi.fn(
      async (callback: (transaction: typeof tx) => Promise<void>) =>
        callback(tx),
    ),
  };
  const service = new SessionService(
    {
      getOrThrow: (key: string) =>
        key === 'ACCESS_JWT_SECRET' ? ACCESS_SECRET : REFRESH_SECRET,
    },
    jwt,
    prisma,
  );
  return { service, jwt, rows };
}

describe('Auth session isolation', () => {
  it('accepts two active devices and rejects a revoked device even when another remains active', async () => {
    const { service, jwt, rows } = setup();
    const first = await service.createToken({ payload: { sub: USER_ID } });
    const second = await service.createToken({ payload: { sub: USER_ID } });
    const firstSid = (jwt.decode(first.accessToken) as { sid: string }).sid;
    const secondSid = (jwt.decode(second.accessToken) as { sid: string }).sid;

    expect(firstSid).not.toBe(secondSid);
    await expect(
      service.validateToken(first.accessToken, 'access'),
    ).resolves.toMatchObject({ sid: firstSid });
    await expect(
      service.validateToken(second.accessToken, 'access'),
    ).resolves.toMatchObject({ sid: secondSid });
    rows.get(firstSid)!.revokedAt = new Date();
    await expect(
      service.validateToken(first.accessToken, 'access'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.validateToken(second.accessToken, 'access'),
    ).resolves.toMatchObject({ sid: secondSid });
  });

  it('logs out only the session matching its refresh cookie', async () => {
    const { service, jwt, rows } = setup();
    const first = await service.createToken({ payload: { sub: USER_ID } });
    const second = await service.createToken({ payload: { sub: USER_ID } });
    await service.revokeCurrent({
      cookies: { refreshToken: first.refreshToken },
    });
    expect(
      rows.get((jwt.decode(first.accessToken) as { sid: string }).sid)
        ?.revokedAt,
    ).toBeInstanceOf(Date);
    expect(
      rows.get((jwt.decode(second.accessToken) as { sid: string }).sid)
        ?.revokedAt,
    ).toBeNull();
    await expect(
      service.validateToken(first.refreshToken, 'refresh'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.validateToken(second.accessToken, 'access'),
    ).resolves.toBeDefined();
  });

  it('refreshes access with the same sid without rotating the cookie or extending session expiry', async () => {
    const { service, jwt, rows } = setup();
    const original = await service.createToken({ payload: { sub: USER_ID } });
    const sid = (jwt.decode(original.accessToken) as { sid: string }).sid;
    const expiresAt = rows.get(sid)!.expiresAt;
    const tokenHash = rows.get(sid)!.refreshTokenHash;

    const refreshed = await service.refreshAccessToken({
      cookies: { refreshToken: original.refreshToken },
    });
    expect(refreshed.data).toEqual({ accessToken: expect.any(String) });
    expect(
      (jwt.decode(refreshed.data.accessToken) as { sid: string }).sid,
    ).toBe(sid);
    expect(rows.get(sid)!.refreshTokenHash).toBe(tokenHash);
    expect(rows.get(sid)!.expiresAt).toEqual(expiresAt);
    await expect(
      service.validateToken(original.refreshToken, 'refresh'),
    ).resolves.toMatchObject({ sid });
  });

  it('rejects legacy access tokens without sid', async () => {
    const { service, jwt } = setup();
    const legacy = await jwt.signAsync(
      { sub: USER_ID },
      { secret: ACCESS_SECRET, expiresIn: '15m' },
    );
    await expect(service.validateToken(legacy, 'access')).rejects.toMatchObject(
      { status: 401 },
    );
  });

  it('evicts the least recent of six devices and retains five sessions', async () => {
    const { service } = setup();
    const tokens = [];
    for (let i = 0; i < 6; i++)
      tokens.push(await service.createToken({ payload: { sub: USER_ID } }));
    await expect(
      service.validateToken(tokens[0].accessToken, 'access'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.validateToken(tokens[5].accessToken, 'access'),
    ).resolves.toBeDefined();
  });
});
