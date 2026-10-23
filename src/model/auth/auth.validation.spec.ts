import { describe, expect, it } from 'vitest';
import { LoginSchema } from './dto/login.dto';
import { RegisterDTO } from './dto/register.dto';

describe.each([
  ['login', LoginSchema],
  ['register', RegisterDTO.schema],
] as const)('%s credentials', (_name, schema) => {
  it('accepts username/password without email and trims username', () => {
    const result = schema.parse({
      username: '  adam_01  ',
      password: 'Password123!',
    });
    expect(result.username).toBe('adam_01');
    expect(result).not.toHaveProperty('email');
  });

  it('requires a username even when an email is provided', () => {
    expect(
      schema.safeParse({ email: 'adam@example.com', password: 'Password123!' })
        .success,
    ).toBe(false);
  });

  it.each(['ab', 'a'.repeat(51), 'adam user', 'adam@example.com'])(
    'rejects invalid username %s',
    (username) => {
      expect(
        schema.safeParse({ username, password: 'Password123!' }).success,
      ).toBe(false);
    },
  );
});
