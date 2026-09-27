import { z } from 'zod';
import path from 'node:path';

const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'live']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  // 32-byte keys, base64. Used for session tokens? No — for encrypting stored secrets and backups.
  SECRETS_ENCRYPTION_KEY: z.string().min(40),
  BACKUP_ENCRYPTION_KEY: z.string().min(40),
  BACKUP_DIR: z.string().default('./backups'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().default(35),
  STORAGE_DIR: z.string().default('./storage'),
  SESSION_DAYS: z.coerce.number().int().default(14),
  DEMO_LINK_DEFAULT_DAYS: z.coerce.number().int().default(14),
  SUPPORT_EMAIL: z.string().default(''),
  JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
  PG_BIN_DIR: z.string().default(''),
});

export type Config = z.infer<typeof schema> & { isLive: boolean };

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`BrittVideo cannot start: configuration is incomplete (${missing}). See .env.example.`);
  }
  const c = parsed.data;
  // V29/Y21: environments must not share a database.
  const dbName = c.DATABASE_URL.split('/').pop()?.split('?')[0] ?? '';
  if (c.APP_ENV === 'live' && !/live|prod/i.test(dbName)) {
    throw new Error('BrittVideo live mode must use a live database (database name must contain "live" or "prod").');
  }
  if (c.APP_ENV !== 'live' && /live|prod/i.test(dbName)) {
    throw new Error(`BrittVideo ${c.APP_ENV} mode must not use the live database.`);
  }
  if (c.SECRETS_ENCRYPTION_KEY === c.BACKUP_ENCRYPTION_KEY) {
    throw new Error('SECRETS_ENCRYPTION_KEY and BACKUP_ENCRYPTION_KEY must be different.');
  }
  return { ...c, BACKUP_DIR: path.resolve(c.BACKUP_DIR), STORAGE_DIR: path.resolve(c.STORAGE_DIR), isLive: c.APP_ENV === 'live' };
}

export function config(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}
export function setConfigForTests(c: Config) { cached = c; }
