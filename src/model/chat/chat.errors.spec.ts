import {
  describe,
  expect,
  it,
} from 'vitest';
import { isRateLimitError, chatErrorDetails } from './chat.errors';

describe(
  'rate limit classification',
  () => {
    it(
      'recognizes LangChain names and wrapped provider status',
      () => {
        expect(
          isRateLimitError(
            Object.assign(
              new Error(),
              { name: 'RateLimitQuotaExhaustedError' },
            ),
          ),
        )
          .toBe(
            true,
          );
        expect(isRateLimitError({ name: 'RateLimitCapacityError' }))
          .toBe(true);
        expect(isRateLimitError({ cause: { status: 429 } }))
          .toBe(true);
        expect(isRateLimitError({ statusCode: '429' }))
          .toBe(true);
      },
    );
    it(
      'does not misclassify provider failures or trust message text',
      () => {
        expect(isRateLimitError({
          status: 503,
          message: '429',
        }))
          .toBe(false);
        expect(isRateLimitError(null))
          .toBe(false);

        const circular: { cause?: unknown } = {};

        circular.cause = circular;
        expect(isRateLimitError(circular))
          .toBe(false);
      },
    );
  },
);

it(
  'logs a bounded error summary and redacts configured credentials',
  () => {
    const summary = chatErrorDetails(
      {
        name: 'Error',
        message: 'Failed https://example.test?key=secret-key&token=private-token Bearer abc\nprivate body',
        cause: {
          name: 'ApiError',
          status: 404,
          message: 'Model not found',
        },
      },
      'secret-key',
    );

    expect(summary)
      .toHaveLength(2);
    expect(summary[1].status)
      .toBe(404);
    expect(JSON.stringify(summary)).not.toContain('secret-key');
    expect(JSON.stringify(summary)).not.toContain('private-token');
    expect(JSON.stringify(summary)).not.toContain('abc');
    expect(JSON.stringify(summary)).not.toContain('private body');
  },
);
