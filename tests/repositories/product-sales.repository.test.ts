import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProductSale } from '../../src/entities/product-sale.entity';
import { ProductSalesRepository } from '../../src/repositories/product-sales.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeBarber,
  makePayment,
  makeProduct,
  makeProductSale,
  makeUser,
  withTestShop,
} from '../support/factories';

const PAGE = { limit: 50, offset: 0 };

describe('product sales repository', () => {
  let dataSource: DataSource;
  let repository: ProductSalesRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new ProductSalesRepository(withTestShop(dataSource));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  it('writes a basket of lines sharing one payment', async () => {
    const pomade = await makeProduct(dataSource, { price: 3500 });
    const beard = await makeProduct(dataSource, { price: 2800 });
    const payment = await makePayment(dataSource, { appointmentId: null, amount: 9800 });
    const staff = await makeUser(dataSource, { role: 'MANAGER' });

    const created = await repository.create([
      {
        productId: pomade.id,
        quantity: 2,
        unitPrice: 3500,
        total: 7000,
        soldByBarberId: null,
        clientId: null,
        paymentId: payment.id,
        createdBy: staff.id,
      },
      {
        productId: beard.id,
        quantity: 1,
        unitPrice: 2800,
        total: 2800,
        soldByBarberId: null,
        clientId: null,
        paymentId: payment.id,
        createdBy: staff.id,
      },
    ]);

    expect(created).toHaveLength(2);

    const lines = await repository.findByPayment(payment.id);

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.total).reduce((sum, total) => sum + total, 0)).toBe(9800);
    expect(lines.every((line) => line.voidedAt === null)).toBe(true);
  });

  it('keeps money in integer cents through a round trip', async () => {
    const sale = await makeProductSale(dataSource, {
      quantity: 3,
      unitPrice: 1999,
      total: 5997,
    });

    const found = await repository.findById(sale.id);

    expect(found?.unitPrice).toBe(1999);
    expect(found?.total).toBe(5997);
    expect(Number.isInteger(found?.total)).toBe(true);
  });

  describe('findByPayment', () => {
    it('reads only the basket asked for', async () => {
      const sale = await makeProductSale(dataSource);
      await makeProductSale(dataSource);

      const lines = await repository.findByPayment(sale.paymentId);

      expect(lines.map((line) => line.id)).toEqual([sale.id]);
    });
  });

  describe('void', () => {
    it('stamps every line of the basket', async () => {
      const payment = await makePayment(dataSource, { appointmentId: null });
      const first = await makeProductSale(dataSource, { paymentId: payment.id });
      const second = await makeProductSale(dataSource, { paymentId: payment.id });
      const admin = await makeUser(dataSource, { role: 'ADMIN' });
      const voidedAt = new Date('2026-03-09T18:00:00.000Z');

      const voided = await repository.void([first.id, second.id], {
        voidedAt,
        voidedBy: admin.id,
        voidReason: 'cliente desistiu',
      });

      expect(voided).toHaveLength(2);
      expect(voided.every((line) => line.voidedAt?.toISOString() === voidedAt.toISOString())).toBe(
        true,
      );
      expect(voided.every((line) => line.voidReason === 'cliente desistiu')).toBe(true);
    });

    it('leaves an already voided line as it was', async () => {
      const admin = await makeUser(dataSource, { role: 'ADMIN' });
      const first = await makeProductSale(dataSource, {
        voidedAt: new Date('2026-03-01T12:00:00.000Z'),
        voidedBy: admin.id,
        voidReason: 'first reason',
      });

      const [line] = await repository.void([first.id], {
        voidedAt: new Date('2026-03-09T18:00:00.000Z'),
        voidedBy: admin.id,
        voidReason: 'second reason',
      });

      expect(line.voidReason).toBe('first reason');
      expect(line.voidedAt?.toISOString()).toBe('2026-03-01T12:00:00.000Z');
    });

    it('does nothing for an empty list', async () => {
      const admin = await makeUser(dataSource, { role: 'ADMIN' });

      expect(
        await repository.void([], { voidedAt: new Date(), voidedBy: admin.id, voidReason: null }),
      ).toEqual([]);
    });
  });

  describe('findMany', () => {
    it('filters by product, barber and client', async () => {
      const product = await makeProduct(dataSource);
      const barber = await makeBarber(dataSource);
      const client = await makeUser(dataSource, { role: 'CLIENT' });

      const wanted = await makeProductSale(dataSource, {
        productId: product.id,
        soldByBarberId: barber.id,
        clientId: client.id,
      });
      await makeProductSale(dataSource);

      expect((await repository.findMany({ productId: product.id }, PAGE))[0]).toHaveLength(1);
      expect((await repository.findMany({ barberId: barber.id }, PAGE))[1]).toBe(1);

      const [byClient] = await repository.findMany({ clientId: client.id }, PAGE);

      expect(byClient.map((line) => line.id)).toEqual([wanted.id]);
    });

    it('separates live lines from voided ones', async () => {
      const admin = await makeUser(dataSource, { role: 'ADMIN' });
      const live = await makeProductSale(dataSource);
      const dead = await makeProductSale(dataSource, {
        voidedAt: new Date(),
        voidedBy: admin.id,
        voidReason: 'erro de digitação',
      });

      const [open] = await repository.findMany({ voided: false }, PAGE);
      const [gone] = await repository.findMany({ voided: true }, PAGE);
      const [both] = await repository.findMany({}, PAGE);

      expect(open.map((line) => line.id)).toEqual([live.id]);
      expect(gone.map((line) => line.id)).toEqual([dead.id]);
      expect(both).toHaveLength(2);
    });

    it('bounds a range inclusively and reads newest first', async () => {
      const older = await makeProductSale(dataSource, {
        createdAt: new Date('2026-03-01T12:00:00.000Z'),
      });
      const newer = await makeProductSale(dataSource, {
        createdAt: new Date('2026-03-09T12:00:00.000Z'),
      });
      await makeProductSale(dataSource, { createdAt: new Date('2026-04-01T12:00:00.000Z') });

      const [rows, total] = await repository.findMany(
        { from: new Date('2026-03-01T12:00:00.000Z'), to: new Date('2026-03-09T12:00:00.000Z') },
        PAGE,
      );

      expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
      expect(total).toBe(2);
    });

    it('counts every match while returning one page', async () => {
      const product = await makeProduct(dataSource);
      await makeProductSale(dataSource, { productId: product.id });
      await makeProductSale(dataSource, { productId: product.id });
      await makeProductSale(dataSource, { productId: product.id });

      const [rows, total] = await repository.findMany(
        { productId: product.id },
        { limit: 2, offset: 0 },
      );

      expect(rows).toHaveLength(2);
      expect(total).toBe(3);
    });
  });

  it('joins a caller transaction and disappears when it rolls back', async () => {
    const product = await makeProduct(dataSource);
    const payment = await makePayment(dataSource, { appointmentId: null });
    const staff = await makeUser(dataSource, { role: 'MANAGER' });
    let id = '';

    await expect(
      dataSource.transaction(async (manager) => {
        const [created] = await repository.create(
          [
            {
              productId: product.id,
              quantity: 1,
              unitPrice: 3500,
              total: 3500,
              soldByBarberId: null,
              clientId: null,
              paymentId: payment.id,
              createdBy: staff.id,
            },
          ],
          manager,
        );
        id = created.id;

        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    expect(await dataSource.getRepository(ProductSale).findOneBy({ id })).toBeNull();
  });
});
