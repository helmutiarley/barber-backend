import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { USER_ROLES, type UserRole } from './enums';

@Entity('users')
@Index('uq_users_shop_email', ['shopId', 'email'], { unique: true })
@Index('uq_users_platform_email', ['email'], { unique: true, where: 'shop_id IS NULL' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_users_shop_id')
  @Column({ type: 'uuid', nullable: true })
  shopId!: string | null;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  email!: string;

  @Column({ type: 'varchar', nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  passwordHash!: string | null;

  @Column({ type: 'enum', enum: USER_ROLES, enumName: 'user_role' })
  role!: UserRole;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
