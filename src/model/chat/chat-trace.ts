import { randomUUID } from 'node:crypto';
import type { PinoLogger } from 'nestjs-pino';

// Only pass metadata here; prompts, document contents and model output stay private.
export async function traceChatOperation<T>(
  logger: PinoLogger,
  metadata: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const operationId = randomUUID();

  const started = performance.now();

  const fields = () => ({
    ...metadata,
    operationId,
    elapsedMs: Math.round(
      performance.now() - started,
    ),
  });

  logger.trace(
    {
      ...fields(),
      event: 'started',
    },
    'Chat operation',
  );

  const heartbeat = setInterval(
    () => {
      logger.trace(
        {
          ...fields(),
          event: 'waiting',
        },
        'Chat operation',
      );
    },
    10_000,
  );

  heartbeat.unref();
  try {
    const result = await run();

    logger.trace(
      {
        ...fields(),
        event: 'completed',
      },
      'Chat operation',
    );

    return result;
  } catch (error) {
    logger.trace(
      {
        ...fields(),
        event: 'failed',
        errorType: error instanceof Error ? error.name : 'Unknown',
      },
      'Chat operation',
    );
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
