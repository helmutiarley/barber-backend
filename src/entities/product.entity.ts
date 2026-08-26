import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { moneyTransformer } from '../lib/money';

@Entity('products')

@Index('uq_products_name_active', ['shopId', 'name'], { unique: true, where: 'active' })

@Check('chk_products_stock_non_negative', '"stock_quantity" >= 0')
@Check('chk_products_low_stock_threshold_non_negative', '"low_stock_threshold" >= 0')
@Check('chk_products_price_positive', '"price" > 0')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_products_shop_id')
  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  price!: number;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: moneyTransformer,
  })
  cost!: number | null;

  @Column({ type: 'integer', default: 0 })
  stockQuantity!: number;

  @Column({ type: 'integer', default: 0 })
  lowStockThreshold!: number;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
