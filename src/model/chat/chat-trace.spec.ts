import {
  afterEach,
  expect,
  it,
  vi,
} from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import { traceChatOperation } from './chat-trace';
afterEach(() => vi.useRealTimers());
it(
  'logs start, waiting and completion with one correlation ID and clears timers',
  async () => {
    vi.useFakeTimers();

    const trace = vi.fn();

    let finish!: (value: string) => void;

    const result = traceChatOperation(
      { trace } as unknown as PinoLogger,
      { operation: 'evaluate' },
      () => new Promise<string>(
        (resolve) => { finish = resolve; },
      ),
    );

    await vi.advanceTimersByTimeAsync(10000);

    finish('private output');

    await expect(result).resolves.toBe('private output');

    const entries = trace.mock.calls.map((call) => call[0]);

    expect(entries.map((entry) => entry.event))
      .toEqual(
        [
          'started',
          'waiting',
          'completed',
        ],
      );
    expect(new Set(entries.map((entry) => entry.operationId)).size)
      .toBe(1);
    expect(entries[1].elapsedMs)
      .toBe(10000);
    expect(JSON.stringify(entries)).not.toContain('private output');
    expect(vi.getTimerCount())
      .toBe(0);
  },
);
it(
  'records failure without swallowing the error or logging its body',
  async () => {
    vi.useFakeTimers();

    const trace = vi.fn();

    const error = new Error('private provider body');

    await expect(traceChatOperation(
      { trace } as unknown as PinoLogger,
      { operation: 'evaluate' },
      async () => { throw error; },
    )).rejects.toBe(error);

    expect(trace.mock.calls.at(-1)?.[0].event)
      .toBe('failed');
    expect(JSON.stringify(trace.mock.calls)).not.toContain(
      'private provider body',
    );
    expect(vi.getTimerCount())
      .toBe(0);
  },
);
