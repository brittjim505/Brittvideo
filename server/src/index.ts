import { config } from './config.js';
import { db, closeDb } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';
import { createBackup } from './modules/backup/service.js';
import { ensureDefaultPriceBook } from './modules/pricing/service.js';
import { seedDemoLibrary } from './modules/demo/service.js';
import { startWorker, stopWorker } from './jobs/queue.js';
import { registerScheduledJobs, scheduleDue } from './jobs/scheduled.js';
import { APP_VERSION } from './version.js';

async function main() {
  const c = config();
  const pool = db();
  // Upgrades never wipe data: pending migrations run inside transactions, after a verified backup (Y23).
  const m = await migrate(pool, { backup: async (kind) => (await createBackup(pool, kind)).file });
  if (m.applied.length) console.log(`Database upgraded: ${m.applied.join(', ')}${m.backupFile ? ` (backup: ${m.backupFile})` : ''}`);
  await ensureDefaultPriceBook(pool);
  await seedDemoLibrary(pool);
  const app = await buildApp(pool, { logger: c.APP_ENV === 'development' });
  registerScheduledJobs();
  if (c.JOBS_ENABLED === 'true') startWorker(pool, 5000, () => scheduleDue(pool));
  await app.listen({ port: c.PORT, host: c.HOST });
  console.log(`BrittVideo ${APP_VERSION} (${c.APP_ENV}) running at ${c.PUBLIC_BASE_URL}/app`);
  const shutdown = async () => { stopWorker(); await app.close(); await closeDb(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
