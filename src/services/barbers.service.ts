import type { Cradle } from '../container';
import type { BarberBlock } from '../entities/barber-block.entity';
import type { BarberSchedule, TimeOfDay } from '../entities/barber-schedule.entity';
import type { Barber } from '../entities/barber.entity';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import type { Clock } from '../lib/clock';
import type { AppointmentsRepository } from '../repositories/appointments.repository';
import type { BarberBlocksRepository } from '../repositories/barber-blocks.repository';
import type {
  BarberSchedulesRepository,
  NewBarberSchedule,
} from '../repositories/barber-schedules.repository';
import type { BarbersRepository } from '../repositories/barbers.repository';
import type { UsersRepository } from '../repositories/users.repository';

export interface BarberDto {
  id: string;
  userId: string;
  displayName: string;
  photoUrl: string | null;
  specialties: string[];
  active: boolean;
  createdAt: string;
}

export interface PublicBarberDto {
  id: string;
  displayName: string;
  photoUrl: string | null;
  specialties: string[];
}

export interface CreateBarberInput {
  userId: string;
  displayName: string;
  photoUrl?: string | null;
  specialties?: string[];
}

export interface UpdateBarberInput {
  displayName?: string;
  photoUrl?: string | null;
  specialties?: string[];
}

export interface ScheduleDayDto {
  weekday: number;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  breakStart: TimeOfDay | null;
  breakEnd: TimeOfDay | null;
}

export interface BlockDto {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export interface CreateBlockInput {
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}

export function toScheduleDayDto(schedule: BarberSchedule): ScheduleDayDto {
  return {
    weekday: schedule.weekday,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    breakStart: schedule.breakStart,
    breakEnd: schedule.breakEnd,
  };
}

export function toBlockDto(block: BarberBlock): BlockDto {
  return {
    id: block.id,
    startsAt: block.startsAt.toISOString(),
    endsAt: block.endsAt.toISOString(),
    reason: block.reason,
  };
}

export function toBarberDto(barber: Barber): BarberDto {
  return {
    id: barber.id,
    userId: barber.userId,
    displayName: barber.displayName,
    photoUrl: barber.photoUrl,
    specialties: barber.specialties,
    active: barber.active,
    createdAt: barber.createdAt.toISOString(),
  };
}

export function toPublicBarberDto(barber: Barber): PublicBarberDto {
  return {
    id: barber.id,
    displayName: barber.displayName,
    photoUrl: barber.photoUrl,
    specialties: barber.specialties,
  };
}

export class BarbersService {
  private readonly barbersRepository: BarbersRepository;
  private readonly barberSchedulesRepository: BarberSchedulesRepository;
  private readonly barberBlocksRepository: BarberBlocksRepository;
  private readonly usersRepository: UsersRepository;
  private readonly appointmentsRepository: AppointmentsRepository;
  private readonly clock: Clock;

  constructor({
    barbersRepository,
    barberSchedulesRepository,
    barberBlocksRepository,
    usersRepository,
    appointmentsRepository,
    clock,
  }: Cradle) {
    this.barbersRepository = barbersRepository;
    this.barberSchedulesRepository = barberSchedulesRepository;
    this.barberBlocksRepository = barberBlocksRepository;
    this.usersRepository = usersRepository;
    this.appointmentsRepository = appointmentsRepository;
    this.clock = clock;
  }

  async create(input: CreateBarberInput): Promise<BarberDto> {
    const user = await this.usersRepository.findById(input.userId);
    if (!user) {
      throw new NotFoundError(`User ${input.userId} not found`);
    }
    if (user.role !== 'BARBER') {
      throw new ValidationError('A barber profile requires a user with role BARBER', [
        { field: 'userId', message: `user has role ${user.role}` },
      ]);
    }

    const existing = await this.barbersRepository.findByUserId(input.userId);
    if (existing) {
      throw new ConflictError('This user already has a barber profile');
    }

    const barber = await this.barbersRepository.create(input);
    return toBarberDto(barber);
  }

  async listPublic(): Promise<PublicBarberDto[]> {
    const barbers = await this.barbersRepository.findMany({ active: true });
    return barbers.map(toPublicBarberDto);
  }

  async getPublicById(id: string): Promise<PublicBarberDto> {
    return toPublicBarberDto(await this.requireBarber(id));
  }

