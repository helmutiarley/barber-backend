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
import { type StockAdjustmentReason } from './enums';
import { Product } from './product.entity';
import { User } from './user.entity';

@Entity('stock_adjustments')
@Index('idx_stock_adjustments_product_created', ['productId', 'createdAt'])

@Check('chk_stock_adjustments_delta_non_zero', '"delta" <> 0')
export class StockAdjustment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_stock_adjustments_shop_id')
  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ type: 'integer' })
  delta!: number;

  @Column({ type: 'varchar' })
  reason!: StockAdjustmentReason;

  @Column({ type: 'integer' })
  resultingQuantity!: number;

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
