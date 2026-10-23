import { HttpException, HttpStatus } from '@nestjs/common';

export class InternalServerErrorException extends HttpException {
  constructor() {
    super(
      `🔥 Internal Server Error! Something went wrong on our side. Hang tight, we're fixing it! 🧯`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
