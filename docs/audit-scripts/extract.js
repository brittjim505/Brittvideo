const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const pg=await b.newPage();
await pg.goto('file:///home/claude/brittvideo/prototype/BrittVideo_Builder_V2.11.22_DEMO_TO_PROJECT_HANDOFF.html');
const d=await pg.evaluate(()=>({moradaImages:moradaImages.filter(x=>!x.bvLibraryId),socialAScenes,socialBScenes,emailScenes}));
fs.writeFileSync('/home/claude/brittvideo/server/src/modules/migration/prototype-defaults.json',JSON.stringify(d,null,1));
console.log(d.moradaImages.length,d.socialAScenes.length,d.socialBScenes.length,d.emailScenes.length);await b.close();})();
