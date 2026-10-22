import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

import { getSeedConfig } from './config';

import {
  seedUsers,
  seedChatSessions,
  seedChatHistory,
  seedChatFeedback,
  seedCompletions,
} from './seeding/index';

async function main(): Promise<void> {
  const config = getSeedConfig();

  const adapter = new PrismaPg({
    connectionString: config.databaseUrl,
    max: 3,
    connectionTimeoutMillis: 5_000,
  });

  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.$connect();

    console.log('🌱 Starting database seeding...');

    await prisma.$transaction(
      async (tx) => {
        await tx.chatFeedback.deleteMany();
        await tx.completion.deleteMany();
        await tx.sessionDocument.deleteMany();
        await tx.chatHistory.deleteMany();
        await tx.chatSession.deleteMany();
        await tx.document.deleteMany();
        await tx.user.deleteMany();

        console.log('🧹 Database cleared!');
        await seedUsers(tx);
        await seedChatSessions(tx);
        await seedChatHistory(tx);
        await seedChatFeedback(tx);
        await seedCompletions(tx);
      },
      {
        maxWait: 10_000,
        timeout: 120_000,
      },
    );

    console.log('🎉 Database seeding done!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('💥 Database seeding failed:', error);
  process.exitCode = 1;
});
