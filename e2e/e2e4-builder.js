const { chromium } = require('playwright'); const fs=require('fs');
const S='/tmp/claude-0/-home-claude/360ebc77-61a2-5798-95d0-1fdf85f56a7c/scratchpad/shots/p3_'; const PW='my business password 2026';
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});const pg=await ctx.newPage();const errs=[];
pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));pg.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errs.push('CONSOLE '+m.text())});
pg.on('dialog',d=>d.accept());
const shot=async n=>{await pg.waitForTimeout(500);await pg.screenshot({path:S+n+'.png',fullPage:true});console.log('shot',n,'errors',errs.length);};
await pg.goto('http://localhost:3000/app');
await pg.getByLabel('Your name').fill('Jim Britt');await pg.getByLabel('Email').fill('jim.britt@example.com');await pg.getByLabel('Password').fill(PW);
await pg.getByRole('button',{name:'CREATE MY SUPER USER ACCOUNT',exact:true}).click();await pg.waitForSelector('text=Needs attention today');
// Record a sale (Mac) for the practice
await pg.getByRole('link',{name:'RECORD A SALE'}).click();await pg.getByLabel('Business / facility name').fill('Mesa Verde Senior Living');await pg.getByLabel('Website').fill('http://127.0.0.1:4000');
await pg.getByLabel('Agreed by (full name)').fill('Ann Director');await pg.getByLabel(/accepted the/).check();await pg.getByRole('button',{name:'CREATE SALE',exact:true}).click();
await pg.getByLabel('How was it paid?').fill('Check #1001');await pg.getByRole('button',{name:/RECORD PAYMENT OF/}).click();await pg.waitForSelector('text=Paid.');
await pg.getByRole('link',{name:'GO TO COMMAND CENTER'}).click();await pg.getByRole('link',{name:'OPEN PROJECT'}).first().click();
await pg.getByRole('link',{name:'OPEN BUILDER'}).click();await pg.waitForSelector('text=YOU ARE HERE');await shot('01_step1');
await pg.getByRole('button',{name:'ANALYZE WEBSITE',exact:true}).click();
await pg.waitForSelector('text=Review them',{timeout:60000});await shot('02_facts');
await pg.getByLabel('Keep this fact').first().click();await pg.waitForTimeout(500);
await pg.getByLabel('Add a fact yourself').fill('Family-owned and operated since 2004.');await pg.getByRole('button',{name:'ADD FACT',exact:true}).click();await pg.waitForTimeout(600);
await pg.getByRole('button',{name:'NEXT: REVIEW IMAGES →',exact:true}).click();await pg.waitForSelector('text=Pictures for this project');await shot('03_images');
await pg.getByRole('button',{name:'DO NOT USE',exact:true}).last().click();await pg.waitForTimeout(600);
await pg.getByRole('button',{name:'NEXT: CHOOSE STORY →',exact:true}).click();await pg.getByLabel('Video story').selectOption('A Day in the Life');await shot('04_story');
await pg.getByRole('button',{name:'NEXT: BUILD VIDEOS →',exact:true}).click();await pg.getByRole('button',{name:'BUILD 4 VIDEOS',exact:true}).click();
await pg.waitForSelector('text=APPROVE ALL');await shot('05_review');
await pg.getByRole('button',{name:'REWRITE SCENE',exact:true}).nth(2).click();await pg.getByLabel('Narration — the words spoken').fill('Every day at Mesa Verde starts with a warm breakfast.');await pg.getByRole('button',{name:'SAVE SCENE',exact:true}).click();await pg.waitForTimeout(700);
for (const tab of ['Website Video','Social A','Social B','Email Video']) { await pg.getByRole('button',{name:new RegExp('^'+tab)}).click(); await pg.waitForTimeout(300);
  const all=pg.getByRole('button',{name:/APPROVE ALL/}); if (await all.count()) { await all.click(); await pg.waitForTimeout(900);} }
await shot('06_all_approved');
await pg.getByRole('button',{name:'NEXT: APPROVE →',exact:true}).click();await pg.getByRole('button',{name:'APPROVE COMPLETE VIDEO KIT',exact:true}).click();await pg.waitForSelector('text=✓ COMPLETE VIDEO KIT APPROVED');await shot('07_kit_approved');
await pg.getByRole('button',{name:'NEXT: DOWNLOAD →',exact:true}).click();
const dl=pg.waitForEvent('download');await pg.getByRole('link',{name:'DOWNLOAD COMPLETE VIDEO KIT'}).click();const d=await dl;const zp=await d.path();
console.log('zip',d.suggestedFilename(),fs.statSync(zp).size,'bytes');fs.copyFileSync(zp,S+'kit.zip');
await pg.waitForTimeout(1800);await pg.getByRole('button',{name:'RECORD DELIVERY',exact:true}).click();await pg.waitForSelector('text=Delivery history');await shot('08_delivered');
// Quick Video
await pg.getByRole('link',{name:'Quick Video'}).click();await pg.getByLabel('Who is it for?').selectOption({label:'Mesa Verde Senior Living'});
await pg.getByLabel('Purpose').selectOption('Review Request');await pg.getByLabel('Length').selectOption('30');await pg.getByLabel('Customer first name').fill('Rosa');
await pg.getByRole('button',{name:'BUILD QUICK VIDEO',exact:true}).click();await pg.waitForSelector('text=SAVE NARRATION');await shot('09_quick');
await pg.getByRole('button',{name:'APPROVE SCRIPT',exact:true}).first().click();await pg.waitForSelector('text=DOWNLOAD SCRIPT');
const dl2=pg.waitForEvent('download');await pg.getByRole('link',{name:'DOWNLOAD SCRIPT'}).click();console.log('script',(await dl2).suggestedFilename());
// Image library + text size
await pg.getByRole('link',{name:'Image Library'}).click();await pg.waitForSelector('text=Your reusable pictures');await shot('10_library');
await pg.getByRole('button',{name:'A++',exact:true}).click();await pg.getByRole('link',{name:'Command Center'}).click();await pg.waitForSelector('text=Needs attention today');await shot('11_text_xl');
console.log('ERRORS',errs);await b.close();})();
