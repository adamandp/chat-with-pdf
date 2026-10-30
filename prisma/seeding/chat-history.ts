import { randomUUID } from 'node:crypto';

import { dummyConversations } from './dummy/chat-history';
import {
  ChatHistoryStatus,
  type Prisma,
} from '../../src/generated/prisma/client';

const MIN_CONVERSATIONS = 6;

const MAX_CONVERSATIONS = 10;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function seedChatHistory(
  db: Prisma.TransactionClient,
): Promise<void> {
  const username = process.env.SEED_USERNAME;

  if (!username) {
    throw new Error('SEED_USERNAME is required');
  }

  const user = await db.user.findUniqueOrThrow({
    where: { username },
    select: { id: true },
  });

  const sessions = await db.chatSession.findMany({
    where: {
      userId: user.id,
    },
    select: {
      id: true,
      answerMode: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  for (const session of sessions) {
    const conversationCount = randomInt(MIN_CONVERSATIONS, MAX_CONVERSATIONS);

    const conversations = [...dummyConversations]
      .sort(() => Math.random() - 0.5)
      .slice(0, conversationCount);

    let parentMessageId: string | null = null;

    let lastMessageId: string | null = null;

    const baseTime = session.createdAt ?? new Date();

    for (const [index, conversation] of conversations.entries()) {
      const questionTime = new Date(baseTime.getTime() + index * 120_000);

      const answerTime = new Date(questionTime.getTime() + 30_000);

      // User message
      const userMessage: Prisma.ChatHistoryGetPayload<{
        select: { id: true };
      }> = await db.chatHistory.create({
        data: {
          sessionId: session.id,
          parentMessageId,
          role: 'user',
          content: conversation.question,
          status: ChatHistoryStatus.COMPLETED,
          answerMode: session.answerMode,
          createdAt: questionTime,
        },
        select: {
          id: true,
        },
      });

      // Assistant response
      const assistantMessage: Prisma.ChatHistoryGetPayload<{
        select: { id: true };
      }> = await db.chatHistory.create({
        data: {
          sessionId: session.id,
          parentMessageId: userMessage.id,
          role: 'assistant',
          content: conversation.answer,
          status: ChatHistoryStatus.COMPLETED,
          answerMode: session.answerMode,
          createdAt: answerTime,
        },
        select: {
          id: true,
        },
      });

      // Next user message continues from previous assistant
      parentMessageId = assistantMessage.id;
      lastMessageId = assistantMessage.id;
    }

    // Set active leaf to the last assistant message
    if (lastMessageId) {
      await db.chatSession.update({
        where: {
          id: session.id,
        },
        data: {
          activeLeafMessageId: lastMessageId,
        },
      });
    }
  }

  console.log('🤖 Chat history seeded!');
}
