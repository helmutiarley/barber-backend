import type { Cradle } from '../container';
import type { ClientProfile } from '../entities/client-profile.entity';
import type { User } from '../entities/user.entity';
import { ForbiddenError, NotFoundError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import type {
  ClientProfilesRepository,
  ClientRow,
  ClientStats,
} from '../repositories/client-profiles.repository';
import type { UsersRepository } from '../repositories/users.repository';
import type { AppointmentsService, PageInput, PagedAppointments } from './appointments.service';

export interface ClientStatsDto {
  visits: number;
  lastVisitAt: string | null;

  averageTicketCents: number | null;
  noShows: number;
}

export interface ClientListItemDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  birthday: string | null;
  preferences: string | null;
  internalNotes: string | null;
}

export interface StaffClientDto extends ClientListItemDto {
  stats: ClientStatsDto;
}

export interface BarberClientDto {
  id: string;
  name: string;
  birthday: string | null;
  preferences: string | null;
  stats: ClientStatsDto;
}

export interface SelfClientDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  preferences: string | null;
}

export interface ListClientsInput extends PageInput {
  search?: string;
  birthdayMonth?: number;
  inactiveSince?: Date;
}

export interface PagedClients extends PageInput {
  items: ClientListItemDto[];
  total: number;
}

export interface UpdateClientInput {
  birthday?: string | null;
  preferences?: string | null;
  internalNotes?: string | null;
}

export type UpdateOwnClientInput = Omit<UpdateClientInput, 'internalNotes'>;

const STAFF_ROLES = ['ADMIN', 'MANAGER'] as const;

function isStaff(actor: AuthenticatedUser): boolean {
  return (STAFF_ROLES as readonly string[]).includes(actor.role);
}

export class ClientsService {
  private readonly clientProfilesRepository: ClientProfilesRepository;
  private readonly usersRepository: UsersRepository;
  private readonly appointmentsService: AppointmentsService;

  constructor({ clientProfilesRepository, usersRepository, appointmentsService }: Cradle) {
    this.clientProfilesRepository = clientProfilesRepository;
    this.usersRepository = usersRepository;
    this.appointmentsService = appointmentsService;
  }

  async list(input: ListClientsInput): Promise<PagedClients> {
    const page = { limit: input.limit, offset: input.offset };
    const [rows, total] = await this.clientProfilesRepository.findMany(
      {
        search: input.search,
        birthdayMonth: input.birthdayMonth,
        inactiveSince: input.inactiveSince,
      },
      page,
    );

    return { items: rows.map(toClientListItemDto), total, ...page };
  }

  async get(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<StaffClientDto | BarberClientDto | SelfClientDto> {
    if (isStaff(actor)) {
      return this.getForStaff(id);
    }
    if (actor.role === 'BARBER') {
      return this.getForBarber(id);
    }

    this.assertIsSelf(id, actor);
    return this.getOwn(id);
  }

  async getForStaff(id: string): Promise<StaffClientDto> {
    const user = await this.requireClient(id);
    const profile = await this.clientProfilesRepository.findByUserId(id);

    return toStaffClientDto(user, profile, await this.clientProfilesRepository.findStats(id));
  }

  async getForBarber(id: string): Promise<BarberClientDto> {
    const user = await this.requireClient(id);
    const profile = await this.clientProfilesRepository.findByUserId(id);

    return toBarberClientDto(user, profile, await this.clientProfilesRepository.findStats(id));
  }

  async getOwn(userId: string): Promise<SelfClientDto> {
    const user = await this.requireClient(userId);

    return toSelfClientDto(user, await this.clientProfilesRepository.findByUserId(userId));
  }

  async getHistory(
    id: string,
    actor: AuthenticatedUser,
    page: PageInput,
  ): Promise<PagedAppointments> {
    await this.requireClient(id);
    if (!isStaff(actor) && actor.role !== 'BARBER') {
      this.assertIsSelf(id, actor);
    }

    return this.appointmentsService.listForClient(id, page);
  }

  async updateProfile(
    id: string,
    input: UpdateClientInput,
    actor: AuthenticatedUser,
  ): Promise<StaffClientDto> {
    if (!isStaff(actor)) {
      throw new ForbiddenError('Only staff may edit a client profile');
    }

    const user = await this.requireClient(id);
    const profile = await this.clientProfilesRepository.upsert(id, input);

    return toStaffClientDto(user, profile, await this.clientProfilesRepository.findStats(id));
  }

  async updateOwn(userId: string, input: UpdateOwnClientInput): Promise<SelfClientDto> {
    const user = await this.requireClient(userId);

    return toSelfClientDto(user, await this.clientProfilesRepository.upsert(userId, input));
  }

  private async requireClient(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user || user.role !== 'CLIENT') {
      throw new NotFoundError(`Client ${id} not found`);
    }

    return user;
  }

  private assertIsSelf(id: string, actor: AuthenticatedUser): void {
    if (id !== actor.id) {
      throw new ForbiddenError('You can only read your own client profile');
    }
  }
}

function toStats(stats: ClientStats): ClientStatsDto {
  return {
    visits: stats.visits,
    lastVisitAt: stats.lastVisitAt?.toISOString() ?? null,
    averageTicketCents: stats.averageTicket,
    noShows: stats.noShows,
  };
}

function toStaffClientDto(
  user: User,
  profile: ClientProfile | null,
  stats: ClientStats,
): StaffClientDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    active: user.active,
    birthday: profile?.birthday ?? null,
    preferences: profile?.preferences ?? null,
    internalNotes: profile?.internalNotes ?? null,
    stats: toStats(stats),
  };
}

function toBarberClientDto(
  user: User,
  profile: ClientProfile | null,
  stats: ClientStats,
): BarberClientDto {
  return {
    id: user.id,
    name: user.name,
    birthday: profile?.birthday ?? null,
    preferences: profile?.preferences ?? null,
    stats: toStats(stats),
  };
}

function toSelfClientDto(user: User, profile: ClientProfile | null): SelfClientDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    birthday: profile?.birthday ?? null,
    preferences: profile?.preferences ?? null,
  };
}

function toClientListItemDto(row: ClientRow): ClientListItemDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    active: row.active,
    birthday: row.birthday,
    preferences: row.preferences,
    internalNotes: row.internalNotes,
  };
}
