import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { db, closeDb } from '../db/pool.js';
import { createUser } from '../auth/service.js';

// Usage: npm run create-super-user   (asks for name, email and password)
// Non-interactive: BV_NAME=.. BV_EMAIL=.. BV_PASSWORD=.. BV_ROLE=super_user|admin|user npm run create-super-user
async function main() {
  const rl = readline.createInterface({ input, output });
  const name = process.env.BV_NAME || await rl.question('Full name: ');
  const email = process.env.BV_EMAIL || await rl.question('Email: ');
  const password = process.env.BV_PASSWORD || await rl.question('Password (12+ characters): ');
  const role = (process.env.BV_ROLE || 'super_user') as any;
  rl.close();
  const u = await createUser(db(), null, { email, displayName: name, role, password });
  console.log(`Created ${u.roleLabel} account for ${u.displayName} <${u.email}>.`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(closeDb);
