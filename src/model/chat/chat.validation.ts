import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';

// Prisma Decimal diserialisasi menjadi string di JSON.
const completionCostSchema = z
  .instanceof(Prisma.Decimal)
  .transform((value) => value.toString())
  .pipe(z.string())
  .nullable();

export const completionSchema = z.object({
  id: z.uuid(),
  chatHistoryId: z.uuid(),
  model: z.string().max(100),
  provider: z.string().max(50),
  inputTokens: z.int32().nullable(),
  outputTokens: z.int32().nullable(),
  totalTokens: z.int32().nullable(),
  inputCost: completionCostSchema,
  outputCost: completionCostSchema,
  totalCost: completionCostSchema,
  latencyMs: z.int32().nullable(),
  timeToFirstTokenMs: z.int32().nullable(),
  status: z.string().max(20),
  errorMessage: z.string().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date().nullable(),
});

export const chatHistorySchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  parentMessageId: z.uuid().nullable(),
  versionGroupId: z.uuid(),
  role: z.string().max(20),
  content: z.string(),
  sources: z.json(),
  answerMode: z.string().max(30).nullable(),
  status: z.string().max(20),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
});

export const sendChatSchema = z
  .object({
    question: z.string().trim().min(1).max(8000),
    documentIds: z.array(z.uuid()).min(1).max(10).optional(),
    sessionId: z.uuid().optional(),
    mode: z.enum(['quick', 'pro', 'ultra']).default('quick').optional(),
    answerMode: z
      .enum(['general', 'document_only'])
      .default('general')
      .optional(),
  })
  .strict();
