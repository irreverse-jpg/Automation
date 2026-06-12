const { chromium } = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({baseURL:'https://uat2.careuk.com'});
 await page.goto('/types-of-care/day-clubs',{waitUntil:'domcontentloaded'});
 await page.waitForLoadState('load').catch(()=>{});
 const accept=page.locator('#onetrust-accept-btn-handler').first();
 if (await accept.isVisible().catch(()=>false)) await accept.click().catch(()=>{});
 await page.locator('input#careHomeSearch').first().fill('M33').catch(()=>{});
 const sel=page.locator('select[name="type"]').first();
 await sel.selectOption({ label: /day\s*club/i }).catch(async()=>{const v=await sel.locator('option').filter({hasText:/day\s*club/i}).first().getAttribute('value'); if(v) await sel.selectOption(v);});
 await page.getByRole('button',{name:/^submit$/i}).first().click().catch(()=>{});
 await page.waitForTimeout(1500);
 const data=await page.evaluate(()=>{
   const normalize=(v)=>String(v||'').replace(/\s+/g,' ').trim();
   const bySel=(s)=>document.querySelectorAll(s).length;
   const sec=document.querySelector('.nearestHome') || document;
   const labels=Array.from(sec.querySelectorAll('a[href], button')).map(el=>({tag:el.tagName.toLowerCase(), href:el.getAttribute('href')||'', text:normalize(el.textContent)})).filter(x=>x.text);
   return {
     counts:{
       careHomeLinks: bySel('.nearestHome a[href*="/care-homes/"]'),
       viewThisHomeLinks: bySel('.nearestHome a[href*="/care-homes/"][href]:is(:not([href=""]))'),
       resultCards1: bySel('.nearestHome .careHomeResult, .nearestHome .searchResult, .nearestHome .search-results__item, .nearestHome .result'),
       forms: bySel('.nearestHome form'),
     },
     sampleLinks: labels.slice(0,25),
     bodyHasViewThisHome: /view this home/i.test(document.body.innerText),
   };
 });
 console.log(JSON.stringify(data,null,2));
 await browser.close();
})();
