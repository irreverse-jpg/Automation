const { chromium, devices } = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 for (const mode of ['desktop','tablet','mobile']) {
  const context=await browser.newContext({ ...(mode==='desktop'?{}:mode==='tablet'?devices['iPad Pro 11']:devices['Pixel 7']), baseURL:'https://uat2.careuk.com' });
  const page=await context.newPage();
  await page.goto('/',{waitUntil:'domcontentloaded'}); await page.waitForLoadState('load').catch(()=>{});
  const accept=page.locator('#onetrust-accept-btn-handler').first(); if(await accept.isVisible().catch(()=>false)) await accept.click().catch(()=>{});
  const navIcon=page.locator('.navicon').first(); if(await navIcon.isVisible().catch(()=>false)) await navIcon.click().catch(()=>{});
  const data=await page.evaluate(()=>{
    const normalize=(v)=>String(v||'').replace(/\s+/g,' ').trim();
    const directText=(li)=>Array.from(li.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>normalize(n.textContent)).join(' ').trim();
    const roots=[...document.querySelectorAll('.navigation .rootlevel > ul > li')].map(li=>({
      cls: li.className,
      direct: normalize(directText(li)),
      anchor: normalize(li.querySelector(':scope > a')?.textContent),
      href: li.querySelector(':scope > a')?.getAttribute('href') || '',
      children:[...li.querySelectorAll(':scope > .sublevelOne > ul > li')].map(c=>({
        t: normalize(c.textContent),
        a: normalize(c.querySelector(':scope > a')?.textContent),
        href: c.querySelector(':scope > a')?.getAttribute('href') || ''
      }))
    }));
    return roots;
  });
  console.log('MODE', mode);
  console.log(JSON.stringify(data, null, 2));
  await context.close();
 }
 await browser.close();
})();
