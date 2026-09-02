const { test, expect, devices } = require('@playwright/test');

// Captures the page's web address at the moment a test fails, so the
// findings report can tell teammates exactly where an issue was seen.
// Note: for the two-page comparison tests below, this only reflects the
// PRIMARY environment (baseURL) page at the time of failure - the compare
// environment's page is opened in a separate context that's usually already
// closed by the time a test fails. Check the assertion message itself (it
// names both environments) for which side an issue was actually seen on.
test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('failure-context', {
            body: JSON.stringify({
                url: page.url(),
                pageTitle: await page.title().catch(() => ''),
                environment: testInfo.project.use.baseURL || '',
                compareEnvironment: COMPARE_BASE_URL || '',
                viewport: testInfo.project.name,
            }),
            contentType: 'application/json',
        }).catch(() => {});
    }
});


// ============================================================================
// Coverage notes - two-environment discrepancy checks
// ============================================================================
// Scope: unlike every other spec in this project, this file doesn't test ONE
// environment - it DIFFS TWO of them (whichever `MCC_BASE_URL` points at,
// against `MCC_COMPARE_BASE_URL`). It grew out of the equivalent CareUK
// envcompare spec (`15-careuk.envcompare.spec.js`), itself the product of a
// manual UAT2-vs-Live comparison pass done in conversation with Claude
// (2026-09) - see the project's memory notes for the original write-up this
// spec automates, and the real GTM finding it surfaced on first run (see the
// "Analytics container" test below).
//
// Opt-in by design: every test in this file is skipped (via `test.skip` on
// the whole describe block) unless `MCC_COMPARE_BASE_URL` is set. Running
// `npm test` / CI normally will always show this file as skipped - that's
// expected, not a problem. See README.md "Comparing two environments" for
// how to actually run it.
//
// Tests in this file:
//   1-N. "Environment Compare - Page title: <path>" - one test per page in
//        PAGES_TO_COMPARE below, asserting the <title> is byte-identical on
//        both environments. Deliberately one test per page (not one test
//        looping over all of them) so the findings spreadsheet gets one row
//        per broken page, ready to turn into individual bug tickets.
//   Eyebrow navigation link order - compares the `.eyebrowNav` links'
//        text/order (Lord's Insider, London Spirit, Shop, Tickets).
//   Footer link groups and order - compares each `<ul>` of footer links.
//   Meganav labels and order - compares every root/child/grandchild label
//        and position in the meganav (reuses the same DOM shape proven out
//        in `02-mcc.meganav.spec.js`: `.meganav .mainLevel > li.meganav__item`
//        etc.).
//   Homepage hero carousel slide order - compares the `.homeHeader__slide`
//        headings. Soft on slide COUNT (confirmed live 2026-09: Live
//        currently runs 1 active slide while UAT2 runs 3 - this is normal
//        CMS content, not a bug), but hard-compares the order of whichever
//        slides both environments currently share.
//   Security & caching response headers - Strict-Transport-Security,
//        Cache-Control, Server, X-Content-Type-Options, Referrer-Policy.
//        Confirmed live 2026-09: UAT2's initial response carries no
//        Strict-Transport-Security header at all (Live does), and Live
//        exposes no "Server" header (UAT2 does, via "PAC ...") - both real,
//        soft-reported differences worth a look, not necessarily bugs.
//   robots.txt Sitemap: lines point at their own domain - not a
//        cross-environment diff, a same-file-wrong-for-one-environment
//        check. Confirmed live 2026-09: UAT2's /robots.txt returns HTTP 403
//        (nginx-blocked) rather than a usable robots.txt at all, which this
//        test reports as a finding rather than crashing on.
//   Sitemap availability and URL-count parity - both /sitemap.xml files
//        return 200 and aren't wildly different sizes. Confirmed live
//        2026-09: UAT2's /sitemap.xml also currently 403s.
//   Analytics container must not be shared across environments - the most
//        important test in this file - a HARD (non-soft) assertion, since a
//        shared GTM/GA container between environments means test traffic
//        pollutes real production analytics. Confirmed live 2026-09: UAT2
//        and Live currently DO fire into the same container, GTM-TL438PR -
//        this test is expected to genuinely fail against real infrastructure
//        today, exactly the kind of finding this file exists to catch.
//   Social-share (og:image) and structured-data (JSON-LD) parity - both
//        environments should expose an og:image tag and at least some
//        JSON-LD structured data on the homepage. Confirmed live 2026-09:
//        neither environment currently exposes either, so this test is
//        expected to fail on both sides until that's addressed - kept as a
//        standing finding rather than removed, same reasoning as CareUK's
//        equivalent check.
//   Favicon path parity - informational; a differing CDN/build path isn't
//        necessarily a bug on its own.
//   Browser broken-image sweep on key pages - sweeps
//        KEY_PATHS_FOR_IMAGE_SWEEP on both environments checking for any
//        `<img>` that loaded with zero natural width (the standard signal
//        for a broken/missing image).
//
// No cookie-shape/SameSite test: unlike CareUK's `CurrentContact` cookie,
// MCC's server responses (checked across the homepage and several other key
// pages, 2026-09) set no `Set-Cookie` header at all on an unauthenticated
// first request - OneTrust's consent cookies are set client-side via JS, not
// server-side, so there's nothing to compare with a plain `fetch()`. Add an
// equivalent test here if that ever changes.
//
// Most tests here run once per device project (desktop-chromium,
// tablet-webkit, mobile-chromium) since UI order/structure genuinely can
// differ by breakpoint. The pure HTTP-level tests (headers, robots.txt,
// sitemap, GTM, structured data, favicon) are gated to desktop-chromium only
// via `test.skip` inside each test, since they don't depend on viewport and
// running them 3x would just waste CI time.
// ============================================================================

