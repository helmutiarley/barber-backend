import type { Repository } from 'typeorm';
import type { Cradle } from '../container';
import { BarberSchedule, type TimeOfDay } from '../entities/barber-schedule.entity';
import { requireShopId } from '../lib/shop-context';

export interface NewBarberSchedule {
  weekday: number;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  breakStart?: TimeOfDay | null;
  breakEnd?: TimeOfDay | null;
}

export class BarberSchedulesRepository {
  private readonly repository: Repository<BarberSchedule>;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.repository = dataSource.getRepository(BarberSchedule);
    this.shopId = requireShopId(currentShop);
  }

  async findByBarber(barberId: string): Promise<BarberSchedule[]> {
    return this.repository.find({
      where: { barberId, shopId: this.shopId },
      order: { weekday: 'ASC' },
    });
  }

  async findByBarberAndWeekday(barberId: string, weekday: number): Promise<BarberSchedule | null> {
    return this.repository.findOneBy({ barberId, weekday, shopId: this.shopId });
  }

  async replaceWeek(barberId: string, days: NewBarberSchedule[]): Promise<BarberSchedule[]> {
    const shopId = this.shopId;

    return this.repository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(BarberSchedule);

      await repository.delete({ barberId, shopId });

      if (days.length === 0) {
        return [];
      }

      await repository.insert(
        days.map((day) =>
          repository.create({
            barberId,
            shopId,
            breakStart: null,
            breakEnd: null,
            ...day,
          }),
        ),
      );

      return repository.find({ where: { barberId, shopId }, order: { weekday: 'ASC' } });
    });
  }
}
