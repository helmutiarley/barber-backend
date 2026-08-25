import type { DataSource } from 'typeorm';
import type { AppConfig } from '../config';
import type { Cradle } from '../container';
import type { PaymentMethod } from '../entities/enums';
import type { ProductSale } from '../entities/product-sale.entity';
import type { Product } from '../entities/product.entity';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import type { Clock } from '../lib/clock';
import { toShopDate } from '../lib/shop-time';
import { withTransaction } from '../lib/transaction';
import type { BarbersRepository } from '../repositories/barbers.repository';
import type {
  NewProductSale,
  ProductSalesRepository,
} from '../repositories/product-sales.repository';
import type { ProductsRepository } from '../repositories/products.repository';
import type { UsersRepository } from '../repositories/users.repository';
import type { CommissionsService } from './commissions.service';
import type { PaymentsService } from './payments.service';

export interface ProductSaleLineDto {
  id: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  soldByBarberId: string | null;
  clientId: string | null;
  paymentId: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ProductSaleDto {
  lines: ProductSaleLineDto[];
  paymentId: string;
  totalCents: number;
  cardFeeCents: number;
  netTotalCents: number;
  method: PaymentMethod;

  commissionEntryIds: string[];
}

export interface SellItemInput {
  productId: string;
  quantity: number;
}

export interface SellInput {
  items: SellItemInput[];
  method: PaymentMethod;

  soldByBarberId?: string | null;
  clientId?: string | null;
}

export interface VoidSaleInput {
  reason?: string | null;
}

export interface PageInput {
  limit: number;
  offset: number;
}

export interface ListSalesInput extends PageInput {
  productId?: string;
  barberId?: string;
  clientId?: string;
  from?: Date;
  to?: Date;
  voided?: boolean;
}

export interface PagedProductSales extends PageInput {
  items: ProductSaleLineDto[];
  total: number;
}

export class ProductSalesService {
  private readonly productSalesRepository: ProductSalesRepository;
  private readonly productsRepository: ProductsRepository;
  private readonly barbersRepository: BarbersRepository;
  private readonly usersRepository: UsersRepository;
  private readonly paymentsService: PaymentsService;
  private readonly commissionsService: CommissionsService;

  private readonly dataSource: DataSource;
  private readonly clock: Clock;
  private readonly config: AppConfig;

  constructor({
    productSalesRepository,
    productsRepository,
    barbersRepository,
    usersRepository,
    paymentsService,
    commissionsService,
    dataSource,
    clock,
    config,
  }: Cradle) {
    this.productSalesRepository = productSalesRepository;
    this.productsRepository = productsRepository;
    this.barbersRepository = barbersRepository;
    this.usersRepository = usersRepository;
    this.paymentsService = paymentsService;
    this.commissionsService = commissionsService;
    this.dataSource = dataSource;
    this.clock = clock;
    this.config = config;
  }

  async sell(input: SellInput, actor: AuthenticatedUser): Promise<ProductSaleDto> {
    const products = await this.resolveItems(input.items);
    const barberId = await this.resolveSeller(input.soldByBarberId);
    const clientId = await this.resolveClient(input.clientId);

    const lines = input.items.map((item, index) => ({
      product: products[index],
      quantity: item.quantity,
      total: products[index].price * item.quantity,
    }));
    const totalCents = lines.reduce((sum, line) => sum + line.total, 0);

    return withTransaction(this.dataSource, async (manager) => {

      for (const line of lines) {
        const moved = await this.productsRepository.applyDelta(
          line.product.id,
          -line.quantity,
          manager,
        );

        if (!moved) {

          throw new ConflictError(`Not enough ${line.product.name} in stock`, {
            productId: line.product.id,
            requested: line.quantity,
            available: line.product.stockQuantity,
          });
        }
      }

      const payment = await this.paymentsService.recordForSale(
        { amountCents: totalCents, method: input.method },
        actor,
        manager,
      );

      const rows: NewProductSale[] = lines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        unitPrice: line.product.price,
        total: line.total,
        soldByBarberId: barberId,
        clientId,
        paymentId: payment.id,
        createdBy: actor.id,
      }));

      const sold = await this.productSalesRepository.create(rows, manager);

      const entries = barberId
        ? await this.commissionsService.recordForProductSales(
            {
              barberId,
              lines: sold.map((line) => ({ saleId: line.id, total: line.total })),
              cardFeeCents: payment.cardFeeCents,
            },
            manager,
          )
        : [];

