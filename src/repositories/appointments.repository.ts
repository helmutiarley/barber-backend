import {
  And,
  In,
  LessThan,
  LessThanOrEqual,
  MoreThanOrEqual,
  type DataSource,
  type EntityManager,
  type Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import type { Cradle } from '../container';
import { Appointment } from '../entities/appointment.entity';
import { ACTIVE_APPOINTMENT_STATUSES, type AppointmentStatus } from '../entities/enums';
import { ConflictError } from '../errors/app-error';
import { requireShopId } from '../lib/shop-context';

const EXCLUSION_VIOLATION = '23P01';

const DEADLOCK_DETECTED = '40P01';
const MAX_WRITE_ATTEMPTS = 3;

export type NewAppointment = Pick<
  Appointment,
  'clientId' | 'barberId' | 'serviceId' | 'startsAt' | 'endsAt' | 'price' | 'durationMinutes'
> &
  Partial<Pick<Appointment, 'notes'>> & { createdBy: string };

export type AppointmentChanges = Partial<
  Pick<Appointment, 'status' | 'startsAt' | 'endsAt' | 'notes' | 'cancelledReason' | 'cancelledBy'>
>;

export interface AppointmentFilters {

  from: Date;
  to: Date;
  barberId?: string;
  clientId?: string;
  status?: AppointmentStatus[];
}

export interface Page {
  limit: number;
  offset: number;
}

export class AppointmentsRepository {
  private readonly dataSource: DataSource;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.dataSource = dataSource;
    this.shopId = requireShopId(currentShop);
  }

  async findOverlapping(
    barberId: string,
    startsAt: Date,
    endsAt: Date,
    excludeAppointmentId?: string,
  ): Promise<Appointment[]> {
    return this.activeInRange(barberId, startsAt, endsAt, excludeAppointmentId).getMany();
  }

  async findActiveBetween(
    barberId: string,
    from: Date,
    to: Date,
    excludeAppointmentId?: string,
  ): Promise<Appointment[]> {
    return this.activeInRange(barberId, from, to, excludeAppointmentId)
      .orderBy('appointment.startsAt', 'ASC')
      .getMany();
  }

  async create(data: NewAppointment): Promise<Appointment> {
    const repository = this.repo();

    return this.guarded(() =>
      repository.save(repository.create({ notes: null, shopId: this.shopId, ...data })),
    );
  }

  async update(
    id: string,
    changes: AppointmentChanges,
    manager?: EntityManager,
  ): Promise<Appointment | null> {
    if (Object.keys(changes).length > 0) {
      await this.guarded(
        () => this.repo(manager).update({ id, shopId: this.shopId }, changes),
        manager,
      );
    }

    return this.findById(id, manager);
  }

  async findById(id: string, manager?: EntityManager): Promise<Appointment | null> {
    return this.repo(manager).findOneBy({ id, shopId: this.shopId });
  }

  async findUpcomingActive(barberId: string, from: Date): Promise<Appointment[]> {
    return this.repo().find({
      where: {
        barberId,
        shopId: this.shopId,
        status: In([...ACTIVE_APPOINTMENT_STATUSES]),
        startsAt: MoreThanOrEqual(from),
      },
      order: { startsAt: 'ASC' },
    });
  }

  async findMany(filters: AppointmentFilters, page: Page): Promise<[Appointment[], number]> {
    return this.repo().findAndCount({
      where: {
        shopId: this.shopId,
        startsAt: And(MoreThanOrEqual(filters.from), LessThanOrEqual(filters.to)),
        ...(filters.barberId ? { barberId: filters.barberId } : {}),
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        ...(filters.status?.length ? { status: In(filters.status) } : {}),
      },
      order: { startsAt: 'ASC', id: 'ASC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  async findForClient(clientId: string, page: Page): Promise<[Appointment[], number]> {
    return this.repo().findAndCount({
      where: { clientId, shopId: this.shopId },
      order: { startsAt: 'DESC', id: 'ASC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  async findBetween(barberId: string, from: Date, to: Date): Promise<Appointment[]> {
    return this.repo().find({
      where: { barberId, shopId: this.shopId, startsAt: And(MoreThanOrEqual(from), LessThan(to)) },
      order: { startsAt: 'ASC' },
    });
  }

  private activeInRange(
    barberId: string,
    from: Date,
    to: Date,
    excludeAppointmentId?: string,
  ): SelectQueryBuilder<Appointment> {
    const query = this.repo()
      .createQueryBuilder('appointment')
      .where('appointment.shopId = :shopId', { shopId: this.shopId })
      .andWhere('appointment.barberId = :barberId', { barberId })
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: [...ACTIVE_APPOINTMENT_STATUSES],
      })
      .andWhere('appointment.startsAt < :to', { to })
      .andWhere('appointment.endsAt > :from', { from });

    if (excludeAppointmentId) {
      query.andWhere('appointment.id != :excludeAppointmentId', { excludeAppointmentId });
    }

    return query;
  }

  private async guarded<T>(write: () => Promise<T>, manager?: EntityManager): Promise<T> {
    const maxAttempts = manager ? 1 : MAX_WRITE_ATTEMPTS;

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await write();
      } catch (error) {
        if (isDeadlock(error) && attempt < maxAttempts) {
          continue;
        }
        if (isExclusionViolation(error)) {
          throw new ConflictError('This time slot is no longer available for this barber');
        }
        throw error;
      }
    }
  }

  private repo(manager?: EntityManager): Repository<Appointment> {
    return (manager ?? this.dataSource).getRepository(Appointment);
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function isExclusionViolation(error: unknown): boolean {
  return hasCode(error, EXCLUSION_VIOLATION);
}

function isDeadlock(error: unknown): boolean {
  return hasCode(error, DEADLOCK_DETECTED);
}
