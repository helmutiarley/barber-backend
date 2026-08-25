import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Cradle } from '../../src/container';
import { Product } from '../../src/entities/product.entity';
import { ProductsRepository } from '../../src/repositories/products.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeProduct } from '../support/factories';

const PAGE = { limit: 50, offset: 0 };

describe('products repository', () => {
  let dataSource: DataSource;
  let repository: ProductsRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new ProductsRepository({ dataSource } as Cradle);
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  it('round-trips money as cents and defaults the optional columns', async () => {
    const created = await repository.create({
      name: 'Pomada Modeladora',
      price: 3500,
      cost: 1800,
      stockQuantity: 12,
      lowStockThreshold: 4,
    });

    expect(await repository.findById(created.id)).toMatchObject({
      name: 'Pomada Modeladora',
      price: 3500,
      cost: 1800,
      stockQuantity: 12,
      lowStockThreshold: 4,
      description: null,
      active: true,
    });
  });

  it('leaves an unrecorded cost null rather than zero', async () => {
    const created = await repository.create({
      name: 'Shampoo',
      price: 4200,
      stockQuantity: 3,
      lowStockThreshold: 0,
    });

    expect((await repository.findById(created.id))?.cost).toBeNull();
  });

  describe('findActiveByName', () => {
    it('finds the live row and ignores a retired one', async () => {
      await makeProduct(dataSource, { name: 'Óleo para Barba', active: false });

      expect(await repository.findActiveByName('Óleo para Barba')).toBeNull();

      const live = await makeProduct(dataSource, { name: 'Óleo para Barba' });

      expect(await repository.findActiveByName('Óleo para Barba')).toMatchObject({ id: live.id });
    });
  });

  describe('applyDelta', () => {
    it('adds and subtracts in the database rather than in the caller', async () => {
      const product = await makeProduct(dataSource, { stockQuantity: 10 });

      expect((await repository.applyDelta(product.id, 5))?.stockQuantity).toBe(15);
      expect((await repository.applyDelta(product.id, -6))?.stockQuantity).toBe(9);
    });

    it('reaches exactly zero, which is a legitimate empty shelf', async () => {
      const product = await makeProduct(dataSource, { stockQuantity: 4 });

      expect((await repository.applyDelta(product.id, -4))?.stockQuantity).toBe(0);
    });

    it('answers null and writes nothing when the move would go negative', async () => {
      const product = await makeProduct(dataSource, { stockQuantity: 2 });

      expect(await repository.applyDelta(product.id, -3)).toBeNull();
      expect((await repository.findById(product.id))?.stockQuantity).toBe(2);
    });

    it('answers null for a product that does not exist', async () => {
      expect(await repository.applyDelta('3f1e5b7a-0000-4000-8000-000000000000', 1)).toBeNull();
    });

    it('serialises concurrent moves instead of losing one', async () => {
      const product = await makeProduct(dataSource, { stockQuantity: 1 });

      const [first, second] = await Promise.all([
        repository.applyDelta(product.id, -1),
        repository.applyDelta(product.id, -1),
      ]);

      expect([first, second].filter((result) => result !== null)).toHaveLength(1);
      expect((await repository.findById(product.id))?.stockQuantity).toBe(0);
    });
  });

  describe('findMany', () => {
    it('filters low stock by each row against its own threshold', async () => {
      const atThreshold = await makeProduct(dataSource, {
        name: 'A',
        stockQuantity: 3,
        lowStockThreshold: 3,
      });
      const below = await makeProduct(dataSource, {
        name: 'B',
        stockQuantity: 0,
        lowStockThreshold: 2,
      });
      await makeProduct(dataSource, { name: 'C', stockQuantity: 9, lowStockThreshold: 2 });

      await makeProduct(dataSource, { name: 'D', stockQuantity: 1, lowStockThreshold: 0 });

      const [rows, total] = await repository.findMany({ lowStock: true }, PAGE);

      expect(rows.map((row) => row.id)).toEqual([atThreshold.id, below.id]);
      expect(total).toBe(2);
    });

    it('filters by active and orders by name', async () => {
      await makeProduct(dataSource, { name: 'Cera' });
      await makeProduct(dataSource, { name: 'Balm' });
      await makeProduct(dataSource, { name: 'Antigo', active: false });

      const [rows] = await repository.findMany({ active: true }, PAGE);

      expect(rows.map((row) => row.name)).toEqual(['Balm', 'Cera']);
    });

    it('searches by name, case-insensitively', async () => {
      await makeProduct(dataSource, { name: 'Pomada Modeladora' });
      await makeProduct(dataSource, { name: 'Shampoo' });

      const [rows] = await repository.findMany({ search: 'pomada' }, PAGE);

      expect(rows.map((row) => row.name)).toEqual(['Pomada Modeladora']);
    });

    it('counts every match while returning one page', async () => {
      await makeProduct(dataSource, { name: 'A' });
      await makeProduct(dataSource, { name: 'B' });
      await makeProduct(dataSource, { name: 'C' });

      const [rows, total] = await repository.findMany({}, { limit: 2, offset: 1 });

      expect(rows.map((row) => row.name)).toEqual(['B', 'C']);
      expect(total).toBe(3);
    });
  });

  it('joins a caller transaction and disappears when it rolls back', async () => {
    let id = '';

    await expect(
      dataSource.transaction(async (manager) => {
        const created = await repository.create(
          { name: 'Rollback', price: 1000, stockQuantity: 1, lowStockThreshold: 0 },
          manager,
        );
        id = created.id;

        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    expect(await dataSource.getRepository(Product).findOneBy({ id })).toBeNull();
  });
});
