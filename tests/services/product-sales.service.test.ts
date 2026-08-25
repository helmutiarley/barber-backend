import type { EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config';
import type { Cradle } from '../../src/container';
import type { ProductSale } from '../../src/entities/product-sale.entity';
import type { Product } from '../../src/entities/product.entity';
import { ConflictError, NotFoundError, ValidationError } from '../../src/errors/app-error';
import type { AuthenticatedUser } from '../../src/lib/actor';
import type { NewProductSale } from '../../src/repositories/product-sales.repository';
import { ProductSalesService } from '../../src/services/product-sales.service';

const NOW = new Date('2030-03-10T18:00:00.000Z');
const MANAGER: AuthenticatedUser = { id: 'manager-1', role: 'MANAGER' };

const pomade = {
  id: 'product-1',
  name: 'Pomada Modeladora',
  price: 3500,
  stockQuantity: 10,
  lowStockThreshold: 3,
  active: true,
} as Product;

const shampoo = {
  id: 'product-2',
  name: 'Shampoo Anticaspa',
  price: 2800,
  stockQuantity: 4,
  lowStockThreshold: 2,
  active: true,
} as Product;

const CATALOG: Record<string, Product> = { [pomade.id]: pomade, [shampoo.id]: shampoo };

function saleRow(row: NewProductSale, index: number): ProductSale {
  return {
    id: `sale-${index + 1}`,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    createdAt: NOW,
    ...row,
  } as ProductSale;
}

function buildService(
  overrides: {
    productSalesRepository?: Record<string, unknown>;
    productsRepository?: Record<string, unknown>;
    barbersRepository?: Record<string, unknown>;
    usersRepository?: Record<string, unknown>;
    paymentsService?: Record<string, unknown>;
    commissionsService?: Record<string, unknown>;
  } = {},
) {
  const productsRepository = Object.assign(
    {
      findById: vi.fn(async (id: string) => CATALOG[id] ?? null),
      applyDelta: vi.fn(async (id: string, delta: number) => ({
        ...CATALOG[id],
        stockQuantity: CATALOG[id].stockQuantity + delta,
      })),
    },
    overrides.productsRepository,
  );

  const productSalesRepository = Object.assign(
    {
      create: vi.fn(async (rows: NewProductSale[]) => rows.map(saleRow)),
      findById: vi.fn().mockResolvedValue(null),
      findByPayment: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([[], 0]),
      void: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          ...saleRow(
            {
              productId: pomade.id,
              quantity: 1,
              unitPrice: pomade.price,
              total: pomade.price,
              soldByBarberId: null,
              clientId: null,
              paymentId: 'payment-1',
              createdBy: MANAGER.id,
            },
            0,
          ),
          id,
          voidedAt: NOW,
          voidedBy: MANAGER.id,
          voidReason: null,
        })),
      ),
    },
    overrides.productSalesRepository,
  );

  const barbersRepository = Object.assign(
    { findById: vi.fn(async (id: string) => ({ id, active: true })) },
    overrides.barbersRepository,
  );

  const usersRepository = Object.assign(
    { findById: vi.fn(async (id: string) => ({ id, role: 'CLIENT' })) },
    overrides.usersRepository,
  );

  const paymentsService = Object.assign(
    {
      recordForSale: vi.fn(async (input: { amountCents: number; method: string }) => ({
        id: 'payment-1',
        amountCents: input.amountCents,
        method: input.method,
        cardFeeCents: 0,
        netAmountCents: input.amountCents,
      })),
      voidForSale: vi.fn().mockResolvedValue({ id: 'payment-1' }),
    },
    overrides.paymentsService,
  );

  const commissionsService = Object.assign(
    {
      recordForProductSales: vi.fn().mockResolvedValue([{ id: 'entry-1' }]),
      assertProductSalesUnsettled: vi.fn().mockResolvedValue(undefined),
      zeroForProductSales: vi.fn().mockResolvedValue(0),
    },
    overrides.commissionsService,
  );

  const manager = { marker: 'entity-manager' } as unknown as EntityManager;
  const dataSource = {
    transaction: vi.fn(async (work: (manager: EntityManager) => Promise<unknown>) => work(manager)),
  };

  const cradle = {
    productSalesRepository,
    productsRepository,
    barbersRepository,
    usersRepository,
    paymentsService,
    commissionsService,
    dataSource,
    clock: { now: () => NOW },
    config: { shopTimezone: 'America/Sao_Paulo' } as AppConfig,
  } as unknown as Cradle;

  return {
    service: new ProductSalesService(cradle),
    productSalesRepository,
    productsRepository,
    barbersRepository,
    usersRepository,
    paymentsService,
    commissionsService,
    dataSource,
    manager,
  };
}

