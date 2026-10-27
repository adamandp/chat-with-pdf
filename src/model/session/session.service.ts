import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { CookieRequest, WebResponse } from '../../common/common.interface.js';
import {
  CreateTokenDTO,
  CreateTokenResDTO,
  JwtPayload,
  RefreshAccessTokenResDTO,
} from './session.interface.js';

@Injectable()
export class SessionService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private hash(token: string) {
    return createHash('sha256')
      .update(token)
      .digest('hex');
  }

  private signAccess(payload: JwtPayload) {
    return this.jwt.signAsync(
      payload,
      {
        secret: this.config.getOrThrow<string>('ACCESS_JWT_SECRET'),
        expiresIn: '15m',
      },
    );
  }

  async createToken({ payload }: CreateTokenDTO): Promise<CreateTokenResDTO> {
    const sid = randomUUID();

    const claims = {
      sub: payload.sub,
      sid,
    };

    const accessToken = await this.signAccess(claims);

    const refreshToken = await this.jwt.signAsync(
      claims,
      {
        secret: this.config.getOrThrow<string>('REFRESH_JWT_SECRET'),
        expiresIn: '7d',
      },
    );

    await this.prisma.$transaction(async (tx) => {
      // Serialize logins and logout-all for this user, including concurrent requests.
      await tx.$queryRaw`
        SELECT
          id
        FROM
          users
        WHERE
          id = ${payload.sub}::uuid
        FOR UPDATE
      `;

      const now = new Date();

      const sessions = await tx.authSession.findMany({
        where: {
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: [
          { lastUsedAt: 'asc' },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        select: { id: true },
      });

      const evicted = sessions.slice(0, Math.max(0, sessions.length - 4));

      if (evicted.length) {
        await tx.authSession.updateMany({
          where: { id: { in: evicted.map((session) => session.id) } },
          data: { revokedAt: now },
        });
      }

      await tx.authSession.create({
        data: {
          id: sid,
          userId: payload.sub,
          refreshTokenHash: this.hash(refreshToken),
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          lastUsedAt: now,
        },
      });
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  async validateSession(
    payload: JwtPayload,
    refreshToken?: string,
  ): Promise<void> {
    if (!payload.sub) throw new UnauthorizedException();

    const result = await this.prisma.authSession.updateMany({
      where: {
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(refreshToken ? { refreshTokenHash: this.hash(refreshToken) } : {}),
        user: {
          isActive: true,
          deletedAt: null,
        },
      },
      data: { lastUsedAt: new Date() },
    });

    if (result.count !== 1) throw new UnauthorizedException();
  }

  async validateToken(
    token: string,
    type: 'access' | 'refresh',
  ): Promise<JwtPayload> {
    if (!token) throw new UnauthorizedException();

    let payload: JwtPayload;

    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(
        token,
        {
          secret: this.config.getOrThrow<string>(
            type === 'access' ? 'ACCESS_JWT_SECRET' : 'REFRESH_JWT_SECRET',
          ),
        },
      );
    } catch {
      throw new UnauthorizedException();
    }

    await this.validateSession(payload, type === 'refresh' ? token : undefined);

    return payload;
  }

  async refreshAccessToken(
    request: CookieRequest,
  ): Promise<WebResponse<RefreshAccessTokenResDTO>> {
    const payload = await this.validateToken(
      request.cookies?.refreshToken || '',
      'refresh',
    );

    return {
      data: {
        accessToken: await this.signAccess({
          sub: payload.sub,
        }),
      },
    };
  }

  async revokeCurrent(request: CookieRequest): Promise<void> {
    const payload = await this.validateToken(
      request.cookies?.refreshToken || '',
      'refresh',
    );

    await this.prisma.authSession.updateMany({
      where: {
        userId: payload.sub,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT
          id
        FROM
          users
        WHERE
          id = ${userId}::uuid
        FOR UPDATE
      `;

      await tx.authSession.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });
  }
}
