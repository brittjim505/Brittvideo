const { chromium } = require('playwright'); const fs=require('fs');
const F='file:///home/claude/brittvideo/prototype/BrittVideo_Builder_V2.11.23_BRIDGE.html';
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const ctx=await b.newContext({acceptDownloads:true});const pg=await ctx.newPage();
const errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('dialog',d=>d.accept(d.defaultValue()));
await pg.goto(F);await pg.waitForTimeout(300);
// prospects via real form
await pg.click('#nav button[data-page=prospects]');
for (const [n,u,m] of [['Morada Quintessence Albuquerque','https://moradaquintessencealbuquerque.seniorlivingnearme.com','Senior Care'],['Smile Dental','smiledental.example','Dental'],['Rio Grande Plumbing','https://rgplumbing.example','OTHER']]){
 await pg.fill('#pName',n);await pg.fill('#pUrl',u);await pg.selectOption('#pMarket',m);await pg.fill('#pNotes','private note for '+n);await pg.click('#addProspect');}
// convert Smile Dental to Standard client
await pg.evaluate(()=>{const p=state.prospects.find(x=>x.name==='Smile Dental');convertBV(p.id,'Standard');});
// library image (tiny png)
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
fs.writeFileSync('/tmp/claude-0/-home-claude/360ebc77-61a2-5798-95d0-1fdf85f56a7c/scratchpad/audit/dentist_chair.png',png);
await pg.click('#nav button[data-page=imageLibrary]');
await pg.setInputFiles('#bvLibraryFileInput','/tmp/claude-0/-home-claude/360ebc77-61a2-5798-95d0-1fdf85f56a7c/scratchpad/audit/dentist_chair.png');await pg.waitForTimeout(500);
// Morada kit, fully approved + final approved + downloaded
await pg.click('#nav button[data-page=build]');
const mid=await pg.evaluate(()=>String(state.prospects.find(x=>x.name.startsWith('Morada')).id));
await pg.selectOption('#bEntity',mid);await pg.click('#analyzeSite');await pg.click('#makeKit');await pg.waitForTimeout(300);
await pg.evaluate(()=>saveCurrentProject());
await pg.evaluate(()=>{ window.prompt=(m,d)=>m.includes('narration')?'Edited narration by Jim for scene 2.':d; editScene(1); chooseSceneImage(3,6); });
await pg.evaluate(()=>{approveAllWebsiteScenes();approveAllDeliverable('socialA');approveAllDeliverable('socialB');approveAllDeliverable('email');approveCompleteVideoKit();saveCurrentProject();});
const dl=pg.waitForEvent('download');await pg.evaluate(()=>downloadCompleteKit());await dl;
await pg.evaluate(()=>saveCurrentProject());
const moradaPid=await pg.evaluate(()=>currentProjectId);
// second project: Rio Grande partial approvals + quick video; unsaved newer checkpoint
await pg.reload();await pg.waitForTimeout(300);
await pg.click('#nav button[data-page=build]');
const rid=await pg.evaluate(()=>String(state.prospects.find(x=>x.name.startsWith('Rio')).id));
await pg.selectOption('#bEntity',rid);await pg.selectOption('#bLength','30 seconds');await pg.click('#analyzeSite');await pg.click('#makeKit');await pg.waitForTimeout(300);
await pg.selectOption('#singlePurpose','Review Request');await pg.selectOption('#singleLength','30 seconds');await pg.fill('#singleCustomer','Maria');
await pg.click('#makeSingleVideo');await pg.waitForTimeout(200);
await pg.evaluate(()=>{sceneState[0].approved=true;websiteApprovalLedger[0]=true;saveCurrentProject();});
await pg.waitForTimeout(1200);
await pg.evaluate(()=>{sceneState[1].approved=true;createWorkCheckpoint('automatic');});
const d2=pg.waitForEvent('download');await pg.click('text=EXPORT ALL DATA FOR UPGRADE');const d=await d2;
const j=JSON.parse(fs.readFileSync(await d.path(),'utf8'));
fs.writeFileSync('/home/claude/brittvideo/server/test/fixtures/prototype_export.json',JSON.stringify(j,null,1));
const projs=JSON.parse(j.keys['brittvideo-v2-projects']);
console.log('errors',errs,'keys',Object.keys(j.keys).length,'projects',Object.keys(projs).length,'morada',moradaPid,'final?',!!JSON.parse(j.keys['brittvideo-v21107-final-approvals'])[moradaPid]);
await b.close();})();
