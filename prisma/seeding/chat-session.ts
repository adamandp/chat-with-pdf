import { TransactionClient } from '../../src/generated/prisma/internal/prismaNamespace';
import { dummyChatSessions } from './dummy/chat-session';

export async function seedChatSessions(db: TransactionClient): Promise<void> {
  const username = process.env.SEED_USERNAME;

  if (!username) {
    throw new Error('SEED_USERNAME is required');
  }

  const user = await db.user.findUniqueOrThrow({
    where: { username },
    select: { id: true },
  });

  await db.chatSession.createMany({
    data: dummyChatSessions.map((session) => ({
      ...session,
      userId: user.id,
    })),
  });

  console.log('💬 Chat sessions seeded!');
}
