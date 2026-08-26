import type { Repository } from 'typeorm';
import type { Cradle } from '../container';
import { Shop } from '../entities/shop.entity';

export interface NewShop {
  name: string;
  slug: string;
  domain: string;
  customDomain?: string | null;
}

export interface ShopChanges {
  name?: string;
  customDomain?: string | null;
  active?: boolean;
}

export interface ShopStats {
  shopId: string;
  users: number;
  appointments: number;
}

interface RawStats {
  shopId: string;
  users: string;
  appointments: string;
}

export class ShopsRepository {
  private readonly repository: Repository<Shop>;

  constructor({ dataSource }: Cradle) {
    this.repository = dataSource.getRepository(Shop);
  }

  async findById(id: string): Promise<Shop | null> {
    return this.repository.findOneBy({ id });
  }

  async findByHost(host: string): Promise<Shop | null> {
    return this.repository.findOne({ where: [{ domain: host }, { customDomain: host }] });
  }

  async findMany(): Promise<Shop[]> {
    return this.repository.find({ order: { createdAt: 'DESC' } });
  }

  async create(data: NewShop): Promise<Shop> {
    return this.repository.save(this.repository.create({ customDomain: null, ...data }));
  }

  async update(id: string, changes: ShopChanges): Promise<Shop | null> {
    if (Object.keys(changes).length > 0) {
      await this.repository.update({ id }, changes);
    }

    return this.findById(id);
  }

  async stats(): Promise<ShopStats[]> {
    const rows: RawStats[] = await this.repository.query(
      `SELECT s.id AS "shopId",
              (SELECT COUNT(*) FROM users u WHERE u.shop_id = s.id)::text AS "users",
              (SELECT COUNT(*) FROM appointments a WHERE a.shop_id = s.id)::text AS "appointments"
       FROM shops s`,
    );

    return rows.map((row) => ({
      shopId: row.shopId,
      users: Number(row.users),
      appointments: Number(row.appointments),
    }));
  }
}
