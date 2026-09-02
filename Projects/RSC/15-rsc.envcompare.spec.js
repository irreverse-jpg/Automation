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
// environment - it DIFFS TWO of them (whichever `RSC_BASE_URL` points at,
// against `RSC_COMPARE_BASE_URL`). It's modelled directly on the CareUK
// project's `15-careuk.envcompare.spec.js`, which grew out of a manual
// XbyK-vs-Live comparison pass done in conversation with Claude (2026-08/09)
// that found a real, serious cross-environment GTM leak - see that file and
// the CareUK project's memory notes for the original write-up this pattern
// automates. Every selector/path below was re-derived from RSC's OWN specs
// and a real fetch/Playwright pass against both RSC environments on
// 2026-09-02, not copied from CareUK's markup.
//
// Opt-in by design: every test in this file is skipped (via `test.skip` on
// the whole describe block) unless `RSC_COMPARE_BASE_URL` is set. Running
// `npm test` / CI normally will always show this file as skipped - that's
// expected, not a problem. See README.md "Comparing two environments" for
// how to actually run it.
//
// KNOWN INFRASTRUCTURE CAVEAT (confirmed 2026-09-02, important context for
// anyone running this against Live): Live (https://www.rsc.org) currently
// serves an "Are you human?" bot-verification wall (a PALSS-hosted redirect
// to /hck-94155/) to BOTH plain HTTP fetches AND headless Playwright
// Chromium - QA (the xperience-sites.com host) does not have this. This
// means a real run of this spec against Live will likely show near-total
// failures (wrong titles, missing GTM tag, robots.txt/sitemap unreachable,
// etc.) - that's a genuine, current, and arguably serious finding about
// Live's automation-blocking WAF in its own right, not a bug in this spec.
// If Live's WAF configuration changes (allow-lists this runner, or the
// challenge is removed), these tests should start reflecting real content
// differences instead.
//
// Tests in this file:
//   1-N. "Environment Compare - Page title: <path>" - one test per page in
//        PAGES_TO_COMPARE below, asserting the <title> is byte-identical on
//        both environments. Deliberately one test per page (not one test
//        looping over all of them) so the findings spreadsheet gets one row
//        per broken page, ready to turn into individual bug tickets - same
//        reasoning as this project's other traversal-style tests.
//   Header/utility link order - compares the combined order of the header
//        action bar (Donate, Join us) and the "Explore more" umbrella nav
//        (Members' Area, Journals, Books, Sign In) - RSC has no single
//        `.header__shortcut`-style bar like CareUK; these two groups
//        together are RSC's equivalent utility links (confirmed via a real
//        DOM read against QA on 2026-09-02 - Donate/Join us live in
//        `header.header .header__actions`, the other four in `.umbrellaNav`,
//        and none of the six are present in the server-rendered HTML at all
//        - they're injected client-side, hence a real page load is used
//        here rather than a raw fetch).
//   Footer link groups and order - compares each `<ul class="footer__linkList">`
//        of footer links (confirmed 2026-09-02: 3 groups on QA - Company/
//        About, Contact/Offices, and Help & Legal).
//   Meganav labels and order - compares every root/child/grandchild label
//        and position in `#mainnav .mainLevel` (present in the DOM at all
//        times regardless of open/closed state, per 02-rsc.meganav.spec.js's
//        own notes - so no menu-opening is needed to read it here).
//   No homepage carousel test: unlike CareUK, RSC's homepage has no
//        slick-style rotating card carousel - its closest equivalent is the
//        "Latest news" feed, which is genuinely rotating editorial content
//        (01-rsc.homepage.spec.js explicitly avoids asserting which article
//        renders first, for the same reason). Comparing its "order" between
//        environments would just be permanent noise, not a real defect
//        signal, so this test is omitted rather than forced in.
//   Security & caching response headers - Strict-Transport-Security,
//        Cache-Control, Server, X-Content-Type-Options, Referrer-Policy.
//   CurrentContact cookie shape and SameSite policy - RSC sets a cookie of
//        the same name as CareUK's ("CurrentContact"), but confirmed
//        2026-09-02 it is NOT present on the very first raw HTTP response
//        (only Cloudflare's `__cf_bm` is) - it's set client-side once the
//        page's own scripts run. So this test reads it from a real
//        browser's cookie jar after a full page load, not from a raw fetch's
//        Set-Cookie header. Its value is a GUID followed by a "|"-delimited
//        suffix by design on this platform (confirmed real, not a defect on
//        its own) - the check is that it STARTS with a well-formed GUID on
//        both environments, plus that SameSite matches between them.
//   robots.txt Sitemap: lines point at their own domain - not a
//        cross-environment diff, a same-file-wrong-for-one-environment
//        check.
//   Sitemap availability and URL-count parity - both /sitemap.xml files
//        (confirmed this is RSC's real sitemap path, not /sitemap1.xml)
//        return 200 and aren't wildly different sizes.
//   Analytics container must not be shared across environments - the most
//        important test in this file - a HARD (non-soft) assertion, since a
//        shared GTM/GA container between environments means one
//        environment's test/QA traffic pollutes the other's real production
//        analytics. Confirmed 2026-09-02: QA fires GTM-NWXSBHNW.
//   Social-share (og:image) and structured-data (JSON-LD) parity - both
//        environments should expose an og:image tag. RSC's homepage
//        currently renders NO JSON-LD structured data on either environment
//        (confirmed 2026-09-02, unlike CareUK which has some) - so unlike
//        CareUK's version of this test, this one soft-compares the JSON-LD
//        block COUNT for parity rather than asserting it's greater than
//        zero, since "zero on both" is this site's real current baseline,
//        not a gap worth flagging every single run.
//   Favicon path parity - informational; a differing CDN/build path isn't
//        necessarily a bug on its own.
//   Broken images on key pages - sweeps KEY_PATHS_FOR_CONSOLE_SWEEP on both
//        environments checking for any `<img>` that loaded with zero natural
//        width (the standard signal for a broken/missing image).
//
// Most tests here run once per device project (desktop-chromium,
// tablet-webkit, mobile-chromium) since UI order/structure genuinely can
// differ by breakpoint (RSC's own meganav spec found real accordion-vs-
// flyout behaviour differences by viewport). The pure HTTP/cookie-level
// tests (headers, cookie, robots.txt, sitemap, GTM, structured data,
// favicon, page titles) are gated to desktop-chromium only via `test.skip`
// inside each test, since they don't depend on viewport and running them 3x
// would just waste CI time.
// ============================================================================

