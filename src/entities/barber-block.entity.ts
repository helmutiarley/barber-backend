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
import { Barber } from './barber.entity';

@Entity('barber_blocks')
@Index('idx_barber_blocks_barber_starts_at', ['barberId', 'startsAt'])
@Check('chk_barber_blocks_range', '"ends_at" > "starts_at"')
export class BarberBlock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_barber_blocks_shop_id')
  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'uuid' })
  barberId!: string;

  @ManyToOne(() => Barber, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'barber_id' })
  barber?: Barber;

  @Column({ type: 'timestamptz' })
  startsAt!: Date;

  @Column({ type: 'timestamptz' })
  endsAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
