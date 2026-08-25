import type { EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { Cradle } from '../../src/container';
import type { Product } from '../../src/entities/product.entity';
import type { StockAdjustment } from '../../src/entities/stock-adjustment.entity';
import { ConflictError, NotFoundError, ValidationError } from '../../src/errors/app-error';
import type { AuthenticatedUser } from '../../src/lib/actor';
import type { ProductChanges } from '../../src/repositories/products.repository';
import type { NewStockAdjustment } from '../../src/repositories/stock-adjustments.repository';
import { ProductsService } from '../../src/services/products.service';

const NOW = new Date('2030-03-10T18:00:00.000Z');
const MANAGER: AuthenticatedUser = { id: 'manager-1', role: 'MANAGER' };

const product = {
  id: 'product-1',
  name: 'Pomada Modeladora',
  description: null,
  price: 3500,
  cost: 1800,
  stockQuantity: 10,
  lowStockThreshold: 3,
  active: true,
} as Product;

function buildService(
  overrides: {
    productsRepository?: Record<string, unknown>;
    stockAdjustmentsRepository?: Record<string, unknown>;
  } = {},
) {
  const productsRepository = Object.assign(
    {
      create: vi.fn(async (data: Record<string, unknown>) => ({
        ...product,
        id: 'product-new',
        ...data,
      })),
      findById: vi.fn().mockResolvedValue(product),
      findActiveByName: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([[product], 1]),
      update: vi.fn(async (id: string, changes: ProductChanges) => ({
        ...product,
        id,
        ...changes,
      })),
      applyDelta: vi.fn(async (id: string, delta: number) => ({
        ...product,
        id,
        stockQuantity: product.stockQuantity + delta,
      })),
    },
    overrides.productsRepository,
  );

  const stockAdjustmentsRepository = Object.assign(
    {
      create: vi.fn(async (data: NewStockAdjustment) => ({
        id: 'adjustment-1',
        notes: null,
        ...data,
        createdAt: NOW,
      })),
      findByProduct: vi.fn().mockResolvedValue([[], 0]),
    },
    overrides.stockAdjustmentsRepository,
  );

  const manager = { marker: 'entity-manager' } as unknown as EntityManager;
  const dataSource = {
    transaction: vi.fn(async (work: (manager: EntityManager) => Promise<unknown>) => work(manager)),
  };

  const cradle = {
    productsRepository,
    stockAdjustmentsRepository,
    dataSource,
  } as unknown as Cradle;

  return {
    service: new ProductsService(cradle),
    productsRepository,
    stockAdjustmentsRepository,
    dataSource,
    manager,
  };
}

describe('ProductsService.create', () => {
  it('trims the name and defaults the optional numbers', async () => {
    const harness = buildService();

    const created = await harness.service.create(
      { name: '  Shampoo  ', priceCents: 4200 },
      MANAGER,
    );

    expect(harness.productsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Shampoo',
        price: 4200,
        cost: null,
        stockQuantity: 0,
        lowStockThreshold: 0,
      }),
    );

    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
    expect(harness.stockAdjustmentsRepository.create).not.toHaveBeenCalled();
    expect(created.lowStock).toBe(true);
  });

  it('records an opening count as a purchase in the same transaction', async () => {
    const harness = buildService();

    await harness.service.create(
      { name: 'Pomada', priceCents: 3500, stockQuantity: 12, lowStockThreshold: 4 },
      MANAGER,
    );

    expect(harness.dataSource.transaction).toHaveBeenCalledOnce();
    expect(harness.stockAdjustmentsRepository.create).toHaveBeenCalledWith(
      {
        productId: 'product-new',
        delta: 12,
        reason: 'purchase',
        resultingQuantity: 12,
        createdBy: MANAGER.id,
      },
      harness.manager,
    );
  });

  it('refuses a name another live product already uses', async () => {
    const harness = buildService({
      productsRepository: { findActiveByName: vi.fn().mockResolvedValue(product) },
    });

    await expect(
      harness.service.create({ name: 'Pomada Modeladora', priceCents: 3500 }, MANAGER),
    ).rejects.toThrow(ConflictError);
    expect(harness.productsRepository.create).not.toHaveBeenCalled();
  });
});

describe('ProductsService.list', () => {
  it('hides retired products unless asked for them', async () => {
    const harness = buildService();

    await harness.service.list({ limit: 50, offset: 0 });
    expect(harness.productsRepository.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: true }),
      { limit: 50, offset: 0 },
    );

    await harness.service.list({ limit: 50, offset: 0, includeInactive: true });
    expect(harness.productsRepository.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: undefined }),
      { limit: 50, offset: 0 },
    );
  });

  it('derives lowStock per row rather than storing it', async () => {
    const harness = buildService({
      productsRepository: {
        findMany: vi.fn().mockResolvedValue([
          [
            { ...product, id: 'a', stockQuantity: 3, lowStockThreshold: 3 },
            { ...product, id: 'b', stockQuantity: 4, lowStockThreshold: 3 },
          ],
          2,
        ]),
      },
    });

    const page = await harness.service.list({ limit: 50, offset: 0 });

    expect(page.items.map((item) => item.lowStock)).toEqual([true, false]);
  });
});