const COMPARE_BASE_URL = (process.env.RSC_COMPARE_BASE_URL || '').trim().replace(/\/+$/, '');

// A representative, deliberately-curated (not fully dynamic) set of pages
// spanning every major site section, drawn from this project's own spec file
// list (01-14) and the k6 load test's own "core pages" list. Add more paths
// here as new templates/sections are added to the site, rather than crawling
// live on every run (a fixed list keeps this spec fast, deterministic, and
// git-diffable).
const PAGES_TO_COMPARE = [
    { path: '/', label: 'Homepage' },
    { path: '/membership', label: 'Membership' },
    { path: '/publishing', label: 'Publishing' },
    { path: '/policy-and-campaigning', label: 'Policy and Campaigning' },
    { path: '/standards-and-recognition', label: 'Standards and Recognition' },
    { path: '/funding-and-support', label: 'Funding and Support' },
    { path: '/events', label: 'Events and Venue Hire' },
    { path: '/news', label: 'News' },
    { path: '/about-us', label: 'About Us' },
    { path: '/about-us/our-history', label: 'About Us - History' },
    { path: '/about-us/corporate-information', label: 'About Us - Corporate Information' },
    { path: '/contact-us', label: 'Contact Us' },
    { path: '/contact-us/offices', label: 'Contact Us - Offices' },
    { path: '/help-and-legal', label: 'Help and Legal' },
    { path: '/help-and-legal/cookies', label: 'Help and Legal - Cookies' },
    { path: '/help-and-legal/privacy', label: 'Help and Legal - Privacy' },
    { path: '/help-and-legal/accessibility', label: 'Help and Legal - Accessibility' },
    { path: '/donations', label: 'Donate' },
];

