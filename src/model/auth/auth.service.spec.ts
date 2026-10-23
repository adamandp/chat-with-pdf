import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { SessionService } from '../session/session.service.js';
import { InternalServerErrorException } from '../../exceptions/index.js';
import { CookieRequest } from '../../common/common.interface.js';

vi.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let loggerMock: {
    error: ReturnType<typeof vi.fn>;
    setContext: ReturnType<typeof vi.fn>;
  };
  let prismaMock: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let sessionMock: {
    revokeCurrent: ReturnType<typeof vi.fn>;
    validateToken: ReturnType<typeof vi.fn>;
    createToken: ReturnType<typeof vi.fn>;
  };

  const mockUser = {
    id: 'user-uuid-123',
    username: 'testuser',
    passwordHash: '$2b$10$hashedpassword',
    name: 'John Doe',
  };

  const mockCookieRequest = (refreshToken?: string): CookieRequest =>
    ({
      cookies: {
        refreshToken,
      },
    }) as unknown as CookieRequest;

  beforeEach(async () => {
    vi.clearAllMocks();

    loggerMock = {
      error: vi.fn(),
      setContext: vi.fn(),
    };

    prismaMock = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };

    sessionMock = {
      revokeCurrent: vi.fn(),
      validateToken: vi.fn(),
      createToken: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PinoLogger, useValue: loggerMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: SessionService, useValue: sessionMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    const loginDto = { username: 'testuser', password: 'password123' };

    it('should successfully log in a user and return tokens', async () => {
      const request = mockCookieRequest();
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockImplementation(() =>
        Promise.resolve(true as never),
      );
      sessionMock.createToken.mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      });

      const result = await service.login(loginDto, request);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { username: loginDto.username },
        select: { id: true, username: true, passwordHash: true, name: true },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        loginDto.password,
        mockUser.passwordHash,
      );
      expect(sessionMock.createToken).toHaveBeenCalledWith({
        payload: { sub: mockUser.id },
      });
      expect(result).toEqual({
        message: `🔓 Welcome back, ${mockUser.username}! You have logged in successfully! 🎉`,
        data: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      });
    });

    it('should throw BadRequestException if user is already authenticated', async () => {
      const request = mockCookieRequest('valid-refresh-token');
      sessionMock.validateToken.mockResolvedValue({ sub: mockUser.id });

      await expect(service.login(loginDto, request)).rejects.toThrow(
        BadRequestException,
      );
      expect(sessionMock.validateToken).toHaveBeenCalledWith(
        'valid-refresh-token',
        'refresh',
      );
    });

    it('should throw UnauthorizedException when username is not found', async () => {
      const request = mockCookieRequest();
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto, request)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when password compare fails', async () => {
      const request = mockCookieRequest();
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockImplementation(() =>
        Promise.resolve(false as never),
      );

      await expect(service.login(loginDto, request)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw InternalServerErrorException when bcrypt.compare rejects', async () => {
      const request = mockCookieRequest();
      const bcryptError = new Error('Bcrypt crash');
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockRejectedValue(bcryptError as never);

      await expect(service.login(loginDto, request)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(loggerMock.error).toHaveBeenCalledWith(bcryptError);
    });
  });

  describe('register', () => {
    const registerDto = {
      username: 'newuser',
      password: 'securePassword123',
      name: 'New User',
    };

    it('should register a new user successfully', async () => {
      const request = mockCookieRequest();
      prismaMock.user.findUnique.mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockImplementation(() =>
        Promise.resolve('hashedPassword123' as never),
      );
      prismaMock.user.create.mockResolvedValue({
        id: 'new-id',
        username: registerDto.username,
      });

      const result = await service.register(registerDto, request);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { username: registerDto.username },
        select: { id: true },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 10);
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: {
          username: registerDto.username,
          passwordHash: 'hashedPassword123',
          name: registerDto.name,
        },
        select: { id: true, username: true },
      });
      expect(sessionMock.createToken).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: `🎉 Welcome, ${registerDto.username}! Your account has been created! 🎉`,
      });
    });

    it('should throw BadRequestException if username is already registered', async () => {
      const request = mockCookieRequest();
      prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(service.register(registerDto, request)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw InternalServerErrorException if bcrypt.hash fails', async () => {
      const request = mockCookieRequest();
      const hashError = new Error('Hashing error');
      prismaMock.user.findUnique.mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockRejectedValue(hashError as never);

      await expect(service.register(registerDto, request)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(loggerMock.error).toHaveBeenCalledWith(hashError);
    });
  });

  describe('logout', () => {
    it('should validate the refresh token and return success message', async () => {
      const request = mockCookieRequest('valid-refresh-token');
      sessionMock.validateToken.mockResolvedValue(true);

      const result = await service.logout(request);

      expect(sessionMock.revokeCurrent).toHaveBeenCalledWith(request);
      expect(result).toEqual({
        message: '🎉 You have logged out successfully! see u lateer',
      });
    });

    it('should pass an empty string if no refresh token is present in cookies', async () => {
      const request = mockCookieRequest(undefined);
      sessionMock.validateToken.mockResolvedValue(true);

      await service.logout(request);

      expect(sessionMock.revokeCurrent).toHaveBeenCalledWith(request);
    });
  });

  describe('getProfile', () => {
    it('should return user profile payload when user exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        username: mockUser.username,
        name: mockUser.name,
      });

      const result = await service.getProfile({ id: mockUser.id });

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        select: { id: true, username: true, name: true },
      });
      expect(result).toEqual({
        message: '👤 User profile retrieved successfully!',
        data: {
          id: mockUser.id,
          username: mockUser.username,
          name: mockUser.name,
        },
      });
    });

    it('should handle non-existent user profile gracefully', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await service.getProfile({ id: 'non-existent' });

      expect(result).toEqual({
        message: '👤 User profile retrieved successfully!',
        data: {
          id: undefined,
          username: undefined,
          name: undefined,
        },
      });
    });
  });
});