      return {
        lines: sold.map(toLineDto),
        paymentId: payment.id,
        totalCents,
        cardFeeCents: payment.cardFeeCents,
        netTotalCents: payment.netAmountCents,
        method: payment.method,
        commissionEntryIds: entries.map((entry) => entry.id),
      };
    });
  }

  async list(input: ListSalesInput): Promise<PagedProductSales> {
    const page = { limit: input.limit, offset: input.offset };
    const [rows, total] = await this.productSalesRepository.findMany(
      {
        productId: input.productId,
        barberId: input.barberId,
        clientId: input.clientId,
        from: input.from,
        to: input.to,
        voided: input.voided,
      },
      page,
    );

    return { items: rows.map(toLineDto), total, ...page };
  }

  async get(id: string): Promise<ProductSaleLineDto[]> {
    const sale = await this.require(id);

    return (await this.productSalesRepository.findByPayment(sale.paymentId)).map(toLineDto);
  }

  async voidSale(
    id: string,
    input: VoidSaleInput,
    actor: AuthenticatedUser,
  ): Promise<ProductSaleLineDto[]> {
    const sale = await this.require(id);
    const lines = await this.productSalesRepository.findByPayment(sale.paymentId);

    if (lines.some((line) => line.voidedAt)) {
      throw new ConflictError('This sale has already been voided');
    }

    const now = this.clock.now();
    if (!this.isSameShopDay(sale.createdAt, now)) {
      throw new ConflictError('Only sales made today can be voided — record a return instead');
    }

    await this.commissionsService.assertProductSalesUnsettled(lines.map((line) => line.id));

    const voided = await withTransaction(this.dataSource, async (manager) => {

      for (const line of lines) {
        await this.productsRepository.applyDelta(line.productId, line.quantity, manager);
      }

      await this.paymentsService.voidForSale(
        sale.paymentId,
        input.reason?.trim() || null,
        actor,
        manager,
      );

      await this.commissionsService.zeroForProductSales(
        lines.map((line) => line.id),
        manager,
      );

      return this.productSalesRepository.void(
        lines.map((line) => line.id),
        { voidedAt: now, voidedBy: actor.id, voidReason: input.reason?.trim() || null },
        manager,
      );
    });

    return voided.map(toLineDto);
  }

  private async resolveItems(items: SellItemInput[]): Promise<Product[]> {
    const seen = new Set<string>();
    const products: Product[] = [];

    for (const [index, item] of items.entries()) {
      if (seen.has(item.productId)) {
        throw new ValidationError('A product may only appear once in a sale', [
          { field: `items.${index}.productId`, message: 'is listed twice — add up the quantity' },
        ]);
      }
      seen.add(item.productId);

      const product = await this.productsRepository.findById(item.productId);
      if (!product) {
        throw new NotFoundError(`Product ${item.productId} not found`);
      }
      if (!product.active) {
        throw new ConflictError(`${product.name} is no longer sold`, { productId: product.id });
      }

      products.push(product);
    }

    return products;
  }

  private async resolveSeller(barberId?: string | null): Promise<string | null> {
    if (!barberId) {
      return null;
    }

    const barber = await this.barbersRepository.findById(barberId);
    if (!barber) {
      throw new NotFoundError(`Barber ${barberId} not found`);
    }

    return barber.id;
  }

  private async resolveClient(clientId?: string | null): Promise<string | null> {
    if (!clientId) {
      return null;
    }

    const client = await this.usersRepository.findById(clientId);
    if (!client) {
      throw new NotFoundError(`Client ${clientId} not found`);
    }

    return client.id;
  }

  private async require(id: string): Promise<ProductSale> {
    const sale = await this.productSalesRepository.findById(id);
    if (!sale) {
      throw new NotFoundError(`Product sale ${id} not found`);
    }

    return sale;
  }

  private isSameShopDay(left: Date, right: Date): boolean {
    const zone = this.config.shopTimezone;

    return toShopDate(left, zone) === toShopDate(right, zone);
  }
}

function toLineDto(sale: ProductSale): ProductSaleLineDto {
  return {
    id: sale.id,
    productId: sale.productId,
    quantity: sale.quantity,
    unitPriceCents: sale.unitPrice,
    totalCents: sale.total,
    soldByBarberId: sale.soldByBarberId,
    clientId: sale.clientId,
    paymentId: sale.paymentId,
    voidedAt: sale.voidedAt?.toISOString() ?? null,
    voidedBy: sale.voidedBy,
    voidReason: sale.voidReason,
    createdBy: sale.createdBy,
    createdAt: sale.createdAt.toISOString(),
  };
}
