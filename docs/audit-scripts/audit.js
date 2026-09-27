const { chromium } = require('playwright');
const F = 'file:///home/claude/bv/BrittVideo_Claude_Code_Complete_Developer_Package/BrittVideo_Builder_V2.11.22_DEMO_TO_PROJECT_HANDOFF.html';
(async () => {
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const ctx = await b.newContext({ acceptDownloads: true });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  pg.on('dialog', async d => { errors.push('DIALOG ' + d.type() + ': ' + d.message().slice(0, 160)); await d.accept(d.defaultValue()); });
  await pg.goto(F); await pg.waitForTimeout(500);
  const log = (k, v) => console.log(k.padEnd(48), JSON.stringify(v));

  // 1. Add a Dental prospect
  await pg.click('#nav button[data-page=prospects]');
  await pg.fill('#pName', 'Smile Dental'); await pg.fill('#pUrl', 'https://smiledental.example');
  await pg.selectOption('#pMarket', 'Dental'); await pg.click('#addProspect');
  log('prospects after add', await pg.evaluate(() => state.prospects.map(p => p.name)));

  // 2. Build Video for Smile Dental
  await pg.click('#nav button[data-page=build]');
  const id = await pg.evaluate(() => String(state.prospects[0].id));
  await pg.selectOption('#bEntity', id);
  await pg.click('#analyzeSite'); await pg.waitForTimeout(200);
  log('facts shown for a DENTAL prospect', await pg.$$eval('#factsList li', l => l.map(x => x.textContent.slice(0, 50))));
  await pg.selectOption('#bMarket', 'Dental');
  await pg.selectOption('#bLength', '30 seconds');
  errors.length = 0;
  await pg.click('#makeKit'); await pg.waitForTimeout(400);
  log('errors on Build 4-Script Kit (30s)', errors.slice());
  log('scripts built', await pg.evaluate(() => Object.keys(currentScripts || {})));
  log('website scenes', await pg.evaluate(() => sceneState.length));
  log('scene 1 narration (dental client)', await pg.evaluate(() => sceneState[0] && sceneState[0].narration));
  log('socialA scene 2 narration', await pg.evaluate(() => socialAScenes[1].narration));

  // 3. Approve everything; final approve; try download
  errors.length = 0;
  await pg.evaluate(() => { approveAllWebsiteScenes(); approveAllDeliverable('socialA'); approveAllDeliverable('socialB'); approveAllDeliverable('email'); });
  log('allDeliverablesApproved', await pg.evaluate(() => allDeliverablesApproved()));
  await pg.evaluate(() => approveCompleteVideoKit());
  log('finalKitApproved (unsaved project)', await pg.evaluate(() => finalKitApproved()));
  await pg.evaluate(() => downloadCompleteKit());
  log('dialogs on download 30s kit', errors.slice());

  // 4. Material change after final approval of a social scene
  await pg.evaluate(() => { socialAScenes[0].narration = 'CHANGED'; });
  log('finalKitApproved after silent socialA edit', await pg.evaluate(() => finalKitApproved()));

  // 5. Save / reopen persistence
  errors.length = 0;
  await pg.evaluate(() => saveCurrentProject());
  const pid = await pg.evaluate(() => currentProjectId);
  await pg.reload(); await pg.waitForTimeout(400);
  await pg.evaluate(id => loadProject(id), pid); await pg.waitForTimeout(1500);
  log('errors on reopen', errors.slice());
  log('reopened website scenes / approved', await pg.evaluate(() => [sceneState.length, sceneState.filter(s => s.approved).length]));
  log('video library (state.projects)', await pg.evaluate(() => state.projects.length));

  // 6. Demo mode: what remains visible?
  await pg.click('#nav button[data-page=demoSales]');
  await pg.fill('#demoName', 'Acme Law'); await pg.fill('#demoUrl', 'https://acmelaw.example');
  await pg.selectOption('#demoIndustry', 'Attorneys');
  await pg.click('#startDemo'); await pg.waitForTimeout(200);
  const vis = await pg.evaluate(() => {
    const v = el => { if (!el) return null; const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
    return { nav: v(document.querySelector('#nav')), projectBar: v(document.querySelector('.projectBar')), guide: v(document.querySelector('#guidedWorkflow')),
      clientsDataInDom: document.body.innerHTML.includes('Smile Dental'), getSupport: v([...document.querySelectorAll('button')].find(b => b.textContent === 'GET SUPPORT')) };
  });
  log('demo mode visibility', vis);
  errors.length = 0;
  await pg.evaluate(() => convertDemoToSale('Premier'));
  log('after convert: clients / projects', await pg.evaluate(() => [state.clients.map(c => c.name + ':' + c.plan), Object.keys(projectStore()).length]));
  log('convert again (dup check) clients', await pg.evaluate(() => { convertDemoToSale('Premier'); return state.clients.length; }));
  log('localStorage keys', await pg.evaluate(() => Object.keys(localStorage)));
  await b.close();
})();
