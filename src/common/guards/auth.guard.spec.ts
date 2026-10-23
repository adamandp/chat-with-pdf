import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AuthGuard } from './auth.guard';
import { JwtStrategy } from '../common.strategy';
import { SessionService } from '../../model/session/session.service';
import { Public } from '../../decorators/public.decorator';

@Controller()
class ProbeController {
  @Get('private') privateRoute() {
    return { ok: true };
  }
  @Public() @Get('public') publicRoute() {
    return { ok: true };
  }
}

describe('global authentication', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });
  it('allows public routes, rejects missing/expired/revoked tokens and validates active sessions', async () => {
    const validateSession = vi.fn().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProbeController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: ConfigService,
          useValue: new ConfigService({ ACCESS_JWT_SECRET: 'secret' }),
        },
        { provide: SessionService, useValue: { validateSession } },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    const server = app.getHttpServer();
    const jwt = new JwtService({ secret: 'secret' });
    const token = jwt.sign({ sub: 'user', sid: 'session' });
    await request(server).get('/public').expect(200);
    await request(server).get('/private').expect(401);
    await request(server)
      .get('/private')
      .auth(jwt.sign({ sub: 'user' }, { expiresIn: -1 }), { type: 'bearer' })
      .expect(401);
    await request(server)
      .get('/private')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(validateSession).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user', sid: 'session' }),
    );
    const { UnauthorizedException } = await import('@nestjs/common');
    validateSession.mockRejectedValue(new UnauthorizedException());
    await request(server)
      .get('/private')
      .auth(token, { type: 'bearer' })
      .expect(401);
  });
});
