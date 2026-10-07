// Browser walkthrough: GET PICTURES FROM A WEBSITE → business folders (Dentists / Facilities / Attorneys / Others) → Builder uses the folder.
// Needs: the app at localhost:3000 (fresh database, ALLOW_PRIVATE_FETCH=true) and a sample site at 127.0.0.1:4000.
const { chromium } = require('playwright');
const S = (process.env.SHOTS || '/tmp') + '/wp_'; const PW = 'my business password 2026';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push('CONSOLE ' + m.text()); });
  pg.on('dialog', (d) => d.accept());
  const shot = async (n, full = true) => { await pg.waitForTimeout(600); await pg.screenshot({ path: S + n + '.png', fullPage: full }); console.log('shot', n, 'errors', errs.length); };
  const api = (method, url, body) => pg.evaluate(async ([m, u, bd]) => (await fetch(u, { method: m, headers: { 'X-BrittVideo': '1', 'Content-Type': 'application/json' }, body: bd ? JSON.stringify(bd) : undefined })).json(), [method, url, body]);
  await pg.goto('http://localhost:3000/app');
  await pg.getByLabel('Your name').fill('Jim Britt'); await pg.getByLabel('Email').fill('jim.britt@example.com'); await pg.getByLabel('Password').fill(PW);
  await pg.getByRole('button', { name: 'CREATE MY SUPER USER ACCOUNT', exact: true }).click(); await pg.waitForSelector('text=Needs attention today');
  const mesa = await api('POST', '/api/prospects', { businessName: 'Mesa Smiles Dental', websiteUrl: 'http://127.0.0.1:4000', industry: 'dental' });
  await api('POST', '/api/prospects', { businessName: 'Corrales Family Dentistry', websiteUrl: 'corralesdental.example', industry: 'dental' });
  await api('POST', '/api/prospects', { businessName: 'Sandia Senior Living', websiteUrl: 'sandialiving.example', industry: 'senior_care' });
  await api('POST', '/api/prospects', { businessName: 'Rio Grande Law', websiteUrl: 'riolaw.example', industry: 'attorneys' });
  await api('POST', '/api/prospects', { businessName: 'Duke City Plumbing', websiteUrl: 'dcplumb.example', industry: 'other', businessType: 'Plumber' });

  await pg.getByRole('link', { name: 'Image Library' }).click(); await pg.waitForSelector('text=Folders'); await shot('01_folders');
  await pg.getByRole('button', { name: /^DENTISTS/ }).click(); await pg.waitForSelector('text=Mesa Smiles Dental'); await shot('02_dentists_group');
  await pg.locator('.folder', { hasText: 'Mesa Smiles Dental' }).click();
  await pg.getByRole('button', { name: /GET PICTURES FROM MESA SMILES DENTAL'S WEBSITE/ }).click();
  await pg.getByRole('button', { name: 'SCAN WEBSITE', exact: true }).click();
  await pg.waitForSelector('text=Tick the ones you want', { timeout: 90000 }); await shot('03_scan_results');
  await pg.getByRole('button', { name: /^SAVE \d+ PICTURES TO MESA SMILES DENTAL/ }).click();
  await pg.waitForSelector('text=saved to the Mesa Smiles Dental folder'); await shot('04_saved', false);
  await pg.getByRole('button', { name: '×' }).or(pg.getByRole('button', { name: /CLOSE/i })).first().click().catch(() => pg.keyboard.press('Escape'));
  await pg.waitForTimeout(800); await shot('05_mesa_folder');

  // Mesa buys: the Builder offers the folder pictures for the new video — no new scan needed.
  const sale = await api('POST', '/api/sales', { saleKey: 'e2e-' + Date.now(), channel: 'manual', package: 'standard', prospectId: mesa.id ?? mesa.prospect?.id,
    business: { businessName: 'Mesa Smiles Dental', industry: 'dental', websiteUrl: 'http://127.0.0.1:4000' }, agreement: { accepted: true, name: 'Dr. Lee' } });
  await pg.goto(`http://localhost:3000/app/projects/${sale.projectId}/build?step=3`);
  await pg.waitForSelector('text=Pictures for this project'); await shot('06_builder_before');
  await pg.getByRole('button', { name: /FROM MESA SMILES DENTAL'S FOLDER/ }).click();
  await pg.waitForSelector('text=added from the folder'); await shot('07_builder_after');
  console.log('ERRORS', errs); await b.close();
})();
