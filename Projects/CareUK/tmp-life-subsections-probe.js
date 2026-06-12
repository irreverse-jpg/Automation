const { chromium } = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({baseURL:'https://uat2.careuk.com'});
 const routes=['/life-at-a-care-uk-home/lifestyle','/life-at-a-care-uk-home/food'];
 for (const route of routes){
  await page.goto(route,{waitUntil:'domcontentloaded'}); await page.waitForLoadState('load').catch(()=>{});
  const accept=page.locator('#onetrust-accept-btn-handler').first(); if(await accept.isVisible().catch(()=>false)) await accept.click().catch(()=>{});
  const data=await page.evaluate(()=>{
    const normalize=(v)=>String(v||'').replace(/\s+/g,' ').trim();
    const nodes=[...document.querySelectorAll('h3,h4')].map(h=>{
      const txt=normalize(h.textContent);
      let c=h.parentElement;
      let found=null;
      for(let i=0;i<5 && c;i+=1){
        const a=c.querySelector('a[href]');
        if(a){found={text:normalize(a.textContent),href:a.getAttribute('href')};break;}
        c=c.parentElement;
      }
      return {tag:h.tagName,text:txt,cta:found};
    }).filter(x=>x.text && /(lifestyle|activities|keeping active|technology|personalisation|nutrition|catering|dining|sample menu|chef of the year|meaningful)/i.test(x.text));

    const allReadMore=[...document.querySelectorAll('a[href]')].map(a=>({text:normalize(a.textContent),href:a.getAttribute('href')})).filter(x=>/read more|chef of the year/i.test(x.text));
    return {nodes,allReadMore};
  });
  console.log('ROUTE',route); console.log(JSON.stringify(data,null,2));
 }
 await browser.close();
})();
