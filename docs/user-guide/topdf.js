const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  await p.goto('file://' + __dirname + '/guide.html', { waitUntil: 'networkidle' });
  await p.pdf({ path: __dirname + '/BrittVideo_Desk_User_Guide.pdf', format: 'Letter', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:9pt;color:#6b7280;padding:0 0.75in;display:flex;justify-content:space-between;font-family:Arial"><span>BrittVideo Desk — User Guide · v3.0.1 owner test edition</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>' });
  await b.close();
})();
