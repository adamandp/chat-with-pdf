import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChatHistoryStatus } from '../../generated/prisma/client';
import { ErrorMessage } from '../../utils/message.helper';
import type { ToggleChatFeedbackDto } from './dto/toggle-chat-feedback.dto';

@Injectable()
export class ChatFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async toggle(
    userId: string,
    messageId: string,
    body: ToggleChatFeedbackDto,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Row lock serializes concurrent toggles for the same message.
      const [message] = await tx.$queryRaw<{ role: string; status: string }[]>`
        SELECT h.role, h.status::text AS status
        FROM chat_history h
        JOIN chat_session s ON s.id = h.session_id
        WHERE h.id = ${messageId}::uuid
          AND s.user_id = ${userId}::uuid
          AND s.deleted_at IS NULL
          AND h.deleted_at IS NULL
        FOR UPDATE OF h
      `;
      if (!message)
        throw new NotFoundException(ErrorMessage.notFound('Chat message'));
      if (
        message.role !== 'assistant' ||
        message.status.toUpperCase() !== ChatHistoryStatus.COMPLETED
      ) {
        throw new ConflictException(
          'Feedback requires a completed assistant message',
        );
      }

      const existing = await tx.chatFeedback.findUnique({
        where: { chatHistoryId: messageId },
        select: { type: true },
      });
      if (!existing) {
        await tx.chatFeedback.create({
          data: { chatHistoryId: messageId, type: body.type },
        });
      } else if (existing.type === body.type) {
        await tx.chatFeedback.delete({ where: { chatHistoryId: messageId } });
      } else {
        await tx.chatFeedback.update({
          where: { chatHistoryId: messageId },
          data: { type: body.type },
        });
      }
    });
  }
}
