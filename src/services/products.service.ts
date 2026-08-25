import type { DataSource } from 'typeorm';
import type { Cradle } from '../container';
import type { StockAdjustmentReason } from '../entities/enums';
import type { Product } from '../entities/product.entity';
import type { StockAdjustment } from '../entities/stock-adjustment.entity';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import { withTransaction } from '../lib/transaction';
import type { ProductChanges, ProductsRepository } from '../repositories/products.repository';
import type { StockAdjustmentsRepository } from '../repositories/stock-adjustments.repository';

export interface ProductDto {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  costCents: number | null;
  stockQuantity: number;
  lowStockThreshold: number;

  lowStock: boolean;
  active: boolean;
}

export interface StockAdjustmentDto {
  id: string;
  productId: string;
  delta: number;
  reason: StockAdjustmentReason;
  resultingQuantity: number;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreateProductInput {
  name: string;
  description?: string | null;
  priceCents: number;
  costCents?: number | null;

  stockQuantity?: number;
  lowStockThreshold?: number;
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  priceCents?: number;
  costCents?: number | null;
  lowStockThreshold?: number;
}

export interface AdjustStockInput {
  delta: number;
  reason: StockAdjustmentReason;
  notes?: string | null;
}

export interface PageInput {
  limit: number;
  offset: number;
}

export interface ListProductsInput extends PageInput {
  lowStock?: boolean;
  includeInactive?: boolean;
  search?: string;
}

export interface PagedProducts extends PageInput {
  items: ProductDto[];
  total: number;
}

export interface PagedStockAdjustments extends PageInput {
  items: StockAdjustmentDto[];
  total: number;
}

export class ProductsService {
  private readonly productsRepository: ProductsRepository;
  private readonly stockAdjustmentsRepository: StockAdjustmentsRepository;

  private readonly dataSource: DataSource;

  constructor({ productsRepository, stockAdjustmentsRepository, dataSource }: Cradle) {
    this.productsRepository = productsRepository;
    this.stockAdjustmentsRepository = stockAdjustmentsRepository;
    this.dataSource = dataSource;
  }

  async create(input: CreateProductInput, actor: AuthenticatedUser): Promise<ProductDto> {
    await this.assertNameIsFree(input.name);

    const stockQuantity = input.stockQuantity ?? 0;
    const row = {
      name: input.name.trim(),
      description: input.description ?? null,
      price: input.priceCents,
      cost: input.costCents ?? null,
      stockQuantity,
      lowStockThreshold: input.lowStockThreshold ?? 0,
    };

    if (stockQuantity === 0) {
      return this.toDto(await this.productsRepository.create(row));
    }

    const product = await withTransaction(this.dataSource, async (manager) => {
      const created = await this.productsRepository.create(row, manager);

      await this.stockAdjustmentsRepository.create(
        {
          productId: created.id,
          delta: stockQuantity,
          reason: 'purchase',
          resultingQuantity: stockQuantity,
          createdBy: actor.id,
        },
        manager,
      );

      return created;
    });

    return this.toDto(product);
  }

  async list(input: ListProductsInput): Promise<PagedProducts> {
    const page = { limit: input.limit, offset: input.offset };
    const [rows, total] = await this.productsRepository.findMany(
      {
        active: input.includeInactive ? undefined : true,
        lowStock: input.lowStock,
        search: input.search,
      },
      page,
    );

    return { items: rows.map((row) => this.toDto(row)), total, ...page };
  }

  async get(id: string): Promise<ProductDto> {
    return this.toDto(await this.require(id));
  }

  async update(id: string, input: UpdateProductInput): Promise<ProductDto> {
    const product = await this.require(id);

    if (input.name !== undefined && input.name.trim() !== product.name) {
      await this.assertNameIsFree(input.name);
    }

    const updated = await this.productsRepository.update(id, toChanges(input));

    return this.toDto(updated ?? product);
  }

  async adjustStock(
    id: string,
    input: AdjustStockInput,
    actor: AuthenticatedUser,
  ): Promise<StockAdjustmentDto> {
    const product = await this.require(id);

    const adjustment = await withTransaction(this.dataSource, async (manager) => {
      const moved = await this.productsRepository.applyDelta(product.id, input.delta, manager);
      if (!moved) {

        throw new ValidationError('This adjustment would leave negative stock', [
          {
            field: 'delta',
            message: `must not take stock below zero — ${product.stockQuantity} on the shelf`,
          },
        ]);
      }

      return this.stockAdjustmentsRepository.create(
        {
          productId: product.id,
          delta: input.delta,
          reason: input.reason,
          resultingQuantity: moved.stockQuantity,
          notes: input.notes ?? null,
          createdBy: actor.id,
        },
        manager,
      );
    });

    return toAdjustmentDto(adjustment);
  }

  async listAdjustments(id: string, page: PageInput): Promise<PagedStockAdjustments> {
    const product = await this.require(id);
    const [rows, total] = await this.stockAdjustmentsRepository.findByProduct(product.id, page);

    return { items: rows.map(toAdjustmentDto), total, ...page };
  }

  async deactivate(id: string): Promise<ProductDto> {
    const product = await this.require(id);
    if (!product.active) {
      return this.toDto(product);
    }

    const updated = await this.productsRepository.update(id, { active: false });

    return this.toDto(updated ?? product);
  }

  private async assertNameIsFree(name: string): Promise<void> {
    const existing = await this.productsRepository.findActiveByName(name.trim());
    if (existing) {
      throw new ConflictError('A product with this name already exists');
    }
  }

  private async require(id: string): Promise<Product> {
    const product = await this.productsRepository.findById(id);
    if (!product) {
      throw new NotFoundError(`Product ${id} not found`);
    }

    return product;
  }

  private toDto(product: Product): ProductDto {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      priceCents: product.price,
      costCents: product.cost,
      stockQuantity: product.stockQuantity,
      lowStockThreshold: product.lowStockThreshold,
      lowStock: product.stockQuantity <= product.lowStockThreshold,
      active: product.active,
    };
  }
}

function toAdjustmentDto(adjustment: StockAdjustment): StockAdjustmentDto {
  return {
    id: adjustment.id,
    productId: adjustment.productId,
    delta: adjustment.delta,
    reason: adjustment.reason,
    resultingQuantity: adjustment.resultingQuantity,
    notes: adjustment.notes,
    createdBy: adjustment.createdBy,
    createdAt: adjustment.createdAt.toISOString(),
  };
}

function toChanges(input: UpdateProductInput): ProductChanges {
  const changes: ProductChanges = {
    name: input.name?.trim(),
    description: input.description,
    price: input.priceCents,
    cost: input.costCents,
    lowStockThreshold: input.lowStockThreshold,
  };

  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
}
