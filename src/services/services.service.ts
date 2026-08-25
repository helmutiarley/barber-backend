import type { Cradle } from '../container';
import type { Service } from '../entities/service.entity';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import type { ServicesRepository } from '../repositories/services.repository';

export interface ServiceDto {
  id: string;
  name: string;
  description: string | null;

  priceCents: number;
  durationMinutes: number;
  active: boolean;
}

export interface CreateServiceInput {
  name: string;
  description?: string | null;
  priceCents: number;
  durationMinutes: number;
}

export interface UpdateServiceInput {
  name?: string;
  description?: string | null;
  priceCents?: number;
  durationMinutes?: number;
}

const STAFF_ROLES = ['ADMIN', 'MANAGER'] as const;

export function toServiceDto(service: Service): ServiceDto {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    priceCents: service.price,
    durationMinutes: service.durationMinutes,
    active: service.active,
  };
}

export class ServicesService {
  private readonly servicesRepository: ServicesRepository;

  constructor({ servicesRepository }: Cradle) {
    this.servicesRepository = servicesRepository;
  }

  async create(input: CreateServiceInput): Promise<ServiceDto> {
    await this.assertNameIsFree(input.name);

    const service = await this.servicesRepository.create({
      name: input.name,
      description: input.description ?? null,
      price: input.priceCents,
      durationMinutes: input.durationMinutes,
    });

    return toServiceDto(service);
  }

  async list(includeInactive: boolean, actor?: AuthenticatedUser): Promise<ServiceDto[]> {
    if (includeInactive && !isStaff(actor)) {
      throw new ForbiddenError('Only staff may list inactive services');
    }

    const services = await this.servicesRepository.findMany(
      includeInactive ? {} : { active: true },
    );

    return services.map(toServiceDto);
  }

  async getById(id: string): Promise<ServiceDto> {
    return toServiceDto(await this.requireService(id));
  }

  async update(id: string, input: UpdateServiceInput): Promise<ServiceDto> {
    const service = await this.requireService(id);

    if (input.name !== undefined && input.name !== service.name) {
      await this.assertNameIsFree(input.name);
    }

    const updated = await this.servicesRepository.update(id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.priceCents !== undefined && { price: input.priceCents }),
      ...(input.durationMinutes !== undefined && { durationMinutes: input.durationMinutes }),
    });

    return toServiceDto(updated!);
  }

  async deactivate(id: string): Promise<ServiceDto> {
    const service = await this.requireService(id);
    if (!service.active) {
      return toServiceDto(service);
    }

    const updated = await this.servicesRepository.update(id, { active: false });
    return toServiceDto(updated!);
  }

  private async assertNameIsFree(name: string): Promise<void> {
    const existing = await this.servicesRepository.findActiveByName(name);
    if (existing) {
      throw new ConflictError('A service with this name already exists');
    }
  }

  private async requireService(id: string): Promise<Service> {
    const service = await this.servicesRepository.findById(id);
    if (!service) {
      throw new NotFoundError(`Service ${id} not found`);
    }

    return service;
  }
}

function isStaff(actor?: AuthenticatedUser): boolean {
  return actor !== undefined && (STAFF_ROLES as readonly string[]).includes(actor.role);
}
