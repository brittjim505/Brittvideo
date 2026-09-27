const { chromium } = require('playwright');
const fs=require('fs');
const F = 'file:///home/claude/brittvideo/prototype/BrittVideo_Builder_V2.11.23_BRIDGE.html';
(async () => {
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const ctx=await b.newContext({acceptDownloads:true}); const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  pg.on('dialog', async d => { errors.push('DIALOG ' + d.message().slice(0, 100)); await d.accept(d.defaultValue()); });
  await pg.goto(F); await pg.waitForTimeout(400);
  const log = (k, v) => console.log(k.padEnd(44), JSON.stringify(v));
  for (const [len, n] of [['30 seconds',6],['60 seconds',12],['120 seconds',24]]) {
    await pg.evaluate(() => { if(!state.prospects.length){state.prospects.push({id:1,name:'Smile Dental',url:'https://smiledental.example',market:'Dental'}); render();} sceneState=[]; });
    await pg.click('#nav button[data-page=build]');
    await pg.selectOption('#bEntity', '1'); await pg.click('#analyzeSite');
    await pg.selectOption('#bLength', len);
    errors.length=0; await pg.click('#makeKit'); await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => [Object.keys(currentScripts), sceneState.length]);
    await pg.evaluate(() => { approveAllWebsiteScenes(); approveAllDeliverable('socialA'); approveAllDeliverable('socialB'); approveAllDeliverable('email'); approveCompleteVideoKit(); });
    const dl = pg.waitForEvent('download',{timeout:3000}).catch(()=>null);
    await pg.evaluate(() => downloadCompleteKit());
    const d = await dl;
    log(len, {errors:errors.slice(), scripts:r[0], scenes:r[1], expected:n, zip: d && d.suggestedFilename()});
    if (d && len==='30 seconds') { const p=await d.path(); const z=fs.readFileSync(p); log('zip has Website_30sec.txt', z.includes(Buffer.from('Website_30sec.txt'))); log('manifest 6/6', z.includes(Buffer.from('30 sec / 16:9 — 6/6'))); }
  }
  await pg.evaluate(() => saveCurrentProject());
  const pid = await pg.evaluate(() => currentProjectId);
  await pg.reload(); await pg.waitForTimeout(400); errors.length=0;
  await pg.evaluate(id => loadProject(id), pid); await pg.waitForTimeout(1500);
  log('reopen errors', errors.slice());
  log('reopen scenes/approved/final', await pg.evaluate(() => [sceneState.length, sceneState.filter(s=>s.approved).length, finalKitApproved()]));
  const dl = pg.waitForEvent('download'); errors.length=0;
  await pg.click('text=EXPORT ALL DATA FOR UPGRADE'); const d = await dl;
  const j = JSON.parse(fs.readFileSync(await d.path(),'utf8'));
  fs.writeFileSync('sample_export.json', JSON.stringify(j,null,1));
  log('export file / keys', [d.suggestedFilename(), Object.keys(j.keys)]);
  log('support version', await pg.evaluate(() => stage1SupportReport().split('\n')[2]));
  await b.close();
})();
