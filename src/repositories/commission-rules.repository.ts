import { IsNull, type DataSource, type EntityManager, type Repository } from 'typeorm';
import type { Cradle } from '../container';
import { CommissionRule } from '../entities/commission-rule.entity';
import type { CommissionAppliesTo, CommissionBase } from '../entities/enums';

export interface NewCommissionRule {
  barberId: string | null;
  serviceId: string | null;
  rate: number;
  base: CommissionBase;
  appliesTo: CommissionAppliesTo;
}

export interface CommissionRuleChanges {
  rate?: number;
  base?: CommissionBase;
  active?: boolean;
}

export interface RuleScope {
  barberId: string | null;
  serviceId: string | null;
  appliesTo: CommissionAppliesTo;
}

export interface CommissionRuleFilters {
  appliesTo?: CommissionAppliesTo;
  active?: boolean;

  appliesToBarberId?: string;
}

export class CommissionRulesRepository {
  private readonly dataSource: DataSource;

  constructor({ dataSource }: Cradle) {
    this.dataSource = dataSource;
  }

  async create(data: NewCommissionRule, manager?: EntityManager): Promise<CommissionRule> {
    const repository = this.repo(manager);

    return repository.save(repository.create(data));
  }

  async findById(id: string, manager?: EntityManager): Promise<CommissionRule | null> {
    return this.repo(manager).findOneBy({ id });
  }

  async update(
    id: string,
    changes: CommissionRuleChanges,
    manager?: EntityManager,
  ): Promise<CommissionRule | null> {
    if (Object.keys(changes).length > 0) {
      await this.repo(manager).update({ id }, changes);
    }

    return this.findById(id, manager);
  }

  async resolve(scope: RuleScope, manager?: EntityManager): Promise<CommissionRule | null> {
    return this.repo(manager)
      .createQueryBuilder('r')
      .where('r.active = true')
      .andWhere('r.applies_to = :appliesTo', { appliesTo: scope.appliesTo })
      .andWhere('(r.barber_id = :barberId OR r.barber_id IS NULL)', { barberId: scope.barberId })
      .andWhere('(r.service_id = :serviceId OR r.service_id IS NULL)', {
        serviceId: scope.serviceId,
      })
      .orderBy('(r.barber_id IS NOT NULL)::int * 2 + (r.service_id IS NOT NULL)::int', 'DESC')
      .addOrderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .limit(1)
      .getOne();
  }

  async findActiveByScope(
    scope: RuleScope,
    manager?: EntityManager,
  ): Promise<CommissionRule | null> {
    return this.repo(manager).findOneBy({
      barberId: scope.barberId === null ? IsNull() : scope.barberId,
      serviceId: scope.serviceId === null ? IsNull() : scope.serviceId,
      appliesTo: scope.appliesTo,
      active: true,
    });
  }

  async findMany(filters: CommissionRuleFilters): Promise<CommissionRule[]> {
    const query = this.repo().createQueryBuilder('r');

    if (filters.appliesTo) query.andWhere('r.applies_to = :appliesTo', filters);
    if (filters.active !== undefined) query.andWhere('r.active = :active', filters);
    if (filters.appliesToBarberId) {
      query.andWhere('(r.barber_id = :appliesToBarberId OR r.barber_id IS NULL)', filters);
    }

    return query
      .orderBy('(r.barber_id IS NOT NULL)::int * 2 + (r.service_id IS NOT NULL)::int', 'DESC')
      .addOrderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .getMany();
  }

  private repo(manager?: EntityManager): Repository<CommissionRule> {
    return (manager ?? this.dataSource).getRepository(CommissionRule);
  }
}
