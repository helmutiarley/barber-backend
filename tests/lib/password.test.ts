import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/password';

describe('password hashing', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(verifyPassword(hash, 'Correct horse battery staple')).resolves.toBe(false);
  });

  it('produces a salted argon2id hash', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);

    expect(first).toMatch(/^\$argon2id\$/);
    expect(first).not.toBe(second);
  });

  it('treats a malformed hash as a failed verification', async () => {
    await expect(verifyPassword('not-a-hash', 'whatever')).resolves.toBe(false);
  });
});
