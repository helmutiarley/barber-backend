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
import { rateTransformer } from '../lib/rate';
import { Barber } from './barber.entity';
import { COMMISSION_BASES, type CommissionAppliesTo, type CommissionBase } from './enums';
import { Service } from './service.entity';

@Entity('commission_rules')
@Index('idx_commission_rules_lookup', ['appliesTo', 'barberId', 'serviceId'])

@Index('uq_commission_rules_scope', ['shopId', 'barberId', 'serviceId', 'appliesTo'], {
  unique: true,
  where: 'active',
})

@Check('chk_commission_rules_rate_range', '"rate" >= 0 AND "rate" <= 1')
export class CommissionRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_commission_rules_shop_id')
  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'uuid', nullable: true })
  barberId!: string | null;

  @ManyToOne(() => Barber, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'barber_id' })
  barber?: Barber;

  @Column({ type: 'uuid', nullable: true })
  serviceId!: string | null;

  @ManyToOne(() => Service, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_id' })
  service?: Service;

  @Column({ type: 'numeric', precision: 5, scale: 4, transformer: rateTransformer })
  rate!: number;

  @Column({ type: 'enum', enum: COMMISSION_BASES, enumName: 'commission_base' })
  base!: CommissionBase;

  @Column({ type: 'varchar', default: 'services' })
  appliesTo!: CommissionAppliesTo;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
