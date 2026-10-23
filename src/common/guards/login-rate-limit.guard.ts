import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/** Shared PostgreSQL counters: enforced across backend instances and restarts. */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const username =
      typeof request.body?.username === 'string'
        ? request.body.username.trim().toLowerCase()
        : '';
    // Do not trust caller-supplied X-Forwarded-For. Express req.ip follows the
    // application's explicitly configured proxy trust policy.
    const buckets = [
      { value: `ip:${request.ip || request.socket.remoteAddress}`, limit: 30 },
      ...(username ? [{ value: `username:${username}`, limit: 10 }] : []),
    ];
    let retryAfter = 0;
    for (const bucket of buckets) {
      const key = createHash('sha256').update(bucket.value).digest('hex');
      const [row] = await this.prisma.$queryRaw<
        { attempts: number; retryAfter: number }[]
      >`
        INSERT INTO auth_rate_limits (key, attempts, reset_at)
        VALUES (${key}, 1, clock_timestamp() + interval '15 minutes')
        ON CONFLICT (key) DO UPDATE SET
          attempts = CASE WHEN auth_rate_limits.reset_at <= clock_timestamp()
            THEN 1 ELSE LEAST(auth_rate_limits.attempts + 1, 1000000) END,
          reset_at = CASE WHEN auth_rate_limits.reset_at <= clock_timestamp()
            THEN clock_timestamp() + interval '15 minutes' ELSE auth_rate_limits.reset_at END
        RETURNING attempts, CEIL(EXTRACT(EPOCH FROM (reset_at - clock_timestamp())))::int AS "retryAfter"
      `;
      if (row.attempts > bucket.limit)
        retryAfter = Math.max(retryAfter, row.retryAfter);
    }
    if (retryAfter > 0) {
      response.setHeader('Retry-After', retryAfter);
      throw new HttpException(
        'Too many login attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
