const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('https://www.zentao.net/downloads.html', { waitUntil: 'networkidle', timeout: 60000 });
  const links = await p.$$eval('a', as => as.map(a => a.href).filter(h => /zbox|tar\.gz|\.zip/i.test(h)));
  console.log([...new Set(links)].join('\n'));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
