// import type { SeedTransaction } from './types';
import { hash } from 'bcrypt';
import { TransactionClient } from '../../src/generated/prisma/internal/prismaNamespace';

export async function seedUsers(db: TransactionClient): Promise<void> {
  const username = process.env.SEED_USERNAME;
  const password = process.env.SEED_PASSWORD;

  if (!username || !password) {
    throw new Error('SEED_USERNAME and SEED_PASSWORD are required');
  }

  const passwordHash = await hash(password, 12);

  await db.user.upsert({
    where: { username },
    update: {},
    create: {
      username,
      passwordHash,
      role: 'user',
      isActive: true,
    },
  });

  console.log('👤 Users seeded!');
}
