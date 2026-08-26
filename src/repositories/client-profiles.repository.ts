import type { Repository, SelectQueryBuilder } from 'typeorm';
import type { Cradle } from '../container';
import { Appointment } from '../entities/appointment.entity';
import { ClientProfile } from '../entities/client-profile.entity';
import { User } from '../entities/user.entity';
import { decimalStringToCents } from '../lib/money';
import { requireShopId } from '../lib/shop-context';

export interface ProfileChanges {
  birthday?: string | null;
  preferences?: string | null;
  internalNotes?: string | null;
}

export interface ClientFilters {

  search?: string;

  birthdayMonth?: number;

  inactiveSince?: Date;
}

export interface Page {
  limit: number;
  offset: number;
}

export interface ClientRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  active: boolean;
  birthday: string | null;
  preferences: string | null;
  internalNotes: string | null;
}

export interface ClientStats {
  visits: number;
  lastVisitAt: Date | null;

  averageTicket: number | null;
  noShows: number;
}

interface RawStats {
  visits: string;
  lastVisitAt: Date | null;
  averageTicket: string | null;
  noShows: string;
}

export class ClientProfilesRepository {
  private readonly profiles: Repository<ClientProfile>;
  private readonly users: Repository<User>;
  private readonly appointments: Repository<Appointment>;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.profiles = dataSource.getRepository(ClientProfile);
    this.users = dataSource.getRepository(User);
    this.appointments = dataSource.getRepository(Appointment);
    this.shopId = requireShopId(currentShop);
  }

  async findByUserId(userId: string): Promise<ClientProfile | null> {
    return this.profiles.findOneBy({ userId, shopId: this.shopId });
  }

  async upsert(userId: string, changes: ProfileChanges): Promise<ClientProfile> {
    const existing = await this.findByUserId(userId);

    return this.profiles.save(
      this.profiles.create({
        birthday: null,
        preferences: null,
        internalNotes: null,
        ...existing,

        ...omitUndefined(changes),
        userId,
        shopId: this.shopId,
      }),
    );
  }

  async findMany(filters: ClientFilters, page: Page): Promise<[ClientRow[], number]> {
    const total = await this.clientQuery(filters).getCount();

    const rows = await this.clientQuery(filters)
      .select('u.id', 'id')
      .addSelect('u.name', 'name')
      .addSelect('u.email', 'email')
      .addSelect('u.phone', 'phone')
      .addSelect('u.active', 'active')

      .addSelect(`to_char(p.birthday, 'YYYY-MM-DD')`, 'birthday')
      .addSelect('p.preferences', 'preferences')
      .addSelect('p.internal_notes', 'internalNotes')
      .orderBy('u.name', 'ASC')
      .addOrderBy('u.id', 'ASC')
      .limit(page.limit)
      .offset(page.offset)
      .getRawMany<ClientRow>();

    return [rows, total];
  }

  async findStats(clientId: string): Promise<ClientStats> {
    const raw = await this.appointments
      .createQueryBuilder('a')
      .select(`count(*) FILTER (WHERE a.status = 'completed')`, 'visits')
      .addSelect(`max(a.starts_at) FILTER (WHERE a.status = 'completed')`, 'lastVisitAt')

      .addSelect(`round(avg(a.price) FILTER (WHERE a.status = 'completed'), 2)`, 'averageTicket')
      .addSelect(`count(*) FILTER (WHERE a.status = 'no_show')`, 'noShows')
      .where('a.client_id = :clientId', { clientId })
      .andWhere('a.shop_id = :shopId', { shopId: this.shopId })
      .getRawOne<RawStats>();

    return {
      visits: Number(raw?.visits ?? 0),
      lastVisitAt: raw?.lastVisitAt ?? null,
      averageTicket: raw?.averageTicket ? decimalStringToCents(raw.averageTicket) : null,
      noShows: Number(raw?.noShows ?? 0),
    };
  }

  private clientQuery(filters: ClientFilters): SelectQueryBuilder<User> {

    const query = this.users
      .createQueryBuilder('u')
      .leftJoin(ClientProfile, 'p', 'p.user_id = u.id')
      .where('u.role = :role', { role: 'CLIENT' })
      .andWhere('u.shop_id = :shopId', { shopId: this.shopId });

    if (filters.search) {
      query.andWhere('(u.name ILIKE :q OR u.email ILIKE :q OR u.phone ILIKE :q)', {
        q: `%${escapeLike(filters.search)}%`,
      });
    }

    if (filters.birthdayMonth !== undefined) {
      query.andWhere('EXTRACT(MONTH FROM p.birthday) = :month', { month: filters.birthdayMonth });
    }

    if (filters.inactiveSince) {
      query.andWhere(
        `NOT EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.client_id = u.id AND a.shop_id = :shopId
             AND a.status = 'completed' AND a.starts_at >= :since
         )`,
        { since: filters.inactiveSince, shopId: this.shopId },
      );
    }

    return query;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function omitUndefined(changes: ProfileChanges): ProfileChanges {
  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
}
