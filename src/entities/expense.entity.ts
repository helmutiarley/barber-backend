import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { moneyTransformer } from '../lib/money';
import {
  PAYMENT_METHODS,
  type ExpenseCategory,
  type ExpenseKind,
  type PaymentMethod,
} from './enums';
import { User } from './user.entity';

@Entity('expenses')
@Index('idx_expenses_paid_at', ['paidAt'])
@Index('idx_expenses_due_date', ['dueDate'])

@Check('chk_expenses_amount_positive', '"amount" > 0')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  description!: string;

  @Column({ type: 'varchar' })
  category!: ExpenseCategory;

  @Column({ type: 'varchar' })
  kind!: ExpenseKind;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  amount!: number;

  @Column({ type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'enum', enum: PAYMENT_METHODS, enumName: 'payment_method', nullable: true })
  paymentMethod!: PaymentMethod | null;

  @Column({ type: 'boolean', default: false })
  recurring!: boolean;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator?: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
