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
import { Barber } from './barber.entity';
import { CommissionPeriod } from './commission-period.entity';
import { User } from './user.entity';

@Entity('commission_advances')
@Index('idx_commission_advances_barber_created', ['barberId', 'createdAt'])
@Check('chk_commission_advances_amount_positive', '"amount" > 0')
export class CommissionAdvance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_commission_advances_shop_id')
  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'uuid' })
  barberId!: string;

  @ManyToOne(() => Barber, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'barber_id' })
  barber?: Barber;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  amount!: number;

  @Column({ type: 'uuid', nullable: true })
  periodId!: string | null;

  @ManyToOne(() => CommissionPeriod, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'period_id' })
  period?: CommissionPeriod;

  @Column({ type: 'varchar', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator?: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
