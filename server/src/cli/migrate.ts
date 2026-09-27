import { db, closeDb } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { createBackup } from '../modules/backup/service.js';
import { ensureDefaultPriceBook } from '../modules/pricing/service.js';

const pool = db();
migrate(pool, { backup: async (k) => (await createBackup(pool, k)).file })
  .then(async (r) => {
    await ensureDefaultPriceBook(pool);
    console.log(r.applied.length ? `Applied: ${r.applied.join(', ')}` : 'Database is up to date.');
    if (r.backupFile) console.log(`Backup taken first: ${r.backupFile}`);
  })
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(closeDb);