describe('ProductSalesService.sell', () => {
  it('writes every line of a basket against one payment', async () => {
    const harness = buildService();

    const sale = await harness.service.sell(
      {
        items: [
          { productId: pomade.id, quantity: 2 },
          { productId: shampoo.id, quantity: 1 },
        ],
        method: 'cash',
      },
      MANAGER,
    );

    expect(sale.totalCents).toBe(9800);
    expect(sale.lines).toHaveLength(2);
    expect(new Set(sale.lines.map((line) => line.paymentId))).toEqual(new Set(['payment-1']));
    expect(harness.paymentsService.recordForSale).toHaveBeenCalledWith(
      { amountCents: 9800, method: 'cash' },
      MANAGER,
      harness.manager,
    );
  });

  it('snapshots the catalog price onto the line', async () => {
    const harness = buildService();

    const sale = await harness.service.sell(
      { items: [{ productId: pomade.id, quantity: 3 }], method: 'pix' },
      MANAGER,
    );

    expect(sale.lines[0]).toMatchObject({ unitPriceCents: 3500, totalCents: 10500, quantity: 3 });
  });

  it('takes the stock off the shelf inside the sale transaction', async () => {
    const harness = buildService();

    await harness.service.sell(
      {
        items: [
          { productId: pomade.id, quantity: 2 },
          { productId: shampoo.id, quantity: 1 },
        ],
        method: 'cash',
      },
      MANAGER,
    );

    expect(harness.productsRepository.applyDelta).toHaveBeenCalledWith(
      pomade.id,
      -2,
      harness.manager,
    );
    expect(harness.productsRepository.applyDelta).toHaveBeenCalledWith(
      shampoo.id,
      -1,
      harness.manager,
    );
  });

  it('refuses a basket the shelf cannot fill, before taking any money', async () => {
    const harness = buildService({
      productsRepository: { applyDelta: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.sell(
        { items: [{ productId: shampoo.id, quantity: 99 }], method: 'cash' },
        MANAGER,
      ),
    ).rejects.toThrow(ConflictError);

    expect(harness.paymentsService.recordForSale).not.toHaveBeenCalled();
    expect(harness.productSalesRepository.create).not.toHaveBeenCalled();
  });

  it('credits the seller with a commission entry', async () => {
    const harness = buildService();

    const sale = await harness.service.sell(
      {
        items: [{ productId: pomade.id, quantity: 1 }],
        method: 'cash',
        soldByBarberId: 'barber-1',
      },
      MANAGER,
    );

    expect(harness.commissionsService.recordForProductSales).toHaveBeenCalledWith(
      {
        barberId: 'barber-1',
        lines: [{ saleId: 'sale-1', total: 3500 }],
        cardFeeCents: 0,
      },
      harness.manager,
    );
    expect(sale.commissionEntryIds).toEqual(['entry-1']);
  });

  it('passes the card fee on for a net rule to share out', async () => {
    const harness = buildService({
      paymentsService: {
        recordForSale: vi.fn(async (input: { amountCents: number; method: string }) => ({
          id: 'payment-1',
          amountCents: input.amountCents,
          method: input.method,
          cardFeeCents: 111,
          netAmountCents: input.amountCents - 111,
        })),
      },
    });

    const sale = await harness.service.sell(
      {
        items: [{ productId: pomade.id, quantity: 1 }],
        method: 'credit',
        soldByBarberId: 'barber-1',
      },
      MANAGER,
    );

    expect(harness.commissionsService.recordForProductSales).toHaveBeenCalledWith(
      expect.objectContaining({ cardFeeCents: 111 }),
      harness.manager,
    );
    expect(sale.netTotalCents).toBe(3389);
  });

  it('earns nobody anything on a house sale', async () => {
    const harness = buildService();

    const sale = await harness.service.sell(
      { items: [{ productId: pomade.id, quantity: 1 }], method: 'cash' },
      MANAGER,
    );

    expect(harness.commissionsService.recordForProductSales).not.toHaveBeenCalled();
    expect(sale.commissionEntryIds).toEqual([]);
    expect(sale.lines[0].soldByBarberId).toBeNull();
  });

  it('refuses a product listed twice rather than guessing the quantity', async () => {
    const harness = buildService();

    await expect(
      harness.service.sell(
        {
          items: [
            { productId: pomade.id, quantity: 1 },
            { productId: pomade.id, quantity: 2 },
          ],
          method: 'cash',
        },
        MANAGER,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses a discontinued product', async () => {
    const harness = buildService({
      productsRepository: {
        findById: vi.fn().mockResolvedValue({ ...pomade, active: false }),
      },
    });

    await expect(
      harness.service.sell(
        { items: [{ productId: pomade.id, quantity: 1 }], method: 'cash' },
        MANAGER,
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses an unknown product, seller or client', async () => {
    const unknownProduct = buildService({
      productsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });
    const unknownBarber = buildService({
      barbersRepository: { findById: vi.fn().mockResolvedValue(null) },
    });
    const unknownClient = buildService({
      usersRepository: { findById: vi.fn().mockResolvedValue(null) },
    });
    const items = [{ productId: pomade.id, quantity: 1 }];

    await expect(unknownProduct.service.sell({ items, method: 'cash' }, MANAGER)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      unknownBarber.service.sell({ items, method: 'cash', soldByBarberId: 'nope' }, MANAGER),
    ).rejects.toThrow(NotFoundError);
    await expect(
      unknownClient.service.sell({ items, method: 'cash', clientId: 'nope' }, MANAGER),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('ProductSalesService.voidSale', () => {
  const lines = [
    {
      id: 'sale-1',
      productId: pomade.id,
      quantity: 2,
      paymentId: 'payment-1',
      createdAt: NOW,
      voidedAt: null,
    },
    {
      id: 'sale-2',
      productId: shampoo.id,
      quantity: 1,
      paymentId: 'payment-1',
      createdAt: NOW,
      voidedAt: null,
    },
  ] as ProductSale[];

  function withBasket(overrides: Record<string, unknown> = {}) {
    return buildService({
      productSalesRepository: {
        findById: vi.fn().mockResolvedValue(lines[0]),
        findByPayment: vi.fn().mockResolvedValue(lines),
        ...overrides,
      },
    });
  }

  it('puts every line back on the shelf and voids the shared payment', async () => {
    const harness = withBasket();

    await harness.service.voidSale('sale-1', { reason: '  cliente desistiu  ' }, MANAGER);

    expect(harness.productsRepository.applyDelta).toHaveBeenCalledWith(
      pomade.id,
      2,
      harness.manager,
    );
    expect(harness.productsRepository.applyDelta).toHaveBeenCalledWith(
      shampoo.id,
      1,
      harness.manager,
    );
    expect(harness.paymentsService.voidForSale).toHaveBeenCalledWith(
      'payment-1',
      'cliente desistiu',
      MANAGER,
      harness.manager,
    );
  });

  it('zeroes what the sale earned rather than deleting it', async () => {
    const harness = withBasket();

    await harness.service.voidSale('sale-1', {}, MANAGER);

    expect(harness.commissionsService.zeroForProductSales).toHaveBeenCalledWith(
      ['sale-1', 'sale-2'],
      harness.manager,
    );
  });

  it('refuses when a period has already settled the commission', async () => {
    const harness = withBasket();
    harness.commissionsService.assertProductSalesUnsettled = vi
      .fn()
      .mockRejectedValue(new ConflictError('settled'));

    await expect(harness.service.voidSale('sale-1', {}, MANAGER)).rejects.toThrow(ConflictError);
    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses a sale from another day', async () => {
    const harness = withBasket({
      findById: vi
        .fn()
        .mockResolvedValue({ ...lines[0], createdAt: new Date('2030-03-09T18:00:00.000Z') }),
    });

    await expect(harness.service.voidSale('sale-1', {}, MANAGER)).rejects.toThrow(
      'Only sales made today can be voided — record a return instead',
    );
  });

  it('refuses a second void', async () => {
    const harness = withBasket({
      findByPayment: vi.fn().mockResolvedValue([{ ...lines[0], voidedAt: NOW }, lines[1]]),
    });

    await expect(harness.service.voidSale('sale-1', {}, MANAGER)).rejects.toThrow(
      'This sale has already been voided',
    );
  });

  it('refuses an unknown sale', async () => {
    const harness = buildService();

    await expect(harness.service.voidSale('nope', {}, MANAGER)).rejects.toThrow(NotFoundError);
  });
});

describe('ProductSalesService.list', () => {
  it('passes the filters through and pages', async () => {
    const harness = buildService();

    const result = await harness.service.list({
      limit: 20,
      offset: 40,
      barberId: 'barber-1',
      voided: false,
    });

    expect(harness.productSalesRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ barberId: 'barber-1', voided: false }),
      { limit: 20, offset: 40 },
    );
    expect(result).toMatchObject({ items: [], total: 0, limit: 20, offset: 40 });
  });
});
