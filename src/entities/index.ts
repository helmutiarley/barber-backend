import { Appointment } from './appointment.entity';
import { BarberBlock } from './barber-block.entity';
import { BarberSchedule } from './barber-schedule.entity';
import { Barber } from './barber.entity';
import { CashMovement } from './cash-movement.entity';
import { CashRegisterSession } from './cash-register-session.entity';
import { ClientProfile } from './client-profile.entity';
import { CommissionAdvance } from './commission-advance.entity';
import { CommissionEntry } from './commission-entry.entity';
import { CommissionPeriod } from './commission-period.entity';
import { CommissionRule } from './commission-rule.entity';
import { Expense } from './expense.entity';
import { Payment } from './payment.entity';
import { ProductSale } from './product-sale.entity';
import { Product } from './product.entity';
import { RefreshToken } from './refresh-token.entity';
import { Service } from './service.entity';
import { Shop } from './shop.entity';
import { StockAdjustment } from './stock-adjustment.entity';
import { User } from './user.entity';

export const entities = [
  Shop,
  User,
  Barber,
  BarberSchedule,
  BarberBlock,
  Service,
  Appointment,
  RefreshToken,
  ClientProfile,
  CashRegisterSession,
  Payment,
  Expense,
  CashMovement,
  CommissionRule,
  CommissionPeriod,
  Product,
  ProductSale,
  CommissionEntry,
  CommissionAdvance,
  StockAdjustment,
];

export {
  Appointment,
  Barber,
  BarberBlock,
  BarberSchedule,
  CashMovement,
  CashRegisterSession,
  ClientProfile,
  CommissionAdvance,
  CommissionEntry,
  CommissionPeriod,
  CommissionRule,
  Expense,
  Payment,
  Product,
  ProductSale,
  RefreshToken,
  Service,
  Shop,
  StockAdjustment,
  User,
};
