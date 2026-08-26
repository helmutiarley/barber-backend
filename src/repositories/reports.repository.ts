import type { Repository, SelectQueryBuilder } from 'typeorm';
import type { Cradle } from '../container';
import { Appointment } from '../entities/appointment.entity';
import { Barber } from '../entities/barber.entity';
import { CommissionEntry } from '../entities/commission-entry.entity';
import type { ExpenseCategory } from '../entities/enums';
import { Expense } from '../entities/expense.entity';
import { Payment } from '../entities/payment.entity';
import { Product } from '../entities/product.entity';
import { ProductSale } from '../entities/product-sale.entity';
import { Service } from '../entities/service.entity';
import { decimalStringToCents } from '../lib/money';
import { requireShopId } from '../lib/shop-context';
import type { RevenueGrouping } from '../schemas/reports.schemas';

export interface Range {
  start: Date;
  end: Date;
}

export interface RevenueBucket {
  key: string | null;

  label: string | null;
  grossCents: number;
  netCents: number;
  cardFeeCents: number;
  payments: number;
}

export interface RevenueTotals {
  grossCents: number;
  netCents: number;
  cardFeeCents: number;

  serviceGrossCents: number;
  productGrossCents: number;
  payments: number;
}

export interface TicketRow {
  barberId: string;
  barberName: string;
  grossCents: number;
  appointments: number;
}

export interface ServiceRow {
  serviceId: string;
  serviceName: string;
  appointments: number;
  grossCents: number;
}

export interface ProductRow {
  productId: string;
  productName: string;
  units: number;
  revenueCents: number;

  costCents: number | null;
}

export interface LowStockRow {
  productId: string;
  productName: string;
  stockQuantity: number;
  lowStockThreshold: number;
}

export interface ExpenseCategoryRow {
  category: ExpenseCategory;
  amountCents: number;
}

export interface BarberStatusRow {
  barberId: string;
  barberName: string;
  status: string;
  count: number;
}

export interface BarberMinutesRow {
  barberId: string;
  minutes: number;
}

export interface ClientMixRow {
  newClients: number;
  recurringClients: number;
}

export interface BarberCommissionRow {
  barberId: string;
  barberName: string;
  amountCents: number;
}

interface RawBucket {
  key: string | null;
  label: string | null;
  gross: string | null;
  net: string | null;
  fee: string | null;
  payments: string;
}

interface RawTotals {
  gross: string | null;
  net: string | null;
  fee: string | null;
  serviceGross: string | null;
  productGross: string | null;
  payments: string;
}

