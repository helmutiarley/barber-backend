import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { moneyTransformer } from '../lib/money';
import { CashRegisterSession } from './cash-register-session.entity';
import { CommissionAdvance } from './commission-advance.entity';
import { CommissionPeriod } from './commission-period.entity';
import { CASH_MOVEMENT_TYPES, type CashMovementSource, type CashMovementType } from './enums';
import { Expense } from './expense.entity';
import { Payment } from './payment.entity';
import { User } from './user.entity';

@Entity('cash_movements')
@Index('idx_cash_movements_session_id', ['sessionId'])

@Check('chk_cash_movements_amount_positive', '"amount" > 0')
export class CashMovement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => CashRegisterSession, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'session_id' })
  session?: CashRegisterSession;

  @Column({ type: 'enum', enum: CASH_MOVEMENT_TYPES, enumName: 'cash_movement_type' })
  type!: CashMovementType;

  @Column({ type: 'varchar' })
  source!: CashMovementSource;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  amount!: number;

  @Column({ type: 'uuid', nullable: true })
  paymentId!: string | null;

  @ManyToOne(() => Payment, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_id' })
  payment?: Payment;

  @Column({ type: 'uuid', nullable: true })
  expenseId!: string | null;

  @ManyToOne(() => Expense, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'expense_id' })
  expense?: Expense;

  @Column({ type: 'uuid', nullable: true })
  advanceId!: string | null;

  @ManyToOne(() => CommissionAdvance, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'advance_id' })
  advance?: CommissionAdvance;

  @Column({ type: 'uuid', nullable: true })
  periodId!: string | null;

  @ManyToOne(() => CommissionPeriod, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'period_id' })
  period?: CommissionPeriod;

  @Column({ type: 'varchar', nullable: true })
  description!: string | null;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator?: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
