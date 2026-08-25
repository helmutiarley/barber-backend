import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config';
import type { Cradle } from '../../src/container';
import { ValidationError } from '../../src/errors/app-error';
import { ReportsService } from '../../src/services/reports.service';

const NOW = new Date('2026-07-14T18:00:00.000Z');
const ZONE = 'America/Sao_Paulo';

const EMPTY_TOTALS = {
  grossCents: 0,
  netCents: 0,
  cardFeeCents: 0,
  serviceGrossCents: 0,
  productGrossCents: 0,
  payments: 0,
};

function buildService(
  overrides: {
    reportsRepository?: Record<string, unknown>;
    barbersRepository?: Record<string, unknown>;
    availabilityService?: Record<string, unknown>;
  } = {},
) {
  const reportsRepository = Object.assign(
    {
      revenue: vi.fn().mockResolvedValue([]),
      revenueTotals: vi.fn().mockResolvedValue(EMPTY_TOTALS),
      ticketsByBarber: vi.fn().mockResolvedValue([]),
      topServices: vi.fn().mockResolvedValue([]),
      productsSold: vi.fn().mockResolvedValue([]),
      lowStock: vi.fn().mockResolvedValue([]),
      expensesByCategory: vi.fn().mockResolvedValue([]),
      commissionsEarned: vi.fn().mockResolvedValue(0),
      bookedMinutesByBarber: vi.fn().mockResolvedValue([]),
      appointmentCountsByBarber: vi.fn().mockResolvedValue([]),
      clientMix: vi.fn().mockResolvedValue({ newClients: 0, recurringClients: 0 }),
      inactiveClientCount: vi.fn().mockResolvedValue(0),
      commissionsByBarber: vi.fn().mockResolvedValue([]),
    },
    overrides.reportsRepository,
  );

  const barbersRepository = Object.assign(
    {
      findMany: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      findByUserId: vi.fn().mockResolvedValue(null),
    },
    overrides.barbersRepository,
  );

  const availabilityService = Object.assign(
    {
      workingIntervals: vi.fn().mockResolvedValue([]),
    },
    overrides.availabilityService,
  );

  const service = new ReportsService({
    reportsRepository,
    barbersRepository,
    availabilityService,
    clock: { now: () => NOW },
    config: { shopTimezone: ZONE } as AppConfig,
  } as unknown as Cradle);

  return { service, reportsRepository, barbersRepository, availabilityService };
}

