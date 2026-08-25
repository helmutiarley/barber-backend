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
import { Appointment } from './appointment.entity';
import { Barber } from './barber.entity';
import { CommissionPeriod } from './commission-period.entity';
import { CommissionRule } from './commission-rule.entity';
import { COMMISSION_BASES, type CommissionBase } from './enums';
import { ProductSale } from './product-sale.entity';
import { moneyTransformer } from '../lib/money';
import { rateTransformer } from '../lib/rate';

@Entity('commission_entries')

@Index('idx_commission_entries_barber_created', ['barberId', 'createdAt'])
@Index('uq_commission_entries_appointment', ['appointmentId'], { unique: true })
@Index('uq_commission_entries_product_sale', ['productSaleId'], { unique: true })
@Check('chk_commission_entries_amount_non_negative', '"amount" >= 0')

@Check(
  'chk_commission_entries_one_source',
  '("appointment_id" IS NULL) <> ("product_sale_id" IS NULL)',
)
export class CommissionEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  barberId!: string;

  @ManyToOne(() => Barber, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'barber_id' })
  barber?: Barber;

  @Column({ type: 'uuid', nullable: true })
  appointmentId!: string | null;

  @ManyToOne(() => Appointment, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment;

  @Column({ type: 'uuid', nullable: true })
  productSaleId!: string | null;

  @ManyToOne(() => ProductSale, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_sale_id' })
  productSale?: ProductSale;

  @Column({ type: 'uuid' })
  ruleId!: string;

  @ManyToOne(() => CommissionRule, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'rule_id' })
  rule?: CommissionRule;

  @Column({ type: 'numeric', precision: 5, scale: 4, transformer: rateTransformer })
  rate!: number;

  @Column({ type: 'enum', enum: COMMISSION_BASES, enumName: 'commission_base' })
  base!: CommissionBase;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  baseAmount!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  amount!: number;

  @Column({ type: 'uuid', nullable: true })
  periodId!: string | null;

  @ManyToOne(() => CommissionPeriod, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'period_id' })
  period?: CommissionPeriod;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