export class ReportsRepository {
  private readonly payments: Repository<Payment>;
  private readonly appointments: Repository<Appointment>;
  private readonly expenses: Repository<Expense>;
  private readonly commissionEntries: Repository<CommissionEntry>;
  private readonly productSales: Repository<ProductSale>;
  private readonly products: Repository<Product>;

  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.payments = dataSource.getRepository(Payment);
    this.appointments = dataSource.getRepository(Appointment);
    this.expenses = dataSource.getRepository(Expense);
    this.commissionEntries = dataSource.getRepository(CommissionEntry);
    this.productSales = dataSource.getRepository(ProductSale);
    this.products = dataSource.getRepository(Product);
    this.shopId = requireShopId(currentShop);
  }

  async revenue(range: Range, grouping: RevenueGrouping, zone: string): Promise<RevenueBucket[]> {
    const query = this.paidInRange(range);
    const time = TIME_BUCKETS[grouping];

    if (time) {
      query
        .select(`to_char(date_trunc('${time}', p.paid_at AT TIME ZONE :zone), 'YYYY-MM-DD')`, 'key')
        .addSelect('NULL', 'label')
        .setParameter('zone', zone)
        .groupBy('1')
        .orderBy('1', 'ASC');
    } else if (grouping === 'barber') {
      query
        .leftJoin(Barber, 'b', 'b.id = COALESCE(a.barber_id, ps.sold_by_barber_id)')
        .select('COALESCE(a.barber_id, ps.sold_by_barber_id)::text', 'key')
        .addSelect('b.display_name', 'label')
        .groupBy('1')
        .addGroupBy('2')
        .orderBy('"gross"', 'DESC');
    } else if (grouping === 'service') {
      query
        .leftJoin(Service, 's', 's.id = a.service_id')
        .select('a.service_id::text', 'key')
        .addSelect('s.name', 'label')
        .groupBy('1')
        .addGroupBy('2')
        .orderBy('"gross"', 'DESC');
    } else {
      query
        .select('p.method::text', 'key')
        .addSelect('NULL', 'label')
        .groupBy('1')
        .orderBy('"gross"', 'DESC');
    }

    const rows = await query
      .addSelect('SUM(p.amount)', 'gross')
      .addSelect('SUM(p.net_amount)', 'net')
      .addSelect('SUM(p.card_fee)', 'fee')
      .addSelect('COUNT(*)', 'payments')
      .getRawMany<RawBucket>();

    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      grossCents: toCents(row.gross),
      netCents: toCents(row.net),
      cardFeeCents: toCents(row.fee),
      payments: Number(row.payments),
    }));
  }

  async revenueTotals(range: Range): Promise<RevenueTotals> {
    const raw = await this.paidInRange(range)
      .select('SUM(p.amount)', 'gross')
      .addSelect('SUM(p.net_amount)', 'net')
      .addSelect('SUM(p.card_fee)', 'fee')
      .addSelect('SUM(p.amount) FILTER (WHERE p.appointment_id IS NOT NULL)', 'serviceGross')
      .addSelect('SUM(p.amount) FILTER (WHERE p.appointment_id IS NULL)', 'productGross')
      .addSelect('COUNT(*)', 'payments')
      .getRawOne<RawTotals>();

    return {
      grossCents: toCents(raw?.gross),
      netCents: toCents(raw?.net),
      cardFeeCents: toCents(raw?.fee),
      serviceGrossCents: toCents(raw?.serviceGross),
      productGrossCents: toCents(raw?.productGross),
      payments: Number(raw?.payments ?? 0),
    };
  }

  async ticketsByBarber(range: Range): Promise<TicketRow[]> {
    const rows = await this.paidInRange(range)
      .innerJoin(Barber, 'b', 'b.id = a.barber_id')
      .select('a.barber_id::text', 'barberId')
      .addSelect('b.display_name', 'barberName')
      .addSelect('SUM(p.amount)', 'gross')
      .addSelect('COUNT(DISTINCT p.appointment_id)', 'appointments')
      .groupBy('1')
      .addGroupBy('2')
      .orderBy('"gross"', 'DESC')
      .getRawMany<{ barberId: string; barberName: string; gross: string; appointments: string }>();

    return rows.map((row) => ({
      barberId: row.barberId,
      barberName: row.barberName,
      grossCents: toCents(row.gross),
      appointments: Number(row.appointments),
    }));
  }

  async topServices(range: Range, limit: number): Promise<ServiceRow[]> {
    const rows = await this.paidInRange(range)
      .innerJoin(Service, 's', 's.id = a.service_id')
      .select('a.service_id::text', 'serviceId')
      .addSelect('s.name', 'serviceName')
      .addSelect('SUM(p.amount)', 'gross')
      .addSelect('COUNT(DISTINCT p.appointment_id)', 'appointments')
      .groupBy('1')
      .addGroupBy('2')
      .orderBy('"gross"', 'DESC')
      .addOrderBy('"appointments"', 'DESC')
      .limit(limit)
      .getRawMany<{
        serviceId: string;
        serviceName: string;
        gross: string;
        appointments: string;
      }>();

    return rows.map((row) => ({
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      grossCents: toCents(row.gross),
      appointments: Number(row.appointments),
    }));
  }

  async productsSold(range: Range): Promise<ProductRow[]> {
    const rows = await this.productSales
      .createQueryBuilder('ps')
      .innerJoin(Payment, 'p', 'p.id = ps.payment_id')
      .innerJoin(Product, 'pr', 'pr.id = ps.product_id')
      .where('ps.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('ps.voided_at IS NULL')
      .andWhere('p.voided_at IS NULL')
      .andWhere('p.paid_at >= :start AND p.paid_at < :end', range)
      .select('ps.product_id::text', 'productId')
      .addSelect('pr.name', 'productName')
      .addSelect('SUM(ps.quantity)', 'units')
      .addSelect('SUM(ps.total)', 'revenue')
      .addSelect('MAX(pr.cost)', 'cost')
      .groupBy('1')
      .addGroupBy('2')
      .orderBy('"revenue"', 'DESC')
      .getRawMany<{
        productId: string;
        productName: string;
        units: string;
        revenue: string;
        cost: string | null;
      }>();

    return rows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      units: Number(row.units),
      revenueCents: toCents(row.revenue),
      costCents: row.cost === null ? null : decimalStringToCents(row.cost),
    }));
  }

  async lowStock(): Promise<LowStockRow[]> {
    const rows = await this.products
      .createQueryBuilder('pr')
      .where('pr.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('pr.active = true')
      .andWhere('pr.stock_quantity <= pr.low_stock_threshold')
      .select('pr.id::text', 'productId')
      .addSelect('pr.name', 'productName')
      .addSelect('pr.stock_quantity', 'stockQuantity')
      .addSelect('pr.low_stock_threshold', 'lowStockThreshold')
      .orderBy('pr.stock_quantity', 'ASC')
      .addOrderBy('pr.name', 'ASC')
      .getRawMany<{
        productId: string;
        productName: string;
        stockQuantity: number;
        lowStockThreshold: number;
      }>();

    return rows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      stockQuantity: Number(row.stockQuantity),
      lowStockThreshold: Number(row.lowStockThreshold),
    }));
  }

  async expensesByCategory(range: Range): Promise<ExpenseCategoryRow[]> {
    const rows = await this.expenses
      .createQueryBuilder('e')
      .where('e.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('e.paid_at >= :start AND e.paid_at < :end', range)
      .select('e.category', 'category')
      .addSelect('SUM(e.amount)', 'amount')
      .groupBy('1')
      .orderBy('"amount"', 'DESC')
      .getRawMany<{ category: ExpenseCategory; amount: string }>();

    return rows.map((row) => ({
      category: row.category,
      amountCents: decimalStringToCents(row.amount),
    }));
  }

  async commissionsEarned(range: Range): Promise<number> {
    const raw = await this.commissionEntries
      .createQueryBuilder('ce')
      .where('ce.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('ce.created_at >= :start AND ce.created_at < :end', range)
      .select('SUM(ce.amount)', 'total')
      .getRawOne<{ total: string | null }>();

    return toCents(raw?.total);
  }

  async appointmentCounts(range: Range): Promise<Record<string, number>> {
    const rows = await this.appointments
      .createQueryBuilder('a')
      .where('a.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('a.starts_at >= :start AND a.starts_at < :end', range)
      .select('a.status::text', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('1')
      .getRawMany<{ status: string; count: string }>();

    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }

  async appointmentCountsByBarber(range: Range): Promise<BarberStatusRow[]> {
    const rows = await this.appointments
      .createQueryBuilder('a')
      .innerJoin(Barber, 'b', 'b.id = a.barber_id')
      .where('a.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('a.starts_at >= :start AND a.starts_at < :end', range)
      .select('a.barber_id::text', 'barberId')
      .addSelect('b.display_name', 'barberName')
      .addSelect('a.status::text', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('1')
      .addGroupBy('2')
      .addGroupBy('3')
      .getRawMany<{ barberId: string; barberName: string; status: string; count: string }>();

    return rows.map((row) => ({
      barberId: row.barberId,
      barberName: row.barberName,
      status: row.status,
      count: Number(row.count),
    }));
  }

  async bookedMinutesByBarber(range: Range): Promise<BarberMinutesRow[]> {
    const rows = await this.appointments
      .createQueryBuilder('a')
      .where('a.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('a.starts_at >= :start AND a.starts_at < :end', range)
      .andWhere(`a.status <> 'cancelled'`)
      .select('a.barber_id::text', 'barberId')
      .addSelect('COALESCE(SUM(a.duration_minutes), 0)', 'minutes')
      .groupBy('1')
      .getRawMany<{ barberId: string; minutes: string }>();

    return rows.map((row) => ({
      barberId: row.barberId,
      minutes: Number(row.minutes),
    }));
  }

  async clientMix(range: Range): Promise<ClientMixRow> {

    const mix = await this.appointments.query(
      `
      WITH first_visit AS (
        SELECT client_id, MIN(starts_at) AS first_at
        FROM appointments
        WHERE status = 'completed' AND shop_id = $3
        GROUP BY client_id
      ),
      period_clients AS (
        SELECT DISTINCT client_id
        FROM appointments
        WHERE status = 'completed' AND shop_id = $3
          AND starts_at >= $1 AND starts_at < $2
      )
      SELECT
        COUNT(*) FILTER (
          WHERE first_visit.first_at >= $1 AND first_visit.first_at < $2
        )::int AS "newClients",
        COUNT(*) FILTER (
          WHERE first_visit.first_at < $1
        )::int AS "recurringClients"
      FROM period_clients
      JOIN first_visit ON first_visit.client_id = period_clients.client_id
      `,
      [range.start, range.end, this.shopId],
    );

    return {
      newClients: Number(mix[0]?.newClients ?? 0),
      recurringClients: Number(mix[0]?.recurringClients ?? 0),
    };
  }

  async inactiveClientCount(since: Date): Promise<number> {
    const raw = await this.appointments.query(
      `
      SELECT COUNT(*)::int AS count
      FROM users u
      WHERE u.role = 'CLIENT'
        AND u.shop_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.client_id = u.id
            AND a.status = 'completed'
            AND a.starts_at >= $1
        )
      `,
      [since, this.shopId],
    );

    return Number(raw[0]?.count ?? 0);
  }

  async commissionsByBarber(range: Range): Promise<BarberCommissionRow[]> {
    const rows = await this.commissionEntries
      .createQueryBuilder('ce')
      .innerJoin(Barber, 'b', 'b.id = ce.barber_id')
      .where('ce.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('ce.created_at >= :start AND ce.created_at < :end', range)
      .select('ce.barber_id::text', 'barberId')
      .addSelect('b.display_name', 'barberName')
      .addSelect('SUM(ce.amount)', 'amount')
      .groupBy('1')
      .addGroupBy('2')
      .orderBy('"amount"', 'DESC')
      .getRawMany<{ barberId: string; barberName: string; amount: string }>();

    return rows.map((row) => ({
      barberId: row.barberId,
      barberName: row.barberName,
      amountCents: decimalStringToCents(row.amount),
    }));
  }

  private paidInRange(range: Range): SelectQueryBuilder<Payment> {
    return this.payments
      .createQueryBuilder('p')
      .leftJoin(Appointment, 'a', 'a.id = p.appointment_id')
      .leftJoin(COLLAPSED_BASKETS, 'ps', 'ps.payment_id = p.id')
      .where('p.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('p.voided_at IS NULL')
      .andWhere('p.paid_at >= :start AND p.paid_at < :end', range);
  }
}

const COLLAPSED_BASKETS = `(
  SELECT DISTINCT ON (payment_id) payment_id, sold_by_barber_id
  FROM product_sales
  WHERE voided_at IS NULL
  ORDER BY payment_id, id
)`;

const TIME_BUCKETS: Partial<Record<RevenueGrouping, string>> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

function toCents(value: string | null | undefined): number {
  return value ? decimalStringToCents(value) : 0;
}
