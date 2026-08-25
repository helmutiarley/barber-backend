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
import { Payment } from './payment.entity';
import { Product } from './product.entity';
import { User } from './user.entity';

@Entity('product_sales')
@Index('idx_product_sales_payment', ['paymentId'])
@Index('idx_product_sales_created_at', ['createdAt'])
@Index('idx_product_sales_barber_created', ['soldByBarberId', 'createdAt'])

@Check('chk_product_sales_quantity_positive', '"quantity" > 0')
@Check('chk_product_sales_unit_price_positive', '"unit_price" > 0')
@Check('chk_product_sales_total_positive', '"total" > 0')
export class ProductSale {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  unitPrice!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  total!: number;

  @Column({ type: 'uuid', nullable: true })
  soldByBarberId!: string | null;

  @ManyToOne(() => Barber, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sold_by_barber_id' })
  soldByBarber?: Barber;

  @Column({ type: 'uuid', nullable: true })
  clientId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client?: User;

  @Column({ type: 'uuid' })
  paymentId!: string;

  @ManyToOne(() => Payment, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_id' })
  payment?: Payment;

  @Column({ type: 'timestamptz', nullable: true })
  voidedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voidedBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'voided_by' })
  voider?: User;

  @Column({ type: 'varchar', nullable: true })
  voidReason!: string | null;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator?: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
