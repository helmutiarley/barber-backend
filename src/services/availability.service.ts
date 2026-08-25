import type { AppConfig } from '../config';
import type { Cradle } from '../container';
import { NotFoundError, ValidationError } from '../errors/app-error';
import { contains, slotsWithin, subtract, type Interval } from '../lib/intervals';
import { shopDayBounds, toInstant, toShopDate, weekdayOf } from '../lib/shop-time';
import type { AppointmentsRepository } from '../repositories/appointments.repository';
import type { BarberBlocksRepository } from '../repositories/barber-blocks.repository';
import type { BarberSchedulesRepository } from '../repositories/barber-schedules.repository';
import type { BarbersRepository } from '../repositories/barbers.repository';
import type { ServicesRepository } from '../repositories/services.repository';

const DEFAULT_SLOT_MINUTES = 15;

export interface AvailabilityQuery {
  barberId: string;

  date: string;
  serviceId?: string;
  slotMinutes?: number;
}

export interface AvailabilityDto {
  barberId: string;
  date: string;
  timezone: string;

  free: { startsAt: string; endsAt: string }[];

  slots?: string[];
}

export class AvailabilityService {
  private readonly barbersRepository: BarbersRepository;
  private readonly barberSchedulesRepository: BarberSchedulesRepository;
  private readonly barberBlocksRepository: BarberBlocksRepository;
  private readonly appointmentsRepository: AppointmentsRepository;
  private readonly servicesRepository: ServicesRepository;
  private readonly config: AppConfig;

  constructor({
    barbersRepository,
    barberSchedulesRepository,
    barberBlocksRepository,
    appointmentsRepository,
    servicesRepository,
    config,
  }: Cradle) {
    this.barbersRepository = barbersRepository;
    this.barberSchedulesRepository = barberSchedulesRepository;
    this.barberBlocksRepository = barberBlocksRepository;
    this.appointmentsRepository = appointmentsRepository;
    this.servicesRepository = servicesRepository;
    this.config = config;
  }

  async getDay(query: AvailabilityQuery): Promise<AvailabilityDto> {
    const barber = await this.barbersRepository.findById(query.barberId);
    if (!barber) {
      throw new NotFoundError(`Barber ${query.barberId} not found`);
    }

    const free = barber.active ? await this.freeIntervals(query.barberId, query.date) : [];

    const dto: AvailabilityDto = {
      barberId: query.barberId,
      date: query.date,
      timezone: this.config.shopTimezone,
      free: free.map((interval) => ({
        startsAt: interval.start.toISOString(),
        endsAt: interval.end.toISOString(),
      })),
    };

    if (query.serviceId) {
      const service = await this.servicesRepository.findById(query.serviceId);
      if (!service) {
        throw new NotFoundError(`Service ${query.serviceId} not found`);
      }
      if (!service.active) {
        throw new ValidationError('This service is no longer offered');
      }

      const step = query.slotMinutes ?? DEFAULT_SLOT_MINUTES;
      dto.slots = free
        .flatMap((interval) => slotsWithin(interval, service.durationMinutes, step))
        .map((slot) => slot.toISOString());
    }

    return dto;
  }

  async isAvailable(
    barberId: string,
    startsAt: Date,
    endsAt: Date,
    options: { excludeAppointmentId?: string } = {},
  ): Promise<boolean> {
    const requested: Interval = { start: startsAt, end: endsAt };
    const date = toShopDate(startsAt, this.config.shopTimezone);
    const free = await this.freeIntervals(barberId, date, options.excludeAppointmentId);

    return free.some((interval) => contains(interval, requested));
  }

  async workingIntervals(barberId: string, date: string): Promise<Interval[]> {
    const zone = this.config.shopTimezone;
    const schedule = await this.barberSchedulesRepository.findByBarberAndWeekday(
      barberId,
      weekdayOf(date),
    );

    if (!schedule) {
      return [];
    }

    const working: Interval = {
      start: toInstant(date, schedule.startTime, zone),
      end: toInstant(date, schedule.endTime, zone),
    };

    const cuts: Interval[] = [];

    if (schedule.breakStart && schedule.breakEnd) {
      cuts.push({
        start: toInstant(date, schedule.breakStart, zone),
        end: toInstant(date, schedule.breakEnd, zone),
      });
    }

    const { start: dayStart, end: dayEnd } = shopDayBounds(date, zone);
    const blocks = await this.barberBlocksRepository.findOverlapping(barberId, dayStart, dayEnd);
    cuts.push(...blocks.map((block) => ({ start: block.startsAt, end: block.endsAt })));

    return subtract([working], cuts);
  }

  private async freeIntervals(
    barberId: string,
    date: string,
    excludeAppointmentId?: string,
  ): Promise<Interval[]> {
    const working = await this.workingIntervals(barberId, date);
    if (working.length === 0) {
      return [];
    }

    const { start: dayStart, end: dayEnd } = shopDayBounds(date, this.config.shopTimezone);
    const appointments = await this.appointmentsRepository.findActiveBetween(
      barberId,
      dayStart,
      dayEnd,
      excludeAppointmentId,
    );

    return subtract(
      working,
      appointments.map((appointment) => ({
        start: appointment.startsAt,
        end: appointment.endsAt,
      })),
    );
  }
}
