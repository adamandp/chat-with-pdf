import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  GetProfileResDTO,
  LoginResultDTO,
  ValidateUsernameResDTO,
} from './auth.interface.js';
import { CookieRequest, WebResponse } from '../../common/common.interface.js';
import { InternalServerErrorException } from '../../exceptions/index.js';
import bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDTO } from './dto/register.dto.js';
import { SessionService } from '../session/session.service.js';
import { GetProfileDTO } from './dto/get-profile.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
  ) {
    this.logger.setContext(AuthService.name);
  }

  private async validatePassword(
    requestPassword: string,
    password: string,
  ): Promise<void> {
    return await bcrypt
      .compare(requestPassword, password)
      .catch((error) => {
        this.logger.error(error);
        throw new InternalServerErrorException();
      })
      .then((res) => {
        if (!res)
          throw new UnauthorizedException(
            '🚫 Login failed. Please check your username and password, then try again! 🔍',
          );
      });
  }

  private async validateUsername(
    username: string,
  ): Promise<ValidateUsernameResDTO> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, passwordHash: true, name: true },
    });
    if (!user) {
      throw new UnauthorizedException(
        '🚫 Login failed. Please check your username and password, then try again! 🔍',
      );
    }
    return {
      ...user,
      username: user.username!,
      passwordHash: user.passwordHash ?? '',
      name: user.name ?? '',
    };
  }

  private async assertUsernameNotTaken(username: string): Promise<void> {
    const existingUser = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (existingUser) {
      throw new BadRequestException('Username is already registered');
    }
  }

  private async assertNotAlreadyAuthenticated(
    request: CookieRequest,
  ): Promise<void> {
    if (!request.cookies.refreshToken) return;

    try {
      await this.session.validateToken(request.cookies.refreshToken, 'refresh');
    } catch {
      return;
    }

    throw new BadRequestException('You are already logged in.');
  }

  async logout(request: CookieRequest): Promise<WebResponse> {
    await this.session.revokeCurrent(request);
    return {
      message: '🎉 You have logged out successfully! see u lateer',
    };
  }

  async logoutAll(userId: string): Promise<void> {
    await this.session.revokeAll(userId);
  }

  async login(
    data: LoginDto,
    request: CookieRequest,
  ): Promise<WebResponse<LoginResultDTO>> {
    await this.assertNotAlreadyAuthenticated(request);
    const user = await this.validateUsername(data.username);
    await this.validatePassword(data.password, user.passwordHash);
    const token = await this.session.createToken({
      payload: {
        sub: user.id,
      },
    });

    return {
      message: `🔓 Welcome back, ${user.username}! You have logged in successfully! 🎉`,
      data: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
      },
    };
  }

  async register(
    data: RegisterDTO,
    request: CookieRequest,
  ): Promise<WebResponse> {
    await this.assertNotAlreadyAuthenticated(request);
    await this.assertUsernameNotTaken(data.username);

    const passwordHash = await bcrypt.hash(data.password, 10).catch((error) => {
      this.logger.error(error);
      throw new InternalServerErrorException();
    });

    const user = await this.prisma.user.create({
      data: {
        username: data.username,
        passwordHash,
        name: data.name,
      },
      select: { id: true, username: true },
    });

    return {
      message: `🎉 Welcome, ${user.username}! Your account has been created! 🎉`,
    };
  }

  async getProfile(
    data: GetProfileDTO,
  ): Promise<WebResponse<GetProfileResDTO>> {
    const user = await this.prisma.user.findUnique({
      where: { id: data.id },
      select: { id: true, username: true, name: true },
    });

    return {
      message: `👤 User profile retrieved successfully!`,
      data: {
        id: user?.id,
        username: user?.username ?? undefined,
        name: user?.name,
      },
    };
  }
}
