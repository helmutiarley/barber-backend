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
import { User } from './user.entity';

@Entity('client_profiles')
export class ClientProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_client_profiles_shop_id')
  @Column({ type: 'uuid' })
  shopId!: string;

  @Index('uq_client_profiles_user_id', { unique: true })
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'date', nullable: true })
  birthday!: string | null;

  @Column({ type: 'text', nullable: true })
  preferences!: string | null;

  @Column({ type: 'text', nullable: true })
  internalNotes!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
