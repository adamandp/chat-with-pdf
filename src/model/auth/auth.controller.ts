import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { PinoLogger } from 'nestjs-pino';
import type {
  CookieRequest,
  WebResponse,
} from '../../common/common.interface.js';
import type { Response } from 'express';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDTO } from './dto/register.dto.js';
import { Public } from '../../decorators/public.decorator.js';
import { CurrentUser } from '../../decorators/current-user.decorator.js';
import type { JwtPayload } from '../session/session.interface.js';
import {
  GetProfileResDTO,
  LoginResDTO,
  LoginResultDTO,
} from './auth.interface.js';
import { LoginRateLimitException } from './login-rate-limit.service.js';
import {
  assertTrustedCookieOrigin,
  clearRefreshCookie,
  setRefreshCookie,
} from '../session/refresh-cookie.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuthController.name);
  }

  @Post('register')
  @Public()
  async register(
    @Body() registerDto: RegisterDTO,
    @Req() request: CookieRequest,
  ): Promise<WebResponse> {
    return await this.authService.register(registerDto, request);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebResponse<LoginResDTO>> {
    let result: WebResponse<LoginResultDTO>;
    try {
      result = await this.authService.login(loginDto, request);
    } catch (error) {
      if (error instanceof LoginRateLimitException) {
        response.setHeader('Retry-After', String(error.retryAfter));
      }
      throw error;
    }
    const { message, data } = result;
    setRefreshCookie(response, data!.refreshToken!);

    return {
      message,
      data: {
        accessToken: data?.accessToken,
      },
    };
  }

  @Get('profile')
  async getProfile(
    @CurrentUser() payload: JwtPayload,
  ): Promise<WebResponse<GetProfileResDTO>> {
    const { message, data } = await this.authService.getProfile({
      id: payload.sub,
    });

    return {
      message,
      data,
    };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() payload: JwtPayload,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebResponse> {
    const result = await this.authService.logoutAll(payload.sub);

    clearRefreshCookie(response);

    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Public()
  async logout(
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebResponse> {
    assertTrustedCookieOrigin(request);
    try {
      return await this.authService.logout(request);
    } finally {
      clearRefreshCookie(response);
    }
  }
}
