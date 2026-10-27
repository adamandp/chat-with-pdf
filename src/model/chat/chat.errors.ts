// LangChain may rename provider errors or wrap them in a cause.
// Inspect structured fields only; provider messages can contain private request data.
export function isRateLimitError(error: unknown): boolean {
  const visited = new Set<unknown>();

  let current = error;

  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== 'object' || visited.has(current)) return false;

    visited.add(current);

    const value = current as Record<string, unknown>;

    if (value.name === 'RateLimitQuotaExhaustedError'
      || value.name === 'RateLimitCapacityError'
      || value.status === 429 || value.status === '429'
      || value.statusCode === 429 || value.statusCode === '429'
      || value.code === 429 || value.code === '429') return true;

    current = value.cause;
  }

  return false;
}

// Log bounded summaries, never entire SDK errors (which may contain request headers).
export function chatErrorDetails(error: unknown, apiKey?: string) {
  const details: { name: string;
    message: string;
    status?: number | string; }[] = [];

  const visited = new Set<unknown>();

  let current = error;

  for (let depth = 0; depth < 3; depth++) {
    if (!current || typeof current !== 'object' || visited.has(current)) break;

    visited.add(current);

    const value = current as Record<string, unknown>;

    let message = typeof value.message === 'string' ? value.message.split('\n')[0] : 'No error message';

    if (apiKey) message = message
      .split(apiKey)
      .join('[Redacted]');

    message = message
      .replace(/([?&](?:key|api_key|token)=)[^&\s"']+/gi, '$1[Redacted]')
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [Redacted]')
      .slice(0, 400);

    const status = value.status ?? value.statusCode ?? value.code;

    details.push({
      name: typeof value.name === 'string' ? value.name : 'Unknown',
      message,
      ...(typeof status === 'number' || typeof status === 'string' ? { status } : {}),
    });
    current = value.cause;
  }

  return details;
}
