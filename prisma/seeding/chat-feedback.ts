import { FeedbackType } from '../../src/generated/prisma/enums';
import { TransactionClient } from '../../src/generated/prisma/internal/prismaNamespace';

export async function seedChatFeedback(db: TransactionClient): Promise<void> {
  const username = process.env.SEED_USERNAME;

  if (!username) {
    throw new Error('SEED_USERNAME is required');
  }

  const messages = await db.chatHistory.findMany({
    where: {
      role: 'assistant',
      session: {
        user: {
          username,
        },
      },
      feedback: null,
    },
    select: {
      id: true,
    },
  });

  // Randomly select 30% of assistant messages
  const selectedMessages = messages
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.ceil(messages.length * 0.3));

  await db.chatFeedback.createMany({
    data: selectedMessages.map((message) => ({
      chatHistoryId: message.id,
      type: Math.random() > 0.5 ? FeedbackType.LIKE : FeedbackType.DISLIKE,
    })),
  });

  console.log('👍 Chat feedback seeded!');
}
