import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeUser, makeUserWithPassword, TEST_PASSWORD } from '../support/factories';

describe('auth routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    config = loadConfig();
    app = createApp(buildContainer({ config, logger: pino({ level: 'silent' }), dataSource }));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  const credentials = {
    name: 'Ana Cliente',
    email: 'ana@test.local',
    password: TEST_PASSWORD,
  };

  describe('POST /v1/auth/register', () => {
    it('registers a client and returns a token pair', async () => {
      const response = await request(app).post('/v1/auth/register').send(credentials);

      expect(response.status).toBe(201);
      expect(response.body.data.user).toMatchObject({ email: 'ana@test.local', role: 'CLIENT' });
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
    });

    it('never leaks the password hash', async () => {
      const response = await request(app).post('/v1/auth/register').send(credentials);

      expect(JSON.stringify(response.body)).not.toContain('argon2');
      expect(response.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('normalizes the email and rejects a duplicate regardless of case', async () => {
      await request(app).post('/v1/auth/register').send(credentials);

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ ...credentials, email: '  ANA@Test.local ' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('cannot self-assign a staff role', async () => {
      const response = await request(app)
        .post('/v1/auth/register')
        .send({ ...credentials, role: 'ADMIN' });

      expect(response.status).toBe(201);
      expect(response.body.data.user.role).toBe('CLIENT');
    });

    it('rejects a short password', async () => {
      const response = await request(app)
        .post('/v1/auth/register')
        .send({ ...credentials, password: 'short' });

      expect(response.status).toBe(400);
      expect(response.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'password' }),
      );
    });
  });

  describe('POST /v1/auth/login', () => {
    beforeEach(async () => {
      await makeUserWithPassword(dataSource, { email: 'ana@test.local', role: 'CLIENT' });
    });

    it('returns a token pair for valid credentials', async () => {
      const response = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'ana@test.local', password: TEST_PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.data.accessToken).toBeTruthy();
    });

    it.each([
      ['a wrong password', { email: 'ana@test.local', password: 'wrong-password' }],
      ['an unknown email', { email: 'nobody@test.local', password: TEST_PASSWORD }],
    ])('returns an identical 401 for %s', async (_label, payload) => {
      const response = await request(app).post('/v1/auth/login').send(payload);

      expect(response.status).toBe(401);
      expect(response.body.error).toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Invalid credentials',
      });
    });

    it('refuses a deactivated account', async () => {
      await makeUserWithPassword(dataSource, { email: 'gone@test.local', active: false });

      const response = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'gone@test.local', password: TEST_PASSWORD });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe('Invalid credentials');
    });

    it('refuses a walk-in account that has no password', async () => {
      await makeUser(dataSource, { email: 'walkin@test.local', passwordHash: null });

      const response = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'walkin@test.local', password: TEST_PASSWORD });

      expect(response.status).toBe(401);
    });
  });

  describe('refresh rotation', () => {
    async function register() {
      const response = await request(app).post('/v1/auth/register').send(credentials);
      return response.body.data as { accessToken: string; refreshToken: string };
    }

    it('rotates the refresh token and invalidates the old one', async () => {
      const first = await register();

      const rotated = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken });

      expect(rotated.status).toBe(200);
      expect(rotated.body.data.refreshToken).not.toBe(first.refreshToken);

      const replay = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken });

      expect(replay.status).toBe(401);
    });

    it('burns the family when a used token is replayed', async () => {
      const first = await register();
      const second = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken });

      await request(app).post('/v1/auth/refresh').send({ refreshToken: first.refreshToken });

      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: second.body.data.refreshToken });

      expect(response.status).toBe(401);
    });

    it('rejects a token that was never issued', async () => {
      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'made-up-token' });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('revokes the refresh token', async () => {
      const registered = await request(app).post('/v1/auth/register').send(credentials);
      const { refreshToken } = registered.body.data;

      const loggedOut = await request(app).post('/v1/auth/logout').send({ refreshToken });
      expect(loggedOut.status).toBe(204);

      const afterLogout = await request(app).post('/v1/auth/refresh').send({ refreshToken });
      expect(afterLogout.status).toBe(401);
    });
  });

  it('supports the full register → login → refresh → logout flow', async () => {
    const registered = await request(app).post('/v1/auth/register').send(credentials);
    expect(registered.status).toBe(201);

    const loggedIn = await request(app)
      .post('/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    expect(loggedIn.status).toBe(200);

    const refreshed = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: loggedIn.body.data.refreshToken });
    expect(refreshed.status).toBe(200);

    const me = await request(app)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${refreshed.body.data.accessToken}`);
    expect(me.body.data.email).toBe(credentials.email);

    const loggedOut = await request(app)
      .post('/v1/auth/logout')
      .send({ refreshToken: refreshed.body.data.refreshToken });
    expect(loggedOut.status).toBe(204);
  });
});
