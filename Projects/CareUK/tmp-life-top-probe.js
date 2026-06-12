const { chromium } = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({baseURL:'https://uat2.careuk.com'});
 await page.goto('/life-at-a-care-uk-home',{waitUntil:'domcontentloaded'}); await page.waitForLoadState('load').catch(()=>{});
 const accept=page.locator('#onetrust-accept-btn-handler').first(); if(await accept.isVisible().catch(()=>false)) await accept.click().catch(()=>{});
 await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
 await page.waitForTimeout(500);
 const data=await page.evaluate(()=>{
  const normalize=(v)=>String(v||'').replace(/\s+/g,' ').trim();
  const candidates=[...document.querySelectorAll('a,button')]
   .map(el=>({text:normalize(el.textContent), cls:el.className, href:el.getAttribute('href')||'', id:el.id||''}))
   .filter(x=>/top|back to top|scroll/i.test(x.text) || /scrolltop|top/i.test(x.cls) || x.href==='#top');
  const footer=document.querySelector('footer');
  return { candidates, footerClass: footer?.className || '' };
 });
 console.log(JSON.stringify(data,null,2));
 await browser.close();
})();
