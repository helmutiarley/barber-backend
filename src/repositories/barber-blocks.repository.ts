import type { Repository } from 'typeorm';
import type { Cradle } from '../container';
import { BarberBlock } from '../entities/barber-block.entity';
import { requireShopId } from '../lib/shop-context';

export interface NewBarberBlock {
  barberId: string;
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}

export class BarberBlocksRepository {
  private readonly repository: Repository<BarberBlock>;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.repository = dataSource.getRepository(BarberBlock);
    this.shopId = requireShopId(currentShop);
  }

  async findById(id: string): Promise<BarberBlock | null> {
    return this.repository.findOneBy({ id, shopId: this.shopId });
  }

  async findOverlapping(barberId: string, from: Date, to: Date): Promise<BarberBlock[]> {
    return this.repository
      .createQueryBuilder('block')
      .where('block.shopId = :shopId', { shopId: this.shopId })
      .andWhere('block.barberId = :barberId', { barberId })
      .andWhere('block.startsAt < :to', { to })
      .andWhere('block.endsAt > :from', { from })
      .orderBy('block.startsAt', 'ASC')
      .getMany();
  }

  async create(data: NewBarberBlock): Promise<BarberBlock> {
    return this.repository.save(
      this.repository.create({ reason: null, shopId: this.shopId, ...data }),
    );
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id, shopId: this.shopId });
  }
}