const KEY_PATHS_FOR_CONSOLE_SWEEP = [
    '/', '/membership', '/publishing', '/policy-and-campaigning',
    '/standards-and-recognition', '/funding-and-support', '/events',
    '/news', '/about-us', '/contact-us',
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

// The OneTrust banner is injected asynchronously via GTM - a same-tick isVisible()
// check races it and misses it, leaving its dark overlay blocking clicks lower on
// the page. Wait for the accept button before moving on. (Verbatim from this
// project's other spec files.)
async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

async function openHomeAndSettle(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

async function openComparePage(browser, testInfo) {
    const context = await browser.newContext(deviceOptionsForProject(testInfo.project.name));
    const comparePage = await context.newPage();
    await comparePage.goto(COMPARE_BASE_URL, { waitUntil: 'domcontentloaded' });
    await comparePage.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(comparePage);
    return { context, comparePage };
}

async function fetchTitle(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.status !== 200) return { status: res.status, title: null };
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return { status: res.status, title: m ? normalizeWhitespace(m[1]) : null };
}

// Donate/Join us live in the header action bar; Members' Area/Journals/Books/Sign In live in the
// separate ".umbrellaNav" wrapper - neither group renders in the raw server HTML (confirmed
// 2026-09-02, both are injected client-side), so this always needs a real page load, never a fetch.
async function getUtilityLinkOrder(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('header.header .header__actions a.button, .umbrellaNav a'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean));
}

async function getFooterGroups(page) {
    return page.evaluate(() => {
        const footer = document.querySelector('footer.footer');
        if (!footer) return [];
        const groups = [];
        footer.querySelectorAll('ul.footer__linkList').forEach((ul) => {
            const links = Array.from(ul.querySelectorAll('a'))
                .map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            if (links.length) groups.push(links);
        });
        return groups;
    });
}

