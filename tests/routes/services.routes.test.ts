import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeAuthenticatedUser, makeService } from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';

describe('services routes', () => {
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

  describe('GET /v1/services', () => {
    it('is public and returns prices in cents', async () => {
      await makeService(dataSource, { name: 'Corte', price: 4500, durationMinutes: 30 });

      const response = await request(app).get('/v1/services');

      expect(response.status).toBe(200);
      expect(response.body.data[0]).toMatchObject({
        name: 'Corte',
        priceCents: 4500,
        durationMinutes: 30,
        active: true,
      });
    });

    it('hides inactive services from anonymous callers', async () => {
      await makeService(dataSource, { name: 'Ativo' });
      await makeService(dataSource, { name: 'Descontinuado', active: false });

      const response = await request(app).get('/v1/services');

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Ativo');
    });

    it('shows inactive services to staff who ask', async () => {
      const { authHeader } = await asRole('MANAGER');
      await makeService(dataSource, { name: 'Ativo' });
      await makeService(dataSource, { name: 'Descontinuado', active: false });

      const response = await request(app)
        .get('/v1/services?includeInactive=true')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });

    it('forbids includeInactive for a client', async () => {
      const { authHeader } = await asRole('CLIENT');

      const response = await request(app)
        .get('/v1/services?includeInactive=true')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
    });

    it('forbids includeInactive without a token', async () => {
      expect((await request(app).get('/v1/services?includeInactive=true')).status).toBe(403);
    });

    it('still rejects a broken token on the public route', async () => {
      const response = await request(app).get('/v1/services').set('Authorization', 'Bearer nope');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /v1/services', () => {
    it('creates a service as ADMIN', async () => {
      const { authHeader } = await asRole('ADMIN');

      const response = await request(app)
        .post('/v1/services')
        .set('Authorization', authHeader)
        .send({ name: 'Barba', priceCents: 3000, durationMinutes: 20 });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({ name: 'Barba', priceCents: 3000, active: true });
    });

    it('rejects a fractional price', async () => {
      const { authHeader } = await asRole('ADMIN');

      const response = await request(app)
        .post('/v1/services')
        .set('Authorization', authHeader)
        .send({ name: 'Barba', priceCents: 30.5, durationMinutes: 20 });

      expect(response.status).toBe(400);
    });

    it('refuses a duplicate name', async () => {
      const { authHeader } = await asRole('ADMIN');
      await makeService(dataSource, { name: 'Corte' });

      const response = await request(app)
        .post('/v1/services')
        .set('Authorization', authHeader)
        .send({ name: 'Corte', priceCents: 4500, durationMinutes: 30 });

      expect(response.status).toBe(409);
    });

    it('lets a retired name come back', async () => {
      const { authHeader } = await asRole('ADMIN');
      await makeService(dataSource, { name: 'Corte', active: false });

      const response = await request(app)
        .post('/v1/services')
        .set('Authorization', authHeader)
        .send({ name: 'Corte', priceCents: 4500, durationMinutes: 30 });

      expect(response.status).toBe(201);
    });

    it.each([['MANAGER'], ['BARBER'], ['CLIENT']] as const)('forbids %s', async (role) => {
      const { authHeader } = await asRole(role);

      const response = await request(app)
        .post('/v1/services')
        .set('Authorization', authHeader)
        .send({ name: 'Nope', priceCents: 1000, durationMinutes: 10 });

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /v1/services/:id', () => {
    it('updates the price', async () => {
      const { authHeader } = await asRole('ADMIN');
      const service = await makeService(dataSource);

      const response = await request(app)
        .patch(`/v1/services/${service.id}`)
        .set('Authorization', authHeader)
        .send({ priceCents: 5500 });

      expect(response.status).toBe(200);
      expect(response.body.data.priceCents).toBe(5500);
    });

    it('404s on an unknown service', async () => {
      const { authHeader } = await asRole('ADMIN');

      const response = await request(app)
        .patch(`/v1/services/${UNKNOWN_UUID}`)
        .set('Authorization', authHeader)
        .send({ priceCents: 100 });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /v1/services/:id', () => {
    it('soft deletes and drops it from the public list', async () => {
      const { authHeader } = await asRole('ADMIN');
      const service = await makeService(dataSource);

      const response = await request(app)
        .delete(`/v1/services/${service.id}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.data.active).toBe(false);
      expect((await request(app).get('/v1/services')).body.data).toHaveLength(0);
      expect((await request(app).get(`/v1/services/${service.id}`)).status).toBe(200);
    });
  });
});