describe('ProductsService.update', () => {
  it('passes only the fields that were sent', async () => {
    const harness = buildService();

    await harness.service.update(product.id, { priceCents: 3900 });

    expect(harness.productsRepository.update).toHaveBeenCalledWith(product.id, { price: 3900 });
  });

  it('blanks a description when null is sent explicitly', async () => {
    const harness = buildService();

    await harness.service.update(product.id, { description: null });

    expect(harness.productsRepository.update).toHaveBeenCalledWith(product.id, {
      description: null,
    });
  });

  it('skips the name check when the name is unchanged', async () => {
    const harness = buildService();

    await harness.service.update(product.id, { name: '  Pomada Modeladora  ' });

    expect(harness.productsRepository.findActiveByName).not.toHaveBeenCalled();
  });

  it('refuses a rename onto another live product', async () => {
    const harness = buildService({
      productsRepository: {
        findActiveByName: vi.fn().mockResolvedValue({ ...product, id: 'product-2' }),
      },
    });

    await expect(harness.service.update(product.id, { name: 'Shampoo' })).rejects.toThrow(
      ConflictError,
    );
    expect(harness.productsRepository.update).not.toHaveBeenCalled();
  });

  it('404s on a product that does not exist', async () => {
    const harness = buildService({
      productsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(harness.service.update('missing', { priceCents: 1 })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('ProductsService.adjustStock', () => {
  it('moves the shelf and writes the reason in one transaction', async () => {
    const harness = buildService();

    const adjustment = await harness.service.adjustStock(
      product.id,
      { delta: 6, reason: 'purchase', notes: 'entrega do fornecedor' },
      MANAGER,
    );

    expect(harness.dataSource.transaction).toHaveBeenCalledOnce();
    expect(harness.productsRepository.applyDelta).toHaveBeenCalledWith(
      product.id,
      6,
      harness.manager,
    );
    expect(harness.stockAdjustmentsRepository.create).toHaveBeenCalledWith(
      {
        productId: product.id,
        delta: 6,
        reason: 'purchase',
        resultingQuantity: 16,
        notes: 'entrega do fornecedor',
        createdBy: MANAGER.id,
      },
      harness.manager,
    );
    expect(adjustment).toMatchObject({ delta: 6, resultingQuantity: 16 });
  });

  it('snapshots the count the move actually produced, not the one it was asked for', async () => {
    const harness = buildService({
      productsRepository: {
        applyDelta: vi.fn().mockResolvedValue({ ...product, stockQuantity: 7 }),
      },
    });

    await harness.service.adjustStock(product.id, { delta: -3, reason: 'loss' }, MANAGER);

    expect(harness.stockAdjustmentsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ resultingQuantity: 7, notes: null }),
      harness.manager,
    );
  });

  it('refuses a delta that would leave negative stock, writing nothing', async () => {
    const harness = buildService({
      productsRepository: { applyDelta: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.adjustStock(product.id, { delta: -30, reason: 'correction' }, MANAGER),
    ).rejects.toThrow(ValidationError);
    expect(harness.stockAdjustmentsRepository.create).not.toHaveBeenCalled();
  });

  it('still adjusts a retired product', async () => {
    const harness = buildService({
      productsRepository: {
        findById: vi.fn().mockResolvedValue({ ...product, active: false }),
      },
    });

    await expect(
      harness.service.adjustStock(product.id, { delta: -10, reason: 'loss' }, MANAGER),
    ).resolves.toMatchObject({ reason: 'loss' });
  });

  it('404s before touching anything when the product is unknown', async () => {
    const harness = buildService({
      productsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.adjustStock('missing', { delta: 1, reason: 'purchase' }, MANAGER),
    ).rejects.toThrow(NotFoundError);
    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe('ProductsService.deactivate', () => {
  it('flips the flag rather than deleting the row', async () => {
    const harness = buildService();

    const deactivated = await harness.service.deactivate(product.id);

    expect(harness.productsRepository.update).toHaveBeenCalledWith(product.id, { active: false });
    expect(deactivated.active).toBe(false);
  });

  it('is idempotent on a product that is already retired', async () => {
    const harness = buildService({
      productsRepository: {
        findById: vi.fn().mockResolvedValue({ ...product, active: false }),
      },
    });

    await expect(harness.service.deactivate(product.id)).resolves.toMatchObject({ active: false });
    expect(harness.productsRepository.update).not.toHaveBeenCalled();
  });
});

describe('ProductsService.listAdjustments', () => {
  it('reads the trail for a product that exists', async () => {
    const trail = [
      {
        id: 'adjustment-1',
        productId: product.id,
        delta: -1,
        reason: 'loss',
        resultingQuantity: 9,
        notes: null,
        createdBy: MANAGER.id,
        createdAt: NOW,
      } as StockAdjustment,
    ];
    const harness = buildService({
      stockAdjustmentsRepository: { findByProduct: vi.fn().mockResolvedValue([trail, 1]) },
    });

    const page = await harness.service.listAdjustments(product.id, { limit: 50, offset: 0 });

    expect(page).toMatchObject({ total: 1, limit: 50, offset: 0 });
    expect(page.items[0]).toMatchObject({ delta: -1, createdAt: NOW.toISOString() });
  });

  it('404s rather than answering an empty trail for an unknown product', async () => {
    const harness = buildService({
      productsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.listAdjustments('missing', { limit: 50, offset: 0 }),
    ).rejects.toThrow(NotFoundError);
  });
});
