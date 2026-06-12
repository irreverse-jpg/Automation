const { chromium } = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({baseURL:'https://uat2.careuk.com'});
 await page.goto('/types-of-care/day-clubs',{waitUntil:'domcontentloaded'});
 await page.waitForLoadState('load').catch(()=>{});
 const accept=page.locator('#onetrust-accept-btn-handler').first();
 if (await accept.isVisible().catch(()=>false)) await accept.click().catch(()=>{});
 const data = await page.evaluate(()=>{
   const normalize=(v)=>String(v||'').replace(/\s+/g,' ').trim();
   const isVisible=(el)=>{const s=getComputedStyle(el); return s.display!=='none' && s.visibility!=='hidden' && el.getClientRects().length>0;};
   const h4 = Array.from(document.querySelectorAll('h4')).find(h=>normalize(h.textContent).toLowerCase()==='find a day club near you' && isVisible(h));
   const container = h4?.closest('.container, section, article, .row, .nearestHome') || h4?.parentElement || document;
   const links = Array.from(container.querySelectorAll('a[href]')).filter(isVisible).map(a=>({text:normalize(a.textContent),href:a.getAttribute('href')||''}));
   return {heading: normalize(h4?.textContent||''), links};
 });
 console.log(JSON.stringify(data,null,2));
 await browser.close();
})();
