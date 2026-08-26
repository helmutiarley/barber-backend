import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Barber } from '../../src/entities/barber.entity';
import type { Service } from '../../src/entities/service.entity';
import { CommissionRulesRepository } from '../../src/repositories/commission-rules.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  TEST_SHOP_ID,
  makeBarber,
  makeCommissionRule,
  makeService,
  withTestShop,
} from '../support/factories';

describe('commission rules repository', () => {
  let dataSource: DataSource;
  let repository: CommissionRulesRepository;
  let barber: Barber;
  let service: Service;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new CommissionRulesRepository(withTestShop(dataSource));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    barber = await makeBarber(dataSource);
    service = await makeService(dataSource);
  });

  function scope(overrides: { barberId?: string; serviceId?: string } = {}) {
    return {
      barberId: overrides.barberId ?? barber.id,
      serviceId: overrides.serviceId ?? service.id,
      appliesTo: 'services' as const,
    };
  }

  it('round-trips the rate as a fraction, not the string the column holds', async () => {
    const created = await repository.create({
      barberId: null,
      serviceId: null,
      rate: 0.425,
      base: 'net',
      appliesTo: 'services',
    });

    expect(created.rate).toBe(0.425);
    expect((await repository.findById(created.id))?.rate).toBe(0.425);
  });

  describe('resolve', () => {
    it('prefers the barber-and-service rule over every less specific one', async () => {
      const winner = await makeCommissionRule(dataSource, {
        barberId: barber.id,
        serviceId: service.id,
        rate: 0.6,
      });
      await makeCommissionRule(dataSource, { barberId: barber.id, rate: 0.5 });
      await makeCommissionRule(dataSource, { serviceId: service.id, rate: 0.45 });
      await makeCommissionRule(dataSource, { rate: 0.4 });

      expect((await repository.resolve(scope()))?.id).toBe(winner.id);
    });

    it('falls to the barber rule when no service-specific one exists', async () => {
      const winner = await makeCommissionRule(dataSource, { barberId: barber.id, rate: 0.5 });
      await makeCommissionRule(dataSource, { serviceId: service.id, rate: 0.45 });
      await makeCommissionRule(dataSource, { rate: 0.4 });

      expect((await repository.resolve(scope()))?.id).toBe(winner.id);
    });

    it('falls to the service rule when the barber has none', async () => {
      const winner = await makeCommissionRule(dataSource, { serviceId: service.id, rate: 0.45 });
      await makeCommissionRule(dataSource, { rate: 0.4 });

      expect((await repository.resolve(scope()))?.id).toBe(winner.id);
    });

    it('falls to the shop default when nothing more specific applies', async () => {
      const winner = await makeCommissionRule(dataSource, { rate: 0.4 });

      expect((await repository.resolve(scope()))?.id).toBe(winner.id);
    });

    it('never picks an inactive rule, however specific', async () => {
      await makeCommissionRule(dataSource, {
        barberId: barber.id,
        serviceId: service.id,
        rate: 0.6,
        active: false,
      });
      const winner = await makeCommissionRule(dataSource, { rate: 0.4 });

      expect((await repository.resolve(scope()))?.id).toBe(winner.id);
    });

    it("ignores another barber's rule", async () => {
      const other = await makeBarber(dataSource);
      await makeCommissionRule(dataSource, { barberId: other.id, rate: 0.7 });
      const winner = await makeCommissionRule(dataSource, { rate: 0.4 });

      expect((await repository.resolve(scope()))?.id).toBe(winner.id);
    });

    it("ignores another service's rule", async () => {
      const other = await makeService(dataSource);
      await makeCommissionRule(dataSource, { serviceId: other.id, rate: 0.7 });
      const winner = await makeCommissionRule(dataSource, { rate: 0.4 });

      expect((await repository.resolve(scope()))?.id).toBe(winner.id);
    });

    it('never crosses from products to services', async () => {
      await makeCommissionRule(dataSource, { appliesTo: 'products', rate: 0.1 });

      expect(await repository.resolve(scope())).toBeNull();
    });

    it('finds nothing when the shop has no rules at all', async () => {
      expect(await repository.resolve(scope())).toBeNull();
    });
  });

  it('refuses a second active rule for the same scope, wildcards included', async () => {
    await makeCommissionRule(dataSource, { rate: 0.4 });

    await expect(
      repository.create({
        barberId: null,
        serviceId: null,
        rate: 0.5,
        base: 'gross',
        appliesTo: 'services',
      }),
    ).rejects.toThrow(/uq_commission_rules_scope/);
  });

  it('lets a deactivated rule be replaced by a new one on the same scope', async () => {
    const old = await makeCommissionRule(dataSource, { rate: 0.4, active: false });

    const replacement = await repository.create({
      barberId: null,
      serviceId: null,
      rate: 0.5,
      base: 'gross',
      appliesTo: 'services',
    });

    expect(replacement.id).not.toBe(old.id);
    expect((await repository.resolve(scope()))?.rate).toBe(0.5);
  });

  it('finds an existing active rule by its exact scope', async () => {
    const rule = await makeCommissionRule(dataSource, { barberId: barber.id });

    const found = await repository.findActiveByScope({
      barberId: barber.id,
      serviceId: null,
      appliesTo: 'services',
    });
    const wildcard = await repository.findActiveByScope({
      barberId: null,
      serviceId: null,
      appliesTo: 'services',
    });

    expect(found?.id).toBe(rule.id);

    expect(wildcard).toBeNull();
  });

  describe('findMany', () => {
    it('lists most specific first', async () => {
      const shop = await makeCommissionRule(dataSource, { rate: 0.4 });
      const forBarber = await makeCommissionRule(dataSource, { barberId: barber.id, rate: 0.5 });
      const forBoth = await makeCommissionRule(dataSource, {
        barberId: barber.id,
        serviceId: service.id,
        rate: 0.6,
      });

      const rows = await repository.findMany({});

      expect(rows.map((row) => row.id)).toEqual([forBoth.id, forBarber.id, shop.id]);
    });

    it('keeps the wildcard rules when narrowing to one barber', async () => {
      const other = await makeBarber(dataSource);
      const shop = await makeCommissionRule(dataSource, { rate: 0.4 });
      const mine = await makeCommissionRule(dataSource, { barberId: barber.id, rate: 0.5 });
      await makeCommissionRule(dataSource, { barberId: other.id, rate: 0.7 });

      const rows = await repository.findMany({ appliesToBarberId: barber.id });

      expect(rows.map((row) => row.id)).toEqual([mine.id, shop.id]);
    });

    it('filters by active', async () => {
      await makeCommissionRule(dataSource, { barberId: barber.id, active: false });
      const active = await makeCommissionRule(dataSource, { rate: 0.4 });

      const rows = await repository.findMany({ active: true });

      expect(rows.map((row) => row.id)).toEqual([active.id]);
    });
  });

  it('refuses a rate above one at the database level', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO commission_rules (shop_id, rate, base, applies_to) VALUES ($1, 1.5, 'gross', 'services')`,
        [TEST_SHOP_ID],
      ),
    ).rejects.toThrow(/chk_commission_rules_rate_range/);
  });
});
