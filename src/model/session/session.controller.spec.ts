import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger, getLoggerToken } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';
import { CookieRequest, WebResponse } from '../../common/common.interface.js';
import { RefreshAccessTokenResDTO } from './session.interface.js';
import { UnauthorizedException } from '../../exceptions/index.js';

describe('SessionController', () => {
  let controller: SessionController;

  const mockSessionService = {
    refreshAccessToken: vi.fn(),
  };

  const mockPinoLogger = {
    setContext: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockCookieReq = {
    cookies: {
      refreshToken: 'valid.refresh.token',
    },
  } as unknown as CookieRequest;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        {
          provide: SessionService,
          useValue: mockSessionService,
        },
        {
          provide: PinoLogger,
          useValue: mockPinoLogger,
        },
        {
          provide: getLoggerToken(SessionController.name),
          useValue: mockPinoLogger,
        },
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
  });

  it('should be defined and set context on PinoLogger', () => {
    expect(controller).toBeDefined();
    expect(mockPinoLogger.setContext).toHaveBeenCalledWith(
      SessionController.name,
    );
  });

  describe('refreshAccessToken', () => {
    it('should call sessionService.refreshAccessToken and return mapped web response', async () => {
      const mockServiceResponse: WebResponse<RefreshAccessTokenResDTO> = {
        message: 'Token refreshed successfully',
        data: {
          accessToken: 'new.access.token.jwt',
        },
      };

      mockSessionService.refreshAccessToken.mockResolvedValue(
        mockServiceResponse,
      );

      const result = await controller.refreshAccessToken(mockCookieReq);

      expect(mockPinoLogger.debug).toHaveBeenCalledWith(
        'refresh access token hitted',
      );
      expect(mockSessionService.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockSessionService.refreshAccessToken).toHaveBeenCalledWith(
        mockCookieReq,
      );

      expect(result).toEqual({
        message: 'Token refreshed successfully',
        data: {
          accessToken: 'new.access.token.jwt',
        },
      });
    });

    it('should propagate exceptions thrown by sessionService', async () => {
      const authError = new UnauthorizedException();
      mockSessionService.refreshAccessToken.mockRejectedValue(authError);

      await expect(
        controller.refreshAccessToken(mockCookieReq),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockSessionService.refreshAccessToken).toHaveBeenCalledWith(
        mockCookieReq,
      );
    });
  });
});
