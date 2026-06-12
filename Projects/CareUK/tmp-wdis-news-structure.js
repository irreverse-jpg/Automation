const { chromium } = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({baseURL:'https://uat2.careuk.com'});
 for (const route of ['/where-do-i-start/choosing-a-care-home','/where-do-i-start/support-at-a-stressful-time']) {
  await page.goto(route,{waitUntil:'domcontentloaded'}); await page.waitForLoadState('load').catch(()=>{});
  const accept=page.locator('#onetrust-accept-btn-handler').first(); if(await accept.isVisible().catch(()=>false)) await accept.click().catch(()=>{});
  const data = await page.evaluate(()=>{
    const norm=(v)=>String(v||'').replace(/\s+/g,' ').trim();
    const vis=(el)=>{const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&el.getClientRects().length>0};
    const wrappers = Array.from(document.querySelectorAll('section,div')).filter(el=>vis(el)&&/help and advice|news/i.test(norm(el.textContent).slice(0,220))).slice(0,3).map(el=>({cls:el.className, text:norm(el.textContent).slice(0,220)}));
    const tiles = Array.from(document.querySelectorAll('a.article__tile')).filter(vis).map(a=>({href:a.getAttribute('href'), cls:a.className, type:norm(a.querySelector('.article__type')?.textContent||''), title:norm(a.querySelector('.article__title')?.textContent||''), parent:a.parentElement?.className||'', grand:a.parentElement?.parentElement?.className||''}));
    const firstBlocks = Array.from(document.querySelectorAll('a[href]')).filter(vis).map(a=>({href:a.getAttribute('href')||'', text:norm(a.textContent), cls:a.className, hasArticleTitle: !!a.querySelector('.article__title')})).filter(x=>/help-advice|news/.test(x.href)||x.hasArticleTitle).slice(0,20);
    const showMore = Array.from(document.querySelectorAll('a,button')).filter(el=>vis(el)&&/^show more$/i.test(norm(el.textContent))).map(el=>({tag:el.tagName,cls:el.className}));
    return {wrappers, tileCount:tiles.length, tileSample:tiles.slice(0,3), firstBlocks, showMore};
  });
  console.log(route, JSON.stringify(data,null,2));
 }
 await browser.close();
})();
