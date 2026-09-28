import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { SECRETS_ENCRYPTION_KEY: 'a'.repeat(44), BACKUP_ENCRYPTION_KEY: 'b'.repeat(44) };

describe('hosting configuration guards', () => {
  it('live must use https and a live database', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'live', DATABASE_URL: 'postgres://x/brittvideo_live', PUBLIC_BASE_URL: 'http://bv.example.com' })).toThrow(/https/);
    expect(() => loadConfig({ ...base, APP_ENV: 'live', DATABASE_URL: 'postgres://x/brittvideo_test', PUBLIC_BASE_URL: 'https://bv.example.com' })).toThrow(/live database/);
    expect(loadConfig({ ...base, APP_ENV: 'live', DATABASE_URL: 'postgres://x/brittvideo_live', PUBLIC_BASE_URL: 'https://bv.example.com' }).isLive).toBe(true);
  });
  it('a hosted test copy refuses the local-only private-fetch switch', () => {
    const env = { ...base, APP_ENV: 'test', DATABASE_URL: 'postgres://x/brittvideo_test', HOST: '0.0.0.0', PUBLIC_BASE_URL: 'https://test.bv.example.com' };
    expect(() => loadConfig({ ...env, ALLOW_PRIVATE_FETCH: 'true' } as any)).toThrow(/local testing only/);
    const saved = process.env.ALLOW_PRIVATE_FETCH; delete process.env.ALLOW_PRIVATE_FETCH;
    try { expect(loadConfig(env).APP_ENV).toBe('test'); } finally { process.env.ALLOW_PRIVATE_FETCH = saved; }
  });
});
