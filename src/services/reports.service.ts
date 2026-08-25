import type { AppConfig } from '../config';
import type { Cradle } from '../container';
import { ForbiddenError, NotFoundError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import type { Clock } from '../lib/clock';
import { durationMinutes } from '../lib/intervals';
import { eachShopDate, shopMonthRange, shopRangeBounds } from '../lib/shop-time';
import type { BarbersRepository } from '../repositories/barbers.repository';
import type {
  ExpenseCategoryRow,
  LowStockRow,
  Range,
  ReportsRepository,
  RevenueBucket,
  RevenueTotals,
  ServiceRow,
} from '../repositories/reports.repository';
import type { RevenueGrouping } from '../schemas/reports.schemas';
import type { AvailabilityService } from './availability.service';

export interface RangeInput {
  from?: string;
  to?: string;
}

export interface RevenueInput extends RangeInput {
  groupBy: RevenueGrouping;
}

export interface TopServicesInput extends RangeInput {
  limit: number;
}

interface Ranged {
  from: string;
  to: string;
}

export interface RevenueReport extends Ranged {
  groupBy: RevenueGrouping;
  totals: RevenueTotals;
  buckets: RevenueBucket[];
}

export interface BarberTicketDto {
  barberId: string;
  barberName: string;
  grossCents: number;
  appointments: number;

  averageTicketCents: number | null;
}

export interface AverageTicketReport extends Ranged {
  overall: {
    grossCents: number;
    appointments: number;
    averageTicketCents: number | null;
  };
  barbers: BarberTicketDto[];
}

export interface TopServicesReport extends Ranged {
  services: ServiceRow[];
}

export interface ProductLineDto {
  productId: string;
  productName: string;
  units: number;
  revenueCents: number;
  costCents: number | null;

  marginCents: number | null;
}

export interface ProductsReport extends Ranged {
  totals: {
    units: number;
    revenueCents: number;

    marginCents: number;
    productsWithoutCost: number;
  };
  products: ProductLineDto[];
  lowStock: LowStockRow[];
}

export interface DreReport extends Ranged {
  revenue: {
    grossCents: number;
    serviceGrossCents: number;
    productGrossCents: number;
    cardFeeCents: number;

    netCents: number;
  };
  expenses: {
    totalCents: number;
    byCategory: ExpenseCategoryRow[];
  };
  commissionsCents: number;

  resultCents: number;
}

export interface OccupancyBarberDto {
  barberId: string;
  barberName: string;
  bookedMinutes: number;
  scheduledMinutes: number;

  occupancyRate: number | null;
}

export interface OccupancyReport extends Ranged {
  overall: {
    bookedMinutes: number;
    scheduledMinutes: number;
    occupancyRate: number | null;
  };
  barbers: OccupancyBarberDto[];
}

export interface NoShowBarberDto {
  barberId: string;
  barberName: string;
  completed: number;
  noShows: number;
  cancelled: number;
  total: number;
  noShowRate: number | null;
  cancellationRate: number | null;
}

export interface NoShowsReport extends Ranged {
  overall: {
    completed: number;
    noShows: number;
    cancelled: number;
    total: number;
    noShowRate: number | null;
    cancellationRate: number | null;
  };
  barbers: NoShowBarberDto[];
}

export interface ClientsReport extends Ranged {
  newClients: number;
  recurringClients: number;

  inactiveClients: number;
}

export interface BarberSummaryReport extends Ranged {
  barberId: string;
  barberName: string;
  cuts: number;

  revenueCents: number;
  commissionCents: number;
  noShows: number;
  cancelled: number;
  appointments: number;
  noShowRate: number | null;
  averageTicketCents: number | null;
}

const STAFF_ROLES = ['ADMIN', 'MANAGER'] as const;

function isStaff(actor: AuthenticatedUser): boolean {
  return (STAFF_ROLES as readonly string[]).includes(actor.role);
}

export class ReportsService {
  private readonly reportsRepository: ReportsRepository;
  private readonly barbersRepository: BarbersRepository;
  private readonly availabilityService: AvailabilityService;
  private readonly clock: Clock;
  private readonly config: AppConfig;

  constructor({
    reportsRepository,
    barbersRepository,
    availabilityService,
    clock,
    config,
  }: Cradle) {
    this.reportsRepository = reportsRepository;
    this.barbersRepository = barbersRepository;
    this.availabilityService = availabilityService;
    this.clock = clock;
    this.config = config;
  }

  async revenue(input: RevenueInput): Promise<RevenueReport> {
    const { from, to, range } = this.resolveRange(input);

    const [totals, buckets] = await Promise.all([
      this.reportsRepository.revenueTotals(range),
      this.reportsRepository.revenue(range, input.groupBy, this.config.shopTimezone),
    ]);

    return { from, to, groupBy: input.groupBy, totals, buckets };
  }

  async averageTicket(input: RangeInput): Promise<AverageTicketReport> {
    const { from, to, range } = this.resolveRange(input);
    const rows = await this.reportsRepository.ticketsByBarber(range);

    const grossCents = rows.reduce((sum, row) => sum + row.grossCents, 0);
    const appointments = rows.reduce((sum, row) => sum + row.appointments, 0);

    return {
      from,
      to,

      overall: { grossCents, appointments, averageTicketCents: average(grossCents, appointments) },
      barbers: rows.map((row) => ({
        ...row,
        averageTicketCents: average(row.grossCents, row.appointments),
      })),
    };
  }

  async topServices(input: TopServicesInput): Promise<TopServicesReport> {
    const { from, to, range } = this.resolveRange(input);

    return { from, to, services: await this.reportsRepository.topServices(range, input.limit) };
  }

  async products(input: RangeInput): Promise<ProductsReport> {
    const { from, to, range } = this.resolveRange(input);

    const [sold, lowStock] = await Promise.all([
      this.reportsRepository.productsSold(range),
      this.reportsRepository.lowStock(),
    ]);

    const products = sold.map((row) => ({
      ...row,
      marginCents: row.costCents === null ? null : row.revenueCents - row.costCents * row.units,
    }));

    return {
      from,
      to,
      totals: {
        units: products.reduce((sum, row) => sum + row.units, 0),
        revenueCents: products.reduce((sum, row) => sum + row.revenueCents, 0),
        marginCents: products.reduce((sum, row) => sum + (row.marginCents ?? 0), 0),
        productsWithoutCost: products.filter((row) => row.marginCents === null).length,
      },
      products,
      lowStock,
    };
  }

  async dre(input: RangeInput): Promise<DreReport> {
    const { from, to, range } = this.resolveRange(input);

    const [revenue, byCategory, commissionsCents] = await Promise.all([
      this.reportsRepository.revenueTotals(range),
      this.reportsRepository.expensesByCategory(range),
      this.reportsRepository.commissionsEarned(range),
    ]);

    const expensesCents = byCategory.reduce((sum, row) => sum + row.amountCents, 0);

    return {
      from,
      to,
      revenue: {
        grossCents: revenue.grossCents,
        serviceGrossCents: revenue.serviceGrossCents,
        productGrossCents: revenue.productGrossCents,
        cardFeeCents: revenue.cardFeeCents,
        netCents: revenue.netCents,
      },
      expenses: { totalCents: expensesCents, byCategory },
      commissionsCents,
      resultCents: revenue.netCents - expensesCents - commissionsCents,
    };
  }

  async occupancy(input: RangeInput): Promise<OccupancyReport> {
    const { from, to, range } = this.resolveRange(input);
    const dates = eachShopDate(from, to);
    const barbers = await this.barbersRepository.findMany({ active: true });
    const booked = await this.reportsRepository.bookedMinutesByBarber(range);
    const bookedById = new Map(booked.map((row) => [row.barberId, row.minutes]));

    const rows: OccupancyBarberDto[] = [];

    for (const barber of barbers) {
      let scheduledMinutes = 0;

      for (const date of dates) {
        const working = await this.availabilityService.workingIntervals(barber.id, date);
        scheduledMinutes += working.reduce((sum, interval) => sum + durationMinutes(interval), 0);
      }

      const bookedMinutes = bookedById.get(barber.id) ?? 0;

      rows.push({
        barberId: barber.id,
        barberName: barber.displayName,
        bookedMinutes,
        scheduledMinutes,
        occupancyRate: rate(bookedMinutes, scheduledMinutes),
      });
    }

    for (const row of booked) {
      if (rows.some((existing) => existing.barberId === row.barberId)) {
        continue;
      }

      const barber = await this.barbersRepository.findById(row.barberId);
      if (!barber) {
        continue;
      }

      rows.push({
        barberId: barber.id,
        barberName: barber.displayName,
        bookedMinutes: row.minutes,
        scheduledMinutes: 0,
        occupancyRate: null,
      });
    }

    rows.sort((a, b) => a.barberName.localeCompare(b.barberName));

    const bookedMinutes = rows.reduce((sum, row) => sum + row.bookedMinutes, 0);
    const scheduledMinutes = rows.reduce((sum, row) => sum + row.scheduledMinutes, 0);

    return {
      from,
      to,
      overall: {
        bookedMinutes,
        scheduledMinutes,
        occupancyRate: rate(bookedMinutes, scheduledMinutes),
      },
      barbers: rows,
    };
  }

  async noShows(input: RangeInput): Promise<NoShowsReport> {
    const { from, to, range } = this.resolveRange(input);
    const rows = await this.reportsRepository.appointmentCountsByBarber(range);

    const byBarber = new Map<string, NoShowBarberDto>();

    for (const row of rows) {
      const current = byBarber.get(row.barberId) ?? {
        barberId: row.barberId,
        barberName: row.barberName,
        completed: 0,
        noShows: 0,
        cancelled: 0,
        total: 0,
        noShowRate: null,
        cancellationRate: null,
      };

      current.total += row.count;
      if (row.status === 'completed') current.completed += row.count;
      if (row.status === 'no_show') current.noShows += row.count;
      if (row.status === 'cancelled') current.cancelled += row.count;

      byBarber.set(row.barberId, current);
    }

    const barbers = [...byBarber.values()]
      .map((row) => ({
        ...row,
        noShowRate: rate(row.noShows, row.total),
        cancellationRate: rate(row.cancelled, row.total),
      }))
      .sort((a, b) => a.barberName.localeCompare(b.barberName));

    const overall = {
      completed: barbers.reduce((sum, row) => sum + row.completed, 0),
      noShows: barbers.reduce((sum, row) => sum + row.noShows, 0),
      cancelled: barbers.reduce((sum, row) => sum + row.cancelled, 0),
      total: barbers.reduce((sum, row) => sum + row.total, 0),
      noShowRate: null as number | null,
      cancellationRate: null as number | null,
    };
    overall.noShowRate = rate(overall.noShows, overall.total);
    overall.cancellationRate = rate(overall.cancelled, overall.total);

    return { from, to, overall, barbers };
  }

  async clients(input: RangeInput): Promise<ClientsReport> {
    const { from, to, range } = this.resolveRange(input);
    const [mix, inactiveClients] = await Promise.all([
      this.reportsRepository.clientMix(range),
      this.reportsRepository.inactiveClientCount(range.start),
    ]);

    return { from, to, ...mix, inactiveClients };
  }

  async barberSummary(
    barberId: string,
    input: RangeInput,
    actor: AuthenticatedUser,
  ): Promise<BarberSummaryReport> {
    await this.assertOwnBarber(barberId, actor);

    const barber = await this.barbersRepository.findById(barberId);
    if (!barber) {
      throw new NotFoundError(`Barber ${barberId} not found`);
    }

    const { from, to, range } = this.resolveRange(input);

    const [statusRows, tickets, commissions, revenueBuckets] = await Promise.all([
      this.reportsRepository.appointmentCountsByBarber(range),
      this.reportsRepository.ticketsByBarber(range),
      this.reportsRepository.commissionsByBarber(range),
      this.reportsRepository.revenue(range, 'barber', this.config.shopTimezone),
    ]);

    const statuses = statusRows.filter((row) => row.barberId === barberId);
    const completed = statuses.find((row) => row.status === 'completed')?.count ?? 0;
    const noShows = statuses.find((row) => row.status === 'no_show')?.count ?? 0;
    const cancelled = statuses.find((row) => row.status === 'cancelled')?.count ?? 0;
    const appointments = statuses.reduce((sum, row) => sum + row.count, 0);

    const ticket = tickets.find((row) => row.barberId === barberId);
    const revenueCents = revenueBuckets.find((row) => row.key === barberId)?.grossCents ?? 0;
    const commissionCents = commissions.find((row) => row.barberId === barberId)?.amountCents ?? 0;

    return {
      from,
      to,
      barberId: barber.id,
      barberName: barber.displayName,
      cuts: completed,
      revenueCents,
      commissionCents,
      noShows,
      cancelled,
      appointments,
      noShowRate: rate(noShows, appointments),
      averageTicketCents: ticket ? average(ticket.grossCents, ticket.appointments) : null,
    };
  }

  private async assertOwnBarber(barberId: string, actor: AuthenticatedUser): Promise<void> {
    if (isStaff(actor)) {
      return;
    }

    const own =
      actor.role === 'BARBER' ? await this.barbersRepository.findByUserId(actor.id) : null;

    if (!own || own.id !== barberId) {
      throw new ForbiddenError('You can only read your own summary');
    }
  }

  private resolveRange(input: RangeInput): Ranged & { range: Range } {
    const zone = this.config.shopTimezone;
    const thisMonth = shopMonthRange(this.clock.now(), zone);
    const from = input.from ?? thisMonth.from;
    const to = input.to ?? thisMonth.to;

    return { from, to, range: shopRangeBounds(from, to, zone) };
  }
}

function average(total: number, count: number): number | null {
  return count === 0 ? null : Math.round(total / count);
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 10_000) / 10_000;
}
