import type { Prisma } from '../../../src/generated/prisma/client';

type DummyChatSession = Pick<
  Prisma.ChatSessionUncheckedCreateInput,
  'title' | 'answerMode' | 'createdAt' | 'lastMessageAt' | 'deletedAt'
>;

export const dummyChatSessions = [
  {
    title: 'Getting Started with Chat With PDF',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-01T08:00:00Z'),
    lastMessageAt: new Date('2026-10-01T08:15:00Z'),
  },
  {
    title: 'Understanding Message Versioning',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-02T09:00:00Z'),
    lastMessageAt: new Date('2026-10-02T09:30:00Z'),
  },
  {
    title: 'Introduction to Artificial Intelligence',
    answerMode: 'document_only',
    createdAt: new Date('2026-10-03T10:00:00Z'),
    lastMessageAt: new Date('2026-10-03T10:45:00Z'),
  },
  {
    title: 'Machine Learning Fundamentals',
    answerMode: 'document_only',
    createdAt: new Date('2026-10-04T11:00:00Z'),
    lastMessageAt: new Date('2026-10-04T11:20:00Z'),
  },
  {
    title: 'Deep Learning and Neural Networks',
    answerMode: 'document_only',
    createdAt: new Date('2026-10-05T13:00:00Z'),
    lastMessageAt: new Date('2026-10-05T13:40:00Z'),
  },
  {
    title: 'Natural Language Processing',
    answerMode: 'document_only',
    createdAt: new Date('2026-10-06T08:30:00Z'),
    lastMessageAt: new Date('2026-10-06T09:00:00Z'),
  },
  {
    title: 'Understanding Large Language Models',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-07T09:00:00Z'),
    lastMessageAt: new Date('2026-10-07T09:25:00Z'),
  },
  {
    title: 'Retrieval Augmented Generation',
    answerMode: 'document_only',
    createdAt: new Date('2026-10-08T10:00:00Z'),
    lastMessageAt: new Date('2026-10-08T10:50:00Z'),
  },
  {
    title: 'Vector Databases Explained',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-09T11:00:00Z'),
    lastMessageAt: new Date('2026-10-09T11:35:00Z'),
  },
  {
    title: 'PostgreSQL Database Design',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-10T12:00:00Z'),
    lastMessageAt: new Date('2026-10-10T12:45:00Z'),
  },
  {
    title: 'Prisma ORM Best Practices',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-11T13:00:00Z'),
    lastMessageAt: new Date('2026-10-11T13:30:00Z'),
  },
  {
    title: 'NestJS Backend Architecture',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-12T14:00:00Z'),
    lastMessageAt: new Date('2026-10-12T14:40:00Z'),
  },
  {
    title: 'REST API Design Principles',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-13T08:00:00Z'),
    lastMessageAt: new Date('2026-10-13T08:20:00Z'),
  },
  {
    title: 'Authentication and Authorization',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-14T09:00:00Z'),
    lastMessageAt: new Date('2026-10-14T09:45:00Z'),
  },
  {
    title: 'Redis and Background Jobs',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-15T10:00:00Z'),
    lastMessageAt: new Date('2026-10-15T10:30:00Z'),
  },
  {
    title: 'File Storage with MinIO',
    answerMode: 'document_only',
    createdAt: new Date('2026-10-16T11:00:00Z'),
    lastMessageAt: new Date('2026-10-16T11:25:00Z'),
  },
  {
    title: 'PDF Text Extraction Techniques',
    answerMode: 'document_only',
    createdAt: new Date('2026-10-17T12:00:00Z'),
    lastMessageAt: new Date('2026-10-17T12:40:00Z'),
  },
  {
    title: 'Semantic Search Implementation',
    answerMode: 'document_only',
    createdAt: new Date('2026-10-18T13:00:00Z'),
    lastMessageAt: new Date('2026-10-18T13:50:00Z'),
  },
  {
    title: 'Testing Strategies for Backend',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-10-19T14:00:00Z'),
    lastMessageAt: new Date('2026-10-19T14:30:00Z'),
  },
  {
    title: 'Old Conversation About Software Design',
    answerMode: 'general_knowledge',
    createdAt: new Date('2026-09-20T08:00:00Z'),
    lastMessageAt: new Date('2026-09-20T08:30:00Z'),
    deletedAt: new Date('2026-10-20T08:00:00Z'),
  },
] satisfies DummyChatSession[];
