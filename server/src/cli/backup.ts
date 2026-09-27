import { db, closeDb } from '../db/pool.js';
import { createBackup, listBackupFiles } from '../modules/backup/service.js';

createBackup(db(), 'manual')
  .then((r) => { console.log(`Backup created and verified: ${r.file} (${(r.bytes / 1024).toFixed(0)} KB)`); console.log(`Backups on file: ${listBackupFiles().length}`); })
  .catch((e) => { console.error('Backup failed: ' + e.message); process.exitCode = 1; })
  .finally(closeDb);
