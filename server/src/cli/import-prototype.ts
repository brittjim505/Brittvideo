import fs from 'node:fs';
import { db, closeDb } from '../db/pool.js';
import { createBackup } from '../modules/backup/service.js';
import { importPrototypeExport } from '../modules/migration/importer.js';
import { systemActor } from '../auth/permissions.js';

// Usage: npm run import-prototype -- BrittVideo_ALL_DATA_2026-09-27.json
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run import-prototype -- <BrittVideo_ALL_DATA_….json>');
  const pool = db();
  await createBackup(pool, 'pre_import');
  const s = await importPrototypeExport(pool, systemActor('Prototype import (command line)'), fs.readFileSync(file, 'utf8'));
  console.log(JSON.stringify(s, null, 2));
}
main().catch((e) => { console.error('Import failed: ' + e.message); process.exitCode = 1; }).finally(closeDb);
