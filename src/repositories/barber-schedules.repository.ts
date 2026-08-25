import type { Repository } from 'typeorm';
import type { Cradle } from '../container';
import { BarberSchedule, type TimeOfDay } from '../entities/barber-schedule.entity';

export interface NewBarberSchedule {
  weekday: number;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  breakStart?: TimeOfDay | null;
  breakEnd?: TimeOfDay | null;
}

export class BarberSchedulesRepository {
  private readonly repository: Repository<BarberSchedule>;

  constructor({ dataSource }: Cradle) {
    this.repository = dataSource.getRepository(BarberSchedule);
  }

  async findByBarber(barberId: string): Promise<BarberSchedule[]> {
    return this.repository.find({ where: { barberId }, order: { weekday: 'ASC' } });
  }

  async findByBarberAndWeekday(barberId: string, weekday: number): Promise<BarberSchedule | null> {
    return this.repository.findOneBy({ barberId, weekday });
  }

  async replaceWeek(barberId: string, days: NewBarberSchedule[]): Promise<BarberSchedule[]> {
    return this.repository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(BarberSchedule);

      await repository.delete({ barberId });

      if (days.length === 0) {
        return [];
      }

      await repository.insert(
        days.map((day) =>
          repository.create({
            barberId,
            breakStart: null,
            breakEnd: null,
            ...day,
          }),
        ),
      );

      return repository.find({ where: { barberId }, order: { weekday: 'ASC' } });
    });
  }
}
