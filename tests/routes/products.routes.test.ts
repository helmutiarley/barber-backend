import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { Product } from '../../src/entities/product.entity';
import { StockAdjustment } from '../../src/entities/stock-adjustment.entity';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeAuthenticatedUser, makeProduct, makeStockAdjustment } from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';

describe('products routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;
  let adminAuth: string;
  let managerAuth: string;
  let managerId: string;
  let barberAuth: string;
  let clientAuth: string;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    config = loadConfig();
    app = createApp(buildContainer({ config, logger: pino({ level: 'silent' }), dataSource }));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);

    adminAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'ADMIN' })).authHeader;
    const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });
    managerAuth = manager.authHeader;
    managerId = manager.user.id;
    barberAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' })).authHeader;
    clientAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' })).authHeader;
  });

  function get(path: string, auth: string) {
    return request(app).get(path).set('Authorization', auth);
  }

  function post(path: string, auth: string, body: object = {}) {
    return request(app).post(path).set('Authorization', auth).send(body);
  }

  function patch(path: string, auth: string, body: object = {}) {
    return request(app).patch(path).set('Authorization', auth).send(body);
  }

  describe('POST /v1/products', () => {
    it('creates a product and stocks it through an adjustment', async () => {
      const response = await post('/v1/products', adminAuth, {
        name: 'Pomada Modeladora',
        description: 'Fixação forte, brilho seco',
        priceCents: 3500,
        costCents: 1800,
        stockQuantity: 12,
        lowStockThreshold: 4,
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        name: 'Pomada Modeladora',
        priceCents: 3500,
        costCents: 1800,
        stockQuantity: 12,
        lowStockThreshold: 4,
        lowStock: false,
        active: true,
      });

      const trail = await dataSource.getRepository(StockAdjustment).find();
      expect(trail).toHaveLength(1);
      expect(trail[0]).toMatchObject({
        delta: 12,
        reason: 'purchase',
        resultingQuantity: 12,
        createdBy: expect.any(String),
      });
    });

    it('starts at an empty shelf, with no adjustment, when no count is given', async () => {
      const response = await post('/v1/products', adminAuth, { name: 'Shampoo', priceCents: 4200 });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        stockQuantity: 0,
        lowStockThreshold: 0,
        lowStock: true,
        costCents: null,
      });
      expect(await dataSource.getRepository(StockAdjustment).count()).toBe(0);
    });

    it('refuses a name a live product already uses, but not a retired one', async () => {
      await makeProduct(dataSource, { name: 'Cera', active: false });

      const revived = await post('/v1/products', adminAuth, { name: 'Cera', priceCents: 2500 });
      expect(revived.status).toBe(201);

      const duplicate = await post('/v1/products', adminAuth, { name: 'Cera', priceCents: 3000 });
      expect(duplicate.status).toBe(409);
      expect(await dataSource.getRepository(Product).count()).toBe(2);
    });

    it('rejects a free product', async () => {
      const response = await post('/v1/products', adminAuth, { name: 'Brinde', priceCents: 0 });

      expect(response.status).toBe(400);
    });

    it('is closed to managers', async () => {
      const response = await post('/v1/products', managerAuth, {
        name: 'Balm',
        priceCents: 3000,
      });

      expect(response.status).toBe(403);
      expect(await dataSource.getRepository(Product).count()).toBe(0);
    });
  });

  describe('GET /v1/products', () => {
    it('hides retired products unless asked, and never from a client', async () => {
      await makeProduct(dataSource, { name: 'Ativo' });
      await makeProduct(dataSource, { name: 'Antigo', active: false });

      const listed = await get('/v1/products', barberAuth);
      expect(listed.status).toBe(200);
      expect(listed.body.data.map((row: { name: string }) => row.name)).toEqual(['Ativo']);
      expect(listed.body.meta).toMatchObject({ total: 1, limit: 50, offset: 0 });

      const all = await get('/v1/products?includeInactive=true', adminAuth);
      expect(all.body.data.map((row: { name: string }) => row.name)).toEqual(['Antigo', 'Ativo']);

      expect((await get('/v1/products', clientAuth)).status).toBe(403);
    });

    it('filters the shelves that need restocking', async () => {
      await makeProduct(dataSource, { name: 'Acabando', stockQuantity: 2, lowStockThreshold: 3 });
      await makeProduct(dataSource, { name: 'Cheio', stockQuantity: 20, lowStockThreshold: 3 });

      const response = await get('/v1/products?lowStock=true', managerAuth);

      expect(response.body.data.map((row: { name: string }) => row.name)).toEqual(['Acabando']);
      expect(response.body.data[0].lowStock).toBe(true);
    });

    it('searches by name', async () => {
      await makeProduct(dataSource, { name: 'Óleo para Barba' });
      await makeProduct(dataSource, { name: 'Shampoo' });

      const response = await get('/v1/products?search=barba', managerAuth);

      expect(response.body.data.map((row: { name: string }) => row.name)).toEqual([
        'Óleo para Barba',
      ]);
    });
  });

  describe('GET /v1/products/:id', () => {
    it('reads one product', async () => {
      const product = await makeProduct(dataSource, { name: 'Balm', price: 3900 });

      const response = await get(`/v1/products/${product.id}`, barberAuth);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ name: 'Balm', priceCents: 3900 });
    });

    it('404s on an unknown id', async () => {
      expect((await get(`/v1/products/${UNKNOWN_UUID}`, adminAuth)).status).toBe(404);
    });
  });

  describe('PATCH /v1/products/:id', () => {
    it('changes the price and the threshold', async () => {
      const product = await makeProduct(dataSource, { price: 3500, lowStockThreshold: 3 });

      const response = await patch(`/v1/products/${product.id}`, adminAuth, {
        priceCents: 3900,
        lowStockThreshold: 6,
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ priceCents: 3900, lowStockThreshold: 6 });
    });

    it('refuses to move stock', async () => {
      const product = await makeProduct(dataSource, { stockQuantity: 10 });

      const response = await patch(`/v1/products/${product.id}`, adminAuth, { stockQuantity: 99 });

      expect(response.status).toBe(400);
      expect(
        (await dataSource.getRepository(Product).findOneBy({ id: product.id }))?.stockQuantity,
      ).toBe(10);
    });

    it('refuses a rename onto a live product and is closed to managers', async () => {
      await makeProduct(dataSource, { name: 'Cera' });
      const product = await makeProduct(dataSource, { name: 'Pomada' });

      expect((await patch(`/v1/products/${product.id}`, adminAuth, { name: 'Cera' })).status).toBe(
        409,
      );
      expect(
        (await patch(`/v1/products/${product.id}`, managerAuth, { priceCents: 1000 })).status,
      ).toBe(403);
    });
  });

  describe('POST /v1/products/:id/stock-adjustments', () => {
    it('receives stock and records who and why', async () => {
      const product = await makeProduct(dataSource, { stockQuantity: 4 });

      const response = await post(`/v1/products/${product.id}/stock-adjustments`, managerAuth, {
        delta: 12,
        reason: 'purchase',
        notes: 'entrega do fornecedor',
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        delta: 12,
        reason: 'purchase',
        resultingQuantity: 16,
        notes: 'entrega do fornecedor',
        createdBy: managerId,
      });
      expect(
        (await dataSource.getRepository(Product).findOneBy({ id: product.id }))?.stockQuantity,
      ).toBe(16);
    });

    it('writes off breakage', async () => {
      const product = await makeProduct(dataSource, { stockQuantity: 10 });

      const response = await post(`/v1/products/${product.id}/stock-adjustments`, managerAuth, {
        delta: -2,
        reason: 'loss',
      });

      expect(response.body.data).toMatchObject({ delta: -2, resultingQuantity: 8, notes: null });
    });

    it('refuses a delta that would leave negative stock, changing nothing', async () => {
      const product = await makeProduct(dataSource, { stockQuantity: 2 });

      const response = await post(`/v1/products/${product.id}/stock-adjustments`, managerAuth, {
        delta: -3,
        reason: 'correction',
      });

      expect(response.status).toBe(400);
      expect(
        (await dataSource.getRepository(Product).findOneBy({ id: product.id }))?.stockQuantity,
      ).toBe(2);
      expect(await dataSource.getRepository(StockAdjustment).count()).toBe(0);
    });

    it('rejects a zero delta and an invented reason', async () => {
      const product = await makeProduct(dataSource);

      expect(
        (
          await post(`/v1/products/${product.id}/stock-adjustments`, managerAuth, {
            delta: 0,
            reason: 'purchase',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post(`/v1/products/${product.id}/stock-adjustments`, managerAuth, {
            delta: 1,
            reason: 'sale',
          })
        ).status,
      ).toBe(400);
    });

    it('is closed to barbers', async () => {
      const product = await makeProduct(dataSource);

      const response = await post(`/v1/products/${product.id}/stock-adjustments`, barberAuth, {
        delta: 1,
        reason: 'purchase',
      });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /v1/products/:id/stock-adjustments', () => {
    it('reads the trail newest first', async () => {
      const product = await makeProduct(dataSource);
      await makeStockAdjustment(dataSource, {
        productId: product.id,
        delta: 10,
        reason: 'purchase',
        createdAt: new Date('2026-03-01T12:00:00.000Z'),
      });
      await makeStockAdjustment(dataSource, {
        productId: product.id,
        delta: -1,
        reason: 'loss',
        createdAt: new Date('2026-03-08T12:00:00.000Z'),
      });

      const response = await get(`/v1/products/${product.id}/stock-adjustments`, adminAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.map((row: { reason: string }) => row.reason)).toEqual([
        'loss',
        'purchase',
      ]);
      expect(response.body.meta.total).toBe(2);
    });

    it('404s on an unknown product rather than answering an empty trail', async () => {
      expect((await get(`/v1/products/${UNKNOWN_UUID}/stock-adjustments`, adminAuth)).status).toBe(
        404,
      );
    });
  });

  describe('DELETE /v1/products/:id', () => {
    it('retires the product instead of deleting the row', async () => {
      const product = await makeProduct(dataSource);

      const response = await request(app)
        .delete(`/v1/products/${product.id}`)
        .set('Authorization', adminAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.active).toBe(false);
      expect(await dataSource.getRepository(Product).findOneBy({ id: product.id })).not.toBeNull();
    });

    it('leaves a retired product adjustable', async () => {
      const product = await makeProduct(dataSource, { stockQuantity: 3, active: false });

      const response = await post(`/v1/products/${product.id}/stock-adjustments`, managerAuth, {
        delta: -3,
        reason: 'loss',
        notes: 'sobra descartada',
      });

      expect(response.status).toBe(201);
      expect(response.body.data.resultingQuantity).toBe(0);
    });

    it('is closed to managers', async () => {
      const product = await makeProduct(dataSource);

      const response = await request(app)
        .delete(`/v1/products/${product.id}`)
        .set('Authorization', managerAuth);

      expect(response.status).toBe(403);
    });
  });

  it('refuses every route without a token', async () => {
    const product = await makeProduct(dataSource);

    const responses = await Promise.all([
      request(app).get('/v1/products'),
      request(app).get(`/v1/products/${product.id}`),
      request(app).post('/v1/products').send({ name: 'X', priceCents: 100 }),
      request(app).patch(`/v1/products/${product.id}`).send({ priceCents: 100 }),
      request(app).post(`/v1/products/${product.id}/stock-adjustments`).send({
        delta: 1,
        reason: 'purchase',
      }),
      request(app).get(`/v1/products/${product.id}/stock-adjustments`),
      request(app).delete(`/v1/products/${product.id}`),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401, 401, 401, 401, 401,
    ]);
  });
});
