const { chromium } = require('playwright');
(async()=>{for (const f of ['BrittVideo_Builder_V2.11.22_DEMO_TO_PROJECT_HANDOFF.html','BrittVideo_Builder_V2.11.23_BRIDGE.html']){
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const pg=await b.newPage();const errs=[];
pg.on('pageerror',e=>errs.push(e.message));pg.on('dialog',d=>d.accept());
await pg.addInitScript(()=>{if(!('websiteKey' in window)){Object.defineProperty(window,'websiteSecs',{configurable:true,get(){return 60}});Object.defineProperty(window,'websiteKey',{configurable:true,get(){return 'Website 60'}});}});
await pg.goto('file:///home/claude/brittvideo/prototype/'+f);await pg.waitForTimeout(300);
await pg.evaluate(()=>{state.prospects.push({id:1,name:'X',url:'x.example',market:'Dental'});render();});
await pg.click('#nav button[data-page=build]');await pg.selectOption('#bEntity','1');await pg.click('#makeKit');await pg.waitForTimeout(300);
errs.length=0;await pg.evaluate(()=>{try{approveScene(0)}catch(e){throw e}}).catch(e=>errs.push('approveScene: '+e.message.split('\n')[0]));
console.log(f.slice(0,28), errs.length?errs:'no errors');await b.close();}})();
