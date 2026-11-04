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
import { Messages, ErrorMessage } from '../../utils/message.helper';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDTO } from './dto/register.dto.js';
import { SessionService } from '../session/session.service.js';
import type { JwtPayload } from '../session/session.interface.js';
import { GetProfileDTO } from './dto/get-profile.dto.js';
import { LoginRateLimitService } from './login-rate-limit.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
    private readonly loginRateLimit: LoginRateLimitService,
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
          throw new UnauthorizedException(ErrorMessage.invalidCredential);
      });
  }

  private async validateUsername(
    username: string,
  ): Promise<ValidateUsernameResDTO> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        name: true,
        isActive: true,
        deletedAt: true,
      },
    });
    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException(ErrorMessage.invalidCredential);
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
      throw new BadRequestException(ErrorMessage.alreadyExist('Username'));
    }
  }

  private async currentSession(
    request: CookieRequest,
  ): Promise<JwtPayload | null> {
    if (!request.cookies?.refreshToken) return null;

    try {
      return await this.session.validateToken(request.cookies.refreshToken, 'refresh');
    } catch (error) {
      if (error instanceof UnauthorizedException) return null;
      throw error;
    }
  }

  private async assertNotRegistered(
    request: CookieRequest,
  ): Promise<JwtPayload | null> {
    const session = await this.currentSession(request);
    if (!session) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: session.sub },
      select: { accountType: true },
    });
    if (user?.accountType !== 'GUEST') {
      throw new BadRequestException(ErrorMessage.alreadyLoggedIn);
    }
    return session;
  }

  async createGuest(
    request: CookieRequest,
  ): Promise<WebResponse<LoginResultDTO>> {
    // Repeated calls with a valid cookie must never create another guest.
    const existing = await this.currentSession(request);
    if (existing) {
      const refreshed = await this.session.refreshAccessToken(request);
      return {
        message: Messages.get('Login session'),
        data: { accessToken: refreshed.data!.accessToken },
      };
    }

    await this.loginRateLimit.consumeGuest(request);
    const user = await this.prisma.user.create({
      data: { accountType: 'GUEST' },
    });
    try {
      const tokens = await this.session.createToken({ payload: { sub: user.id } });
      return { message: Messages.create('Guest session'), data: tokens };
    } catch (error) {
      // A failed token issuance must not leave an unused guest user behind.
      await this.prisma.user.delete({ where: { id: user.id } }).catch((cleanupError) => {
        this.logger.error(cleanupError);
      });
      throw error;
    }
  }

  async logout(request: CookieRequest): Promise<WebResponse> {
    await this.session.revokeCurrent(request);
    return {
      message: Messages.delete('Login session'),
    };
  }

  async logoutAll(userId: string): Promise<WebResponse> {
    await this.session.revokeAll(userId);
    return { message: Messages.delete('All login sessions') };
  }

  async login(
    data: LoginDto,
    request: CookieRequest,
  ): Promise<WebResponse<LoginResultDTO>> {
    const guest = await this.assertNotRegistered(request);
    await this.loginRateLimit.consume(request, data.username);
    const user = await this.validateUsername(data.username);
    await this.validatePassword(data.password, user.passwordHash);
    const token = await this.session.createToken({
      payload: {
        sub: user.id,
      },
    });

    // Signing into an existing account switches identity, without merging data.
    if (guest) {
      await this.session.revokeCurrent(request).catch((error) => {
        if (!(error instanceof UnauthorizedException)) throw error;
      });
    }

    return {
      message: Messages.create('Login session'),
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
    const guest = await this.assertNotRegistered(request);
    await this.assertUsernameNotTaken(data.username);

    const passwordHash = await bcrypt.hash(data.password, 10).catch((error) => {
      this.logger.error(error);
      throw new InternalServerErrorException();
    });

    try {
      if (guest) {
        // Preserve User.id and therefore every ChatSession/Document relation.
        await this.prisma.$transaction(async (tx) => {
          const updated = await tx.user.updateMany({
            where: {
              id: guest.sub,
              accountType: 'GUEST',
              isActive: true,
              deletedAt: null,
            },
            data: {
              username: data.username,
              passwordHash,
              name: data.name,
              accountType: 'REGISTERED',
            },
          });
          if (updated.count !== 1) {
            throw new BadRequestException('Guest account is no longer available');
          }
          // Register + subsequent login must use a newly issued session.
          await tx.authSession.updateMany({
            where: { userId: guest.sub, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        });
      } else {
        await this.prisma.user.create({
          data: {
            username: data.username,
            passwordHash,
            name: data.name,
          },
        });
      }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(ErrorMessage.alreadyExist('Username'));
      }
      throw error;
    }

    return {
      message: Messages.create('Account'),
    };
  }

  async getProfile(
    data: GetProfileDTO,
  ): Promise<WebResponse<GetProfileResDTO>> {
    const user = await this.prisma.user.findUnique({
      where: { id: data.id },
      select: { id: true, username: true, name: true, accountType: true },
    });

    return {
      message: Messages.get('User profile'),
      data: {
        id: user?.id,
        username: user?.username,
        name: user?.name,
        accountType: user?.accountType,
      },
    };
  }
}
