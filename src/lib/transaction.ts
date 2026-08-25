import type { DataSource, EntityManager } from 'typeorm';

export function withTransaction<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return dataSource.transaction(work);
}
