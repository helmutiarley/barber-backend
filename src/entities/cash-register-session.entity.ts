import {
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
import { CASH_SESSION_STATUSES, type CashSessionStatus } from './enums';
import { User } from './user.entity';

@Entity('cash_register_sessions')
@Index('uq_cash_sessions_one_open', ['shopId', 'status'], {
  unique: true,
  where: `status = 'open'`,
})
export class CashRegisterSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_cash_sessions_shop_id')
  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({
    type: 'enum',
    enum: CASH_SESSION_STATUSES,
    enumName: 'cash_session_status',
    default: 'open',
  })
  status!: CashSessionStatus;

  @Column({ type: 'uuid' })
  openedBy!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'opened_by' })
  opener?: User;

  @Column({ type: 'timestamptz' })
  openedAt!: Date;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  openingBalance!: number;

  @Column({ type: 'uuid', nullable: true })
  closedBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'closed_by' })
  closer?: User;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: moneyTransformer,
  })
  expectedBalance!: number | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: moneyTransformer,
  })
  countedBalance!: number | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: moneyTransformer,
  })
  difference!: number | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
