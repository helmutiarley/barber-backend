import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { Barber } from '../../src/entities/barber.entity';
import { User } from '../../src/entities/user.entity';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAppointment,
  makeAuthenticatedUser,
  makeBarber,
  TEST_PASSWORD,
} from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';

describe('users routes', () => {
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

  const asRole = (role: 'ADMIN' | 'MANAGER' | 'BARBER' | 'CLIENT') =>
    makeAuthenticatedUser(dataSource, config, { role });

  describe('GET /v1/users/me', () => {
    it('returns the caller profile without the password hash', async () => {
      const { user, authHeader } = await asRole('CLIENT');

      const response = await request(app).get('/v1/users/me').set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ id: user.id, email: user.email });
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });

    it('returns 401 without a token', async () => {
      expect((await request(app).get('/v1/users/me')).status).toBe(401);
    });
  });

  describe('PATCH /v1/users/me', () => {
    it('updates own name and phone', async () => {
      const { authHeader } = await asRole('CLIENT');

      const response = await request(app)
        .patch('/v1/users/me')
        .set('Authorization', authHeader)
        .send({ name: 'Novo Nome', phone: '+5511999999999' });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ name: 'Novo Nome', phone: '+5511999999999' });
    });

    it('changes the password when the current one is given', async () => {
      const { user, authHeader } = await asRole('CLIENT');

      const changed = await request(app)
        .patch('/v1/users/me')
        .set('Authorization', authHeader)
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-password' });
      expect(changed.status).toBe(200);

      const login = await request(app)
        .post('/v1/auth/login')
        .send({ email: user.email, password: 'a-brand-new-password' });
      expect(login.status).toBe(200);
    });

    it('refuses a password change with the wrong current password', async () => {
      const { authHeader } = await asRole('CLIENT');

      const response = await request(app)
        .patch('/v1/users/me')
        .set('Authorization', authHeader)
        .send({ currentPassword: 'not-my-password', newPassword: 'a-brand-new-password' });

      expect(response.status).toBe(401);
    });

    it('rejects a password change that omits the current password', async () => {
      const { authHeader } = await asRole('CLIENT');

      const response = await request(app)
        .patch('/v1/users/me')
        .set('Authorization', authHeader)
        .send({ newPassword: 'a-brand-new-password' });

      expect(response.status).toBe(400);
    });

    it('ignores a role field smuggled into a self-update', async () => {
      const { authHeader } = await asRole('CLIENT');

      const response = await request(app)
        .patch('/v1/users/me')
        .set('Authorization', authHeader)
        .send({ name: 'Novo Nome', role: 'ADMIN' });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ name: 'Novo Nome', role: 'CLIENT' });
    });

    it('accepts a no-op update without erroring', async () => {
      const { authHeader } = await asRole('CLIENT');

      const response = await request(app)
        .patch('/v1/users/me')
        .set('Authorization', authHeader)
        .send({ currentPassword: TEST_PASSWORD });

      expect(response.status).toBe(200);
    });
  });

  describe('POST /v1/users', () => {
    const staff = { name: 'Novo Barbeiro', email: 'barbeiro@test.local', password: TEST_PASSWORD };

    it('lets an admin create staff', async () => {
      const { authHeader } = await asRole('ADMIN');

      const response = await request(app)
        .post('/v1/users')
        .set('Authorization', authHeader)
        .send({ ...staff, role: 'BARBER' });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({ email: staff.email, role: 'BARBER' });
    });

    it.each([['MANAGER'], ['BARBER'], ['CLIENT']] as const)(
      'forbids a %s from creating staff',
      async (role) => {
        const { authHeader } = await asRole(role);

        const response = await request(app)
          .post('/v1/users')
          .set('Authorization', authHeader)
          .send({ ...staff, role: 'BARBER' });

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
      },
    );

    it('refuses to mint another ADMIN through this endpoint', async () => {
      const { authHeader } = await asRole('ADMIN');

      const response = await request(app)
        .post('/v1/users')
        .set('Authorization', authHeader)
        .send({ ...staff, role: 'ADMIN' });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /v1/users', () => {
    it('lists users for staff and filters by role', async () => {
      const { authHeader } = await asRole('MANAGER');
      await asRole('CLIENT');
      await asRole('BARBER');

      const all = await request(app).get('/v1/users').set('Authorization', authHeader);
      expect(all.body.data).toHaveLength(3);

      const barbers = await request(app)
        .get('/v1/users?role=BARBER')
        .set('Authorization', authHeader);
      expect(barbers.body.data).toHaveLength(1);
      expect(barbers.body.data[0].role).toBe('BARBER');
    });

    it('forbids a client from listing users', async () => {
      const { authHeader } = await asRole('CLIENT');

      expect((await request(app).get('/v1/users').set('Authorization', authHeader)).status).toBe(
        403,
      );
    });
  });

  describe('PATCH /v1/users/:id', () => {
    it('lets an admin deactivate a user', async () => {
      const { authHeader } = await asRole('ADMIN');
      const target = await asRole('BARBER');

      const response = await request(app)
        .patch(`/v1/users/${target.user.id}`)
        .set('Authorization', authHeader)
        .send({ active: false });

      expect(response.status).toBe(200);
      expect(response.body.data.active).toBe(false);
    });

    it('blocks login once deactivated', async () => {
      const { authHeader } = await asRole('ADMIN');
      const target = await asRole('CLIENT');

      await request(app)
        .patch(`/v1/users/${target.user.id}`)
        .set('Authorization', authHeader)
        .send({ active: false });

      const login = await request(app)
        .post('/v1/auth/login')
        .send({ email: target.user.email, password: TEST_PASSWORD });

      expect(login.status).toBe(401);
    });

    it('forbids a manager from editing users', async () => {
      const { authHeader } = await asRole('MANAGER');
      const target = await asRole('CLIENT');

      const response = await request(app)
        .patch(`/v1/users/${target.user.id}`)
        .set('Authorization', authHeader)
        .send({ active: false });

      expect(response.status).toBe(403);
    });

    it('returns 404 for an unknown user', async () => {
      const { authHeader } = await asRole('ADMIN');

      const response = await request(app)
        .patch(`/v1/users/${UNKNOWN_UUID}`)
        .set('Authorization', authHeader)
        .send({ active: false });

      expect(response.status).toBe(404);
    });

    describe('deactivating a barber', () => {
      it('takes the barber profile down with the account', async () => {
        const { authHeader } = await asRole('ADMIN');
        const target = await asRole('BARBER');
        const barber = await makeBarber(dataSource, { userId: target.user.id });

        const response = await request(app)
          .patch(`/v1/users/${target.user.id}`)
          .set('Authorization', authHeader)
          .send({ active: false });

        expect(response.status).toBe(200);
        const profile = await dataSource.getRepository(Barber).findOneBy({ id: barber.id });
        expect(profile?.active).toBe(false);
      });

      it('refuses while a future appointment stands, and changes nothing', async () => {
        const { authHeader } = await asRole('ADMIN');
        const target = await asRole('BARBER');
        const barber = await makeBarber(dataSource, { userId: target.user.id });
        await makeAppointment(dataSource, { barberId: barber.id });

        const response = await request(app)
          .patch(`/v1/users/${target.user.id}`)
          .set('Authorization', authHeader)
          .send({ active: false });

        expect(response.status).toBe(409);

        const user = await dataSource.getRepository(User).findOneBy({ id: target.user.id });
        const profile = await dataSource.getRepository(Barber).findOneBy({ id: barber.id });
        expect(user?.active).toBe(true);
        expect(profile?.active).toBe(true);
      });

      it('goes through once the appointment is cancelled', async () => {
        const { authHeader } = await asRole('ADMIN');
        const target = await asRole('BARBER');
        const barber = await makeBarber(dataSource, { userId: target.user.id });
        await makeAppointment(dataSource, { barberId: barber.id, status: 'cancelled' });

        const response = await request(app)
          .patch(`/v1/users/${target.user.id}`)
          .set('Authorization', authHeader)
          .send({ active: false });

        expect(response.status).toBe(200);
      });
    });
  });
});
