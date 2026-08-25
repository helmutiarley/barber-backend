import { randomUUID } from 'node:crypto';
import { IsNull, type DataSource } from 'typeorm';
import type { AppConfig } from '../../src/config';
import { Appointment } from '../../src/entities/appointment.entity';
import { BarberBlock } from '../../src/entities/barber-block.entity';
import { BarberSchedule } from '../../src/entities/barber-schedule.entity';
import { Barber } from '../../src/entities/barber.entity';
import { CashMovement } from '../../src/entities/cash-movement.entity';
import { CashRegisterSession } from '../../src/entities/cash-register-session.entity';
import { ClientProfile } from '../../src/entities/client-profile.entity';
import { CommissionAdvance } from '../../src/entities/commission-advance.entity';
import { CommissionEntry } from '../../src/entities/commission-entry.entity';
import { CommissionPeriod } from '../../src/entities/commission-period.entity';
import { CommissionRule } from '../../src/entities/commission-rule.entity';
import type { UserRole } from '../../src/entities/enums';
import { Expense } from '../../src/entities/expense.entity';
import { Payment } from '../../src/entities/payment.entity';
import { ProductSale } from '../../src/entities/product-sale.entity';
import { Product } from '../../src/entities/product.entity';
import { Service } from '../../src/entities/service.entity';
import { StockAdjustment } from '../../src/entities/stock-adjustment.entity';
import { User } from '../../src/entities/user.entity';
import { hashPassword } from '../../src/lib/password';
import { signAccessToken } from '../../src/lib/tokens';

export const TEST_PASSWORD = 'test-password-123';

export async function makeUser(
  dataSource: DataSource,
  overrides: Partial<User> & { role?: UserRole } = {},
): Promise<User> {
  const repository = dataSource.getRepository(User);

  return repository.save(
    repository.create({
      name: 'Test User',
      email: `user-${randomUUID()}@test.local`,
      phone: null,
      role: 'CLIENT',
      active: true,
      ...overrides,
    }),
  );
}

export async function makeUserWithPassword(
  dataSource: DataSource,
  overrides: Partial<User> & { role?: UserRole } = {},
): Promise<User> {
  return makeUser(dataSource, { passwordHash: await hashPassword(TEST_PASSWORD), ...overrides });
}

export async function makeAuthenticatedUser(
  dataSource: DataSource,
  config: AppConfig,
  overrides: Partial<User> & { role?: UserRole } = {},
): Promise<{ user: User; accessToken: string; authHeader: string }> {
  const user = await makeUserWithPassword(dataSource, overrides);
  const accessToken = signAccessToken(config, { sub: user.id, role: user.role });

  return { user, accessToken, authHeader: `Bearer ${accessToken}` };
}

export async function makeBarber(
  dataSource: DataSource,
  overrides: Partial<Barber> = {},
): Promise<Barber> {
  const repository = dataSource.getRepository(Barber);
  const userId = overrides.userId ?? (await makeUser(dataSource, { role: 'BARBER' })).id;

  return repository.save(
    repository.create({
      displayName: 'Test Barber',
      specialties: [],
      active: true,
      ...overrides,
      userId,
    }),
  );
}

export async function makeService(
  dataSource: DataSource,
  overrides: Partial<Service> = {},
): Promise<Service> {
  const repository = dataSource.getRepository(Service);

  return repository.save(
    repository.create({
      name: `Service ${randomUUID().slice(0, 8)}`,
      description: null,
      price: 4500,
      durationMinutes: 30,
      active: true,
      ...overrides,
    }),
  );
}

export async function makeClientProfile(
  dataSource: DataSource,
  overrides: Partial<ClientProfile> & { userId: string },
): Promise<ClientProfile> {
  const repository = dataSource.getRepository(ClientProfile);

  return repository.save(
    repository.create({
      birthday: null,
      preferences: null,
      internalNotes: null,
      ...overrides,
    }),
  );
}

export async function makeSchedule(
  dataSource: DataSource,
  overrides: Partial<BarberSchedule> & { barberId: string },
): Promise<BarberSchedule> {
  const repository = dataSource.getRepository(BarberSchedule);

  return repository.save(
    repository.create({
      weekday: 1,
      startTime: '09:00:00',
      endTime: '18:00:00',
      breakStart: null,
      breakEnd: null,
      ...overrides,
    }),
  );
}

export async function makeWorkingWeek(
  dataSource: DataSource,
  barberId: string,
  overrides: Partial<BarberSchedule> = {},
): Promise<BarberSchedule[]> {
  const repository = dataSource.getRepository(BarberSchedule);

  return repository.save(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
      repository.create({
        barberId,
        weekday,
        startTime: '06:00:00',
        endTime: '22:00:00',
        breakStart: null,
        breakEnd: null,
        ...overrides,
      }),
    ),
  );
}

