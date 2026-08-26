import type { DataSource } from 'typeorm';
import type { AppConfig } from '../config';
import type { Cradle } from '../container';
import { Service } from '../entities/service.entity';
import { Shop } from '../entities/shop.entity';
import { User } from '../entities/user.entity';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import { hashPassword } from '../lib/password';
import type { ShopsRepository, ShopChanges } from '../repositories/shops.repository';

const UNIQUE_VIOLATION = '23505';

const RESERVED_SLUGS = new Set(['default', 'www', 'crm', 'api', 'admin', 'mail', 'status']);

export interface CreateShopInput {
  name: string;
  slug: string;
  customDomain?: string | null;
  owner: {
    name: string;
    email: string;
    password: string;
  };
}

export interface ShopDto {
  id: string;
  name: string;
  slug: string;
  domain: string;
  customDomain: string | null;
  active: boolean;
  createdAt: string;
}

export interface ShopWithStatsDto extends ShopDto {
  users: number;
  appointments: number;
}

const DEFAULT_SERVICES = [
  { name: 'Corte', description: 'Corte de cabelo tradicional', price: 4500, durationMinutes: 30 },
  { name: 'Barba', description: 'Barba feita na navalha', price: 3000, durationMinutes: 20 },
  {
    name: 'Corte + Barba',
    description: 'Combo completo com desconto',
    price: 7000,
    durationMinutes: 50,
  },
];

export class PlatformService {
  private readonly dataSource: DataSource;
  private readonly shopsRepository: ShopsRepository;
  private readonly config: AppConfig;

  constructor({ dataSource, shopsRepository, config }: Cradle) {
    this.dataSource = dataSource;
    this.shopsRepository = shopsRepository;
    this.config = config;
  }

  async list(): Promise<ShopWithStatsDto[]> {
    const [shops, stats] = await Promise.all([
      this.shopsRepository.findMany(),
      this.shopsRepository.stats(),
    ]);
    const statsByShop = new Map(stats.map((row) => [row.shopId, row]));

    return shops.map((shop) => ({
      ...this.toDto(shop),
      users: statsByShop.get(shop.id)?.users ?? 0,
      appointments: statsByShop.get(shop.id)?.appointments ?? 0,
    }));
  }

  async getById(id: string): Promise<ShopWithStatsDto> {
    const shop = await this.shopsRepository.findById(id);
    if (!shop) {
      throw new NotFoundError(`Shop ${id} not found`);
    }

    const stats = (await this.shopsRepository.stats()).find((row) => row.shopId === id);

    return {
      ...this.toDto(shop),
      users: stats?.users ?? 0,
      appointments: stats?.appointments ?? 0,
    };
  }

  async create(input: CreateShopInput): Promise<ShopDto> {
    if (RESERVED_SLUGS.has(input.slug)) {
      throw new ValidationError(`Slug "${input.slug}" is reserved`);
    }

    const passwordHash = await hashPassword(input.owner.password);

    try {
      const shop = await this.dataSource.transaction(async (manager) => {
        const shops = manager.getRepository(Shop);
        const created = await shops.save(
          shops.create({
            name: input.name,
            slug: input.slug,
            domain: `${input.slug}.${this.config.shopsBaseDomain}`,
            customDomain: input.customDomain ?? null,
          }),
        );

        const users = manager.getRepository(User);
        await users.save(
          users.create({
            shopId: created.id,
            name: input.owner.name,
            email: input.owner.email,
            phone: null,
            passwordHash,
            role: 'ADMIN',
          }),
        );

        const services = manager.getRepository(Service);
        await services.save(
          DEFAULT_SERVICES.map((service) => services.create({ ...service, shopId: created.id })),
        );

        return created;
      });

      return this.toDto(shop);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Slug or custom domain is already in use');
      }
      throw error;
    }
  }

  async update(id: string, changes: ShopChanges): Promise<ShopDto> {
    try {
      const shop = await this.shopsRepository.update(id, changes);
      if (!shop) {
        throw new NotFoundError(`Shop ${id} not found`);
      }

      return this.toDto(shop);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Custom domain is already in use');
      }
      throw error;
    }
  }

  async isDomainServed(domain: string): Promise<boolean> {
    const host = domain.toLowerCase();

    if (this.config.platformHosts.includes(host)) return true;

    const shop = await this.shopsRepository.findByHost(host);
    return shop?.active ?? false;
  }

  private toDto(shop: Shop): ShopDto {
    return {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      domain: shop.domain,
      customDomain: shop.customDomain,
      active: shop.active,
      createdAt: shop.createdAt.toISOString(),
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
