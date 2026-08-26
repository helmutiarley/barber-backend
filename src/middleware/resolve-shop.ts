import { asValue } from 'awilix';
import type { RequestHandler } from 'express';
import type { AppConfig } from '../config';
import type { Shop } from '../entities/shop.entity';
import { NotFoundError } from '../errors/app-error';
import type { ShopsRepository } from '../repositories/shops.repository';

declare global {
  namespace Express {
    interface Request {
      shop?: Shop;
      isPlatformHost?: boolean;
    }
  }
}

interface CacheEntry {
  shop: Shop | null;
  expiresAt: number;
}

export function resolveShop(config: AppConfig, shopsRepository: ShopsRepository): RequestHandler {
  const cache = new Map<string, CacheEntry>();

  async function lookup(host: string): Promise<Shop | null> {
    const cached = cache.get(host);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.shop;
    }

    const shop = await shopsRepository.findByHost(host);

    cache.set(host, { shop, expiresAt: Date.now() + config.shopCacheTtlMs });
    return shop;
  }

  return async (req, _res, next) => {
    try {
      const host = req.hostname.toLowerCase();

      if (config.platformHosts.includes(host)) {
        req.isPlatformHost = true;
        next();
        return;
      }

      const shop = await lookup(host);
      if (!shop || !shop.active) {
        next(new NotFoundError('No barbershop is registered for this domain'));
        return;
      }

      req.shop = shop;
      req.container.register({ currentShop: asValue(shop) });
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireShop(): RequestHandler {
  return (req, _res, next) => {
    if (!req.shop) {
      next(new NotFoundError('No barbershop is registered for this domain'));
      return;
    }

    next();
  };
}

export function requirePlatformHost(): RequestHandler {
  return (req, _res, next) => {
    if (!req.isPlatformHost) {
      next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
      return;
    }

    next();
  };
}