export async function makeBlock(
  dataSource: DataSource,
  overrides: Partial<BarberBlock> & { barberId: string; startsAt: Date; endsAt: Date },
): Promise<BarberBlock> {
  const repository = dataSource.getRepository(BarberBlock);

  return repository.save(repository.create({ reason: null, ...overrides }));
}

export async function makeAppointment(
  dataSource: DataSource,
  overrides: Partial<Appointment> = {},
): Promise<Appointment> {
  const repository = dataSource.getRepository(Appointment);

  const durationMinutes = overrides.durationMinutes ?? 30;
  const startsAt = overrides.startsAt ?? new Date(Date.now() + 86_400_000);
  const clientId = overrides.clientId ?? (await makeUser(dataSource, { role: 'CLIENT' })).id;
  const barberId = overrides.barberId ?? (await makeBarber(dataSource)).id;
  const serviceId = overrides.serviceId ?? (await makeService(dataSource, { durationMinutes })).id;

  return repository.save(
    repository.create({
      status: 'scheduled',
      price: 4500,
      notes: null,
      ...overrides,
      clientId,
      barberId,
      serviceId,
      startsAt,
      endsAt: overrides.endsAt ?? new Date(startsAt.getTime() + durationMinutes * 60_000),
      durationMinutes,
      createdBy: overrides.createdBy ?? clientId,
    }),
  );
}

export async function makeSession(
  dataSource: DataSource,
  overrides: Partial<CashRegisterSession> = {},
): Promise<CashRegisterSession> {
  const repository = dataSource.getRepository(CashRegisterSession);
  const openedBy = overrides.openedBy ?? (await makeUser(dataSource, { role: 'MANAGER' })).id;

  return repository.save(
    repository.create({
      status: 'open',
      openedAt: new Date(),
      openingBalance: 10_000,
      ...overrides,
      openedBy,
    }),
  );
}

export async function makeMovement(
  dataSource: DataSource,
  overrides: Partial<CashMovement> & { sessionId: string },
): Promise<CashMovement> {
  const repository = dataSource.getRepository(CashMovement);
  const createdBy = overrides.createdBy ?? (await makeUser(dataSource, { role: 'MANAGER' })).id;

  return repository.save(
    repository.create({
      type: 'in',
      source: 'deposit',
      amount: 5000,
      paymentId: null,
      expenseId: null,
      description: null,
      ...overrides,
      createdBy,
    }),
  );
}

export async function makeExpense(
  dataSource: DataSource,
  overrides: Partial<Expense> = {},
): Promise<Expense> {
  const repository = dataSource.getRepository(Expense);
  const createdBy = overrides.createdBy ?? (await makeUser(dataSource, { role: 'MANAGER' })).id;

  return repository.save(
    repository.create({
      description: `Expense ${randomUUID().slice(0, 8)}`,
      category: 'supplies',
      kind: 'variable',
      amount: 12_000,
      dueDate: null,
      paidAt: null,
      paymentMethod: null,
      recurring: false,
      ...overrides,
      createdBy,
    }),
  );
}

export async function makeCommissionRule(
  dataSource: DataSource,
  overrides: Partial<CommissionRule> = {},
): Promise<CommissionRule> {
  const repository = dataSource.getRepository(CommissionRule);

  return repository.save(
    repository.create({
      barberId: null,
      serviceId: null,
      rate: 0.4,
      base: 'gross',
      appliesTo: 'services',
      active: true,
      ...overrides,
    }),
  );
}

export async function ensureDefaultCommissionRule(
  dataSource: DataSource,
  overrides: Partial<CommissionRule> = {},
): Promise<CommissionRule> {
  const existing = await dataSource.getRepository(CommissionRule).findOneBy({
    barberId: IsNull(),
    serviceId: IsNull(),
    appliesTo: 'services',
    active: true,
  });

  return existing ?? makeCommissionRule(dataSource, overrides);
}

export async function makeCommissionEntry(
  dataSource: DataSource,
  overrides: Partial<CommissionEntry> = {},
): Promise<CommissionEntry> {
  const repository = dataSource.getRepository(CommissionEntry);

  const rate = overrides.rate ?? 0.4;
  const baseAmount = overrides.baseAmount ?? 4500;

  const appointment =
    overrides.appointmentId === undefined && !overrides.productSaleId
      ? await makeAppointment(dataSource, {
          status: 'completed',
          ...(overrides.barberId ? { barberId: overrides.barberId } : {}),
        })
      : null;

  return repository.save(
    repository.create({
      base: 'gross',
      productSaleId: null,
      ...overrides,
      barberId: overrides.barberId ?? appointment?.barberId ?? (await makeBarber(dataSource)).id,
      appointmentId: appointment ? appointment.id : (overrides.appointmentId ?? null),
      ruleId: overrides.ruleId ?? (await ensureDefaultCommissionRule(dataSource, { rate })).id,
      rate,
      baseAmount,
      amount: overrides.amount ?? Math.round(baseAmount * rate),
    }),
  );
}

