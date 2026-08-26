import type { Shop } from '../entities/shop.entity';

export function requireShopId(shop: Shop | null): string {
  if (!shop) {
    throw new Error('No shop resolved for this request (tenant repository used on platform host)');
  }

  return shop.id;
}
