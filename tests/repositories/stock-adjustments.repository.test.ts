import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StockAdjustment } from '../../src/entities/stock-adjustment.entity';
import { StockAdjustmentsRepository } from '../../src/repositories/stock-adjustments.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeProduct, makeStockAdjustment, makeUser, withTestShop } from '../support/factories';

const PAGE = { limit: 50, offset: 0 };

describe('stock adjustments repository', () => {
  let dataSource: DataSource;
  let repository: StockAdjustmentsRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new StockAdjustmentsRepository(withTestShop(dataSource));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  it('stores a signed delta with the count it left behind', async () => {
    const product = await makeProduct(dataSource, { stockQuantity: 10 });
    const staff = await makeUser(dataSource, { role: 'MANAGER' });

    const created = await repository.create({
      productId: product.id,
      delta: -2,
      reason: 'loss',
      resultingQuantity: 8,
      notes: 'dois frascos quebrados na prateleira',
      createdBy: staff.id,
    });

    const [rows] = await repository.findByProduct(product.id, PAGE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created.id,
      delta: -2,
      reason: 'loss',
      resultingQuantity: 8,
      notes: 'dois frascos quebrados na prateleira',
    });
  });

  it('defaults notes to null rather than an empty string', async () => {
    const product = await makeProduct(dataSource);
    const staff = await makeUser(dataSource, { role: 'MANAGER' });

    const created = await repository.create({
      productId: product.id,
      delta: 6,
      reason: 'purchase',
      resultingQuantity: 16,
      createdBy: staff.id,
    });

    expect(created.notes).toBeNull();
  });

  describe('findByProduct', () => {
    it('reads newest first and only this product', async () => {
      const product = await makeProduct(dataSource);
      const other = await makeProduct(dataSource);

      const older = await makeStockAdjustment(dataSource, {
        productId: product.id,
        createdAt: new Date('2026-03-01T12:00:00.000Z'),
      });
      const newer = await makeStockAdjustment(dataSource, {
        productId: product.id,
        createdAt: new Date('2026-03-09T12:00:00.000Z'),
      });
      await makeStockAdjustment(dataSource, { productId: other.id });

      const [rows, total] = await repository.findByProduct(product.id, PAGE);

      expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
      expect(total).toBe(2);
    });

    it('counts every row while returning one page', async () => {
      const product = await makeProduct(dataSource);
      await makeStockAdjustment(dataSource, { productId: product.id });
      await makeStockAdjustment(dataSource, { productId: product.id });
      await makeStockAdjustment(dataSource, { productId: product.id });

      const [rows, total] = await repository.findByProduct(product.id, { limit: 2, offset: 0 });

      expect(rows).toHaveLength(2);
      expect(total).toBe(3);
    });
  });

  it('joins a caller transaction and disappears when it rolls back', async () => {
    const product = await makeProduct(dataSource);
    const staff = await makeUser(dataSource, { role: 'MANAGER' });
    let id = '';

    await expect(
      dataSource.transaction(async (manager) => {
        const created = await repository.create(
          {
            productId: product.id,
            delta: 3,
            reason: 'correction',
            resultingQuantity: 13,
            createdBy: staff.id,
          },
          manager,
        );
        id = created.id;

        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    expect(await dataSource.getRepository(StockAdjustment).findOneBy({ id })).toBeNull();
  });
});
