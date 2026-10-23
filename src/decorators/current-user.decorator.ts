import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  sub: string;
}

export function authenticatedUser(
  request: Request & { user?: Partial<AuthenticatedUser> },
): AuthenticatedUser {
  const id = request.user?.sub ?? request.user?.id;
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new UnauthorizedException('Authenticated user required');
  }
  return { id, sub: id };
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    return authenticatedUser(context.switchToHttp().getRequest());
  },
);
