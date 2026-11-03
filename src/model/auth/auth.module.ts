import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { SessionModule } from '../session/session.module.js';
import { LoginRateLimitService } from './login-rate-limit.service.js';

@Module({
  imports: [SessionModule],
  controllers: [AuthController],
  providers: [AuthService, LoginRateLimitService],
})
export class AuthModule {}
