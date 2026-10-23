import { LoginRateLimitGuard } from '../../common/guards/login-rate-limit.guard';
import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDTO } from './dto/register.dto.js';
import { CookieRequest } from '../../common/common.interface.js';
import { JwtPayload } from '../session/session.interface.js';

describe('AuthController', () => {
  let controller: AuthController;
  let authServiceMock: {
    register: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    getProfile: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
  let loggerMock: {
    error: ReturnType<typeof vi.fn>;
    setContext: ReturnType<typeof vi.fn>;
  };
  let responseMock: Partial<Response>;

  const mockReq = (refreshToken?: string): CookieRequest =>
    ({
      cookies: { refreshToken },
    }) as unknown as CookieRequest;

  beforeEach(async () => {
    vi.clearAllMocks();

    authServiceMock = {
      register: vi.fn(),
      login: vi.fn(),
      getProfile: vi.fn(),
      logout: vi.fn(),
    };

    loggerMock = {
      error: vi.fn(),
      setContext: vi.fn(),
    };

    responseMock = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: PinoLogger, useValue: loggerMock },
      ],
    })
      .overrideGuard(LoginRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('register', () => {
    it('should delegate registration to AuthService and return response', async () => {
      const dto: RegisterDTO = {
        username: 'exampleuser',
        password: 'password123',
        name: 'John Doe',
      };
      const req = mockReq();
      const expectedResponse = {
        message:
          '🎉 Welcome, user@example.com! Your account has been created! 🎉',
      };

      authServiceMock.register.mockResolvedValue(expectedResponse);

      const result = await controller.register(dto, req);

      expect(authServiceMock.register).toHaveBeenCalledWith(dto, req);
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('login', () => {
    it('should authenticate user, set HTTP-only refresh token cookie, and omit refreshToken from body', async () => {
      const dto: LoginDto = {
        username: 'exampleuser',
        password: 'password123',
      };
      const req = mockReq();
      const serviceResult = {
        message:
          '🔓 Welcome back, user@example.com! You have logged in successfully! 🎉',
        data: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      };

      authServiceMock.login.mockResolvedValue(serviceResult);

      const result = await controller.login(dto, req, responseMock as Response);

      expect(authServiceMock.login).toHaveBeenCalledWith(dto, req);
      expect(responseMock.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'mock-refresh-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          expires: expect.any(Date),
        }),
      );
      expect(result).toEqual({
        message: serviceResult.message,
        data: {
          accessToken: 'mock-access-token',
        },
      });
      expect(result.data).not.toHaveProperty('refreshToken');
    });
  });

  describe('getProfile', () => {
    it('should fetch user profile using the extracted payload subject', async () => {
      const jwtPayload: JwtPayload = { sub: 'user-uuid-123' } as JwtPayload;
      const serviceResult = {
        message: '👤 User profile retrieved successfully!',
        data: {
          id: 'user-uuid-123',
          username: 'exampleuser',
          name: 'John Doe',
        },
      };

      authServiceMock.getProfile.mockResolvedValue(serviceResult);

      const result = await controller.getProfile(jwtPayload);

      expect(authServiceMock.getProfile).toHaveBeenCalledWith({
        id: jwtPayload.sub,
      });
      expect(result).toEqual(serviceResult);
    });
  });

  describe('logout', () => {
    it('should clear refresh cookie and trigger service logout flow', async () => {
      const req = mockReq('valid-refresh-token');
      const expectedResult = {
        message: '🎉 You have logged out successfully! see u lateer',
      };

      authServiceMock.logout.mockResolvedValue(expectedResult);

      const result = await controller.logout(req, responseMock as Response);

      expect(responseMock.clearCookie).toHaveBeenCalledWith('refreshToken');
      expect(authServiceMock.logout).toHaveBeenCalledWith(req);
      expect(result).toEqual(expectedResult);
    });
  });
});
