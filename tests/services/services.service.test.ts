import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cradle } from '../../src/container';
import type { Service } from '../../src/entities/service.entity';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/errors/app-error';
import type { AuthenticatedUser } from '../../src/lib/actor';
import { ServicesService } from '../../src/services/services.service';

const service = {
  id: 'service-1',
  name: 'Corte',
  description: null,
  price: 4500,
  durationMinutes: 30,
  active: true,
} as Service;

const inactive = { ...service, id: 'service-2', name: 'Descontinuado', active: false } as Service;

const ADMIN_ACTOR: AuthenticatedUser = { id: 'admin-1', role: 'ADMIN' };
const CLIENT_ACTOR: AuthenticatedUser = { id: 'client-1', role: 'CLIENT' };

function buildService(overrides: { servicesRepository?: Record<string, unknown> } = {}) {
  const servicesRepository = {
    findById: vi.fn().mockResolvedValue(service),
    findActiveByName: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([service]),
    create: vi.fn(async (data: Record<string, unknown>) => ({ ...service, ...data, id: 'new' })),
    update: vi.fn(async (_id: string, data: Record<string, unknown>) => ({ ...service, ...data })),
    ...overrides.servicesRepository,
  };

  const cradle = { servicesRepository } as unknown as Cradle;

  return { service: new ServicesService(cradle), servicesRepository };
}

describe('ServicesService.create', () => {
  it('stores cents on the entity and returns priceCents', async () => {
    const harness = buildService();

    const result = await harness.service.create({
      name: 'Barba',
      priceCents: 3000,
      durationMinutes: 20,
    });

    expect(harness.servicesRepository.create).toHaveBeenCalledWith({
      name: 'Barba',
      description: null,
      price: 3000,
      durationMinutes: 20,
    });
    expect(result.priceCents).toBe(3000);
  });

  it('refuses a name an active service already uses', async () => {
    const { service: services } = buildService({
      servicesRepository: { findActiveByName: vi.fn().mockResolvedValue(service), create: vi.fn() },
    });

    await expect(
      services.create({ name: 'Corte', priceCents: 1, durationMinutes: 1 }),
    ).rejects.toThrow(ConflictError);
  });

  it('only checks active services, so a retired name can be reused', async () => {
    const harness = buildService();

    await harness.service.create({ name: 'Corte 2019', priceCents: 1000, durationMinutes: 15 });

    expect(harness.servicesRepository.findActiveByName).toHaveBeenCalledWith('Corte 2019');
  });
});

describe('ServicesService.list', () => {
  let harness: ReturnType<typeof buildService>;

  beforeEach(() => {
    harness = buildService();
  });

  it('shows only active services to anonymous callers', async () => {
    await harness.service.list(false);

    expect(harness.servicesRepository.findMany).toHaveBeenCalledWith({ active: true });
  });

  it('lets staff include inactive ones', async () => {
    const withInactive = buildService({
      servicesRepository: { findMany: vi.fn().mockResolvedValue([service, inactive]) },
    });

    const result = await withInactive.service.list(true, ADMIN_ACTOR);

    expect(withInactive.servicesRepository.findMany).toHaveBeenCalledWith({});
    expect(result).toHaveLength(2);
  });

  it.each([[undefined], [CLIENT_ACTOR]])('refuses includeInactive for actor %s', async (actor) => {
    await expect(harness.service.list(true, actor)).rejects.toThrow(ForbiddenError);
  });
});

describe('ServicesService.update', () => {
  it('maps priceCents onto the entity price column', async () => {
    const harness = buildService();

    const result = await harness.service.update(service.id, { priceCents: 5500 });

    expect(harness.servicesRepository.update).toHaveBeenCalledWith(service.id, { price: 5500 });
    expect(result.priceCents).toBe(5500);
  });

  it('leaves untouched fields out of the changeset', async () => {
    const harness = buildService();

    await harness.service.update(service.id, { name: 'Corte Premium' });

    expect(harness.servicesRepository.update).toHaveBeenCalledWith(service.id, {
      name: 'Corte Premium',
    });
  });

  it('refuses renaming onto another active service', async () => {
    const { service: services } = buildService({
      servicesRepository: {
        findActiveByName: vi.fn().mockResolvedValue({ ...service, id: 'service-9' }),
      },
    });

    await expect(services.update(service.id, { name: 'Barba' })).rejects.toThrow(ConflictError);
  });

  it('allows a no-op rename to its own name', async () => {
    const harness = buildService({
      servicesRepository: { findActiveByName: vi.fn().mockResolvedValue(service) },
    });

    await expect(harness.service.update(service.id, { name: service.name })).resolves.toBeTruthy();
  });

  it('404s on an unknown service', async () => {
    const { service: services } = buildService({
      servicesRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(services.update('ghost', { name: 'X' })).rejects.toThrow(NotFoundError);
  });
});

describe('ServicesService.deactivate', () => {
  it('soft deletes so appointment history survives', async () => {
    const harness = buildService();

    const result = await harness.service.deactivate(service.id);

    expect(harness.servicesRepository.update).toHaveBeenCalledWith(service.id, { active: false });
    expect(result.active).toBe(false);
  });

  it('is idempotent', async () => {
    const harness = buildService({
      servicesRepository: {
        findById: vi.fn().mockResolvedValue(inactive),
        update: vi.fn(),
      },
    });

    await harness.service.deactivate(inactive.id);

    expect(harness.servicesRepository.update).not.toHaveBeenCalled();
  });
});
