import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/test/loader.cjs`);

const { AppModule } = require('../dist/app.module');

const { DocumentWorkerService } = require('../dist/model/documents/processing/document-worker.service');

const { MilvusService } = require('../dist/common/milvus/milvus.service');

const { PrismaService } = require('../dist/common/prisma/prisma.service');

const { StorageService } = require('../dist/common/storage/storage.service');

const { SessionService } = require('../dist/model/session/session.service');

// Uses the configured development database; removes only records created here.
describe('auth with PostgreSQL (e2e)', () => {
  let app: INestApplication;

  let db: InstanceType<typeof PrismaService>;

  let sessions: InstanceType<typeof SessionService>;

  let userId: string | undefined;

  const username = `auth-test-${randomUUID()}`;

  const password = 'TestPassword123!';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DocumentWorkerService)
      .useValue({})
      .overrideProvider(StorageService)
      .useValue({})
      .overrideProvider(MilvusService)
      .useValue({})
      .compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
    db = app.get(PrismaService);
    sessions = app.get(SessionService);
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } });

    await app?.close();
  });

  it('registers without a session, enforces LRU, revokes access+refresh on logout and logout-all', async () => {
    const server = app.getHttpServer();

    const registered = await request(server)
      .post('/auth/register')
      .send({ username, password })
      .expect(201);

    expect(registered.headers['set-cookie']).toBeUndefined();

    const user = await db.user.findUniqueOrThrow({ where: { username } });

    userId = user.id;
    expect(user.email).toBeNull();
    expect(await db.authSession.count({ where: { userId } })).toBe(0);
    await request(server).get('/auth/profile').expect(401);

    const devices: { access: string; cookie: string; sid: string }[] = [];

    const jwt = new JwtService();

    for (let index = 0; index < 5; index++) {
      const res = await request(server)
        .post('/auth/login')
        .send({ username, password })
        .expect(201);

      expect(res.body.data).toEqual({ accessToken: expect.any(String) });
      devices.push({
        access: res.body.data.accessToken,
        cookie: res.headers['set-cookie'][0].split(';')[0],
        sid: jwt.decode(res.body.data.accessToken).sid,
      });
    }
    // Make the first login the least recent, then use it so the second becomes LRU.
    for (let index = 0; index < devices.length; index++) {
      await db.authSession.update({
        where: { id: devices[index].sid },
        data: {
          lastUsedAt: new Date(Date.now() - (10 - index) * 10000),
        },
      });
    }
    await request(server)
      .get('/auth/profile')
      .auth(devices[0].access, { type: 'bearer' })
      .expect(200);
    await request(server)
      .post('/auth/login')
      .send({ username, password })
      .expect(201);
    await request(server)
      .get('/auth/profile')
      .auth(devices[1].access, { type: 'bearer' })
      .expect(401);
    await request(server)
      .post('/session/refresh')
      .set('Cookie', devices[1].cookie)
      .expect(401);
    expect(
      await db.authSession.count({ where: { userId, revokedAt: null } }),
    ).toBe(5);

    await request(server)
      .post('/auth/logout')
      .set('Cookie', devices[0].cookie)
      .expect(201);
    await request(server)
      .get('/auth/profile')
      .auth(devices[0].access, { type: 'bearer' })
      .expect(401);
    await request(server)
      .post('/session/refresh')
      .set('Cookie', devices[0].cookie)
      .expect(401);
    await request(server)
      .get('/chat-sessions')
      .auth(devices[0].access, { type: 'bearer' })
      .expect(401);
    await request(server).get('/chat-sessions').expect(401);
    await request(server)
      .post('/auth/logout-all')
      .auth(devices[2].access, { type: 'bearer' })
      .expect(201);
    expect(
      await db.authSession.count({ where: { userId, revokedAt: null } }),
    ).toBe(0);
    await request(server)
      .get('/auth/profile')
      .auth(devices[2].access, { type: 'bearer' })
      .expect(401);
    await request(server)
      .post('/session/refresh')
      .set('Cookie', devices[2].cookie)
      .expect(401);
  });

  it('keeps at most five sessions during concurrent logins', async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        sessions.createToken({ payload: { sub: userId } }),
      ),
    );
    expect(
      await db.authSession.count({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ).toBe(5);
  });

});
