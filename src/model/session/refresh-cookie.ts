import { ForbiddenException } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';

const COOKIE_NAME = 'refreshToken';
const REFRESH_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions(): CookieOptions {
  const configured = process.env.AUTH_COOKIE_SAME_SITE?.toLowerCase();
  if (configured && !['lax', 'strict', 'none'].includes(configured)) {
    throw new Error('AUTH_COOKIE_SAME_SITE must be lax, strict, or none');
  }
  const sameSite = (configured || 'lax') as 'lax' | 'strict' | 'none';
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
    path: '/',
  };
}

export function setRefreshCookie(response: Response, token: string): void {
  response.cookie(COOKIE_NAME, token, {
    ...cookieOptions(),
    expires: new Date(Date.now() + REFRESH_DURATION_MS),
  });
}

export function clearRefreshCookie(response: Response): void {
  response.clearCookie(COOKIE_NAME, cookieOptions());
}

// CORS protects response visibility, not cookie-authenticated POST side effects.
export function assertTrustedCookieOrigin(request: Request): void {
  const origin = request.get('origin');
  if (!origin) return;
  const allowed = (process.env.FRONTEND_ORIGINS || 'http://localhost:3001')
    .split(',')
    .map((value) => value.trim());
  if (!allowed.includes(origin)) throw new ForbiddenException();
}
