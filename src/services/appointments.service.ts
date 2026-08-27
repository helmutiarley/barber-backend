import type { DataSource, EntityManager } from 'typeorm';
import type { AppConfig } from '../config';
import type { Cradle } from '../container';
import type { Appointment } from '../entities/appointment.entity';
import type { Barber } from '../entities/barber.entity';
import type { AppointmentStatus } from '../entities/enums';
import type { User } from '../entities/user.entity';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import type { Clock } from '../lib/clock';
import { shopDayBounds } from '../lib/shop-time';
import { withTransaction } from '../lib/transaction';
import type {
  AppointmentChanges,
  AppointmentsRepository,
} from '../repositories/appointments.repository';
import type { BarbersRepository } from '../repositories/barbers.repository';
import type { ServicesRepository } from '../repositories/services.repository';
import type { UsersRepository } from '../repositories/users.repository';
import type { AvailabilityService } from './availability.service';
import type { CashRegisterService } from './cash-register.service';
import type { CommissionsService } from './commissions.service';

export interface WalkInClientInput {
  name: string;
  phone: string;
}

export interface CreateAppointmentInput {

  clientId?: string;

  walkIn?: WalkInClientInput;
  barberId: string;
  serviceId: string;
  startsAt: Date;
  notes?: string | null;

  force?: boolean;
}

export interface PageInput {
  limit: number;
  offset: number;
}

export interface PagedAppointments extends PageInput {
  items: AppointmentDto[];
  total: number;
}

export interface ListAppointmentsInput extends PageInput {

  from: Date;
  to: Date;
  barberId?: string;
  clientId?: string;
  status?: AppointmentStatus[];
}

export interface RescheduleAppointmentInput {
  startsAt: Date;
  notes?: string | null;

  force?: boolean;
}

export interface CancelAppointmentInput {

  reason?: string;
}

type BookingClient =
  | { kind: 'existing'; id: string }
  | { kind: 'walkIn'; input: WalkInClientInput };

const STAFF_ROLES = ['ADMIN', 'MANAGER'] as const;

function isStaff(actor: AuthenticatedUser): boolean {
  return (STAFF_ROLES as readonly string[]).includes(actor.role);
}

function ownsBarberProfile(barber: Barber | null, actor: AuthenticatedUser): boolean {
  return actor.role === 'BARBER' && barber?.userId === actor.id;
}

