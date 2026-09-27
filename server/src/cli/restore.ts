import readline from 'node:readline/promises';
import pg from 'pg';
import { config } from '../config.js';
import { restoreBackup, readBackup } from '../modules/backup/service.js';

// Usage: npm run restore -- <backup-file> [--into <database-url>]
// Default target is this environment's DATABASE_URL. A pre-restore backup of the target is always taken first.
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run restore -- <backup-file> [--into <database-url>]');
  const i = process.argv.indexOf('--into');
  const url = i > 0 ? process.argv[i + 1] : config().DATABASE_URL;
  const { header } = readBackup(file);
  console.log(`Backup from ${header.createdAt} (BrittVideo ${header.appVersion}, ${header.env}, ${header.kind}).`);
  console.log(`Target database: ${url.replace(/:[^:@/]+@/, ':****@')}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ok = process.env.BV_CONFIRM === 'RESTORE' || (await rl.question('Type RESTORE to continue: ')) === 'RESTORE';
  rl.close();
  if (!ok) { console.log('Cancelled. Nothing was changed.'); return; }
  const pool = new pg.Pool({ connectionString: url });
  try {
    const r = await restoreBackup(file, { pool, url });
    console.log(`Restored. Safety copy taken first: ${r.preRestoreBackup ?? '(target was empty)'}. Protected unsubscribes/deletions re-applied: ${r.protectedStateReapplied}.`);
    console.log('Start BrittVideo normally; any newer database upgrades will be applied automatically.');
  } finally { await pool.end(); }
}
main().catch((e) => { console.error('Restore failed: ' + e.message); process.exitCode = 1; });
