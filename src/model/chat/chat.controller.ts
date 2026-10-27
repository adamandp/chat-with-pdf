import {
  Body,
  Controller,
  Post,
  Res,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../decorators/current-user.decorator';
import type { JwtPayload } from '../session/session.interface';
import { ChatService } from './chat.service';
import { CreateChatDto } from './dto/create-chat.dto';
import type { ChatStreamEvent } from './chat.interface';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: CreateChatDto) {
    return this.chat.create(user.sub, body);
  }

  @Post('stream')
  async stream(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateChatDto,
    @Res() response: Response,
  ) {
    const abort = new AbortController();

    const disconnect = () => abort.abort();

    response.once('close', disconnect);

    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const send = (event: ChatStreamEvent) => {
      if (abort.signal.aborted || response.writableEnded) return;

      if (!response.headersSent) {
        response.status(200);
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Cache-Control', 'no-cache, no-transform');
        response.setHeader('X-Accel-Buffering', 'no');
        response.flushHeaders();
        heartbeat = setInterval(
          () => {
            if (!response.writableEnded) response.write(': heartbeat\n\n');
          },
          15_000,
        );
      }

      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const result = await this.chat.create(
        user.sub,
        body,
        (progress) => send({
          type: 'progress',
          data: progress,
        }),
        abort.signal,
      );

      send({
        type: 'done',
        data: result.data,
      });
    } catch (error) {
      // Before SSE begins, preserve normal HTTP errors (validation/ownership/readiness).
      if (!response.headersSent && !abort.signal.aborted) throw error;

      send({
        type: 'error',
        data: {
          status_code: error instanceof HttpException ? error.getStatus() : 500,
          message: error instanceof HttpException ? error.message : 'Chat failed; try again later',
        },
      });
    } finally {
      if (heartbeat) clearInterval(heartbeat);

      response.off('close', disconnect);

      if (response.headersSent && !response.writableEnded) response.end();
    }
  }
}
