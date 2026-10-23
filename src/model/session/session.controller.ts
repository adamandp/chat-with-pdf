import { Controller, Post, Req } from '@nestjs/common';
import { SessionService } from './session.service.js';
import { Public } from '../../decorators/public.decorator.js';
import type {
  CookieRequest,
  WebResponse,
} from '../../common/common.interface.js';
import { RefreshAccessTokenResDTO } from './session.interface.js';
import { PinoLogger } from 'nestjs-pino';

@Controller('session')
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SessionController.name);
  }

  @Post('refresh')
  @Public()
  async refreshAccessToken(
    @Req() request: CookieRequest,
  ): Promise<WebResponse<RefreshAccessTokenResDTO>> {
    this.logger.debug('refresh access token hitted');
    const { message, data } =
      await this.sessionService.refreshAccessToken(request);
    return {
      message,
      data: {
        accessToken: data!.accessToken,
      },
    };
  }
}