// Reads #mainnav's whole tree in one DOM pass, matching the real markup confirmed in
// 02-rsc.meganav.spec.js (mainnav__item / mainnav__link / mainnav__list, with items sometimes
// wrapped one level deeper in an inserted "div.mainnav__items" once opened). The tree is present
// in the DOM at all times regardless of open/closed state, so no menu interaction is needed here.
async function getNavTree(page) {
    return page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.mainnav__item:not(.mainnav__intro), :scope > div.mainnav__items > li.mainnav__item:not(.mainnav__intro)')) : []);
        const labelOf = (item) => normalize(item.querySelector(':scope > a.mainnav__link')?.textContent);

        const mainLevel = document.querySelector('#mainnav .mainLevel');
        const roots = directChildItems(mainLevel);

        return roots.map((root) => {
            const children = directChildItems(root.querySelector(':scope > ul.mainnav__list'));
            return {
                label: labelOf(root),
                children: children.map((child) => {
                    const grandchildren = directChildItems(child.querySelector(':scope > ul.mainnav__list'));
                    return { label: labelOf(child), grandchildren: grandchildren.map((g) => labelOf(g)) };
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

test.describe('Environment Comparison', () => {
    test.skip(!COMPARE_BASE_URL, 'Environment comparison spec only runs when RSC_COMPARE_BASE_URL is set alongside RSC_BASE_URL - see README.md "Comparing two environments". Skipped for normal single-environment runs.');

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

    test('Environment Compare - Header/utility link order', async ({ page, browser, baseURL }, testInfo) => {
        await openHomeAndSettle(page);
        const orderA = await getUtilityLinkOrder(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const orderB = await getUtilityLinkOrder(comparePage);
        await context.close();

        expect(orderA, `Header/utility link order should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toEqual(orderB);
    });

    test('Environment Compare - Footer link groups and order', async ({ page, browser, baseURL }, testInfo) => {
        await openHomeAndSettle(page);
        const footer = page.getByRole('contentinfo').first();
        await footer.scrollIntoViewIfNeeded().catch(() => { });
        const groupsA = await getFooterGroups(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        await comparePage.getByRole('contentinfo').first().scrollIntoViewIfNeeded().catch(() => { });
        const groupsB = await getFooterGroups(comparePage);
        await context.close();

        expect.soft(groupsA.length, `Footer should expose the same number of link groups on ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(groupsB.length);

        const groupCount = Math.min(groupsA.length, groupsB.length);
        for (let g = 0; g < groupCount; g += 1) {
            expect.soft(groupsA[g], `Footer link group ${g + 1} should list the same links in the same order on ${hostLabel(baseURL)} vs ${hostLabel(COMPARE_BASE_URL)}`).toEqual(groupsB[g]);
        }
    });

    test('Environment Compare - Meganav labels and order', async ({ page, browser, baseURL }, testInfo) => {
        await openHomeAndSettle(page);
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

    test('Environment Compare - CurrentContact cookie shape and SameSite policy', async ({ page, browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Cookies set on page load are device-independent.');

        // Confirmed 2026-09-02: CurrentContact is set client-side (not present in the raw first
        // response's Set-Cookie header, unlike Cloudflare's __cf_bm), so it must be read from a
        // real browser's cookie jar after a full page load rather than from a raw fetch.
        await openHomeAndSettle(page);
        const cookiesA = await page.context().cookies();
        const cookieA = cookiesA.find((c) => c.name === 'CurrentContact');

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const cookiesB = await comparePage.context().cookies();
        const cookieB = cookiesB.find((c) => c.name === 'CurrentContact');
        await context.close();

        // The value is a GUID followed by a "|"-delimited suffix by design on this platform
        // (confirmed real on QA 2026-09-02, not itself a defect) - the check is that it STARTS
        // with a well-formed GUID, not that it's a bare GUID with nothing else.
        const guidPrefix = /^[0-9a-f-]{36}(\||%7C)/i;
        expect.soft(cookieA?.value && guidPrefix.test(cookieA.value), `CurrentContact cookie on ${hostLabel(page.url())} should be set and start with a well-formed GUID, not "${cookieA?.value || '(not set)'}"`).toBe(true);
        expect.soft(cookieB?.value && guidPrefix.test(cookieB.value), `CurrentContact cookie on ${hostLabel(COMPARE_BASE_URL)} should be set and start with a well-formed GUID, not "${cookieB?.value || '(not set)'}"`).toBe(true);

        expect.soft(cookieA?.sameSite, `CurrentContact SameSite policy should match between ${hostLabel(page.url())} ("${cookieA?.sameSite}") and ${hostLabel(COMPARE_BASE_URL)} ("${cookieB?.sameSite}")`).toBe(cookieB?.sameSite);
    });

    test('Environment Compare - robots.txt Sitemap: lines point at their own domain', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'robots.txt is device-independent.');

        async function pointsAtOwnDomain(base) {
            const res = await fetch(new URL('/robots.txt', base).toString());
            const text = await res.text();
            const sitemapLines = [...text.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
            const ownHost = hostLabel(base);
            return sitemapLines.length > 0 && sitemapLines.every((line) => hostLabel(line) === ownHost);
        }

        expect.soft(await pointsAtOwnDomain(baseURL), `${hostLabel(baseURL)}'s robots.txt Sitemap: lines should point at its own domain, not another environment's`).toBe(true);
        expect.soft(await pointsAtOwnDomain(COMPARE_BASE_URL), `${hostLabel(COMPARE_BASE_URL)}'s robots.txt Sitemap: lines should point at its own domain, not another environment's`).toBe(true);
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

        // Unlike CareUK, RSC's homepage renders NO JSON-LD structured data on either environment
        // as of 2026-09-02 - so this soft-compares the COUNT for parity rather than asserting
        // it's greater than zero, since "zero on both" is this site's real baseline.
        expect.soft(a.jsonLdCount, `JSON-LD structured-data block count should match between ${hostLabel(baseURL)} (${a.jsonLdCount}) and ${hostLabel(COMPARE_BASE_URL)} (${b.jsonLdCount})`).toBe(b.jsonLdCount);
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
            for (const path of KEY_PATHS_FOR_CONSOLE_SWEEP) {
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

        for (let i = 0; i < KEY_PATHS_FOR_CONSOLE_SWEEP.length; i += 1) {
            expect.soft(resultsA[i].brokenImages, `${resultsA[i].path} should have no broken images on ${hostLabel(baseURL)}`).toBe(0);
            expect.soft(resultsB[i].brokenImages, `${resultsB[i].path} should have no broken images on ${hostLabel(COMPARE_BASE_URL)}`).toBe(0);
        }
    });
});
