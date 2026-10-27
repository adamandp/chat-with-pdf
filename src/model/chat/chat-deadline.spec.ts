import {
  afterEach,
  expect,
  it,
  vi,
} from 'vitest';
import { withChatDeadline } from './chat-deadline';
afterEach(() => vi.useRealTimers());
it(
  'bounds a model call that never resolves and cancels its signal',
  async () => {
    vi.useFakeTimers();

    let received: AbortSignal | undefined;

    const result = withChatDeadline(
      (signal) => {
        received = signal;

        return new Promise(() => {});
      },
      undefined,
      100,
    );

    const assertion = expect(result).rejects.toMatchObject(
      { name: 'TimeoutError' },
    );

    await vi.advanceTimersByTimeAsync(100);

    await assertion;

    expect(received?.aborted)
      .toBe(true);
  },
);
it(
  'propagates client cancellation without waiting for the deadline',
  async () => {
    const parent = new AbortController();

    const result = withChatDeadline(
      () => new Promise(() => {}),
      parent.signal,
      30000,
    );

    const assertion = expect(result).rejects.toThrow('Client closed');

    parent.abort(new Error('Client closed'));

    await assertion;
  },
);
it(
  'cleans up its timer when the model succeeds',
  async () => {
    vi.useFakeTimers();
    expect(await withChatDeadline(
      async () => 'answer',
      undefined,
      100,
    ))
      .toBe(
        'answer',
      );
    expect(vi.getTimerCount())
      .toBe(0);
  },
);
