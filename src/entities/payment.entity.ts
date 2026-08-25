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
import { Appointment } from './appointment.entity';
import { CashRegisterSession } from './cash-register-session.entity';
import { PAYMENT_METHODS, type PaymentMethod } from './enums';
import { User } from './user.entity';

@Entity('payments')
@Index('idx_payments_appointment_id', ['appointmentId'])
@Index('idx_payments_paid_at', ['paidAt'])
@Index('idx_payments_session_id', ['cashRegisterSessionId'])

@Check('chk_payments_amount_positive', '"amount" > 0')
@Check('chk_payments_card_fee_non_negative', '"card_fee" >= 0')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  appointmentId!: string | null;

  @ManyToOne(() => Appointment, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  amount!: number;

  @Column({ type: 'enum', enum: PAYMENT_METHODS, enumName: 'payment_method' })
  method!: PaymentMethod;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: moneyTransformer,
  })
  cardFee!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  netAmount!: number;

  @Column({ type: 'uuid', nullable: true })
  cashRegisterSessionId!: string | null;

  @ManyToOne(() => CashRegisterSession, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cash_register_session_id' })
  cashRegisterSession?: CashRegisterSession;

  @Column({ type: 'uuid' })
  receivedBy!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'received_by' })
  receiver?: User;

  @Column({ type: 'timestamptz' })
  paidAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  voidedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voidedBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  voidReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
