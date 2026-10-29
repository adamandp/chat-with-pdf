import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { IS_PUBLIC } from '../decorators/public.decorator';

@Injectable()
export class AuthGuard extends PassportAuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();

    delete request.user;

    if (
      this.reflector.getAllAndOverride<boolean>(
        IS_PUBLIC,
        [
          context.getHandler(),
          context.getClass(),
        ],
      )
    )
      return true;

    return super.canActivate(context);
  }
}