const COMPARE_BASE_URL = (process.env.MCC_COMPARE_BASE_URL || '').trim().replace(/\/+$/, '');

// A representative, deliberately-curated (not fully dynamic) set of pages
// spanning every major site section covered by this project's other spec
// files. Add more paths here as new templates/sections are added to the
// site, rather than crawling live on every run (a fixed list keeps this spec
// fast, deterministic, and git-diffable).
const PAGES_TO_COMPARE = [
    { path: '/', label: 'Homepage' },
    { path: '/lords/match-day/plan-your-day', label: 'Visit Lord\'s - Plan Your Day' },
    { path: '/lords/match-day/fixtures-and-results', label: 'Visit Lord\'s - Fixtures and Results' },
    { path: '/lords/visit-us/contact', label: 'Visit Lord\'s - Contact' },
    { path: '/tickets', label: 'Tickets' },
    { path: '/lords-tickets/faqs', label: 'Tickets - FAQs' },
    { path: '/lords/match-day/premium-seating/hospitality', label: 'Hospitality & Experiences' },
    { path: '/lords/lord-s-experience/tours', label: 'Tours and Museum' },
    { path: '/mcc/the-club/about-us', label: 'MCC (The Club) - About Us' },
    { path: '/careers/vacancies', label: 'Careers' },
    { path: '/information/general-ground-regulations', label: 'Ground Regulations' },
    { path: '/information/general-ground-regulations-1', label: 'Terms & Conditions' },
    { path: '/footer/privacy-policy', label: 'Privacy Notice' },
];

const KEY_PATHS_FOR_IMAGE_SWEEP = [
    '/', '/lords/match-day/plan-your-day', '/tickets',
    '/lords/lord-s-experience/tours', '/mcc/the-club/about-us', '/careers/vacancies',
];

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function hostLabel(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        return url;
    }
}

function deviceOptionsForProject(projectName) {
    if (projectName === 'tablet-webkit') return { ...devices['iPad Pro 11'], browserName: 'chromium' };
    if (projectName === 'mobile-chromium') return { ...devices['Pixel 7'] };
    return { ...devices['Desktop Chrome'] };
}

