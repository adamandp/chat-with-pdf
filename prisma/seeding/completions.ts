import { TransactionClient } from '../../src/generated/prisma/internal/prismaNamespace';

const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// Simulated pricing per 1 million tokens (USD).
// These are fixture rates, not verified provider prices.
const PRICING = {
  input: 0.3,
  output: 2.5,
} as const;

export async function seedCompletions(db: TransactionClient): Promise<void> {
  const username = process.env.SEED_USERNAME;

  if (!username) {
    throw new Error('SEED_USERNAME is required');
  }

  const messages = await db.chatHistory.findMany({
    where: {
      role: 'assistant',
      session: {
        user: { username },
      },
      completions: {
        none: {},
      },
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
    },
  });

  const completions = messages.map((message) => {
    // Simulated prompt tokens including conversation context
    const inputTokens = randomInt(500, 4000);

    // Approximate output tokens from answer length
    const outputTokens = Math.max(
      20,
      Math.ceil(message.content.length / 4) + randomInt(5, 30),
    );

    const totalTokens = inputTokens + outputTokens;

    // Simulated cost in USD
    const inputCost = (inputTokens / 1_000_000) * PRICING.input;

    const outputCost = (outputTokens / 1_000_000) * PRICING.output;

    const totalCost = inputCost + outputCost;

    // Simulated generation performance
    const timeToFirstTokenMs = randomInt(150, 900);

    const latencyMs = timeToFirstTokenMs + randomInt(800, 6000);

    const completedAt = message.createdAt ?? new Date();

    const startedAt = new Date(completedAt.getTime() - latencyMs);

    return {
      chatHistoryId: message.id,

      model: 'seed-simulated',
      provider: 'fixture',

      inputTokens,
      outputTokens,
      totalTokens,

      inputCost: inputCost.toFixed(8),
      outputCost: outputCost.toFixed(8),
      totalCost: totalCost.toFixed(8),

      latencyMs,
      timeToFirstTokenMs,

      status: 'completed',

      startedAt,
      completedAt,
    };
  });

  await db.completion.createMany({
    data: completions,
  });

  console.log('✨ Completions seeded!');
}
