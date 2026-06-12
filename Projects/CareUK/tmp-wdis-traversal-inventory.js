const { chromium } = require('playwright');

const routes = [
  '/where-do-i-start/do-i-need-care',
  '/where-do-i-start/what-is-a-care-home',
  '/where-do-i-start/choosing-a-care-home',
  '/where-do-i-start/booking-a-viewing',
  '/where-do-i-start/moving-in',
  '/where-do-i-start/support-at-a-stressful-time',
  '/where-do-i-start/what-affects-cost',
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: 'https://uat2.careuk.com' });

  for (const route of routes) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => {});
    const accept = page.locator('#onetrust-accept-btn-handler').first();
    if (await accept.isVisible().catch(() => false)) await accept.click().catch(() => {});

    const info = await page.evaluate(() => {
      const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0;
      };

      const articleTiles = Array.from(document.querySelectorAll('a.article__tile')).filter(visible);
      const showMore = Array.from(document.querySelectorAll('a,button')).filter((el) => visible(el) && /^show more$/i.test(norm(el.textContent)));
      const featuredTiles = articleTiles.filter((el) => /featured/i.test(el.className) || !!el.closest('[class*="featured" i]'));

      const accordions = Array.from(document.querySelectorAll('button[aria-expanded], .accordion-button')).filter(visible);
      const videoPanels = Array.from(document.querySelectorAll('.videoPanelInline, .videoPanelInline__play')).filter(visible);
      const nearest = Array.from(document.querySelectorAll('h2,h3,h4')).find((h) => /your nearest care home/i.test(norm(h.textContent)) && visible(h));
      const topBtn = Array.from(document.querySelectorAll('a,button')).find((el) => /^top$/i.test(norm(el.textContent)) && visible(el));

      const firstArticle = articleTiles[0];
      return {
        title: document.title,
        h1: norm(document.querySelector('h1')?.textContent || ''),
        articleCount: articleTiles.length,
        featuredCount: featuredTiles.length,
        showMoreCount: showMore.length,
        firstArticleHref: firstArticle ? firstArticle.getAttribute('href') : '',
        firstArticleTitle: firstArticle ? norm(firstArticle.textContent) : '',
        accordionCount: accordions.length,
        videoCount: videoPanels.length,
        hasNearest: !!nearest,
        topVisible: !!topBtn,
      };
    });

    console.log(route, JSON.stringify(info));
  }

  await browser.close();
})();
