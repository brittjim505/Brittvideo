const { chromium } = require('playwright');
const F = 'file:///home/claude/brittvideo/prototype/BrittVideo_Builder_V2.11.23_BRIDGE.html';
(async () => {
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const pg = await (await b.newContext()).newPage(); const errors=[];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.goto(F); await pg.waitForTimeout(300);
  await pg.evaluate(() => { state.prospects.push({id:1,name:'Smile Dental',url:'https://s.example',market:'Dental'}); save(); });
  await pg.click('#nav button[data-page=build]'); await pg.selectOption('#bEntity','1'); await pg.click('#analyzeSite');
  await pg.click('#makeKit'); await pg.waitForTimeout(300);
  await pg.evaluate(() => saveCurrentProject());
  await pg.evaluate(() => { approveAllWebsiteScenes(); approveAllDeliverable('socialA'); approveAllDeliverable('socialB'); approveAllDeliverable('email'); approveCompleteVideoKit(); saveCurrentProject(); });
  const before = await pg.evaluate(() => finalKitApproved()); const pid = await pg.evaluate(() => currentProjectId);
  await pg.reload(); await pg.waitForTimeout(300);
  await pg.evaluate(id => loadProject(id), pid); await pg.waitForTimeout(1500);
  console.log('final approved before/after reopen', before, await pg.evaluate(() => finalKitApproved()), 'errors', errors);
  await b.close();
})();