  async update(id: string, input: UpdateBarberInput, actor: AuthenticatedUser): Promise<BarberDto> {
    const barber = await this.requireBarber(id);
    assertCanEditProfile(barber, actor);

    const updated = await this.barbersRepository.update(id, input);
    return toBarberDto(updated!);
  }

  async deactivate(id: string): Promise<BarberDto> {
    const barber = await this.requireBarber(id);
    if (!barber.active) {
      return toBarberDto(barber);
    }

    await this.assertNoUpcomingAppointments(barber);

    const updated = await this.barbersRepository.update(id, { active: false });
    return toBarberDto(updated!);
  }

  async deactivateByUserId(userId: string): Promise<void> {
    const barber = await this.barbersRepository.findByUserId(userId);
    if (!barber || !barber.active) {
      return;
    }

    await this.assertNoUpcomingAppointments(barber);
    await this.barbersRepository.update(barber.id, { active: false });
  }

  async getSchedule(barberId: string): Promise<ScheduleDayDto[]> {
    await this.requireBarber(barberId);

    const week = await this.barberSchedulesRepository.findByBarber(barberId);
    return week.map(toScheduleDayDto);
  }

  async replaceSchedule(
    barberId: string,
    days: NewBarberSchedule[],
    actor: AuthenticatedUser,
  ): Promise<ScheduleDayDto[]> {
    const barber = await this.requireBarber(barberId);
    assertCanManageAgenda(barber, actor);

    const week = await this.barberSchedulesRepository.replaceWeek(barberId, days);
    return week.map(toScheduleDayDto);
  }

  async createBlock(
    barberId: string,
    input: CreateBlockInput,
    actor: AuthenticatedUser,
  ): Promise<BlockDto> {
    const barber = await this.requireBarber(barberId);
    assertCanManageAgenda(barber, actor);

    const clashes = await this.appointmentsRepository.findActiveBetween(
      barberId,
      input.startsAt,
      input.endsAt,
    );

    if (clashes.length > 0) {
      throw new ConflictError(
        `This period holds ${clashes.length} appointment(s) — cancel or move them first`,
        clashes.map((appointment) => ({
          id: appointment.id,
          startsAt: appointment.startsAt.toISOString(),
        })),
      );
    }

    const block = await this.barberBlocksRepository.create({ barberId, ...input });
    return toBlockDto(block);
  }

  async deleteBlock(barberId: string, blockId: string, actor: AuthenticatedUser): Promise<void> {
    const barber = await this.requireBarber(barberId);
    assertCanManageAgenda(barber, actor);

    const block = await this.barberBlocksRepository.findById(blockId);
    if (!block || block.barberId !== barberId) {
      throw new NotFoundError(`Block ${blockId} not found`);
    }

    await this.barberBlocksRepository.delete(blockId);
  }

  async requireBarber(id: string): Promise<Barber> {
    const barber = await this.barbersRepository.findById(id);
    if (!barber) {
      throw new NotFoundError(`Barber ${id} not found`);
    }

    return barber;
  }

  private async assertNoUpcomingAppointments(barber: Barber): Promise<void> {
    const upcoming = await this.appointmentsRepository.findUpcomingActive(
      barber.id,
      this.clock.now(),
    );

    if (upcoming.length > 0) {
      throw new ConflictError(
        `This barber has ${upcoming.length} upcoming appointment(s) — reassign or cancel them first`,
        upcoming.map((appointment) => ({
          id: appointment.id,
          startsAt: appointment.startsAt.toISOString(),
        })),
      );
    }
  }
}

function isOwnProfile(barber: Barber, actor: AuthenticatedUser): boolean {
  return actor.role === 'BARBER' && barber.userId === actor.id;
}

export function assertCanEditProfile(barber: Barber, actor: AuthenticatedUser): void {
  if (actor.role === 'ADMIN' || isOwnProfile(barber, actor)) {
    return;
  }

  throw new ForbiddenError('You can only edit your own barber profile');
}

export function assertCanManageAgenda(barber: Barber, actor: AuthenticatedUser): void {
  if (actor.role === 'ADMIN' || actor.role === 'MANAGER' || isOwnProfile(barber, actor)) {
    return;
  }

  throw new ForbiddenError('You can only manage your own schedule and blocks');
}
