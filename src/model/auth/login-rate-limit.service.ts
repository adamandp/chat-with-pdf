import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service.js';

const MAX_REQUESTS_PER_IP = 30;
const MAX_REQUESTS_PER_USERNAME = 10;
const MAX_GUESTS_PER_IP = 10;
const WINDOW_MS = 15 * 60 * 1000;

export class LoginRateLimitException extends HttpException {
  constructor(public readonly retryAfter: number) {
    super(
      'Too many login attempts. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class GuestRateLimitException extends HttpException {
  constructor(public readonly retryAfter: number) {
    super('Too many guest sessions. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class LoginRateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  private key(scope: 'ip' | 'username' | 'guest-ip', value: string): string {
    return createHash('sha256').update(`${scope}:${value}`).digest('hex');
  }

  private async consumeBucket(key: string, limit: number): Promise<number> {
    const now = new Date();
    const resetAt = new Date(now.getTime() + WINDOW_MS);

    // Atomic UPSERT keeps counters correct across workers and concurrent logins.
    const rows = await this.prisma.$queryRaw<
      Array<{ attempts: number; resetAt: Date }>
    >`
      INSERT INTO "auth_rate_limits" ("key", "attempts", "reset_at")
      VALUES (${key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "attempts" = CASE
          WHEN "auth_rate_limits"."reset_at" <= ${now} THEN 1
          ELSE "auth_rate_limits"."attempts" + 1
        END,
        "reset_at" = CASE
          WHEN "auth_rate_limits"."reset_at" <= ${now} THEN ${resetAt}
          ELSE "auth_rate_limits"."reset_at"
        END
      RETURNING "attempts", "reset_at" AS "resetAt"
    `;

    const entry = rows[0];
    if (entry.attempts <= limit) return 0;
    return Math.max(
      1,
      Math.ceil((entry.resetAt.getTime() - Date.now()) / 1000),
    );
  }

  async consume(request: Request, username: string): Promise<void> {
    // Request IP comes from Express, without blindly trusting X-Forwarded-For.
    const address = request.ip || request.socket?.remoteAddress || 'unknown';
    const normalizedUsername = username.trim().toLowerCase();
    const ipWait = await this.consumeBucket(
      this.key('ip', address),
      MAX_REQUESTS_PER_IP,
    );
    const usernameWait = await this.consumeBucket(
      this.key('username', normalizedUsername),
      MAX_REQUESTS_PER_USERNAME,
    );
    if (ipWait || usernameWait) {
      throw new LoginRateLimitException(Math.max(ipWait, usernameWait));
    }
  }

  async consumeGuest(request: Request): Promise<void> {
    const address = request.ip || request.socket?.remoteAddress || 'unknown';
    const wait = await this.consumeBucket(this.key('guest-ip', address), MAX_GUESTS_PER_IP);
    if (wait) throw new GuestRateLimitException(wait);
  }
}
