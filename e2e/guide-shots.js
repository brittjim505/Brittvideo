// Screenshots for the User Guide, taken on a brand-new, empty copy (new-user perspective).
// Needs: app at localhost:3000 (fresh database, ALLOW_PRIVATE_FETCH=true) and the sample dental site at 127.0.0.1:4000.
const { chromium, devices } = require('playwright');
const S = (process.env.SHOTS || '/tmp/shots') + '/';
const PW = 'sunrise morning coffee 2026';
const SITE = 'http://127.0.0.1:4000';
const fails = [];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5, acceptDownloads: true });
  // Screenshots only: keep the menu bar from floating over the middle of full-page pictures.
  const unstick = () => { const st = document.createElement('style'); st.textContent = '.navbar{position:static !important}'; document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st)); };
  await ctx.addInitScript(unstick);
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  pg.on('dialog', (d) => d.accept());
  const shot = async (n, o = {}) => {
    await pg.waitForTimeout(o.wait ?? 600);
    if (o.el) { const l = typeof o.el === 'string' ? pg.locator(o.el).first() : o.el; await l.scrollIntoViewIfNeeded(); await l.screenshot({ path: S + n + '.png' }); }
    else await pg.screenshot({ path: S + n + '.png', fullPage: !!o.full });
    console.log('shot', n);
  };
  const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const step = async (name, fn) => { if (ONLY && !ONLY.includes(name)) return; try { await fn(); } catch (e) { fails.push(name + ': ' + e.message.split('\n')[0]); console.log('FAIL', name, e.message.split('\n')[0]); } };
  const go = (p) => pg.goto('http://localhost:3000/app' + p);

  // ---------- Day 1: first sign-in ----------
  await step('first', async () => {
    await go(''); await pg.waitForSelector('text=Welcome — set up BrittVideo'); await shot('01_first_setup');
    await pg.getByLabel('Your name').fill('Alex Rivera'); await pg.getByLabel('Email').fill('alex@example.com'); await pg.getByLabel('Password').fill(PW);
    await pg.getByRole('button', { name: 'CREATE MY SUPER USER ACCOUNT', exact: true }).click(); await pg.waitForSelector('text=Command Center');
    await shot('02_command_center_empty', { full: true });
    await shot('03_top_bar', { el: 'header' });
  });
  await step('textsize', async () => {
    await pg.getByRole('button', { name: 'A++', exact: true }).click(); await shot('04_text_xl');
    await pg.getByRole('button', { name: 'A+', exact: true }).click();
  });
  await step('signin', async () => { await go(''); await pg.getByLabel('Email').fill('alex@example.com'); await pg.getByLabel('Password').fill(PW);
    await pg.getByRole('button', { name: 'SIGN IN', exact: true }).click(); await pg.waitForSelector('text=Command Center'); });
  // ---------- Settings ----------
  await step('pricing', async () => { await go('/settings'); await pg.waitForSelector('text=Default prices'); await shot('05_settings_pricing', { full: true }); });
  await step('users', async () => {
    await go('/settings/users'); await pg.waitForSelector('text=People with access');
    await pg.getByRole('button', { name: '+ ADD PERSON' }).click(); await shot('06_add_person');
    await pg.getByLabel('Name').fill('Taylor Helper'); await pg.getByLabel('Email').fill('taylor@example.com');
    await pg.getByLabel('Temporary password').fill('temporary password 123'); await pg.getByRole('button', { name: 'CREATE ACCOUNT' }).click();
    await pg.waitForSelector('text=Taylor Helper'); await shot('07_users', { full: true });
  });
  await step('integrations', async () => { await go('/settings/integrations'); await pg.waitForSelector('text=Connections'); await shot('08_integrations', { full: true }); });
  await step('demolib', async () => { await go('/settings/demo-library'); await pg.waitForSelector('text=Demo Library'); await shot('09_demo_library', { full: true }); });
  // ---------- Prospects ----------
  await step('prospect', async () => {
    await go('/prospects'); await pg.waitForSelector('text=Add a prospect'); await shot('10_prospects_empty');
    await pg.getByLabel('Business / facility name').fill('Sunrise Family Dental'); await pg.getByLabel('Website').fill(SITE);
    await pg.getByLabel('Industry').selectOption({ label: 'Dental' }).catch(async () => { await pg.getByLabel('Industry').selectOption('dental'); });
    await pg.getByLabel('Contact name').fill('Dr. Priya Patel'); await pg.getByLabel('Email').fill('office@sunrise.example'); await pg.getByLabel('Phone').fill('505-555-0142');
    await pg.getByLabel('Private notes').fill('Met at Chamber breakfast. Wants something for new patients.');
    await pg.waitForTimeout(2300); await shot('11_prospect_form');
    await pg.getByRole('button', { name: 'ADD PROSPECT', exact: true }).click(); await pg.waitForSelector('text=was added');
    for (const [n, w, ind, t] of [['Sandia Senior Living', 'sandialiving.example', 'senior_care'], ['Rio Grande Law', 'riolaw.example', 'attorneys'], ['Duke City Plumbing', 'dcplumb.example', 'other', 'Plumbing']]) {
      await pg.getByLabel('Business / facility name').fill(n); await pg.getByLabel('Website').fill(w); await pg.getByLabel('Industry').selectOption(ind);
      if (t) await pg.getByLabel('Type of business').fill(t);
      await pg.getByLabel('Contact name').fill(''); await pg.getByLabel('Email').fill(''); await pg.getByLabel('Phone').fill(''); await pg.getByLabel('Private notes').fill('');
      await pg.getByRole('button', { name: 'ADD PROSPECT', exact: true }).click(); await pg.waitForTimeout(900);
    }
    await shot('12_prospect_list', { full: true });
  });
  // ---------- Image Library: pictures from the website ----------
  await step('pictures', async () => {
    await go('/images'); await pg.waitForSelector('text=Folders');
    await pg.getByRole('button', { name: /^DENTISTS/ }).click(); await pg.waitForTimeout(500); await shot('13_folders_dentists', { el: '.folders' });
    await pg.locator('.folder', { hasText: 'Sunrise Family Dental' }).click();
    await pg.getByRole('button', { name: /GET PICTURES FROM SUNRISE/ }).click();
    await pg.getByRole('button', { name: 'SCAN WEBSITE', exact: true }).click();
    await pg.waitForSelector('text=Tick the ones you want', { timeout: 90000 }); await shot('14_scan_results');
    await pg.getByRole('button', { name: /^SAVE \d+ PICTURES/ }).click(); await pg.waitForSelector('text=saved to the Sunrise');
    await pg.getByRole('button', { name: 'CLOSE', exact: true }).click(); await pg.waitForTimeout(800);
    await shot('15_folder_saved');
  });
  // ---------- Demo & Sales ----------
  await step('demosales', async () => {
    await go('/demo'); await pg.waitForSelector('text=Who is the demo for?');
    await pg.getByLabel('Choose a prospect').selectOption({ label: 'Sunrise Family Dental' }).catch(() => {});
    await shot('16_demo_sales', { full: true });
    await pg.getByRole('button', { name: 'CREATE DEMO LINK' }).click(); await pg.waitForSelector('text=Your demo link is ready'); await shot('17_demo_link', { full: true });
  });
  // iPad demo in its own iPad-sized window
  await step('ipad', async () => {
    const ipad = await b.newContext({ ...devices['iPad Pro 11'], deviceScaleFactor: 1.5 }); const ip = await ipad.newPage(); ip.on('dialog', (d) => d.accept());
    const ishot = async (n, full = false) => { await ip.waitForTimeout(700); await ip.screenshot({ path: S + n + '.png', fullPage: full }); console.log('shot', n); };
    await ip.goto('http://localhost:3000/app'); await ip.getByLabel('Email').fill('alex@example.com'); await ip.getByLabel('Password').fill(PW);
    await ishot('18_sign_in'); await ip.getByRole('button', { name: 'SIGN IN', exact: true }).click(); await ip.waitForSelector('text=Command Center');
    await ip.goto('http://localhost:3000/app/prospects'); await ip.waitForSelector('text=Your prospects');
    await ip.getByRole('row', { name: /Sunrise Family Dental/ }).getByRole('button', { name: 'IPAD DEMO' }).click()
      .catch(async () => { await ip.locator('li,tr,div.card', { hasText: 'Sunrise Family Dental' }).getByRole('button', { name: 'IPAD DEMO' }).first().click(); });
    await ip.waitForSelector('text=Choose your package', { timeout: 30000 }); await ishot('19_ipad_demo_top'); await ishot('20_ipad_demo_full', true);
    await ip.getByRole('button', { name: /BECOME A CLIENT — STANDARD/ }).click(); await ip.waitForSelector('text=Type your full name to sign');
    await ip.getByLabel('Your name').fill('Dr. Priya Patel'); await ip.getByLabel('Email').fill('office@sunrise.example');
    await ishot('21_become_client');
    await ip.getByLabel('Type your full name to sign').fill('Dr. Priya Patel'); await ip.locator('input[type=checkbox]').last().check();
    await ip.getByRole('button', { name: 'CONTINUE TO PAYMENT' }).click(); await ip.waitForSelector('text=SIMULATE A DECLINED CARD'); await ishot('22_payment');
    await ip.getByRole('button', { name: /PAY \$597 WITH TEST CARD/ }).click(); await ip.waitForSelector('text=Welcome to BrittVideo!'); await ishot('23_welcome');
    await ip.getByRole('button', { name: 'Owner: exit demo' }).click().catch(() => ip.getByText('Owner: exit demo').click());
    await ip.waitForSelector('text=BrittVideo is locked'); await ishot('24_locked');
    await ipad.close();
  });
  // ---------- Command Center with a new client, project, client page ----------
  await step('cc', async () => { await go(''); await pg.waitForSelector('text=Needs attention today'); await shot('25_command_center_client', { full: true }); });
  await step('project', async () => {
    await pg.getByRole('link', { name: 'OPEN PROJECT' }).first().click(); await pg.waitForSelector('text=Approvals'); await shot('26_project', { full: true });
    await pg.getByRole('link', { name: 'OPEN CLIENT' }).click(); await pg.waitForSelector('text=Marketing messages'); await shot('27_client', { full: true });
    await pg.getByRole('button', { name: 'CHANGE MARKETING PREFERENCE' }).click(); await shot('28_marketing_pref');
    await pg.keyboard.press('Escape');
  });
  // ---------- Record a sale (phone / Zoom / returning client) ----------
  await step('sale', async () => {
    await go('/sale'); await pg.waitForSelector('text=Record a Sale');
    await pg.getByLabel('Business / facility name').fill('Sandia Senior Living').catch(() => {});
    await shot('29_record_sale', { full: true });
  });
  // ---------- Builder ----------
  let pid = '';
  await step('builder', async () => {
    await go('/projects'); await pg.waitForSelector('text=Every video project'); await shot('30_projects', { full: true });
    await pg.getByRole('link', { name: /Sunrise Family Dental/ }).last().click(); await pg.getByRole('link', { name: 'OPEN BUILDER' }).click();
    await pg.waitForSelector('text=YOU ARE HERE'); pid = pg.url().split('/projects/')[1].split('/')[0];
    await shot('31_builder_step2');
    await pg.getByRole('button', { name: 'ANALYZE WEBSITE', exact: true }).click(); await pg.waitForSelector('text=Review them', { timeout: 90000 }); await shot('32_facts', { full: true });
    await pg.getByLabel('Add a fact yourself').fill('Evening appointments are available on Tuesdays and Thursdays.'); await pg.getByRole('button', { name: 'ADD FACT', exact: true }).click(); await pg.waitForTimeout(700);
    await pg.getByRole('button', { name: 'NEXT: REVIEW IMAGES →', exact: true }).click(); await pg.waitForSelector('text=Pictures for this project');
    const folderBtn = pg.getByRole('button', { name: /FOLDER$/ });
    if (await folderBtn.count()) { await shot('33_images_folder_button'); await folderBtn.click(); await pg.waitForTimeout(800); }
    await shot('34_review_images', { full: true });
    await pg.getByRole('button', { name: 'NEXT: CHOOSE STORY →', exact: true }).click(); await pg.waitForSelector('text=YOU ARE HERE'); await shot('35_story', { full: true });
    await pg.getByRole('button', { name: 'NEXT: BUILD VIDEOS →', exact: true }).click(); await pg.waitForTimeout(500); await shot('36_build');
    await pg.getByRole('button', { name: 'BUILD 4 VIDEOS', exact: true }).click(); await pg.waitForSelector('text=APPROVE ALL', { timeout: 60000 }); await shot('37_review_scenes');
    await pg.getByRole('button', { name: 'REWRITE SCENE', exact: true }).nth(1).click(); await pg.waitForTimeout(400); await shot('38_rewrite_scene');
    await pg.getByRole('button', { name: 'SAVE SCENE', exact: true }).click(); await pg.waitForTimeout(700);
    for (const tab of ['Website Video', 'Social A', 'Social B', 'Email Video']) {
      await pg.getByRole('button', { name: new RegExp('^' + tab) }).click(); await pg.waitForTimeout(300);
      const all = pg.getByRole('button', { name: /APPROVE ALL/ }); if (await all.count()) { await all.click(); await pg.waitForTimeout(900); }
    }
    await pg.getByRole('button', { name: 'NEXT: APPROVE →', exact: true }).click(); await pg.waitForTimeout(500); await shot('39_approve');
    await pg.getByRole('button', { name: 'APPROVE COMPLETE VIDEO KIT', exact: true }).click(); await pg.waitForSelector('text=✓ COMPLETE VIDEO KIT APPROVED'); await shot('40_kit_approved');
    await pg.getByRole('button', { name: 'NEXT: DOWNLOAD →', exact: true }).click(); await pg.waitForTimeout(500); await shot('41_download');
    const dl = pg.waitForEvent('download'); await pg.getByRole('link', { name: 'DOWNLOAD COMPLETE VIDEO KIT' }).click(); const d = await dl; console.log('kit', d.suggestedFilename());
    await d.saveAs(S + 'kit.zip');
    await pg.waitForTimeout(1800); await pg.getByRole('button', { name: 'RECORD DELIVERY', exact: true }).click(); await pg.waitForSelector('text=Delivery history'); await shot('42_delivered', { full: true });
  });
  // ---------- Quick Video ----------
  await step('quick', async () => {
    await go('/quick'); await pg.getByLabel('Who is it for?').selectOption({ label: 'Sunrise Family Dental' });
    await pg.getByLabel('Purpose').selectOption('Review Request'); await pg.getByLabel('Length').selectOption('30'); await pg.getByLabel('Customer first name').fill('Rosa');
    await shot('43_quick_form', { full: true });
    await pg.getByRole('button', { name: 'BUILD QUICK VIDEO', exact: true }).click(); await pg.waitForSelector('text=SAVE NARRATION'); await shot('44_quick_result', { full: true });
  });
  // ---------- Health and Support ----------
  await step('health', async () => {
    await go('/health'); await pg.waitForSelector('text=Backups');
    const mk = pg.getByRole('button', { name: 'MAKE A BACKUP NOW' }); if (await mk.count()) { await mk.click(); await pg.waitForSelector('text=Backup created and checked.'); }
    await shot('45_health', { full: true });
    await pg.getByRole('button', { name: 'GET SUPPORT' }).first().click(); await pg.getByLabel(/What were you trying to do/).fill('The Builder would not open for Sunrise Family Dental.');
    await pg.getByRole('button', { name: 'PREPARE SUPPORT REPORT' }).click(); await pg.waitForSelector('text=SEND FOR SUPPORT'); await shot('46_support');
  });
  await step('search', async () => { await pg.keyboard.press('Escape'); await go(''); await pg.getByPlaceholder('Search clients, prospects, projects').fill('sun'); await pg.waitForTimeout(900); await shot('47_search'); });
  console.log('ERRORS', errs); console.log('FAILS', JSON.stringify(fails, null, 1)); await b.close();
})();