async function openComparePage(browser, testInfo) {
    const context = await browser.newContext(deviceOptionsForProject(testInfo.project.name));
    const comparePage = await context.newPage();
    await comparePage.goto(COMPARE_BASE_URL, { waitUntil: 'domcontentloaded' });
    await dismissCookieOverlayIfPresent(comparePage);
    return { context, comparePage };
}

// Reused verbatim from 02-mcc.meganav.spec.js / 03-mcc.footer.spec.js /
// 01-mcc.homepage.spec.js - MCC's OneTrust banner is injected asynchronously
// via GTM, so a single instant visibility check can race and miss it.
async function dismissCookieOverlayIfPresent(page) {
    const acceptTargets = [
        page.locator('#onetrust-accept-btn-handler').first(),
        page.getByRole('button', { name: /accept|allow all|yes, allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
        page.getByRole('link', { name: /allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
    ];

    for (const candidate of acceptTargets) {
        if (await candidate.isVisible().catch(() => false)) {
            await candidate.click({ timeout: 3000 }).catch(() => { });
        }
    }

    const overlay = page.locator('#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]').first();
    if (await overlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }
}

async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }

    await dismissCookieOverlayIfPresent(page);
}

async function fetchTitle(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.status !== 200) return { status: res.status, title: null };
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return { status: res.status, title: m ? normalizeWhitespace(m[1]) : null };
}

async function getEyebrowNavOrder(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('.eyebrowNav a'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean));
}

async function getFooterGroups(page) {
    return page.evaluate(() => {
        const footer = document.querySelector('footer.footer');
        if (!footer) return [];
        const groups = [];
        footer.querySelectorAll('ul').forEach((ul) => {
            const links = Array.from(ul.querySelectorAll('a'))
                .filter((a) => a.offsetParent !== null)
                .map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            if (links.length) groups.push(links);
        });
        return groups;
    });
}

// Same DOM shape as getMenuLeafTargets()/getRootLevelItems() in
// 02-mcc.meganav.spec.js, but reading labels only (not clicking through),
// since this test just needs to diff the structure/order of the two menus.
async function getNavTree(page) {
    await page.evaluate(() => {}); // no-op, keeps shape consistent with other helpers
    return page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);

        const mainLevel = document.querySelector('.meganav .mainLevel');
        return directChildItems(mainLevel).map((root) => {
            const rootSub = root.querySelector(':scope > ul.meganav__list');
            const children = directChildItems(rootSub);
            return {
                label: normalize(root.querySelector(':scope > a.meganav__link')?.textContent),
                children: children.map((child) => {
                    const childSub = child.querySelector(':scope > ul.meganav__list');
                    const grandchildren = directChildItems(childSub);
                    return {
                        label: normalize(child.querySelector(':scope > a.meganav__link')?.textContent),
                        grandchildren: grandchildren.map((g) => normalize(g.querySelector(':scope > a.meganav__link')?.textContent)),
                    };
                }),
            };
        });
    });
}

function flattenNavTree(tree) {
    const out = [];
    tree.forEach((root, i) => {
        out.push({ key: `${i}`, label: root.label });
        (root.children || []).forEach((child, j) => {
            out.push({ key: `${i}.${j}`, label: child.label });
            (child.grandchildren || []).forEach((g, k) => {
                out.push({ key: `${i}.${j}.${k}`, label: g });
            });
        });
    });
    return out;
}

// The homeHeader hero carousel's slide count is CMS-driven and genuinely
// varies between environments (confirmed live 2026-09: Live had 1 active
// promo, UAT2 had 3), so callers should soft-check the count and only
// hard-compare order over the shared/overlapping slides.
async function getHeroSlideOrder(page) {
    await page.locator('.homeHeader').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
    return page.evaluate(() => Array.from(document.querySelectorAll('.homeHeader__slide'))
        .map((slide) => (slide.querySelector('.homeHeader__heading')?.textContent || '').replace(/\s+/g, ' ').trim()));
}