describe('reports service', () => {
  describe('the range', () => {
    it('defaults to the current shop-local month', async () => {
      const { service, reportsRepository } = buildService();

      const report = await service.revenue({ groupBy: 'day' });

      expect(report).toMatchObject({ from: '2026-07-01', to: '2026-07-31' });

      expect(reportsRepository.revenueTotals).toHaveBeenCalledWith({
        start: new Date('2026-07-01T03:00:00.000Z'),
        end: new Date('2026-08-01T03:00:00.000Z'),
      });
    });

    it('fills in only the end the caller left out', async () => {
      const { service } = buildService();

      expect(await service.revenue({ from: '2026-07-05', groupBy: 'day' })).toMatchObject({
        from: '2026-07-05',
        to: '2026-07-31',
      });
    });

    it('refuses a range that ends before it starts', async () => {
      const { service } = buildService();

      await expect(
        service.revenue({ from: '2026-07-20', to: '2026-07-10', groupBy: 'day' }),
      ).rejects.toThrow(ValidationError);
    });

    it('echoes the range back on every report, since both ends may be defaults', async () => {
      const { service } = buildService();
      const range = { from: '2026-06-01', to: '2026-06-30' };

      for (const report of [
        await service.averageTicket(range),
        await service.topServices({ ...range, limit: 10 }),
        await service.products(range),
        await service.dre(range),
      ]) {
        expect(report).toMatchObject(range);
      }
    });
  });

  describe('averageTicket', () => {
    it('divides the summed takings by the summed cuts, not the other way round', async () => {
      const { service } = buildService({
        reportsRepository: {
          ticketsByBarber: vi.fn().mockResolvedValue([
            { barberId: 'b1', barberName: 'Rafael', grossCents: 30_000, appointments: 10 },
            { barberId: 'b2', barberName: 'Bruno', grossCents: 20_000, appointments: 2 },
          ]),
        },
      });

      const report = await service.averageTicket({});

      expect(report.overall).toEqual({
        grossCents: 50_000,
        appointments: 12,
        averageTicketCents: 4167,
      });
      expect(report.barbers).toEqual([
        expect.objectContaining({ barberId: 'b1', averageTicketCents: 3000 }),
        expect.objectContaining({ barberId: 'b2', averageTicketCents: 10_000 }),
      ]);
    });

    it('has no average at all when nobody cut anything', async () => {
      const { service } = buildService();

      expect(await service.averageTicket({})).toMatchObject({
        overall: { grossCents: 0, appointments: 0, averageTicketCents: null },
        barbers: [],
      });
    });
  });

  describe('products', () => {
    it('takes the cost off the takings, once per unit sold', async () => {
      const { service } = buildService({
        reportsRepository: {
          productsSold: vi.fn().mockResolvedValue([
            {
              productId: 'p1',
              productName: 'Pomada',
              units: 3,
              revenueCents: 10_500,
              costCents: 1800,
            },
          ]),
        },
      });

      const report = await service.products({});

      expect(report.products[0].marginCents).toBe(10_500 - 1800 * 3);
      expect(report.totals).toEqual({
        units: 3,
        revenueCents: 10_500,
        marginCents: 5100,
        productsWithoutCost: 0,
      });
    });

    it('reports no margin for a product nobody costed, and says how many it skipped', async () => {
      const { service } = buildService({
        reportsRepository: {
          productsSold: vi.fn().mockResolvedValue([
            {
              productId: 'p1',
              productName: 'Pomada',
              units: 1,
              revenueCents: 3500,
              costCents: 1800,
            },
            { productId: 'p2', productName: 'Cera', units: 2, revenueCents: 6000, costCents: null },
          ]),
        },
      });

      const report = await service.products({});

      expect(report.products[1].marginCents).toBeNull();

      expect(report.totals).toMatchObject({ marginCents: 1700, productsWithoutCost: 1 });
    });

    it('carries the low-stock list, which is about now rather than the range', async () => {
      const lowStock = [
        { productId: 'p9', productName: 'Minoxidil', stockQuantity: 0, lowStockThreshold: 1 },
      ];
      const { service } = buildService({
        reportsRepository: { lowStock: vi.fn().mockResolvedValue(lowStock) },
      });

      expect((await service.products({ from: '2020-01-01', to: '2020-01-31' })).lowStock).toEqual(
        lowStock,
      );
    });
  });

  describe('dre', () => {
    it('nets the fees off, then takes expenses and commissions', async () => {
      const { service } = buildService({
        reportsRepository: {
          revenueTotals: vi.fn().mockResolvedValue({
            grossCents: 100_000,
            netCents: 97_000,
            cardFeeCents: 3000,
            serviceGrossCents: 80_000,
            productGrossCents: 20_000,
            payments: 25,
          }),
          expensesByCategory: vi.fn().mockResolvedValue([
            { category: 'rent', amountCents: 25_000 },
            { category: 'supplies', amountCents: 5000 },
          ]),
          commissionsEarned: vi.fn().mockResolvedValue(32_000),
        },
      });

      const report = await service.dre({});

      expect(report.expenses.totalCents).toBe(30_000);
      expect(report.commissionsCents).toBe(32_000);
      expect(report.resultCents).toBe(97_000 - 30_000 - 32_000);
    });

    it('reports a loss as a negative rather than hiding it', async () => {
      const { service } = buildService({
        reportsRepository: {
          revenueTotals: vi.fn().mockResolvedValue({ ...EMPTY_TOTALS, netCents: 10_000 }),
          expensesByCategory: vi
            .fn()
            .mockResolvedValue([{ category: 'rent', amountCents: 250_000 }]),
        },
      });

      expect((await service.dre({})).resultCents).toBe(-240_000);
    });
  });

  describe('revenue', () => {
    it('passes the shop timezone down, so buckets are cut where the shop is', async () => {
      const { service, reportsRepository } = buildService();

      await service.revenue({ from: '2026-07-01', to: '2026-07-31', groupBy: 'week' });

      expect(reportsRepository.revenue).toHaveBeenCalledWith(expect.anything(), 'week', ZONE);
    });
  });

  describe('occupancy', () => {
    it('divides booked minutes by what the schedule offered', async () => {
      const start = new Date('2026-07-13T12:00:00.000Z');
      const end = new Date('2026-07-13T16:00:00.000Z');

      const { service } = buildService({
        barbersRepository: {
          findMany: vi.fn().mockResolvedValue([{ id: 'b1', displayName: 'Rafael', active: true }]),
        },
        availabilityService: {
          workingIntervals: vi.fn().mockResolvedValue([{ start, end }]),
        },
        reportsRepository: {
          bookedMinutesByBarber: vi.fn().mockResolvedValue([{ barberId: 'b1', minutes: 120 }]),
        },
      });

      const report = await service.occupancy({ from: '2026-07-13', to: '2026-07-13' });

      expect(report.barbers).toEqual([
        {
          barberId: 'b1',
          barberName: 'Rafael',
          bookedMinutes: 120,
          scheduledMinutes: 240,
          occupancyRate: 0.5,
        },
      ]);
      expect(report.overall.occupancyRate).toBe(0.5);
    });

    it('has no rate when the barber was scheduled nowhere', async () => {
      const { service } = buildService({
        barbersRepository: {
          findMany: vi.fn().mockResolvedValue([{ id: 'b1', displayName: 'Rafael', active: true }]),
        },
      });

      expect(await service.occupancy({ from: '2026-07-13', to: '2026-07-13' })).toMatchObject({
        barbers: [{ occupancyRate: null, scheduledMinutes: 0 }],
      });
    });
  });

  describe('noShows', () => {
    it('rates no-shows and cancellations against every appointment in the range', async () => {
      const { service } = buildService({
        reportsRepository: {
          appointmentCountsByBarber: vi.fn().mockResolvedValue([
            { barberId: 'b1', barberName: 'Rafael', status: 'completed', count: 8 },
            { barberId: 'b1', barberName: 'Rafael', status: 'no_show', count: 1 },
            { barberId: 'b1', barberName: 'Rafael', status: 'cancelled', count: 1 },
          ]),
        },
      });

      const report = await service.noShows({});

      expect(report.overall).toEqual({
        completed: 8,
        noShows: 1,
        cancelled: 1,
        total: 10,
        noShowRate: 0.1,
        cancellationRate: 0.1,
      });
    });
  });

  describe('clients', () => {
    it('carries new, recurring and inactive counts', async () => {
      const { service } = buildService({
        reportsRepository: {
          clientMix: vi.fn().mockResolvedValue({ newClients: 3, recurringClients: 7 }),
          inactiveClientCount: vi.fn().mockResolvedValue(12),
        },
      });

      expect(await service.clients({ from: '2026-07-01', to: '2026-07-31' })).toEqual({
        from: '2026-07-01',
        to: '2026-07-31',
        newClients: 3,
        recurringClients: 7,
        inactiveClients: 12,
      });
    });
  });

  describe('barberSummary', () => {
    const ADMIN = { id: 'admin-1', role: 'ADMIN' as const };
    const BARBER = { id: 'user-b1', role: 'BARBER' as const };

    it('lets staff read any barber', async () => {
      const { service } = buildService({
        barbersRepository: {
          findById: vi.fn().mockResolvedValue({ id: 'b1', displayName: 'Rafael' }),
        },
        reportsRepository: {
          appointmentCountsByBarber: vi.fn().mockResolvedValue([
            { barberId: 'b1', barberName: 'Rafael', status: 'completed', count: 5 },
            { barberId: 'b1', barberName: 'Rafael', status: 'no_show', count: 1 },
          ]),
          ticketsByBarber: vi
            .fn()
            .mockResolvedValue([
              { barberId: 'b1', barberName: 'Rafael', grossCents: 22_500, appointments: 5 },
            ]),
          commissionsByBarber: vi
            .fn()
            .mockResolvedValue([{ barberId: 'b1', barberName: 'Rafael', amountCents: 9000 }]),
          revenue: vi.fn().mockResolvedValue([
            {
              key: 'b1',
              label: 'Rafael',
              grossCents: 25_000,
              netCents: 25_000,
              cardFeeCents: 0,
              payments: 6,
            },
          ]),
        },
      });

      const report = await service.barberSummary('b1', {}, ADMIN);

      expect(report).toMatchObject({
        barberId: 'b1',
        cuts: 5,
        revenueCents: 25_000,
        commissionCents: 9000,
        noShows: 1,
        noShowRate: Math.round((1 / 6) * 10_000) / 10_000,
        averageTicketCents: 4500,
      });
    });

    it('lets a barber read only their own summary', async () => {
      const { service } = buildService({
        barbersRepository: {
          findByUserId: vi.fn().mockResolvedValue({ id: 'b1', displayName: 'Rafael' }),
          findById: vi.fn().mockResolvedValue({ id: 'b1', displayName: 'Rafael' }),
        },
      });

      await expect(service.barberSummary('b1', {}, BARBER)).resolves.toMatchObject({
        barberId: 'b1',
      });
      await expect(service.barberSummary('b2', {}, BARBER)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });
});
