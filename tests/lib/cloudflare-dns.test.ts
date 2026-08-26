import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cradle } from '../../src/container';
import { CloudflareDns } from '../../src/lib/cloudflare-dns';

function makeClient(
  overrides: { token?: string | null; zoneId?: string | null; serverIp?: string | null } = {},
) {
  return new CloudflareDns({
    config: {
      cloudflareApiToken: overrides.token === undefined ? 'cf-token' : overrides.token,
      cloudflareZoneId: overrides.zoneId === undefined ? 'zone-1' : overrides.zoneId,
      serverIp: overrides.serverIp === undefined ? '2.57.91.91' : overrides.serverIp,
    },
    logger: pino({ level: 'silent' }),
  } as unknown as Cradle);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CloudflareDns.ensureARecord', () => {
  it('skips when no token is configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const status = await makeClient({ token: null }).ensureARecord(
      'nova.barbearia360.dev',
      'barbearia360.dev',
    );

    expect(status).toBe('skipped');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips when the server IP is not configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const status = await makeClient({ serverIp: null }).ensureARecord(
      'nova.barbearia360.dev',
      'barbearia360.dev',
    );

    expect(status).toBe('skipped');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('creates a proxied A record pointing at the server IP', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, errors: [], result: { id: 'rec-1' } }));
    vi.stubGlobal('fetch', fetchSpy);

    const status = await makeClient().ensureARecord('nova.barbearia360.dev', 'barbearia360.dev');

    expect(status).toBe('created');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/zones/zone-1/dns_records');
    expect(init.headers.authorization).toBe('Bearer cf-token');
    expect(JSON.parse(init.body)).toEqual({
      type: 'A',
      name: 'nova.barbearia360.dev',
      content: '2.57.91.91',
      ttl: 1,
      proxied: true,
    });
  });

  it('treats an already existing record as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: false,
          errors: [{ code: 81057, message: 'Record already exists.' }],
          result: null,
        }),
      ),
    );

    const status = await makeClient().ensureARecord('nova.barbearia360.dev', 'barbearia360.dev');

    expect(status).toBe('exists');
  });

  it('reports failure on API errors without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: false,
          errors: [{ code: 10000, message: 'Authentication error' }],
          result: null,
        }),
      ),
    );

    const status = await makeClient().ensureARecord('nova.barbearia360.dev', 'barbearia360.dev');

    expect(status).toBe('failed');
  });

  it('looks up the zone by name when no zone id is configured', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: true, errors: [], result: [{ id: 'zone-by-name' }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, errors: [], result: { id: 'rec-1' } }),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const status = await makeClient({ zoneId: null }).ensureARecord(
      'nova.barbearia360.dev',
      'barbearia360.dev',
    );

    expect(status).toBe('created');
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.cloudflare.com/client/v4/zones?name=barbearia360.dev',
    );
    expect(fetchSpy.mock.calls[1][0]).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone-by-name/dns_records',
    );
  });

  it('fails gracefully when the zone cannot be resolved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: false,
          errors: [{ code: 9109, message: 'Unauthorized to access requested resource' }],
          result: null,
        }),
      ),
    );

    const status = await makeClient({ zoneId: null }).ensureARecord(
      'nova.barbearia360.dev',
      'barbearia360.dev',
    );

    expect(status).toBe('failed');
  });
});
