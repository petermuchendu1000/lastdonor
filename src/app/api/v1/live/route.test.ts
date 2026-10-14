import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Every shared dependency is mocked to EXPLODE on use. The liveness probe must
// answer 200 anyway: if any of these is ever wired in, the probe starts failing
// fleet-wide during a third-party outage and Fly kills every machine (P1-13).
vi.mock('@/db', () => ({
  get db(): never {
    throw new Error('liveness probe must not touch the database');
  },
}));
vi.mock('@/lib/stripe', () => ({
  get stripe(): never {
    throw new Error('liveness probe must not touch Stripe');
  },
}));
vi.mock('@/lib/locks', () => ({
  pingRedis: () => {
    throw new Error('liveness probe must not touch Redis');
  },
}));

const { GET, HEAD } = await import('./route');

const ROUTE_SOURCE = readFileSync(path.resolve(__dirname, 'route.ts'), 'utf8');

describe('GET /api/v1/live (Fly liveness probe)', () => {
  it('returns 200 with no dependency available', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('alive');
    // Process-local facts only.
    expect(body.pid).toBe(process.pid);
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(typeof body.timestamp).toBe('string');
  });

  it('reports no dependency checks at all', async () => {
    const body = await (await GET()).json();
    // The moment this grows a `checks` map it has become a readiness probe and
    // is no longer safe for an orchestrator to restart machines on.
    expect(body).not.toHaveProperty('checks');
  });

  it('answers HEAD with 200 for orchestrators that use it', async () => {
    const response = await HEAD();
    expect(response.status).toBe(200);
  });

  it('is never cached by a CDN or proxy', async () => {
    const response = await GET();
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('stays answerable many times in a row without any I/O', async () => {
    for (let i = 0; i < 25; i++) {
      expect((await GET()).status).toBe(200);
    }
  });
});

describe('the liveness route source', () => {
  it('imports nothing but next/server', () => {
    const imports = [...ROUTE_SOURCE.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['next/server']);
  });

  it('declares no async handler and awaits nothing', () => {
    // Synchronous by construction: there is nowhere for a dependency call to go.
    const code = ROUTE_SOURCE
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bawait\b/);
    expect(code).not.toMatch(/\basync\b/);
  });

  it('points the reader at /api/v1/health for deep checks', () => {
    expect(ROUTE_SOURCE).toContain('/api/v1/health');
  });
});