export async function makeCommissionPeriod(
  dataSource: DataSource,
  overrides: Partial<CommissionPeriod> = {},
): Promise<CommissionPeriod> {
  const repository = dataSource.getRepository(CommissionPeriod);

  const totalEntries = overrides.totalEntries ?? 20_000;
  const totalAdvances = overrides.totalAdvances ?? 5000;

  return repository.save(
    repository.create({
      startsOn: '2026-01-01',
      endsOn: '2026-01-15',
      status: 'closed',
      closedAt: new Date(),
      paidAt: null,
      paymentMethod: null,
      ...overrides,
      barberId: overrides.barberId ?? (await makeBarber(dataSource)).id,
      closedBy: overrides.closedBy ?? (await makeUser(dataSource, { role: 'ADMIN' })).id,
      totalEntries,
      totalAdvances,
      totalDue: overrides.totalDue ?? totalEntries - totalAdvances,
    }),
  );
}

export async function makeCommissionAdvance(
  dataSource: DataSource,
  overrides: Partial<CommissionAdvance> = {},
): Promise<CommissionAdvance> {
  const repository = dataSource.getRepository(CommissionAdvance);

  return repository.save(
    repository.create({
      amount: 5000,
      periodId: null,
      notes: null,
      ...overrides,
      barberId: overrides.barberId ?? (await makeBarber(dataSource)).id,
      createdBy: overrides.createdBy ?? (await makeUser(dataSource, { role: 'MANAGER' })).id,
    }),
  );
}

export async function makePayment(
  dataSource: DataSource,
  overrides: Partial<Payment> = {},
): Promise<Payment> {
  const repository = dataSource.getRepository(Payment);

  const amount = overrides.amount ?? 4500;
  const cardFee = overrides.cardFee ?? 0;
  const appointmentId =
    overrides.appointmentId === undefined
      ? (await makeAppointment(dataSource, { status: 'completed' })).id
      : overrides.appointmentId;
  const receivedBy = overrides.receivedBy ?? (await makeUser(dataSource, { role: 'MANAGER' })).id;

  return repository.save(
    repository.create({
      method: 'cash',
      cashRegisterSessionId: null,
      paidAt: new Date(),
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      ...overrides,
      appointmentId,
      amount,
      cardFee,
      netAmount: overrides.netAmount ?? amount - cardFee,
      receivedBy,
    }),
  );
}

export async function makeProduct(
  dataSource: DataSource,
  overrides: Partial<Product> = {},
): Promise<Product> {
  const repository = dataSource.getRepository(Product);

  return repository.save(
    repository.create({
      name: `Product ${randomUUID().slice(0, 8)}`,
      description: null,
      price: 3500,
      cost: 1800,
      stockQuantity: 10,
      lowStockThreshold: 3,
      active: true,
      ...overrides,
    }),
  );
}

export async function makeProductSale(
  dataSource: DataSource,
  overrides: Partial<ProductSale> = {},
): Promise<ProductSale> {
  const repository = dataSource.getRepository(ProductSale);

  const product = overrides.productId ? null : await makeProduct(dataSource);
  const quantity = overrides.quantity ?? 1;
  const unitPrice = overrides.unitPrice ?? product?.price ?? 3500;

  return repository.save(
    repository.create({
      soldByBarberId: null,
      clientId: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      ...overrides,
      productId: overrides.productId ?? product!.id,
      quantity,
      unitPrice,
      total: overrides.total ?? unitPrice * quantity,
      paymentId:
        overrides.paymentId ??
        (
          await makePayment(dataSource, {
            appointmentId: null,
            amount: unitPrice * quantity,
          })
        ).id,
      createdBy: overrides.createdBy ?? (await makeUser(dataSource, { role: 'MANAGER' })).id,
    }),
  );
}

export async function makeStockAdjustment(
  dataSource: DataSource,
  overrides: Partial<StockAdjustment> = {},
): Promise<StockAdjustment> {
  const repository = dataSource.getRepository(StockAdjustment);
  const delta = overrides.delta ?? 5;

  return repository.save(
    repository.create({
      reason: 'purchase',
      notes: null,
      ...overrides,
      delta,
      productId: overrides.productId ?? (await makeProduct(dataSource)).id,
      resultingQuantity: overrides.resultingQuantity ?? delta,
      createdBy: overrides.createdBy ?? (await makeUser(dataSource, { role: 'MANAGER' })).id,
    }),
  );
}
