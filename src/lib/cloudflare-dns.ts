import type { Logger } from 'pino';
import type { AppConfig } from '../config';
import type { Cradle } from '../container';

export type DnsRecordStatus = 'created' | 'exists' | 'failed' | 'skipped';
export type DnsDeleteStatus = 'deleted' | 'missing' | 'failed' | 'skipped';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const RECORD_EXISTS_CODES = new Set([81053, 81057]);

interface CloudflareResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T | null;
}

export class CloudflareDns {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly zoneIds = new Map<string, string>();

  constructor({ config, logger }: Cradle) {
    this.config = config;
    this.logger = logger;
  }

  async ensureARecord(name: string, zoneName: string): Promise<DnsRecordStatus> {
    if (!this.config.cloudflareApiToken) {
      return 'skipped';
    }

    if (!this.config.serverIp) {
      this.logger.warn({ name }, 'SERVER_IP is not configured; skipping DNS record creation');
      return 'skipped';
    }

    try {
      const zoneId = await this.resolveZoneId(zoneName);
      const response = await this.request<{ id: string }>(`/zones/${zoneId}/dns_records`, {
        method: 'POST',
        body: {
          type: 'A',
          name,
          content: this.config.serverIp,
          ttl: 1,
          proxied: true,
        },
      });

      if (response.success) {
        this.logger.info({ name, zoneName }, 'created Cloudflare DNS record');
        return 'created';
      }

      if (response.errors.some((error) => RECORD_EXISTS_CODES.has(error.code))) {
        return 'exists';
      }

      this.logger.warn({ name, errors: response.errors }, 'Cloudflare DNS record creation failed');
      return 'failed';
    } catch (error) {
      this.logger.warn({ name, err: error }, 'Cloudflare DNS record creation failed');
      return 'failed';
    }
  }

  async deleteARecord(name: string, zoneName: string): Promise<DnsDeleteStatus> {
    if (!this.config.cloudflareApiToken) {
      return 'skipped';
    }

    try {
      const zoneId = await this.resolveZoneId(zoneName);
      const list = await this.request<{ id: string }[]>(
        `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(name)}`,
      );

      if (!list.success) {
        this.logger.warn({ name, errors: list.errors }, 'Cloudflare DNS record lookup failed');
        return 'failed';
      }

      const records = list.result ?? [];
      if (records.length === 0) {
        return 'missing';
      }

      for (const record of records) {
        const response = await this.request<{ id: string }>(
          `/zones/${zoneId}/dns_records/${record.id}`,
          { method: 'DELETE' },
        );

        if (response.success === false) {
          this.logger.warn(
            { name, recordId: record.id, errors: response.errors },
            'Cloudflare DNS record deletion failed',
          );
          return 'failed';
        }
      }

      this.logger.info({ name, zoneName }, 'deleted Cloudflare DNS record');
      return 'deleted';
    } catch (error) {
      this.logger.warn({ name, err: error }, 'Cloudflare DNS record deletion failed');
      return 'failed';
    }
  }

  private async resolveZoneId(zoneName: string): Promise<string> {
    if (this.config.cloudflareZoneId) {
      return this.config.cloudflareZoneId;
    }

    const cached = this.zoneIds.get(zoneName);
    if (cached) {
      return cached;
    }

    const response = await this.request<{ id: string }[]>(
      `/zones?name=${encodeURIComponent(zoneName)}`,
    );
    const zone = response.success ? response.result?.[0] : undefined;

    if (!zone) {
      throw new Error(
        `could not resolve Cloudflare zone "${zoneName}" (${JSON.stringify(response.errors)}); ` +
          'grant the token Zone Read permission or set CF_ZONE_ID',
      );
    }

    this.zoneIds.set(zoneName, zone.id);
    return zone.id;
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<CloudflareResponse<T>> {
    const response = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.config.cloudflareApiToken}`,
        'content-type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });

    return (await response.json()) as CloudflareResponse<T>;
  }
}
