import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Exclusion,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { moneyTransformer } from '../lib/money';
import { Barber } from './barber.entity';
import { PAYMENT_METHODS, type CommissionPeriodStatus, type PaymentMethod } from './enums';
import { User } from './user.entity';

@Entity('commission_periods')

@Index('idx_commission_periods_barber_ends', ['barberId', 'endsOn'])
@Check('chk_commission_periods_range', '"ends_on" >= "starts_on"')

@Exclusion(
  'commission_periods_no_overlap',
  `USING gist (barber_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)`,
)
export class CommissionPeriod {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_commission_periods_shop_id')
  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'uuid' })
  barberId!: string;

  @ManyToOne(() => Barber, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'barber_id' })
  barber?: Barber;

  @Column({ type: 'date' })
  startsOn!: string;

  @Column({ type: 'date' })
  endsOn!: string;

  @Column({ type: 'varchar', default: 'closed' })
  status!: CommissionPeriodStatus;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  totalEntries!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  totalAdvances!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  totalDue!: number;

  @Column({ type: 'uuid' })
  closedBy!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'closed_by' })
  closer?: User;

  @Column({ type: 'timestamptz' })
  closedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'enum', enum: PAYMENT_METHODS, enumName: 'payment_method', nullable: true })
  paymentMethod!: PaymentMethod | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
