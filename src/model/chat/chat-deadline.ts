// Bound one model operation, including retries, even if an SDK ignores cancellation.
export async function withChatDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();

  const signal = parent
    ? AbortSignal.any([
        parent,
        controller.signal,
      ])
    : controller.signal;

  const timer = setTimeout(
    () => {
      controller.abort(
        new DOMException(
          'Chat model operation timed out',
          'TimeoutError',
        ),
      );
    },
    timeoutMs,
  );

  let onAbort: () => void = () => {};

  try {
    signal.throwIfAborted();

    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener(
        'abort',
        onAbort,
        { once: true },
      );
    });

    return await Promise.race([
      run(signal),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
