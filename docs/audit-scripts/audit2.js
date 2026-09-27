const { chromium } = require('playwright');
const F = 'file:///home/claude/bv/BrittVideo_Claude_Code_Complete_Developer_Package/BrittVideo_Builder_V2.11.22_DEMO_TO_PROJECT_HANDOFF.html';
(async () => {
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const pg = await (await b.newContext()).newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  pg.on('dialog', async d => { errors.push('DIALOG ' + d.message().slice(0, 120)); await d.accept(d.defaultValue()); });
  // shim the missing globals so we can audit downstream behavior
  await pg.addInitScript(() => { Object.defineProperty(window,'websiteSecs',{get(){return parseInt((document.getElementById('bLength')||{}).value||'60',10)}}); Object.defineProperty(window,'websiteKey',{get(){return 'Website '+window.websiteSecs}}); });
  await pg.goto(F); await pg.waitForTimeout(400);
  const log = (k, v) => console.log(k.padEnd(50), JSON.stringify(v));
  await pg.evaluate(() => { state.prospects.push({id:1,name:'Smile Dental',url:'https://smiledental.example',market:'Dental'}); render(); });
  await pg.click('#nav button[data-page=build]');
  await pg.selectOption('#bEntity', '1'); await pg.click('#analyzeSite');
  await pg.selectOption('#bMarket', 'Dental'); await pg.selectOption('#bLength', '30 seconds');
  errors.length=0; await pg.click('#makeKit'); await pg.waitForTimeout(400);
  log('errors on build (shimmed)', errors.slice());
  log('scripts', await pg.evaluate(() => Object.keys(currentScripts)));
  log('website scenes for 30s', await pg.evaluate(() => sceneState.length));
  log('dental scene 1 narration', await pg.evaluate(() => sceneState[0].narration));
  log('website script contains real narration?', await pg.evaluate(() => (currentScripts['Website 30']||'').includes('[AI-generated')));
  errors.length=0;
  await pg.evaluate(() => { approveAllWebsiteScenes(); approveAllDeliverable('socialA'); approveAllDeliverable('socialB'); approveAllDeliverable('email'); approveCompleteVideoKit(); });
  log('final kit approved (30s)', await pg.evaluate(() => finalKitApproved()));
  errors.length=0; await pg.evaluate(() => downloadCompleteKit());
  log('download 30s kit dialogs', errors.slice());
  await pg.evaluate(() => saveCurrentProject());
  // silent content change to social A via array mutation (as Rewrite does, but check invalidation on approval ledger)
  await pg.evaluate(() => { window.prompt=(m,d)=>m.includes('narration')?'New narration':d; socialRewrite('socialA',0); });
  log('after socialA rewrite: finalKitApproved / socialA', await pg.evaluate(() => [finalKitApproved(), counts().socialA]));
  // does approval record reference content? re-approve socialA scene 0 then check final
  await pg.evaluate(() => setApproval('socialA',0,true));
  log('re-approved scene; finalKitApproved (should need re-final)', await pg.evaluate(() => finalKitApproved()));
  // 120s website
  await pg.selectOption('#bLength', '120 seconds'); errors.length=0;
  await pg.evaluate(()=>{ sceneState=[]; window.currentOpenedProject=null; }); await pg.click('#makeKit'); await pg.waitForTimeout(300);
  log('120s website scenes', await pg.evaluate(() => sceneState.length));
  log('deliverable meta shown', await pg.evaluate(() => deliverableDefs.website.meta));
  await b.close();
})();
