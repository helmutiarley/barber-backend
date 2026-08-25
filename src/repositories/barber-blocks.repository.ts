import type { Repository } from 'typeorm';
import type { Cradle } from '../container';
import { BarberBlock } from '../entities/barber-block.entity';

export interface NewBarberBlock {
  barberId: string;
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}

export class BarberBlocksRepository {
  private readonly repository: Repository<BarberBlock>;

  constructor({ dataSource }: Cradle) {
    this.repository = dataSource.getRepository(BarberBlock);
  }

  async findById(id: string): Promise<BarberBlock | null> {
    return this.repository.findOneBy({ id });
  }

  async findOverlapping(barberId: string, from: Date, to: Date): Promise<BarberBlock[]> {
    return this.repository
      .createQueryBuilder('block')
      .where('block.barberId = :barberId', { barberId })
      .andWhere('block.startsAt < :to', { to })
      .andWhere('block.endsAt > :from', { from })
      .orderBy('block.startsAt', 'ASC')
      .getMany();
  }

  async create(data: NewBarberBlock): Promise<BarberBlock> {
    return this.repository.save(this.repository.create({ reason: null, ...data }));
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }
}
