export const USER_ROLES = ['ADMIN', 'MANAGER', 'BARBER', 'CLIENT'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'confirmed'];

export const PAYMENT_METHODS = ['cash', 'pix', 'debit', 'credit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CARD_PAYMENT_METHODS: readonly PaymentMethod[] = ['debit', 'credit'];

export const CASH_SESSION_STATUSES = ['open', 'closed'] as const;
export type CashSessionStatus = (typeof CASH_SESSION_STATUSES)[number];

export const CASH_MOVEMENT_TYPES = ['in', 'out'] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const CASH_MOVEMENT_SOURCES = [
  'payment',
  'expense',
  'withdrawal',
  'deposit',
  'advance',
  'payout',
  'adjustment',
] as const;
export type CashMovementSource = (typeof CASH_MOVEMENT_SOURCES)[number];

export const MANUAL_CASH_MOVEMENT_SOURCES = ['withdrawal', 'deposit', 'adjustment'] as const;
export type ManualCashMovementSource = (typeof MANUAL_CASH_MOVEMENT_SOURCES)[number];

export const EXPENSE_CATEGORIES = [
  'rent',
  'utilities',
  'supplies',
  'products',
  'salaries',
  'maintenance',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_KINDS = ['fixed', 'variable'] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export const COMMISSION_BASES = ['gross', 'net'] as const;
export type CommissionBase = (typeof COMMISSION_BASES)[number];

export const COMMISSION_APPLIES_TO = ['services', 'products'] as const;
export type CommissionAppliesTo = (typeof COMMISSION_APPLIES_TO)[number];

export const COMMISSION_PERIOD_STATUSES = ['closed', 'paid'] as const;
export type CommissionPeriodStatus = (typeof COMMISSION_PERIOD_STATUSES)[number];

export const STOCK_ADJUSTMENT_REASONS = ['purchase', 'loss', 'correction'] as const;
export type StockAdjustmentReason = (typeof STOCK_ADJUSTMENT_REASONS)[number];
