import type { EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config';
import type { Cradle } from '../../src/container';
import type { Appointment } from '../../src/entities/appointment.entity';
import type { Barber } from '../../src/entities/barber.entity';
import type { CommissionAdvance } from '../../src/entities/commission-advance.entity';
import type { CommissionEntry } from '../../src/entities/commission-entry.entity';
import type { CommissionPeriod } from '../../src/entities/commission-period.entity';
import type { CommissionRule } from '../../src/entities/commission-rule.entity';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../src/errors/app-error';
import type { AuthenticatedUser } from '../../src/lib/actor';
import { CommissionsService } from '../../src/services/commissions.service';

const ADMIN: AuthenticatedUser = { id: 'admin-1', role: 'ADMIN' };
const BARBER: AuthenticatedUser = { id: 'user-barber-1', role: 'BARBER' };

const NOW = new Date('2030-06-01T12:00:00.000Z');
const config = { shopTimezone: 'America/Sao_Paulo' } as AppConfig;

const barber = { id: 'barber-1', userId: BARBER.id, active: true } as Barber;

const appointment = {
  id: 'appointment-1',
  barberId: barber.id,
  serviceId: 'service-1',
  status: 'confirmed',
  price: 4500,
} as Appointment;

function makeRule(overrides: Partial<CommissionRule> = {}): CommissionRule {
  return {
    id: 'rule-1',
    barberId: null,
    serviceId: null,
    rate: 0.4,
    base: 'gross',
    appliesTo: 'services',
    active: true,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  } as CommissionRule;
}

function makePeriod(overrides: Partial<CommissionPeriod> = {}): CommissionPeriod {
  const totalEntries = overrides.totalEntries ?? 20_000;
  const totalAdvances = overrides.totalAdvances ?? 5000;

  return {
    id: 'period-1',
    barberId: barber.id,
    startsOn: '2030-05-01',
    endsOn: '2030-05-15',
    status: 'closed',
    closedBy: ADMIN.id,
    closedAt: NOW,
    paidAt: null,
    paymentMethod: null,
    createdAt: NOW,
    ...overrides,
    totalEntries,
    totalAdvances,
    totalDue: overrides.totalDue ?? totalEntries - totalAdvances,
  } as CommissionPeriod;
}

function makeEntry(overrides: Partial<CommissionEntry> = {}): CommissionEntry {
  return {
    id: 'entry-1',
    barberId: barber.id,
    appointmentId: appointment.id,
    ruleId: 'rule-1',
    rate: 0.4,
    base: 'gross',
    baseAmount: 4500,
    amount: 1800,
    periodId: null,
    createdAt: NOW,
    ...overrides,
  } as CommissionEntry;
}

function makeAdvance(overrides: Partial<CommissionAdvance> = {}): CommissionAdvance {
  return {
    id: 'advance-1',
    barberId: barber.id,
    amount: 5000,
    periodId: null,
    notes: null,
    createdBy: ADMIN.id,
    createdAt: NOW,
    ...overrides,
  } as CommissionAdvance;
}

function buildService(
  overrides: {
    commissionRulesRepository?: Record<string, unknown>;
    commissionEntriesRepository?: Record<string, unknown>;
    commissionPeriodsRepository?: Record<string, unknown>;
    commissionAdvancesRepository?: Record<string, unknown>;
    paymentsRepository?: Record<string, unknown>;
    barbersRepository?: Record<string, unknown>;
    servicesRepository?: Record<string, unknown>;
    cashRegisterService?: Record<string, unknown>;
  } = {},
) {
  const commissionRulesRepository = Object.assign(
    {
      create: vi.fn(async (data: Record<string, unknown>) => makeRule(data)),
      findById: vi.fn().mockResolvedValue(makeRule()),
      findActiveByScope: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([makeRule()]),
      resolve: vi.fn().mockResolvedValue(makeRule()),
      update: vi.fn(async (id: string, changes: Record<string, unknown>) =>
        makeRule({ id, ...changes }),
      ),
    },
    overrides.commissionRulesRepository,
  );

  const commissionEntriesRepository = Object.assign(
    {
      create: vi.fn(
        async (data: Record<string, unknown>) =>
          ({ id: 'entry-1', createdAt: new Date(), ...data }) as CommissionEntry,
      ),
      findByAppointment: vi.fn().mockResolvedValue(null),
      findByProductSales: vi.fn().mockResolvedValue([]),
      zeroAmounts: vi.fn(async (ids: string[]) => ids.length),
      findMany: vi.fn().mockResolvedValue([[], 0]),
      findUnassignedInRange: vi.fn().mockResolvedValue([]),
      findByPeriod: vi.fn().mockResolvedValue([]),
      assignPeriod: vi.fn(async (ids: string[]) => ids.length),
      updateAmounts: vi.fn(
        async (id: string, amounts: Record<string, unknown>) =>
          ({ id, rate: 0.4, base: 'net', createdAt: new Date(), ...amounts }) as CommissionEntry,
      ),
    },
    overrides.commissionEntriesRepository,
  );

  const commissionPeriodsRepository = Object.assign(
    {
      create: vi.fn(async (data: Record<string, unknown>) => makePeriod(data)),
      findById: vi.fn().mockResolvedValue(makePeriod()),
      findOverlapping: vi.fn().mockResolvedValue(null),
      findOverlappingForBarbers: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([[], 0]),
      markPaid: vi.fn(async (id: string, paid: Record<string, unknown>) =>
        makePeriod({ id, status: 'paid', ...paid }),
      ),
    },
    overrides.commissionPeriodsRepository,
  );

  const commissionAdvancesRepository = Object.assign(
    {
      create: vi.fn(async (data: Record<string, unknown>) => makeAdvance(data)),
      findById: vi.fn().mockResolvedValue(makeAdvance()),
      findUnassignedInRange: vi.fn().mockResolvedValue([]),
      findByPeriod: vi.fn().mockResolvedValue([]),
      assignPeriod: vi.fn(async (ids: string[]) => ids.length),
      findMany: vi.fn().mockResolvedValue([[], 0]),
    },
    overrides.commissionAdvancesRepository,
  );

  const paymentsRepository = Object.assign(
    { sumNetForAppointment: vi.fn().mockResolvedValue(null) },
    overrides.paymentsRepository,
  );

  const barbersRepository = Object.assign(
    {
      findById: vi.fn().mockResolvedValue(barber),
      findByUserId: vi.fn().mockResolvedValue(barber),
    },
    overrides.barbersRepository,
  );

  const servicesRepository = Object.assign(
    { findById: vi.fn().mockResolvedValue({ id: 'service-1' }) },
    overrides.servicesRepository,
  );

  const cashRegisterService = Object.assign(
    {
      requireOpenSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
      recordMovement: vi.fn().mockResolvedValue({ id: 'movement-1' }),
    },
    overrides.cashRegisterService,
  );

  const manager = { marker: 'entity-manager' } as unknown as EntityManager;
  const dataSource = {
    transaction: vi.fn(async (work: (manager: EntityManager) => Promise<unknown>) => work(manager)),
  };

  const cradle = {
    commissionRulesRepository,
    commissionEntriesRepository,
    commissionPeriodsRepository,
    commissionAdvancesRepository,
    paymentsRepository,
    barbersRepository,
    servicesRepository,
    cashRegisterService,
    dataSource,
    clock: { now: () => NOW },
    config,
  } as unknown as Cradle;

  return {
    service: new CommissionsService(cradle),
    commissionRulesRepository,
    commissionEntriesRepository,
    commissionPeriodsRepository,
    commissionAdvancesRepository,
    paymentsRepository,
    barbersRepository,
    cashRegisterService,
    dataSource,
    manager,
  };
}

describe('CommissionsService.createRule', () => {
  it('defaults to a services rule covering every barber', async () => {
    const harness = buildService();

    const rule = await harness.service.createRule({ rate: 0.4, base: 'gross' });

    expect(harness.commissionRulesRepository.create).toHaveBeenCalledWith({
      barberId: null,
      serviceId: null,
      appliesTo: 'services',
      rate: 0.4,
      base: 'gross',
    });
    expect(rule).toMatchObject({ rate: 0.4, appliesTo: 'services' });
  });

  it('refuses a second active rule on the same scope', async () => {
    const harness = buildService({
      commissionRulesRepository: { findActiveByScope: vi.fn().mockResolvedValue(makeRule()) },
    });

    await expect(harness.service.createRule({ rate: 0.5, base: 'gross' })).rejects.toThrow(
      ConflictError,
    );
    expect(harness.commissionRulesRepository.create).not.toHaveBeenCalled();
  });

  it('refuses a product rule that names a service', async () => {
    const harness = buildService();

    await expect(
      harness.service.createRule({
        rate: 0.1,
        base: 'gross',
        appliesTo: 'products',
        serviceId: 'service-1',
      }),
    ).rejects.toThrow(/cannot name a service/);
  });

  it('404s on a barber that does not exist, rather than failing on the foreign key', async () => {
    const harness = buildService({
      barbersRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.createRule({ barberId: 'ghost', rate: 0.4, base: 'gross' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('CommissionsService.updateRule', () => {
  it('passes through only the fields given', async () => {
    const harness = buildService();

    await harness.service.updateRule('rule-1', { rate: 0.45 });

    expect(harness.commissionRulesRepository.update).toHaveBeenCalledWith('rule-1', { rate: 0.45 });
  });

  it('404s on an unknown rule', async () => {
    const harness = buildService({
      commissionRulesRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(harness.service.updateRule('nope', { active: false })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('refuses to reactivate a rule whose scope was taken over', async () => {
    const harness = buildService({
      commissionRulesRepository: {
        findById: vi.fn().mockResolvedValue(makeRule({ active: false })),
        findActiveByScope: vi.fn().mockResolvedValue(makeRule({ id: 'rule-2' })),
      },
    });

    await expect(harness.service.updateRule('rule-1', { active: true })).rejects.toThrow(
      ConflictError,
    );
    expect(harness.commissionRulesRepository.update).not.toHaveBeenCalled();
  });
});

describe('CommissionsService.listRules', () => {
  it('narrows a barber to the rules that decide their own pay', async () => {
    const harness = buildService();

    await harness.service.listRules({}, BARBER);

    expect(harness.commissionRulesRepository.findMany).toHaveBeenCalledWith({
      appliesTo: undefined,
      active: undefined,
      appliesToBarberId: barber.id,
    });
  });

  it('leaves staff unnarrowed', async () => {
    const harness = buildService();

    await harness.service.listRules({ active: true }, ADMIN);

    expect(harness.commissionRulesRepository.findMany).toHaveBeenCalledWith({
      appliesTo: undefined,
      active: true,
    });
  });
});

describe('CommissionsService.recordForAppointment', () => {
  it('snapshots the resolved rate, base and amounts', async () => {
    const harness = buildService();

    const entry = await harness.service.recordForAppointment(appointment, harness.manager);

    expect(harness.commissionEntriesRepository.create).toHaveBeenCalledWith(
      {
        barberId: barber.id,
        appointmentId: appointment.id,
        ruleId: 'rule-1',
        rate: 0.4,
        base: 'gross',
        baseAmount: 4500,
        amount: 1800,
      },
      harness.manager,
    );
    expect(entry).toMatchObject({ baseAmountCents: 4500, amountCents: 1800 });
  });

  it('resolves the rule for this barber and service, inside the transaction', async () => {
    const harness = buildService();

    await harness.service.recordForAppointment(appointment, harness.manager);

    expect(harness.commissionRulesRepository.resolve).toHaveBeenCalledWith(
      { barberId: barber.id, serviceId: appointment.serviceId, appliesTo: 'services' },
      harness.manager,
    );
  });

  it('refuses to record anything when no rule applies', async () => {
    const harness = buildService({
      commissionRulesRepository: { resolve: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.recordForAppointment(appointment, harness.manager),
    ).rejects.toThrow(/No commission rule configured for barber/);
    expect(harness.commissionEntriesRepository.create).not.toHaveBeenCalled();
  });

  it('rounds half up, once', async () => {

    const harness = buildService({
      commissionRulesRepository: { resolve: vi.fn().mockResolvedValue(makeRule({ rate: 0.375 })) },
    });

    const entry = await harness.service.recordForAppointment(appointment, harness.manager);

    expect(entry.amountCents).toBe(1688);
  });

  describe('with a net base', () => {
    const netRule = makeRule({ base: 'net', rate: 0.4 });

    it('uses what actually landed after card fees', async () => {

      const harness = buildService({
        commissionRulesRepository: { resolve: vi.fn().mockResolvedValue(netRule) },
        paymentsRepository: { sumNetForAppointment: vi.fn().mockResolvedValue(4425) },
      });

      const entry = await harness.service.recordForAppointment(appointment, harness.manager);

      expect(entry).toMatchObject({ base: 'net', baseAmountCents: 4425, amountCents: 1770 });
    });

    it('falls back to the price when nothing has been paid yet', async () => {
      const harness = buildService({
        commissionRulesRepository: { resolve: vi.fn().mockResolvedValue(netRule) },
        paymentsRepository: { sumNetForAppointment: vi.fn().mockResolvedValue(null) },
      });

      const entry = await harness.service.recordForAppointment(appointment, harness.manager);

      expect(entry).toMatchObject({ baseAmountCents: 4500, amountCents: 1800 });
    });

    it('trusts a net sum that is genuinely zero', async () => {
      const harness = buildService({
        commissionRulesRepository: { resolve: vi.fn().mockResolvedValue(netRule) },
        paymentsRepository: { sumNetForAppointment: vi.fn().mockResolvedValue(0) },
      });

      const entry = await harness.service.recordForAppointment(appointment, harness.manager);

      expect(entry).toMatchObject({ baseAmountCents: 0, amountCents: 0 });
    });
  });
});

describe('CommissionsService.recordForProductSales', () => {
  const productsRule = makeRule({ id: 'rule-products', appliesTo: 'products', rate: 0.1 });
  const basket = {
    barberId: barber.id,
    lines: [
      { saleId: 'sale-1', total: 7000 },
      { saleId: 'sale-2', total: 2800 },
    ],
    cardFeeCents: 0,
  };

  function withProductsRule(rule: CommissionRule | null) {
    return buildService({
      commissionRulesRepository: { resolve: vi.fn().mockResolvedValue(rule) },
    });
  }

  it('resolves against products with no service to match on', async () => {
    const harness = withProductsRule(productsRule);

    await harness.service.recordForProductSales(basket, harness.manager);

    expect(harness.commissionRulesRepository.resolve).toHaveBeenCalledWith(
      { barberId: barber.id, serviceId: null, appliesTo: 'products' },
      harness.manager,
    );
  });

  it('writes one entry per line of the basket', async () => {
    const harness = withProductsRule(productsRule);

    const entries = await harness.service.recordForProductSales(basket, harness.manager);

    expect(entries).toHaveLength(2);
    expect(harness.commissionEntriesRepository.create).toHaveBeenNthCalledWith(
      1,
      {
        barberId: barber.id,
        productSaleId: 'sale-1',
        ruleId: 'rule-products',
        rate: 0.1,
        base: 'gross',
        baseAmount: 7000,
        amount: 700,
      },
      harness.manager,
    );
    expect(harness.commissionEntriesRepository.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ productSaleId: 'sale-2', baseAmount: 2800, amount: 280 }),
      harness.manager,
    );
  });

  it('sells with no entry at all when the seller has no products rule', async () => {
    const harness = withProductsRule(null);

    expect(await harness.service.recordForProductSales(basket, harness.manager)).toEqual([]);
    expect(harness.commissionEntriesRepository.create).not.toHaveBeenCalled();
  });

  describe('with a net base', () => {
    const netRule = makeRule({
      id: 'rule-products',
      appliesTo: 'products',
      base: 'net',
      rate: 0.1,
    });

    it('shares the card fee across the lines in proportion to their totals', async () => {
      const harness = withProductsRule(netRule);

      const entries = await harness.service.recordForProductSales(
        { ...basket, cardFeeCents: 294 },
        harness.manager,
      );

      expect(entries.map((entry) => entry.baseAmountCents)).toEqual([6790, 2716]);
    });

    it('gives the last line the rounding remainder, so the shares sum to the fee', async () => {
      const harness = withProductsRule(netRule);

      const entries = await harness.service.recordForProductSales(
        {
          barberId: barber.id,
          lines: [
            { saleId: 'sale-1', total: 1000 },
            { saleId: 'sale-2', total: 1000 },
            { saleId: 'sale-3', total: 1000 },
          ],
          cardFeeCents: 100,
        },
        harness.manager,
      );

      const bases = entries.map((entry) => entry.baseAmountCents);

      expect(bases).toEqual([967, 967, 966]);
      expect(bases.reduce((sum, base) => sum + base, 0)).toBe(3000 - 100);
    });

    it('leaves a fee-free method alone', async () => {
      const harness = withProductsRule(netRule);

      const entries = await harness.service.recordForProductSales(basket, harness.manager);

      expect(entries.map((entry) => entry.baseAmountCents)).toEqual([7000, 2800]);
    });
  });
});

describe('CommissionsService voiding a sale', () => {
  it('refuses when a period has closed over the entry', async () => {
    const harness = buildService({
      commissionEntriesRepository: {
        findByProductSales: vi
          .fn()
          .mockResolvedValue([makeEntry({ productSaleId: 'sale-1', periodId: 'period-1' })]),
      },
    });

    await expect(harness.service.assertProductSalesUnsettled(['sale-1'])).rejects.toThrow(
      ConflictError,
    );
  });

  it('passes when nothing has settled', async () => {
    const harness = buildService({
      commissionEntriesRepository: {
        findByProductSales: vi.fn().mockResolvedValue([makeEntry({ productSaleId: 'sale-1' })]),
      },
    });

    await expect(harness.service.assertProductSalesUnsettled(['sale-1'])).resolves.toBeUndefined();
  });

  it('zeroes every entry the basket earned', async () => {
    const harness = buildService({
      commissionEntriesRepository: {
        findByProductSales: vi
          .fn()
          .mockResolvedValue([
            makeEntry({ productSaleId: 'sale-1' }),
            makeEntry({ id: 'entry-2', productSaleId: 'sale-2' }),
          ]),
      },
    });

    expect(await harness.service.zeroForProductSales(['sale-1', 'sale-2'], harness.manager)).toBe(
      2,
    );
    expect(harness.commissionEntriesRepository.zeroAmounts).toHaveBeenCalledWith(
      ['entry-1', 'entry-2'],
      harness.manager,
    );
  });

  it('refuses when a close raced the void and claimed an entry', async () => {
    const harness = buildService({
      commissionEntriesRepository: {
        findByProductSales: vi.fn().mockResolvedValue([makeEntry({ productSaleId: 'sale-1' })]),
        zeroAmounts: vi.fn().mockResolvedValue(0),
      },
    });

    await expect(harness.service.zeroForProductSales(['sale-1'], harness.manager)).rejects.toThrow(
      ConflictError,
    );
  });
});

describe('CommissionsService.recalculateNetBase', () => {
  const netEntry = {
    id: 'entry-1',
    barberId: barber.id,
    appointmentId: appointment.id,
    ruleId: 'rule-1',
    rate: 0.4,
    base: 'net',
    baseAmount: 4500,
    amount: 1800,
    createdAt: new Date(),
  } as CommissionEntry;

  it('moves a net entry when a late payment changes what landed', async () => {
    const harness = buildService({
      commissionEntriesRepository: { findByAppointment: vi.fn().mockResolvedValue(netEntry) },
      paymentsRepository: { sumNetForAppointment: vi.fn().mockResolvedValue(4365) },
    });

    const updated = await harness.service.recalculateNetBase(appointment, harness.manager);

    expect(harness.commissionEntriesRepository.updateAmounts).toHaveBeenCalledWith(
      netEntry.id,
      { baseAmount: 4365, amount: 1746 },
      harness.manager,
    );
    expect(updated).toMatchObject({ baseAmountCents: 4365, amountCents: 1746 });
  });

  it('keeps the snapshotted rate rather than re-reading the rule', async () => {
    const harness = buildService({
      commissionEntriesRepository: {
        findByAppointment: vi.fn().mockResolvedValue({ ...netEntry, rate: 0.5 }),
      },
      paymentsRepository: { sumNetForAppointment: vi.fn().mockResolvedValue(4000) },
    });

    await harness.service.recalculateNetBase(appointment, harness.manager);

    expect(harness.commissionEntriesRepository.updateAmounts).toHaveBeenCalledWith(
      netEntry.id,
      { baseAmount: 4000, amount: 2000 },
      harness.manager,
    );
    expect(harness.commissionRulesRepository.resolve).not.toHaveBeenCalled();
  });

  it('leaves a gross entry alone — its base was the price, and the price has not moved', async () => {
    const harness = buildService({
      commissionEntriesRepository: {
        findByAppointment: vi.fn().mockResolvedValue({ ...netEntry, base: 'gross' }),
      },
      paymentsRepository: { sumNetForAppointment: vi.fn().mockResolvedValue(1) },
    });

    expect(await harness.service.recalculateNetBase(appointment, harness.manager)).toBeNull();
    expect(harness.commissionEntriesRepository.updateAmounts).not.toHaveBeenCalled();
  });

  it('does nothing when the appointment has no entry yet', async () => {
    const harness = buildService();

    expect(await harness.service.recalculateNetBase(appointment, harness.manager)).toBeNull();
    expect(harness.commissionEntriesRepository.updateAmounts).not.toHaveBeenCalled();
  });

  it('writes nothing when the base has not actually changed', async () => {
    const harness = buildService({
      commissionEntriesRepository: { findByAppointment: vi.fn().mockResolvedValue(netEntry) },
      paymentsRepository: { sumNetForAppointment: vi.fn().mockResolvedValue(4500) },
    });

    expect(await harness.service.recalculateNetBase(appointment, harness.manager)).toBeNull();
    expect(harness.commissionEntriesRepository.updateAmounts).not.toHaveBeenCalled();
  });
});

describe('CommissionsService.listEntries', () => {
  const page = { limit: 20, offset: 0 };

  it('pins a barber to their own entries', async () => {
    const harness = buildService();

    await harness.service.listEntries(page, BARBER);

    expect(harness.commissionEntriesRepository.findMany).toHaveBeenCalledWith(
      { barberId: barber.id, periodId: undefined, from: undefined, to: undefined },
      page,
    );
  });

  it("403s a barber asking for someone else's", async () => {
    const harness = buildService();

    await expect(
      harness.service.listEntries({ ...page, barberId: 'barber-2' }, BARBER),
    ).rejects.toThrow(ForbiddenError);
  });

  it('lets a barber name their own id', async () => {
    const harness = buildService();

    await harness.service.listEntries({ ...page, barberId: barber.id }, BARBER);

    expect(harness.commissionEntriesRepository.findMany).toHaveBeenCalledWith(
      { barberId: barber.id, periodId: undefined, from: undefined, to: undefined },
      page,
    );
  });

  it('lets staff read every barber', async () => {
    const harness = buildService();

    await harness.service.listEntries(page, ADMIN);

    expect(harness.commissionEntriesRepository.findMany).toHaveBeenCalledWith(
      { barberId: undefined, periodId: undefined, from: undefined, to: undefined },
      page,
    );
  });

  it('403s a client, who has no commissions at all', async () => {
    const harness = buildService({
      barbersRepository: { findByUserId: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.listEntries(page, { id: 'client-1', role: 'CLIENT' }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('CommissionsService.recordAdvance', () => {
  const cashAdvance = { barberId: barber.id, amountCents: 15_000, paymentMethod: 'cash' } as const;

  it('takes a cash vale out of the drawer in the same transaction', async () => {
    const harness = buildService();

    const advance = await harness.service.recordAdvance(cashAdvance, ADMIN);

    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(harness.cashRegisterService.requireOpenSession).toHaveBeenCalledWith(harness.manager);
    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        type: 'out',
        source: 'advance',
        amountCents: 15_000,
        advanceId: advance.id,
        createdBy: ADMIN.id,
      }),
      harness.manager,
    );
  });

  it('leaves the drawer alone for a Pix vale', async () => {
    const harness = buildService();

    await harness.service.recordAdvance({ ...cashAdvance, paymentMethod: 'pix' }, ADMIN);

    expect(harness.commissionAdvancesRepository.create).toHaveBeenCalledTimes(1);
    expect(harness.cashRegisterService.requireOpenSession).not.toHaveBeenCalled();
    expect(harness.cashRegisterService.recordMovement).not.toHaveBeenCalled();
  });

  it('writes nothing when the register is closed', async () => {
    const harness = buildService({
      cashRegisterService: {
        requireOpenSession: vi.fn().mockRejectedValue(new ConflictError('No session')),
      },
    });

    await expect(harness.service.recordAdvance(cashAdvance, ADMIN)).rejects.toThrow(ConflictError);
    expect(harness.commissionAdvancesRepository.create).not.toHaveBeenCalled();
  });

  it('404s an unknown barber before opening a transaction', async () => {
    const harness = buildService({
      barbersRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(harness.service.recordAdvance(cashAdvance, ADMIN)).rejects.toThrow(NotFoundError);
    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('advances more than the barber has earned, which is a decision, not an error', async () => {
    const harness = buildService();

    const advance = await harness.service.recordAdvance(
      { ...cashAdvance, amountCents: 500_000 },
      ADMIN,
    );

    expect(advance.amountCents).toBe(500_000);
  });

  it('keeps notes trimmed, and blank notes as null', async () => {
    const harness = buildService();

    await harness.service.recordAdvance({ ...cashAdvance, notes: '  vale sexta  ' }, ADMIN);
    await harness.service.recordAdvance({ ...cashAdvance, notes: '   ' }, ADMIN);

    expect(harness.commissionAdvancesRepository.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ notes: 'vale sexta' }),
      harness.manager,
    );
    expect(harness.commissionAdvancesRepository.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ notes: null }),
      harness.manager,
    );
  });
});

describe('CommissionsService.closePeriod', () => {
  const range = { startsOn: '2030-05-01', endsOn: '2030-05-15' } as const;

  function withRows(entries: CommissionEntry[], advances: CommissionAdvance[]) {
    return buildService({
      commissionEntriesRepository: {
        findUnassignedInRange: vi.fn().mockResolvedValue(entries),
        assignPeriod: vi.fn().mockResolvedValue(entries.length),
      },
      commissionAdvancesRepository: {
        findUnassignedInRange: vi.fn().mockResolvedValue(advances),
        assignPeriod: vi.fn().mockResolvedValue(advances.length),
      },
    });
  }

  it('snapshots entries, advances and the difference between them', async () => {
    const harness = withRows(
      [makeEntry({ amount: 1800 }), makeEntry({ id: 'entry-2', amount: 2200 })],
      [makeAdvance({ amount: 1500 })],
    );

    const [period] = await harness.service.closePeriod({ barberId: barber.id, ...range }, ADMIN);

    expect(period).toMatchObject({
      totalEntriesCents: 4000,
      totalAdvancesCents: 1500,
      totalDueCents: 2500,
      status: 'closed',
    });
  });

  it('carries a negative total due when the barber drew more than they earned', async () => {
    const harness = withRows([makeEntry({ amount: 1000 })], [makeAdvance({ amount: 25_000 })]);

    const [period] = await harness.service.closePeriod({ barberId: barber.id, ...range }, ADMIN);

    expect(period.totalDueCents).toBe(-24_000);
  });

  it('freezes the rows it counted by stamping the period onto them', async () => {
    const entry = makeEntry();
    const advance = makeAdvance();
    const harness = withRows([entry], [advance]);

    const [period] = await harness.service.closePeriod({ barberId: barber.id, ...range }, ADMIN);

    expect(harness.commissionEntriesRepository.assignPeriod).toHaveBeenCalledWith(
      [entry.id],
      period.id,
      harness.manager,
    );
    expect(harness.commissionAdvancesRepository.assignPeriod).toHaveBeenCalledWith(
      [advance.id],
      period.id,
      harness.manager,
    );
  });

  it('rolls back when a concurrent close claimed a row first', async () => {
    const harness = buildService({
      commissionEntriesRepository: {
        findUnassignedInRange: vi.fn().mockResolvedValue([makeEntry(), makeEntry({ id: 'e2' })]),
        assignPeriod: vi.fn().mockResolvedValue(1),
      },
    });

    await expect(
      harness.service.closePeriod({ barberId: barber.id, ...range }, ADMIN),
    ).rejects.toThrow(/Another close claimed/);
  });

  it('skips a barber with nothing to settle', async () => {
    const harness = withRows([], []);

    const periods = await harness.service.closePeriod({ barberId: barber.id, ...range }, ADMIN);

    expect(periods).toEqual([]);
    expect(harness.commissionPeriodsRepository.create).not.toHaveBeenCalled();
  });

  it('closes every active barber when none is named', async () => {
    const second = { id: 'barber-2', active: true } as Barber;
    const harness = buildService({
      barbersRepository: { findMany: vi.fn().mockResolvedValue([barber, second]) },
      commissionEntriesRepository: {
        findUnassignedInRange: vi.fn().mockResolvedValue([makeEntry()]),
        assignPeriod: vi.fn().mockResolvedValue(1),
      },
    });

    const periods = await harness.service.closePeriod(range, ADMIN);

    expect(periods.map((period) => period.barberId)).toEqual([barber.id, second.id]);
    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses the whole run when any barber already has an overlapping period', async () => {
    const harness = buildService({
      barbersRepository: { findMany: vi.fn().mockResolvedValue([barber]) },
      commissionPeriodsRepository: {
        findOverlappingForBarbers: vi.fn().mockResolvedValue([makePeriod()]),
      },
    });

    await expect(harness.service.closePeriod(range, ADMIN)).rejects.toThrow(ConflictError);
    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses a range whose days are not over yet', async () => {
    const harness = buildService();

    await expect(
      harness.service.closePeriod({ startsOn: '2030-05-01', endsOn: '2030-06-30' }, ADMIN),
    ).rejects.toThrow(ValidationError);
    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses a range that ends before it starts', async () => {
    const harness = buildService();

    await expect(
      harness.service.closePeriod({ startsOn: '2030-05-15', endsOn: '2030-05-01' }, ADMIN),
    ).rejects.toThrow(ValidationError);
  });

  it('404s an unknown barber', async () => {
    const harness = buildService({
      barbersRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.closePeriod({ barberId: 'nope', ...range }, ADMIN),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('CommissionsService.payPeriod', () => {
  it('pays cash out of the open drawer as a payout movement', async () => {
    const harness = buildService();

    const period = await harness.service.payPeriod('period-1', { paymentMethod: 'cash' }, ADMIN);

    expect(period).toMatchObject({ status: 'paid', paymentMethod: 'cash' });
    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'out',
        source: 'payout',
        amountCents: 15_000,
        periodId: 'period-1',
      }),
      harness.manager,
    );
  });

  it('records a Pix payout without touching the register', async () => {
    const harness = buildService();

    await harness.service.payPeriod('period-1', { paymentMethod: 'pix' }, ADMIN);

    expect(harness.commissionPeriodsRepository.markPaid).toHaveBeenCalledTimes(1);
    expect(harness.cashRegisterService.requireOpenSession).not.toHaveBeenCalled();
  });

  it('moves no cash when advances already covered everything', async () => {
    const settled = makePeriod({ totalEntries: 5000, totalAdvances: 5000 });
    const harness = buildService({
      commissionPeriodsRepository: {
        findById: vi.fn().mockResolvedValue(settled),
        markPaid: vi.fn(async (_id: string, paid: Record<string, unknown>) => ({
          ...settled,
          status: 'paid',
          ...paid,
        })),
      },
    });

    const period = await harness.service.payPeriod('period-1', { paymentMethod: 'cash' }, ADMIN);

    expect(period.totalDueCents).toBe(0);
    expect(harness.cashRegisterService.recordMovement).not.toHaveBeenCalled();
  });

  it('refuses a period that was already paid', async () => {
    const harness = buildService({
      commissionPeriodsRepository: {
        findById: vi.fn().mockResolvedValue(makePeriod({ status: 'paid', paidAt: NOW })),
      },
    });

    await expect(
      harness.service.payPeriod('period-1', { paymentMethod: 'cash' }, ADMIN),
    ).rejects.toThrow(/already been paid/);
    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses when a second request won the race', async () => {
    const harness = buildService({
      commissionPeriodsRepository: { markPaid: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.payPeriod('period-1', { paymentMethod: 'pix' }, ADMIN),
    ).rejects.toThrow(ConflictError);
  });

  it('404s an unknown period', async () => {
    const harness = buildService({
      commissionPeriodsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.payPeriod('nope', { paymentMethod: 'cash' }, ADMIN),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('CommissionsService.getStatement', () => {
  it('returns the snapshot with the rows it was taken from', async () => {
    const harness = buildService({
      commissionEntriesRepository: { findByPeriod: vi.fn().mockResolvedValue([makeEntry()]) },
      commissionAdvancesRepository: { findByPeriod: vi.fn().mockResolvedValue([makeAdvance()]) },
    });

    const statement = await harness.service.getStatement('period-1', ADMIN);

    expect(statement.period.totalDueCents).toBe(15_000);
    expect(statement.entries).toHaveLength(1);
    expect(statement.advances).toHaveLength(1);
  });

  it('lets a barber read their own statement', async () => {
    const harness = buildService();

    expect((await harness.service.getStatement('period-1', BARBER)).period.barberId).toBe(
      barber.id,
    );
  });

  it("403s a barber reading someone else's", async () => {
    const harness = buildService({
      commissionPeriodsRepository: {
        findById: vi.fn().mockResolvedValue(makePeriod({ barberId: 'barber-2' })),
      },
    });

    await expect(harness.service.getStatement('period-1', BARBER)).rejects.toThrow(ForbiddenError);
  });

  it('404s an unknown period', async () => {
    const harness = buildService({
      commissionPeriodsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(harness.service.getStatement('nope', ADMIN)).rejects.toThrow(NotFoundError);
  });
});

describe('CommissionsService closed-period refusals', () => {
  it('refuses a recalculation that would move a settled entry', async () => {
    const harness = buildService({
      commissionEntriesRepository: {
        findByAppointment: vi
          .fn()
          .mockResolvedValue(makeEntry({ base: 'net', baseAmount: 4500, periodId: 'period-1' })),
      },
      paymentsRepository: { sumNetForAppointment: vi.fn().mockResolvedValue(4000) },
    });

    await expect(harness.service.recalculateNetBase(appointment, harness.manager)).rejects.toThrow(
      /settled in a closed period/,
    );
    expect(harness.commissionEntriesRepository.updateAmounts).not.toHaveBeenCalled();
  });

  it('allows a payment on a settled entry that would not move it', async () => {
    const harness = buildService({
      commissionEntriesRepository: {
        findByAppointment: vi
          .fn()
          .mockResolvedValue(makeEntry({ base: 'net', baseAmount: 4500, periodId: 'period-1' })),
      },
      paymentsRepository: { sumNetForAppointment: vi.fn().mockResolvedValue(4500) },
    });

    expect(await harness.service.recalculateNetBase(appointment, harness.manager)).toBeNull();
  });

  it('refuses a void once a period has closed over the entry', async () => {
    const harness = buildService({
      commissionEntriesRepository: {
        findByAppointment: vi.fn().mockResolvedValue(makeEntry({ periodId: 'period-1' })),
      },
    });

    await expect(harness.service.assertAppointmentUnsettled(appointment.id)).rejects.toThrow(
      ConflictError,
    );
  });

  it('allows a void while the entry is still unsettled', async () => {
    const harness = buildService({
      commissionEntriesRepository: { findByAppointment: vi.fn().mockResolvedValue(makeEntry()) },
    });

    await expect(
      harness.service.assertAppointmentUnsettled(appointment.id),
    ).resolves.toBeUndefined();
  });
});
