import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const tmp = path.join(os.tmpdir(), 'bv-test-' + process.pid);
process.env.APP_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/brittvideo_test';
process.env.SECRETS_ENCRYPTION_KEY ??= crypto.randomBytes(32).toString('base64');
process.env.BACKUP_ENCRYPTION_KEY ??= crypto.randomBytes(32).toString('base64');
process.env.BACKUP_DIR = path.join(tmp, 'backups');
process.env.STORAGE_DIR = path.join(tmp, 'storage');
process.env.JOBS_ENABLED = 'false';
process.env.ALLOW_PRIVATE_FETCH = 'true';   // tests serve a fake client website on 127.0.0.1