const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ['scheduled', 'confirmed', 'cancelled'],
  confirmed: ['scheduled', 'completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

function assertTransition(appointment: Appointment, to: AppointmentStatus): void {
  if (!TRANSITIONS[appointment.status].includes(to)) {
    throw new ConflictError(`An appointment that is ${appointment.status} cannot become ${to}`);
  }
}

export interface AppointmentDto {
  id: string;
  clientId: string;
  barberId: string;
  serviceId: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  priceCents: number;
  durationMinutes: number;
  notes: string | null;
  cancelledReason: string | null;
  cancelledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const MINUTE_IN_MS = 60_000;
const HOUR_IN_MS = 3_600_000;

export class AppointmentsService {
  private readonly appointmentsRepository: AppointmentsRepository;
  private readonly barbersRepository: BarbersRepository;
  private readonly servicesRepository: ServicesRepository;
  private readonly usersRepository: UsersRepository;
  private readonly availabilityService: AvailabilityService;

  private readonly commissionsService: CommissionsService;
  private readonly cashRegisterService: CashRegisterService;

  private readonly dataSource: DataSource;
  private readonly clock: Clock;
  private readonly config: AppConfig;

  constructor({
    appointmentsRepository,
    barbersRepository,
    servicesRepository,
    usersRepository,
    availabilityService,
    commissionsService,
    cashRegisterService,
    dataSource,
    clock,
    config,
  }: Cradle) {
    this.appointmentsRepository = appointmentsRepository;
    this.barbersRepository = barbersRepository;
    this.servicesRepository = servicesRepository;
    this.usersRepository = usersRepository;
    this.availabilityService = availabilityService;
    this.commissionsService = commissionsService;
    this.cashRegisterService = cashRegisterService;
    this.dataSource = dataSource;
    this.clock = clock;
    this.config = config;
  }

  async createAppointment(
    input: CreateAppointmentInput,
    actor: AuthenticatedUser,
  ): Promise<AppointmentDto> {
    const client = this.resolveClient(input, actor);

    const service = await this.servicesRepository.findById(input.serviceId);
    if (!service) {
      throw new NotFoundError(`Service ${input.serviceId} not found`);
    }
    if (!service.active) {
      throw new ConflictError('This service is no longer offered');
    }

    const barber = await this.barbersRepository.findById(input.barberId);
    if (!barber) {
      throw new NotFoundError(`Barber ${input.barberId} not found`);
    }
    if (!barber.active) {
      throw new ConflictError('This barber is not taking appointments');
    }

    if (client.kind === 'existing' && !(await this.usersRepository.findById(client.id))) {
      throw new NotFoundError(`Client ${client.id} not found`);
    }

    const endsAt = new Date(input.startsAt.getTime() + service.durationMinutes * MINUTE_IN_MS);

    await this.assertSlotIsFree({
      barberId: barber.id,
      startsAt: input.startsAt,
      endsAt,
      force: input.force === true,
      actor,
    });

    const booking = {
      barberId: barber.id,
      serviceId: service.id,
      startsAt: input.startsAt,
      endsAt,
      price: service.price,
      durationMinutes: service.durationMinutes,
      notes: input.notes ?? null,
      createdBy: actor.id,
    };

    const appointment =
      client.kind === 'existing'
        ? await this.appointmentsRepository.create({ ...booking, clientId: client.id })
        : await withTransaction(this.dataSource, async (manager) => {
            const walkIn = await this.findOrCreateWalkInClient(client.input, manager);

            return this.appointmentsRepository.create(
              { ...booking, clientId: walkIn.id },
              manager,
            );
          });

    return toDto(appointment);
  }

  async getAppointment(id: string, actor: AuthenticatedUser): Promise<AppointmentDto> {
    const appointment = await this.requireAppointment(id);
    await this.assertCanRead(appointment, actor);

    return toDto(appointment);
  }

  async list(input: ListAppointmentsInput): Promise<PagedAppointments> {
    const page = { limit: input.limit, offset: input.offset };
    const [appointments, total] = await this.appointmentsRepository.findMany(
      {
        from: input.from,
        to: input.to,
        barberId: input.barberId,
        clientId: input.clientId,
        status: input.status,
      },
      page,
    );

    return { items: appointments.map(toDto), total, ...page };
  }

  async listBarberDay(
    barberId: string,
    date: string,
    actor: AuthenticatedUser,
  ): Promise<AppointmentDto[]> {
    const barber = await this.barbersRepository.findById(barberId);
    if (!barber) {
      throw new NotFoundError(`Barber ${barberId} not found`);
    }

    if (!isStaff(actor) && !ownsBarberProfile(barber, actor)) {
      throw new ForbiddenError('You can only read your own agenda');
    }

    const { start, end } = shopDayBounds(date, this.config.shopTimezone);
    const appointments = await this.appointmentsRepository.findBetween(barber.id, start, end);

    return appointments.map(toDto);
  }

  async listOwn(actor: AuthenticatedUser, page: PageInput): Promise<PagedAppointments> {
    return this.listForClient(actor.id, page);
  }

  async listForClient(clientId: string, page: PageInput): Promise<PagedAppointments> {
    const [appointments, total] = await this.appointmentsRepository.findForClient(clientId, page);

    return { items: appointments.map(toDto), total, ...page };
  }

  async confirm(id: string, actor: AuthenticatedUser): Promise<AppointmentDto> {
    const appointment = await this.requireAppointment(id);
    await this.assertWorksOnIt(appointment, actor);
    assertTransition(appointment, 'confirmed');

    return this.applyChanges(appointment.id, { status: 'confirmed' });
  }

  async complete(id: string, actor: AuthenticatedUser): Promise<AppointmentDto> {
    const appointment = await this.requireAppointment(id);
    await this.assertWorksOnIt(appointment, actor);
    assertTransition(appointment, 'completed');

    const updated = await withTransaction(this.dataSource, async (manager) => {
      await this.cashRegisterService.requireOpenSession(manager);

      const completed = await this.appointmentsRepository.update(
        appointment.id,
        { status: 'completed' },
        manager,
      );
      if (!completed) {
        throw new NotFoundError(`Appointment ${appointment.id} not found`);
      }

      await this.commissionsService.recordForAppointment(completed, manager);

      return completed;
    });

    return toDto(updated);
  }

  async markNoShow(id: string, actor: AuthenticatedUser): Promise<AppointmentDto> {
    const appointment = await this.requireAppointment(id);
    await this.assertWorksOnIt(appointment, actor);
    assertTransition(appointment, 'no_show');

    if (appointment.startsAt.getTime() > this.clock.now().getTime()) {
      throw new ConflictError('This appointment has not started yet');
    }

    return this.applyChanges(appointment.id, { status: 'no_show' });
  }

  async reschedule(
    id: string,
    input: RescheduleAppointmentInput,
    actor: AuthenticatedUser,
  ): Promise<AppointmentDto> {
    const appointment = await this.requireAppointment(id);
    this.assertMayChangeTheirOwn(appointment, actor);
    assertTransition(appointment, 'scheduled');

    const endsAt = new Date(input.startsAt.getTime() + appointment.durationMinutes * MINUTE_IN_MS);

    await this.assertSlotIsFree({
      barberId: appointment.barberId,
      startsAt: input.startsAt,
      endsAt,
      force: input.force === true,
      actor,
      excludeAppointmentId: appointment.id,
    });

    return this.applyChanges(appointment.id, {
      status: 'scheduled',
      startsAt: input.startsAt,
      endsAt,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
  }

  async cancel(
    id: string,
    input: CancelAppointmentInput,
    actor: AuthenticatedUser,
  ): Promise<AppointmentDto> {
    const appointment = await this.requireAppointment(id);
    this.assertMayChangeTheirOwn(appointment, actor);
    assertTransition(appointment, 'cancelled');

    const reason = input.reason?.trim() || null;
    if (isStaff(actor) && !reason) {
      throw new ValidationError('Staff must record why an appointment was cancelled', [
        { field: 'reason', message: 'is required' },
      ]);
    }

    return this.applyChanges(appointment.id, {
      status: 'cancelled',
      cancelledReason: reason,
      cancelledBy: actor.id,
    });
  }

  private resolveClient(input: CreateAppointmentInput, actor: AuthenticatedUser): BookingClient {
    if (!input.walkIn) {
      return { kind: 'existing', id: this.resolveClientId(input.clientId, actor) };
    }

    if (input.clientId) {
      throw new ValidationError('A booking names one client, not two', [
        { field: 'walkIn', message: 'cannot be combined with clientId' },
      ]);
    }
    if (!isStaff(actor)) {
      throw new ForbiddenError('Only staff may book for a walk-in client');
    }

    return { kind: 'walkIn', input: input.walkIn };
  }

  private resolveClientId(requested: string | undefined, actor: AuthenticatedUser): string {
    if (!requested || requested === actor.id) {
      return actor.id;
    }
    if (!isStaff(actor)) {
      throw new ForbiddenError('You can only book appointments for yourself');
    }

    return requested;
  }

  private async findOrCreateWalkInClient(
    input: WalkInClientInput,
    manager: EntityManager,
  ): Promise<User> {
    const existing = await this.usersRepository.findActiveClientByPhone(input.phone, manager);
    if (existing) {
      return existing;
    }

    return this.usersRepository.create(
      { name: input.name, phone: input.phone, role: 'CLIENT' },
      manager,
    );
  }

  private async assertSlotIsFree(slot: {
    barberId: string;
    startsAt: Date;
    endsAt: Date;
    force: boolean;
    actor: AuthenticatedUser;
    excludeAppointmentId?: string;
  }): Promise<void> {
    if (slot.startsAt.getTime() <= this.clock.now().getTime()) {
      throw new ValidationError('Appointments must start in the future', [
        { field: 'startsAt', message: 'must be a future date' },
      ]);
    }

    if (slot.force && !isStaff(slot.actor)) {
      throw new ForbiddenError('Only staff may book outside working hours');
    }

    if (!slot.force) {
      const available = await this.availabilityService.isAvailable(
        slot.barberId,
        slot.startsAt,
        slot.endsAt,
        { excludeAppointmentId: slot.excludeAppointmentId },
      );

      if (!available) {
        throw new ConflictError('This barber is not available at that time');
      }
    }

    const overlapping = await this.appointmentsRepository.findOverlapping(
      slot.barberId,
      slot.startsAt,
      slot.endsAt,
      slot.excludeAppointmentId,
    );

    if (overlapping.length > 0) {
      throw new ConflictError('This barber already has an appointment in that time slot');
    }
  }

  private async requireAppointment(id: string): Promise<Appointment> {
    const appointment = await this.appointmentsRepository.findById(id);
    if (!appointment) {
      throw new NotFoundError(`Appointment ${id} not found`);
    }

    return appointment;
  }

  private async applyChanges(id: string, changes: AppointmentChanges): Promise<AppointmentDto> {
    const updated = await this.appointmentsRepository.update(id, changes);
    if (!updated) {
      throw new NotFoundError(`Appointment ${id} not found`);
    }

    return toDto(updated);
  }

  private async assertCanRead(appointment: Appointment, actor: AuthenticatedUser): Promise<void> {
    if (isStaff(actor) || appointment.clientId === actor.id) {
      return;
    }

    if (await this.isOwnAgenda(appointment, actor)) {
      return;
    }

    throw new ForbiddenError('You do not have access to this appointment');
  }

  private async assertWorksOnIt(appointment: Appointment, actor: AuthenticatedUser): Promise<void> {
    if (isStaff(actor) || (await this.isOwnAgenda(appointment, actor))) {
      return;
    }

    throw new ForbiddenError('Only staff or the barber working this appointment may change it');
  }

  private assertMayChangeTheirOwn(appointment: Appointment, actor: AuthenticatedUser): void {
    if (isStaff(actor)) {
      return;
    }

    if (appointment.clientId !== actor.id) {
      throw new ForbiddenError('You can only change your own appointments');
    }

    const hoursAhead = (appointment.startsAt.getTime() - this.clock.now().getTime()) / HOUR_IN_MS;
    const windowHours = this.config.cancellationWindowHours;

    if (hoursAhead < windowHours) {
      throw new ForbiddenError(
        `Appointments can only be changed up to ${windowHours} hours in advance — please call the shop`,
      );
    }
  }

  private async isOwnAgenda(appointment: Appointment, actor: AuthenticatedUser): Promise<boolean> {
    if (actor.role !== 'BARBER') {
      return false;
    }

    return ownsBarberProfile(await this.barbersRepository.findById(appointment.barberId), actor);
  }
}

function toDto(appointment: Appointment): AppointmentDto {
  return {
    id: appointment.id,
    clientId: appointment.clientId,
    barberId: appointment.barberId,
    serviceId: appointment.serviceId,
    status: appointment.status,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    priceCents: appointment.price,
    durationMinutes: appointment.durationMinutes,
    notes: appointment.notes,
    cancelledReason: appointment.cancelledReason,
    cancelledBy: appointment.cancelledBy,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
  };
}
