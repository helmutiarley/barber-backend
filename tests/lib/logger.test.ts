import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/config';
import { createLogger } from '../../src/lib/logger';

const config = { nodeEnv: 'test', logLevel: 'info' } as AppConfig;

function logAndCapture(payload: Record<string, unknown>): string {
  let captured = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      captured += String(chunk);
      callback();
    },
  });

  createLogger(config, destination).info(payload, 'test');

  return captured;
}

describe('logger redaction', () => {
  it('redacts the Authorization header that pino-http serializes', () => {
    const output = logAndCapture({
      req: { headers: { authorization: 'Bearer super-secret-token' } },
    });

    expect(output).not.toContain('super-secret-token');
    expect(output).toContain('[redacted]');
  });

  it('redacts credentials and tokens anywhere in the payload', () => {
    const output = logAndCapture({
      body: { password: 'hunter2', accessToken: 'jwt-value', refreshToken: 'opaque-value' },
      passwordHash: '$argon2id$v=19$secret',
    });

    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('jwt-value');
    expect(output).not.toContain('opaque-value');
    expect(output).not.toContain('argon2id');
  });

  it('leaves harmless fields alone', () => {
    const output = logAndCapture({ userId: 'user-1', route: '/v1/users/me' });

    expect(output).toContain('user-1');
    expect(output).toContain('/v1/users/me');
  });
});
