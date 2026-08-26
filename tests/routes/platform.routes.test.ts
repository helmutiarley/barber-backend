import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { User } from '../../src/entities/user.entity';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeAuthenticatedUser, TEST_SHOP_DOMAIN } from '../support/factories';

const PLATFORM_HOST = 'crm.barbearia360.app';

const newShop = {
  name: 'Barbearia Nova',
  slug: 'nova',
  owner: { name: 'Dono', email: 'dono@nova.local', password: 'owner-password-1' },
};

describe('platform routes', () => {
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

  async function superAdmin() {
    return makeAuthenticatedUser(dataSource, config, { role: 'SUPER_ADMIN', shopId: null });
  }

  describe('host and auth guards', () => {
    it('is invisible on tenant hosts', async () => {
      const { authHeader } = await superAdmin();

      const response = await request(app).get('/v1/platform/shops').set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });

    it('requires authentication', async () => {
      const response = await request(app).get('/v1/platform/shops').set('Host', PLATFORM_HOST);

      expect(response.status).toBe(401);
    });

    it('rejects a tenant-shop token on the platform host', async () => {
      const { authHeader } = await makeAuthenticatedUser(dataSource, config, { role: 'ADMIN' });

      const response = await request(app)
        .get('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader);

      expect(response.status).toBe(401);
    });

    it('rejects a non-SUPER_ADMIN platform user', async () => {
      const { authHeader } = await makeAuthenticatedUser(dataSource, config, {
        role: 'ADMIN',
        shopId: null,
      });

      const response = await request(app)
        .get('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /v1/platform/shops', () => {
    it('creates the shop with its owner and starter services', async () => {
      const { authHeader } = await superAdmin();

      const response = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send(newShop);

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        name: 'Barbearia Nova',
        slug: 'nova',
        domain: `nova.${config.shopsBaseDomain}`,
        active: true,
      });

      const owner = await dataSource
        .getRepository(User)
        .findOneBy({ email: 'dono@nova.local', shopId: response.body.data.id });
      expect(owner).toMatchObject({ role: 'ADMIN', active: true });

      const services = await dataSource.query('SELECT COUNT(*)::int AS count FROM services WHERE shop_id = $1', [
        response.body.data.id,
      ]);
      expect(services[0].count).toBe(3);
    });

    it('derives the shop domain from the CRM host that received the request', async () => {
      const { authHeader } = await superAdmin();

      const response = await request(app)
        .post('/v1/platform/shops')
        .set('Host', 'crm.barbearia360.dev')
        .set('Authorization', authHeader)
        .send(newShop);

      expect(response.status).toBe(201);
      expect(response.body.data.domain).toBe('nova.barbearia360.dev');
    });

    it('lets the new owner log in on the tenant host right away', async () => {
      const { authHeader } = await superAdmin();

      const created = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send({ ...newShop, customDomain: 'nova.example.com' });
      expect(created.status).toBe(201);

      const login = await request(app)
        .post('/v1/auth/login')
        .set('Host', 'nova.example.com')
        .send({ email: newShop.owner.email, password: newShop.owner.password });

      expect(login.status).toBe(200);
      expect(login.body.data.user.role).toBe('ADMIN');
    });

    it('refuses a duplicate slug', async () => {
      const { authHeader } = await superAdmin();

      await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send(newShop);

      const response = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send({ ...newShop, owner: { ...newShop.owner, email: 'outra@nova.local' } });

      expect(response.status).toBe(409);
    });

    it('refuses a reserved slug', async () => {
      const { authHeader } = await superAdmin();

      const response = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send({ ...newShop, slug: 'crm' });

      expect(response.status).toBe(400);
    });
  });

  describe('GET and PATCH /v1/platform/shops', () => {
    it('lists shops with usage stats and suspends one', async () => {
      const { authHeader } = await superAdmin();

      const created = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send(newShop);
      const shopId = created.body.data.id as string;

      const list = await request(app)
        .get('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader);

      expect(list.status).toBe(200);
      const row = list.body.data.find((shop: { id: string }) => shop.id === shopId);
      expect(row).toMatchObject({ slug: 'nova', users: 1, appointments: 0 });

      const patched = await request(app)
        .patch(`/v1/platform/shops/${shopId}`)
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send({ active: false });

      expect(patched.status).toBe(200);
      expect(patched.body.data.active).toBe(false);
    });

    it('reports DNS and HTTPS status for the shop domains', async () => {
      const { authHeader } = await superAdmin();

      const created = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send({ ...newShop, customDomain: 'nova.invalid' });

      const response = await request(app)
        .get(`/v1/platform/shops/${created.body.data.id}/domain-check`)
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.data.active).toBe(true);
      expect(response.body.data.results).toHaveLength(2);

      const custom = response.body.data.results.find(
        (result: { kind: string }) => result.kind === 'custom',
      );
      expect(custom).toMatchObject({
        domain: 'nova.invalid',
        dns: { ips: [] },
        https: { ok: false, status: null },
      });
      expect(typeof custom.https.error).toBe('string');
    });

    it('suspending a shop takes its domain offline', async () => {
      const { authHeader } = await superAdmin();

      const created = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send({ ...newShop, customDomain: 'nova.example.com' });

      await request(app)
        .patch(`/v1/platform/shops/${created.body.data.id}`)
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send({ active: false });

      const response = await request(app)
        .post('/v1/auth/login')
        .set('Host', 'nova.example.com')
        .send({ email: newShop.owner.email, password: newShop.owner.password });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /v1/platform/shops/:id', () => {
    it('soft-deletes the shop, hides it, and frees its slug and domain', async () => {
      const { authHeader } = await superAdmin();

      const created = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send({ ...newShop, customDomain: 'nova.example.com' });
      const shopId = created.body.data.id as string;

      const deleted = await request(app)
        .delete(`/v1/platform/shops/${shopId}`)
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader);

      expect(deleted.status).toBe(200);
      expect(deleted.body.data).toMatchObject({
        id: shopId,
        active: false,
      });

      const fetched = await request(app)
        .get(`/v1/platform/shops/${shopId}`)
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader);
      expect(fetched.status).toBe(404);

      const list = await request(app)
        .get('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader);
      expect(
        list.body.data.find((shop: { id: string }) => shop.id === shopId),
      ).toBeUndefined();

      const row = await dataSource.query(
        'SELECT deleted_at, active FROM shops WHERE id = $1',
        [shopId],
      );
      expect(row[0].deleted_at).not.toBeNull();
      expect(row[0].active).toBe(false);

      const recreated = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send({ ...newShop, owner: { ...newShop.owner, email: 'nova2@nova.local' } });
      expect(recreated.status).toBe(201);
    });

    it('takes the shop domain offline immediately', async () => {
      const { authHeader } = await superAdmin();

      const created = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send({ ...newShop, customDomain: 'nova.example.com' });

      await request(app)
        .delete(`/v1/platform/shops/${created.body.data.id}`)
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader);

      const login = await request(app)
        .post('/v1/auth/login')
        .set('Host', 'nova.example.com')
        .send({ email: newShop.owner.email, password: newShop.owner.password });

      expect(login.status).toBe(404);
    });

    it('returns 404 when the shop is already deleted', async () => {
      const { authHeader } = await superAdmin();

      const created = await request(app)
        .post('/v1/platform/shops')
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader)
        .send(newShop);
      const shopId = created.body.data.id as string;

      await request(app)
        .delete(`/v1/platform/shops/${shopId}`)
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader);

      const again = await request(app)
        .delete(`/v1/platform/shops/${shopId}`)
        .set('Host', PLATFORM_HOST)
        .set('Authorization', authHeader);

      expect(again.status).toBe(404);
    });
  });

  describe('GET /v1/internal/tls-check', () => {
    it('approves the test shop custom domain', async () => {
      const response = await request(app).get(
        `/v1/internal/tls-check?domain=${TEST_SHOP_DOMAIN}`,
      );

      expect(response.status).toBe(200);
    });

    it('approves a shop subdomain by slug', async () => {
      const response = await request(app).get(
        `/v1/internal/tls-check?domain=test-shop.${config.shopsBaseDomain}`,
      );

      expect(response.status).toBe(200);
    });

    it('approves platform hosts', async () => {
      const response = await request(app).get(`/v1/internal/tls-check?domain=${PLATFORM_HOST}`);

      expect(response.status).toBe(200);
    });

    it('refuses an unknown domain', async () => {
      const response = await request(app).get('/v1/internal/tls-check?domain=evil.example.com');

      expect(response.status).toBe(404);
    });
  });
});
