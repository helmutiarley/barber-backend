import type { Logger } from 'pino';
import type { AppConfig } from '../config';
import type { Cradle } from '../container';

export type DnsRecordStatus = 'created' | 'exists' | 'failed' | 'skipped';

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
        type: 'A',
        name,
        content: this.config.serverIp,
        ttl: 1,
        proxied: true,
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

  private async request<T>(path: string, body?: unknown): Promise<CloudflareResponse<T>> {
    const response = await fetch(`${API_BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${this.config.cloudflareApiToken}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });

    return (await response.json()) as CloudflareResponse<T>;
  }
}