test.describe('Environment Comparison', () => {
    test.skip(!COMPARE_BASE_URL, 'Environment comparison spec only runs when MCC_COMPARE_BASE_URL is set alongside MCC_BASE_URL - see README.md "Comparing two environments". Skipped for normal single-environment runs.');

    for (const { path: pagePath, label } of PAGES_TO_COMPARE) {
        test(`Environment Compare - Page title: ${label}`, async ({ page, baseURL }, testInfo) => {
            test.skip(testInfo.project.name !== 'desktop-chromium', 'Page titles are device-independent - only needs to run once.');

            await page.goto(new URL(pagePath, baseURL).toString(), { waitUntil: 'domcontentloaded' }).catch(() => { });

            const [a, b] = await Promise.all([
                fetchTitle(new URL(pagePath, baseURL).toString()),
                fetchTitle(new URL(pagePath, COMPARE_BASE_URL).toString()),
            ]);

            expect(a.status, `${pagePath} should return the same HTTP status on ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(b.status);
            if (a.status === 200 && b.status === 200) {
                expect(a.title, `${pagePath} page title should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(b.title);
            }
        });
    }

    test('Environment Compare - Eyebrow navigation link order', async ({ page, browser, baseURL }, testInfo) => {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await waitForAndAcceptCookieBanner(page);
        const orderA = await getEyebrowNavOrder(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const orderB = await getEyebrowNavOrder(comparePage);
        await context.close();

        expect(orderA, `Eyebrow navigation link order should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toEqual(orderB);
    });

    test('Environment Compare - Footer link groups and order', async ({ page, browser, baseURL }, testInfo) => {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await waitForAndAcceptCookieBanner(page);
        const groupsA = await getFooterGroups(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const groupsB = await getFooterGroups(comparePage);
        await context.close();

        expect.soft(groupsA.length, `Footer should expose the same number of link groups on ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(groupsB.length);

        const groupCount = Math.min(groupsA.length, groupsB.length);
        for (let g = 0; g < groupCount; g += 1) {
            expect.soft(groupsA[g], `Footer link group ${g + 1} should list the same links in the same order on ${hostLabel(baseURL)} vs ${hostLabel(COMPARE_BASE_URL)}`).toEqual(groupsB[g]);
        }
    });

    test('Environment Compare - Meganav labels and order', async ({ page, browser, baseURL }, testInfo) => {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await waitForAndAcceptCookieBanner(page);
        const treeA = flattenNavTree(await getNavTree(page));

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const treeB = flattenNavTree(await getNavTree(comparePage));
        await context.close();

        const mapB = new Map(treeB.map((n) => [n.key, n.label]));
        for (const nodeA of treeA) {
            const labelB = mapB.get(nodeA.key);
            if (labelB === undefined) continue; // structural (extra/missing item) diff - covered by the count check below
            expect.soft(nodeA.label, `Meganav item at position ${nodeA.key} should have the same label on ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(labelB);
        }

        expect.soft(treeA.length, `Meganav should expose the same number of menu items (root+child+grandchild) on ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(treeB.length);
    });

    test('Environment Compare - Homepage hero carousel slide order', async ({ page, browser, baseURL }, testInfo) => {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await waitForAndAcceptCookieBanner(page);
        const slidesA = await getHeroSlideOrder(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const slidesB = await getHeroSlideOrder(comparePage);
        await context.close();

        // Slide count is CMS content, not layout - it's expected to genuinely differ between
        // environments at any given moment (confirmed live 2026-09), so only soft-check it.
        expect.soft(slidesA.length, `Homepage hero carousel slide count on ${hostLabel(baseURL)} (${slidesA.length}) vs ${hostLabel(COMPARE_BASE_URL)} (${slidesB.length}) - informational, CMS content genuinely varies between environments`).toBe(slidesB.length);

        const sharedCount = Math.min(slidesA.length, slidesB.length);
        if (sharedCount > 0) {
            expect(slidesA.slice(0, sharedCount), `Homepage hero carousel slide order (first ${sharedCount} slide(s)) should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)} (checked on ${testInfo.project.name})`).toEqual(slidesB.slice(0, sharedCount));
        }
    });

    test('Environment Compare - Security & caching response headers', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'HTTP headers are device-independent - only needs to run once.');

        const [resA, resB] = await Promise.all([fetch(baseURL), fetch(COMPARE_BASE_URL)]);
        const labelA = hostLabel(baseURL);
        const labelB = hostLabel(COMPARE_BASE_URL);

        ['strict-transport-security', 'cache-control', 'server', 'x-content-type-options', 'referrer-policy'].forEach((name) => {
            const a = resA.headers.get(name);
            const b = resB.headers.get(name);
            expect.soft(a, `${name} header should be present/absent the same way on both environments (${labelA}: "${a || 'absent'}" vs ${labelB}: "${b || 'absent'}")`).toBe(b);
        });
    });

    test('Environment Compare - robots.txt Sitemap: lines point at their own domain', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'robots.txt is device-independent.');

        async function checkRobots(base) {
            const res = await fetch(new URL('/robots.txt', base).toString());
            if (res.status !== 200) return { status: res.status, ok: false, sitemapLines: [] };
            const text = await res.text();
            const sitemapLines = [...text.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
            const ownHost = hostLabel(base);
            const ok = sitemapLines.length === 0 || sitemapLines.every((line) => hostLabel(line) === ownHost);
            return { status: res.status, ok, sitemapLines };
        }

        const a = await checkRobots(baseURL);
        const b = await checkRobots(COMPARE_BASE_URL);

        expect.soft(a.status, `${hostLabel(baseURL)}'s /robots.txt should return HTTP 200`).toBe(200);
        expect.soft(b.status, `${hostLabel(COMPARE_BASE_URL)}'s /robots.txt should return HTTP 200`).toBe(200);
        expect.soft(a.ok, `${hostLabel(baseURL)}'s robots.txt Sitemap: lines should point at its own domain, not another environment's (found: ${a.sitemapLines.join(', ') || 'none'})`).toBe(true);
        expect.soft(b.ok, `${hostLabel(COMPARE_BASE_URL)}'s robots.txt Sitemap: lines should point at its own domain, not another environment's (found: ${b.sitemapLines.join(', ') || 'none'})`).toBe(true);
    });

    test('Environment Compare - Sitemap availability and URL-count parity', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Sitemap health is device-independent.');
        test.setTimeout(60000);

        async function countUrls(url) {
            const res = await fetch(url);
            if (res.status !== 200) return { status: res.status, count: 0 };
            const text = await res.text();
            return { status: 200, count: [...text.matchAll(/<loc>/g)].length };
        }

        const a = await countUrls(new URL('/sitemap.xml', baseURL).toString());
        const b = await countUrls(new URL('/sitemap.xml', COMPARE_BASE_URL).toString());

        expect.soft(a.status, `Main sitemap should return 200 on ${hostLabel(baseURL)}`).toBe(200);
        expect.soft(b.status, `Main sitemap should return 200 on ${hostLabel(COMPARE_BASE_URL)}`).toBe(200);

        if (a.status === 200 && b.status === 200) {
            const pctDiff = Math.abs(a.count - b.count) / Math.max(a.count, b.count, 1);
            expect.soft(pctDiff < 0.25, `Main sitemap URL counts shouldn't differ wildly between environments (${hostLabel(baseURL)}: ${a.count} vs ${hostLabel(COMPARE_BASE_URL)}: ${b.count})`).toBe(true);
        }
    });

    test('Environment Compare - Analytics container must not be shared across environments', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Analytics tags are device-independent.');

        const [resA, resB] = await Promise.all([fetch(baseURL), fetch(COMPARE_BASE_URL)]);
        const [htmlA, htmlB] = await Promise.all([resA.text(), resB.text()]);

        const gtmA = [...new Set(htmlA.match(/GTM-[A-Z0-9]+/g) || [])];
        const gtmB = [...new Set(htmlB.match(/GTM-[A-Z0-9]+/g) || [])];
        const shared = gtmA.filter((id) => gtmB.includes(id));

        expect(shared, `${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)} must not fire into the same Google Tag Manager container - a shared container means one environment's test/QA traffic pollutes the other's real analytics data (found shared: ${shared.join(', ') || 'none'})`).toEqual([]);
    });

    test('Environment Compare - Social-share (og:image) and structured-data (JSON-LD) parity', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Meta tags are device-independent.');

        async function checkMeta(base) {
            const res = await fetch(base);
            const html = await res.text();
            const hasOgImage = /<meta[^>]*property=["']og:image["']/i.test(html);
            const jsonLdCount = (html.match(/<script[^>]*type=["']application\/ld\+json["']/gi) || []).length;
            return { hasOgImage, jsonLdCount };
        }

        const a = await checkMeta(baseURL);
        const b = await checkMeta(COMPARE_BASE_URL);

        expect.soft(a.hasOgImage, `${hostLabel(baseURL)} homepage should expose an og:image tag for social-share previews`).toBe(true);
        expect.soft(b.hasOgImage, `${hostLabel(COMPARE_BASE_URL)} homepage should expose an og:image tag for social-share previews`).toBe(true);

        expect.soft(a.jsonLdCount, `${hostLabel(baseURL)} homepage should expose JSON-LD structured data`).toBeGreaterThan(0);
        expect.soft(b.jsonLdCount, `${hostLabel(COMPARE_BASE_URL)} homepage should expose JSON-LD structured data`).toBeGreaterThan(0);
    });

    test('Environment Compare - Favicon path parity', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Favicon is device-independent.');

        async function getFavicon(base) {
            const res = await fetch(base);
            const html = await res.text();
            const tag = (html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*>/i) || [null])[0];
            return tag ? (tag.match(/href=["']([^"']+)["']/) || [])[1] || null : null;
        }

        const a = await getFavicon(baseURL);
        const b = await getFavicon(COMPARE_BASE_URL);

        expect.soft(a, `Favicon path should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)} (informational - a differing CDN/build path isn't necessarily a bug, but worth a look if it changes unexpectedly)`).toBe(b);
    });

    test('Environment Compare - Broken images on key pages', async ({ page, browser, baseURL }, testInfo) => {
        test.setTimeout(180000);

        async function sweep(p, base) {
            const results = [];
            for (const path of KEY_PATHS_FOR_IMAGE_SWEEP) {
                try {
                    await p.goto(new URL(path, base).toString(), { waitUntil: 'load', timeout: 30000 });
                } catch (e) {
                    results.push({ path, brokenImages: null, navError: e.message });
                    continue;
                }
                await p.waitForTimeout(500);
                const brokenImages = await p.evaluate(() => Array.from(document.querySelectorAll('img[src]'))
                    .filter((img) => img.complete && img.naturalWidth === 0 && !img.src.startsWith('data:'))
                    .length).catch(() => 0);
                results.push({ path, brokenImages, navError: null });
            }
            return results;
        }

        const resultsA = await sweep(page, baseURL);
        const { context, comparePage } = await openComparePage(browser, testInfo);
        const resultsB = await sweep(comparePage, COMPARE_BASE_URL);
        await context.close();

        for (let i = 0; i < KEY_PATHS_FOR_IMAGE_SWEEP.length; i += 1) {
            expect.soft(resultsA[i].brokenImages, `${resultsA[i].path} should have no broken images on ${hostLabel(baseURL)}`).toBe(0);
            expect.soft(resultsB[i].brokenImages, `${resultsB[i].path} should have no broken images on ${hostLabel(COMPARE_BASE_URL)}`).toBe(0);
        }
    });
});
