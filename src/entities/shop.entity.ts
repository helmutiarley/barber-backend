import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('shops')
export class Shop {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Index('uq_shops_slug', { unique: true })
  @Column({ type: 'varchar' })
  slug!: string;

  @Index('uq_shops_domain', { unique: true })
  @Column({ type: 'varchar' })
  domain!: string;

  @Index('uq_shops_custom_domain', { unique: true })
  @Column({ type: 'varchar', nullable: true })
  customDomain!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
