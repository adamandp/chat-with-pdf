import { HttpException, HttpStatus } from '@nestjs/common';

export class UnauthorizedException extends HttpException {
  constructor() {
    super(
      `🚪 You are not logged in. Please sign in to continue! 🔐`,
      HttpStatus.UNAUTHORIZED,
    );
  }
}
