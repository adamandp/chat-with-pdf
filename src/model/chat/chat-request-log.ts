import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatMode } from './chat-mode';

interface ChatRequestContext {
  sessionId: string;
  turnId: string;
  mode: ChatMode;
}

export interface ChatModelRequestInput {
  system: string;
  input: Record<string, unknown>;
  response_schema?: unknown;
}

// Carries diagnostic context across direct calls and LangGraph without shared mutable state.
export const chatRequestContext = new AsyncLocalStorage<ChatRequestContext>();

export async function writeChatRequest(
  root: string,
  context: ChatRequestContext,
  operation: string,
  request: ChatModelRequestInput,
  options: { model: string;
    temperature: number;
    max_retries: number;
    timeout_ms: number;
    thinking_config?: { thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' }; },
) {
  // The session ID is a chat session UUID, never an arbitrary path or auth claim.
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(context.sessionId)) {
    throw new Error('Invalid chat session ID for request log');
  }

  if (![
    'rewrite',
    'evaluate',
    'answer',
  ].includes(operation)) {
    throw new Error('Invalid chat operation for request log');
  }

  const directory = join(root, context.sessionId);

  const createdAt = new Date()
    .toISOString();

  const callId = randomUUID();

  const filename = `${createdAt.replace(/[:.]/g, '-')}_${operation}_${callId}.json`;

  await mkdir(
    directory,
    {
      recursive: true,
      mode: 0o700,
    },
  );

  await writeFile(
    join(directory, filename),
    JSON.stringify(
      {
        representation: 'langchain_input',
        created_at: createdAt,
        session_id: context.sessionId,
        turn_id: context.turnId,
        call_id: callId,
        mode: context.mode,
        operation,
        options,
        request,
      },
      null,
      2,
    ) + '\n',
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
}
