import type { DataSource, EntityManager } from 'typeorm';
import type { AppConfig } from '../config';
import type { Cradle } from '../container';
import type { ExpenseCategory, ExpenseKind, PaymentMethod } from '../entities/enums';
import type { Expense } from '../entities/expense.entity';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import type { Clock } from '../lib/clock';
import { shopDayBounds, toShopDate } from '../lib/shop-time';
import { withTransaction } from '../lib/transaction';
import type {
  ExpenseChanges,
  ExpensesRepository,
  NewExpense,
  PaidFields,
} from '../repositories/expenses.repository';
import type { CashRegisterService } from './cash-register.service';

export interface ExpenseDto {
  id: string;
  description: string;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amountCents: number;
  dueDate: string | null;
  paidAt: string | null;
  paymentMethod: PaymentMethod | null;
  recurring: boolean;

  overdue: boolean;
  createdBy: string;
  createdAt: string;
}

export interface CreateExpenseInput {
  description: string;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amountCents: number;
  dueDate?: string | null;
  recurring?: boolean;

  paymentMethod?: PaymentMethod;
  paidAt?: Date;
}

export interface UpdateExpenseInput {
  description?: string;
  category?: ExpenseCategory;
  kind?: ExpenseKind;
  amountCents?: number;
  dueDate?: string | null;
  recurring?: boolean;
}

export interface PayExpenseInput {
  paymentMethod: PaymentMethod;
  paidAt?: Date;
}

export interface PageInput {
  limit: number;
  offset: number;
}

export interface ListExpensesInput extends PageInput {
  category?: ExpenseCategory;
  kind?: ExpenseKind;
  paid?: boolean;
  from?: Date;
  to?: Date;
  overdue?: boolean;
}

export interface PagedExpenses extends PageInput {
  items: ExpenseDto[];
  total: number;
}

const EDITABLE_AFTER_PAID = ['description', 'category'] as const;

export class ExpensesService {
  private readonly expensesRepository: ExpensesRepository;
  private readonly cashRegisterService: CashRegisterService;

  private readonly dataSource: DataSource;
  private readonly clock: Clock;
  private readonly config: AppConfig;

  constructor({ expensesRepository, cashRegisterService, dataSource, clock, config }: Cradle) {
    this.expensesRepository = expensesRepository;
    this.cashRegisterService = cashRegisterService;
    this.dataSource = dataSource;
    this.clock = clock;
    this.config = config;
  }

  async create(input: CreateExpenseInput, actor: AuthenticatedUser): Promise<ExpenseDto> {
    const row: NewExpense = {
      description: input.description.trim(),
      category: input.category,
      kind: input.kind,
      amount: input.amountCents,
      dueDate: input.dueDate ?? null,
      paidAt: null,
      paymentMethod: null,
      recurring: input.recurring ?? false,
      createdBy: actor.id,
    };

    if (!input.paymentMethod) {
      return this.toDto(await this.expensesRepository.create(row));
    }

    return this.settle(
      { paymentMethod: input.paymentMethod, paidAt: input.paidAt },
      actor,
      (manager, paid) => this.expensesRepository.create({ ...row, ...paid }, manager),
    );
  }

  async list(input: ListExpensesInput): Promise<PagedExpenses> {
    const page = { limit: input.limit, offset: input.offset };
    const [rows, total] = await this.expensesRepository.findMany(
      {
        category: input.category,
        kind: input.kind,
        paid: input.paid,
        from: input.from,
        to: input.to,
        overdue: input.overdue,
        today: this.today(),
      },
      page,
    );

    return { items: rows.map((row) => this.toDto(row)), total, ...page };
  }

  async get(id: string): Promise<ExpenseDto> {
    return this.toDto(await this.require(id));
  }

  async update(id: string, input: UpdateExpenseInput): Promise<ExpenseDto> {
    const expense = await this.require(id);

    if (expense.paidAt) {
      assertOnlyDescriptive(input);
    }

    const updated = await this.expensesRepository.update(id, toChanges(input));

    return this.toDto(updated ?? expense);
  }

