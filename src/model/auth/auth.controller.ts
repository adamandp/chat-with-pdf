import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  Get,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { PinoLogger } from 'nestjs-pino';
import type { CookieRequest, WebResponse } from '../../common/common.interface.js';
import type { Response } from 'express';
import moment from 'moment-timezone';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDTO } from './dto/register.dto.js';
import { Public } from '../../decorators/public.decorator.js';
import { CurrentUser } from '../../decorators/current-user.decorator.js';
import type { JwtPayload } from '../session/session.interface.js';
import { GetProfileResDTO, LoginResDTO } from './auth.interface.js';

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
  @Public()
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebResponse<LoginResDTO>> {
    const { message, data } = await this.authService.login(loginDto, request);

    response.cookie(
      'refreshToken',
      data!.refreshToken,
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        expires: moment()
          .add(7, 'days')
          .toDate(),
      },
    );

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
  async logoutAll(
    @CurrentUser() payload: JwtPayload,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebResponse> {
    await this.authService.logoutAll(payload.sub);

    response.clearCookie('refreshToken');

    return { message: 'Logged out from all devices.' };
  }

  @Post('logout')
  @Public()
  async logout(
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebResponse> {
    const result = await this.authService.logout(request);

    response.clearCookie('refreshToken');

    return result;
  }
}
