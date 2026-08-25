import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { CashMovement } from '../../src/entities/cash-movement.entity';
import { CommissionEntry } from '../../src/entities/commission-entry.entity';
import { Payment } from '../../src/entities/payment.entity';
import { Product } from '../../src/entities/product.entity';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAuthenticatedUser,
  makeBarber,
  makeCommissionPeriod,
  makeCommissionRule,
  makeProduct,
  makeSession,
  makeUser,
} from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';

describe('product sales routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;
  let adminAuth: string;
  let managerAuth: string;
  let barberAuth: string;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    config = loadConfig();
    app = createApp(buildContainer({ config, logger: pino({ level: 'silent' }), dataSource }));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);

    adminAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'ADMIN' })).authHeader;
    managerAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' })).authHeader;
    barberAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' })).authHeader;
  });

  function get(path: string, auth: string) {
    return request(app).get(path).set('Authorization', auth);
  }

  function post(path: string, auth: string, body: object = {}) {
    return request(app).post(path).set('Authorization', auth).send(body);
  }

  async function sellable() {
    await makeSession(dataSource);

    return {
      pomade: await makeProduct(dataSource, { name: 'Pomada', price: 3500, stockQuantity: 10 }),
      shampoo: await makeProduct(dataSource, { name: 'Shampoo', price: 2800, stockQuantity: 4 }),
    };
  }

  describe('POST /v1/product-sales', () => {
    it('sells a basket as one payment and takes the stock off the shelf', async () => {
      const { pomade, shampoo } = await sellable();

      const response = await post('/v1/product-sales', managerAuth, {
        items: [
          { productId: pomade.id, quantity: 2 },
          { productId: shampoo.id, quantity: 1 },
        ],
        method: 'cash',
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        totalCents: 9800,
        cardFeeCents: 0,
        netTotalCents: 9800,
        method: 'cash',
        commissionEntryIds: [],
      });
      expect(response.body.data.lines).toHaveLength(2);

      const products = await dataSource.getRepository(Product).findBy({});
      const counts = Object.fromEntries(products.map((row) => [row.name, row.stockQuantity]));

      expect(counts).toEqual({ Pomada: 8, Shampoo: 3 });
    });

    it('puts the cash in the open drawer as one movement', async () => {
      const { pomade } = await sellable();

      const response = await post('/v1/product-sales', managerAuth, {
        items: [{ productId: pomade.id, quantity: 1 }],
        method: 'cash',
      });

      const movements = await dataSource.getRepository(CashMovement).findBy({});

      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: 'in',
        source: 'payment',
        amount: 3500,
        paymentId: response.body.data.paymentId,
      });
    });

    it('refuses a cash sale with no register open', async () => {
      const pomade = await makeProduct(dataSource, { stockQuantity: 5 });

      const response = await post('/v1/product-sales', managerAuth, {
        items: [{ productId: pomade.id, quantity: 1 }],
        method: 'cash',
      });

      expect(response.status).toBe(409);
      expect(await dataSource.getRepository(Payment).count()).toBe(0);
      expect(
        (await dataSource.getRepository(Product).findOneBy({ id: pomade.id }))?.stockQuantity,
      ).toBe(5);
    });

    it('takes a card sale with the register closed, snapshotting the fee', async () => {
      const pomade = await makeProduct(dataSource, { price: 10_000, stockQuantity: 5 });

      const response = await post('/v1/product-sales', managerAuth, {
        items: [{ productId: pomade.id, quantity: 1 }],
        method: 'credit',
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({ cardFeeCents: 350, netTotalCents: 9650 });
      expect(await dataSource.getRepository(CashMovement).count()).toBe(0);
    });

    it('credits the seller through a products rule', async () => {
      const { pomade } = await sellable();
      const barber = await makeBarber(dataSource);
      await makeCommissionRule(dataSource, { appliesTo: 'products', rate: 0.1, base: 'gross' });

      const response = await post('/v1/product-sales', managerAuth, {
        items: [{ productId: pomade.id, quantity: 2 }],
        method: 'cash',
        soldByBarberId: barber.id,
      });

      expect(response.status).toBe(201);
      expect(response.body.data.commissionEntryIds).toHaveLength(1);

      const entry = await dataSource.getRepository(CommissionEntry).findOneBy({});

      expect(entry).toMatchObject({
        barberId: barber.id,
        appointmentId: null,
        productSaleId: response.body.data.lines[0].id,
        baseAmount: 7000,
        amount: 700,
      });
    });

    it('sells with no commission when the seller has no products rule', async () => {
      const { pomade } = await sellable();
      const barber = await makeBarber(dataSource);

      await makeCommissionRule(dataSource, { appliesTo: 'services', rate: 0.4 });

      const response = await post('/v1/product-sales', managerAuth, {
        items: [{ productId: pomade.id, quantity: 1 }],
        method: 'cash',
        soldByBarberId: barber.id,
      });

      expect(response.status).toBe(201);
      expect(response.body.data.commissionEntryIds).toEqual([]);
      expect(response.body.data.lines[0].soldByBarberId).toBe(barber.id);
      expect(await dataSource.getRepository(CommissionEntry).count()).toBe(0);
    });

    it('409s a basket the shelf cannot fill, writing nothing', async () => {
      const { shampoo } = await sellable();

      const response = await post('/v1/product-sales', managerAuth, {
        items: [{ productId: shampoo.id, quantity: 99 }],
        method: 'cash',
      });

      expect(response.status).toBe(409);
      expect(await dataSource.getRepository(Payment).count()).toBe(0);
      expect(
        (await dataSource.getRepository(Product).findOneBy({ id: shampoo.id }))?.stockQuantity,
      ).toBe(4);
    });

    it('rolls the whole basket back when one line runs out', async () => {
      const { pomade, shampoo } = await sellable();

      const response = await post('/v1/product-sales', managerAuth, {
        items: [
          { productId: pomade.id, quantity: 1 },
          { productId: shampoo.id, quantity: 99 },
        ],
        method: 'cash',
      });

      expect(response.status).toBe(409);
      expect(
        (await dataSource.getRepository(Product).findOneBy({ id: pomade.id }))?.stockQuantity,
      ).toBe(10);
    });

    it('409s a discontinued product and 404s an unknown one', async () => {
      await makeSession(dataSource);
      const retired = await makeProduct(dataSource, { active: false, stockQuantity: 5 });

      expect(
        (
          await post('/v1/product-sales', managerAuth, {
            items: [{ productId: retired.id, quantity: 1 }],
            method: 'cash',
          })
        ).status,
      ).toBe(409);

      expect(
        (
          await post('/v1/product-sales', managerAuth, {
            items: [{ productId: UNKNOWN_UUID, quantity: 1 }],
            method: 'cash',
          })
        ).status,
      ).toBe(404);
    });

    it('400s an empty basket, a zero quantity and a repeated product', async () => {
      const { pomade } = await sellable();

      expect(
        (await post('/v1/product-sales', managerAuth, { items: [], method: 'cash' })).status,
      ).toBe(400);
      expect(
        (
          await post('/v1/product-sales', managerAuth, {
            items: [{ productId: pomade.id, quantity: 0 }],
            method: 'cash',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post('/v1/product-sales', managerAuth, {
            items: [
              { productId: pomade.id, quantity: 1 },
              { productId: pomade.id, quantity: 2 },
            ],
            method: 'cash',
          })
        ).status,
      ).toBe(400);
    });

    it('lets exactly one of two tills sell the last unit', async () => {
      await makeSession(dataSource);
      const last = await makeProduct(dataSource, { stockQuantity: 1 });
      const sell = () =>
        post('/v1/product-sales', managerAuth, {
          items: [{ productId: last.id, quantity: 1 }],
          method: 'cash',
        });

      const [first, second] = await Promise.all([sell(), sell()]);
      const statuses = [first.status, second.status].sort();

      expect(statuses).toEqual([201, 409]);
      expect(
        (await dataSource.getRepository(Product).findOneBy({ id: last.id }))?.stockQuantity,
      ).toBe(0);
      expect(await dataSource.getRepository(Payment).count()).toBe(1);
    });

    it('keeps a barber away from the till', async () => {
      const { pomade } = await sellable();

      const response = await post('/v1/product-sales', barberAuth, {
        items: [{ productId: pomade.id, quantity: 1 }],
        method: 'cash',
      });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /v1/product-sales', () => {
    it('lists lines newest first and filters by barber', async () => {
      const { pomade, shampoo } = await sellable();
      const barber = await makeBarber(dataSource);

      await post('/v1/product-sales', managerAuth, {
        items: [{ productId: pomade.id, quantity: 1 }],
        method: 'cash',
      });
      await post('/v1/product-sales', managerAuth, {
        items: [{ productId: shampoo.id, quantity: 1 }],
        method: 'cash',
        soldByBarberId: barber.id,
      });

      const all = await get('/v1/product-sales', managerAuth);
      const mine = await get(`/v1/product-sales?barberId=${barber.id}`, managerAuth);

      expect(all.body.meta.total).toBe(2);
      expect(mine.body.meta.total).toBe(1);
      expect(mine.body.data[0].productId).toBe(shampoo.id);
    });

    it('400s a range that runs backwards', async () => {
      const response = await get('/v1/product-sales?from=2030-03-10&to=2030-03-01', managerAuth);

      expect(response.status).toBe(400);
    });

    it('keeps a barber out of the sales list', async () => {
      expect((await get('/v1/product-sales', barberAuth)).status).toBe(403);
    });
  });

  describe('GET /v1/product-sales/:id', () => {
    it('answers with every line of the basket, from any one of them', async () => {
      const { pomade, shampoo } = await sellable();

      const sale = await post('/v1/product-sales', managerAuth, {
        items: [
          { productId: pomade.id, quantity: 1 },
          { productId: shampoo.id, quantity: 1 },
        ],
        method: 'pix',
      });

      const response = await get(`/v1/product-sales/${sale.body.data.lines[1].id}`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });

    it('404s an unknown sale', async () => {
      expect((await get(`/v1/product-sales/${UNKNOWN_UUID}`, managerAuth)).status).toBe(404);
    });
  });

  describe('POST /v1/product-sales/:id/void', () => {
    async function sold(soldByBarberId?: string) {
      const { pomade, shampoo } = await sellable();

      const response = await post('/v1/product-sales', managerAuth, {
        items: [
          { productId: pomade.id, quantity: 2 },
          { productId: shampoo.id, quantity: 1 },
        ],
        method: 'cash',
        ...(soldByBarberId ? { soldByBarberId } : {}),
      });

      return { sale: response.body.data, pomade, shampoo };
    }

    it('restocks every line and voids the shared payment', async () => {
      const { sale, pomade, shampoo } = await sold();

      const response = await post(`/v1/product-sales/${sale.lines[0].id}/void`, adminAuth, {
        reason: 'cliente desistiu',
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every((line: { voidedAt: string }) => line.voidedAt)).toBe(true);

      const products = await dataSource.getRepository(Product).findBy({});
      const counts = Object.fromEntries(products.map((row) => [row.id, row.stockQuantity]));

      expect(counts[pomade.id]).toBe(10);
      expect(counts[shampoo.id]).toBe(4);
      expect(
        (await dataSource.getRepository(Payment).findOneBy({ id: sale.paymentId }))?.voidReason,
      ).toBe('cliente desistiu');
    });

    it('takes the cash back out with a compensating movement', async () => {
      const { sale } = await sold();

      await post(`/v1/product-sales/${sale.lines[0].id}/void`, adminAuth, {});

      const movements = await dataSource
        .getRepository(CashMovement)
        .find({ order: { createdAt: 'ASC' } });

      expect(movements).toHaveLength(2);
      expect(movements[1]).toMatchObject({
        type: 'out',
        source: 'payment',
        amount: 9800,
        description: 'Voided sale',
      });
    });

    it('zeroes the commission and keeps its provenance', async () => {
      const barber = await makeBarber(dataSource);
      const rule = await makeCommissionRule(dataSource, { appliesTo: 'products', rate: 0.1 });
      const { sale } = await sold(barber.id);

      await post(`/v1/product-sales/${sale.lines[0].id}/void`, adminAuth, {});

      const entries = await dataSource.getRepository(CommissionEntry).findBy({});

      expect(entries).toHaveLength(2);
      expect(entries.every((entry) => entry.amount === 0 && entry.baseAmount === 0)).toBe(true);
      expect(entries.every((entry) => entry.ruleId === rule.id && entry.rate === 0.1)).toBe(true);
    });

    it('refuses once a period has settled the commission', async () => {
      const barber = await makeBarber(dataSource);
      await makeCommissionRule(dataSource, { appliesTo: 'products', rate: 0.1 });
      const { sale, pomade } = await sold(barber.id);
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id });

      await dataSource
        .getRepository(CommissionEntry)
        .update({ barberId: barber.id }, { periodId: period.id });

      const response = await post(`/v1/product-sales/${sale.lines[0].id}/void`, adminAuth, {});

      expect(response.status).toBe(409);
      expect(
        (await dataSource.getRepository(Product).findOneBy({ id: pomade.id }))?.stockQuantity,
      ).toBe(8);
    });

    it('refuses a second void', async () => {
      const { sale } = await sold();

      await post(`/v1/product-sales/${sale.lines[0].id}/void`, adminAuth, {});
      const second = await post(`/v1/product-sales/${sale.lines[1].id}/void`, adminAuth, {});

      expect(second.status).toBe(409);
    });

    it('keeps a manager from undoing money', async () => {
      const { sale } = await sold();

      expect(
        (await post(`/v1/product-sales/${sale.lines[0].id}/void`, managerAuth, {})).status,
      ).toBe(403);
    });

    it('404s an unknown sale', async () => {
      expect((await post(`/v1/product-sales/${UNKNOWN_UUID}/void`, adminAuth, {})).status).toBe(
        404,
      );
    });
  });

  it('rejects every route without a token', async () => {
    const paths = ['/v1/product-sales', `/v1/product-sales/${UNKNOWN_UUID}`];

    for (const path of paths) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).post('/v1/product-sales').send({})).status).toBe(401);
  });

  it('links a sale to a client for the CRM', async () => {
    const { pomade } = await sellable();
    const client = await makeUser(dataSource, { role: 'CLIENT' });

    const response = await post('/v1/product-sales', managerAuth, {
      items: [{ productId: pomade.id, quantity: 1 }],
      method: 'pix',
      clientId: client.id,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.lines[0].clientId).toBe(client.id);
  });
});