  async pay(id: string, input: PayExpenseInput, actor: AuthenticatedUser): Promise<ExpenseDto> {
    const expense = await this.require(id);

    if (expense.paidAt) {
      throw new ConflictError('This expense has already been paid');
    }

    return this.settle(input, actor, (manager, paid) =>
      this.expensesRepository.markPaid(expense.id, paid, manager),
    );
  }

  async remove(id: string): Promise<void> {
    const expense = await this.require(id);

    if (expense.paidAt) {
      throw new ConflictError('A paid expense cannot be deleted — record an adjustment instead');
    }

    await this.expensesRepository.delete(id);
  }

  private async settle(
    input: PayExpenseInput,
    actor: AuthenticatedUser,
    write: (manager: EntityManager, paid: PaidFields) => Promise<Expense | null>,
  ): Promise<ExpenseDto> {
    const paidAt = input.paidAt ?? this.clock.now();
    this.assertPayable(paidAt, input.paymentMethod);

    const expense = await withTransaction(this.dataSource, async (manager) => {

      const session =
        input.paymentMethod === 'cash'
          ? await this.cashRegisterService.requireOpenSession(manager)
          : null;

      const paid = await write(manager, { paidAt, paymentMethod: input.paymentMethod });
      if (!paid) {

        throw new ConflictError('This expense has already been paid');
      }

      if (session) {
        await this.recordDrawerWithdrawal(session.id, paid, actor, manager);
      }

      return paid;
    });

    return this.toDto(expense);
  }

  private async recordDrawerWithdrawal(
    sessionId: string,
    expense: Expense,
    actor: AuthenticatedUser,
    manager: EntityManager,
  ): Promise<void> {
    await this.cashRegisterService.recordMovement(
      {
        sessionId,
        type: 'out',
        source: 'expense',
        amountCents: expense.amount,
        expenseId: expense.id,
        description: expense.description,
        createdBy: actor.id,
      },
      manager,
    );
  }

  private assertPayable(paidAt: Date, method: PaymentMethod): void {
    const now = this.clock.now();

    if (paidAt > now) {
      throw new ValidationError('An expense cannot be paid in the future', [
        { field: 'paidAt', message: 'must not be in the future' },
      ]);
    }

    if (method !== 'cash') {
      return;
    }

    const { start, end } = shopDayBounds(this.today(), this.config.shopTimezone);

    if (paidAt < start || paidAt >= end) {
      throw new ValidationError('Cash expenses can only be paid today', [
        { field: 'paidAt', message: 'must fall on the current shop day' },
      ]);
    }
  }

  private async require(id: string): Promise<Expense> {
    const expense = await this.expensesRepository.findById(id);
    if (!expense) {
      throw new NotFoundError(`Expense ${id} not found`);
    }

    return expense;
  }

  private today(): string {
    return toShopDate(this.clock.now(), this.config.shopTimezone);
  }

  private toDto(expense: Expense): ExpenseDto {
    return {
      id: expense.id,
      description: expense.description,
      category: expense.category,
      kind: expense.kind,
      amountCents: expense.amount,
      dueDate: expense.dueDate,
      paidAt: expense.paidAt?.toISOString() ?? null,
      paymentMethod: expense.paymentMethod,
      recurring: expense.recurring,
      overdue: !expense.paidAt && expense.dueDate !== null && expense.dueDate < this.today(),
      createdBy: expense.createdBy,
      createdAt: expense.createdAt.toISOString(),
    };
  }
}

function toChanges(input: UpdateExpenseInput): ExpenseChanges {
  const changes: ExpenseChanges = {
    description: input.description?.trim(),
    category: input.category,
    kind: input.kind,
    amount: input.amountCents,
    dueDate: input.dueDate,
    recurring: input.recurring,
  };

  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
}

function assertOnlyDescriptive(input: UpdateExpenseInput): void {
  const frozen = Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field)
    .filter((field) => !(EDITABLE_AFTER_PAID as readonly string[]).includes(field));

  if (frozen.length > 0) {
    throw new ConflictError(
      'A paid expense only accepts description and category changes — record an adjustment instead',
      { fields: frozen },
    );
  }
}
