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
// environment - it DIFFS TWO of them (whichever `NPL_BASE_URL` points at,
// against `NPL_COMPARE_BASE_URL`). It mirrors the equivalent file built for
// the CareUK sibling project (XbyK-vs-Live, 2026-08/09 - see that project's
// `15-careuk.envcompare.spec.js` and its README "Comparing two environments"
// section for the original manual investigative pass this pattern grew out
// of), adapted to NPL's own real DOM structure (confirmed directly against
// npl.co.uk on 2026-09-02 - see below).
//
// Opt-in by design: every test in this file is skipped (via `test.skip` on
// the whole describe block) unless `NPL_COMPARE_BASE_URL` is set. Running
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
//   Header quick-links order - compares the `.header-main__quick-links`
//        list's link text/order (Careers, Contact as of 2026-09-02).
//   Footer link list and order - compares the `.footer__links-list` links'
//        text/order (a single list on this site, unlike CareUK's multiple
//        footer link groups).
//   Meganav labels and order - compares every level1 (6 top-level items)
//        and level2 (link/heading) label and position across the navigation
//        drawer, reusing the confirmed `.nav-main__level1-item` /
//        `.nav-main__level2-item` structure from `02-npl.meganav.spec.js`.
//        NPL's meganav is a flat two-level structure (no level3 tier, unlike
//        CareUK's three-level meganav) - confirmed directly in the DOM.
//   NOTE: no homepage carousel test - NPL's homepage
//        (`01-npl.homepage.spec.js`) has no rotating carousel/slider
//        component, so there's nothing here to diff (CareUK's equivalent
//        file has one; this omission is deliberate, not an oversight).
//   Security & caching response headers - Strict-Transport-Security,
//        Cache-Control, Server, X-Content-Type-Options, Referrer-Policy.
//   CurrentContact cookie shape and SameSite policy - unlike CareUK, this
//        cookie is NOT set on the raw HTTP response (confirmed via curl -
//        NPL's Kentico CMS sets it client-side), so this test opens a real
//        browser page on each environment and reads it from
//        `page.context().cookies()` instead of a plain fetch. Checks the
//        cookie VALUE is a clean GUID on each environment, and that
//        SameSite matches between them (both confirmed "Lax" on 2026-09-02).
//   robots.txt Sitemap: lines point at their own domain - not a
//        cross-environment diff, a same-file-wrong-for-one-environment
//        check. NOTE: NPL's UAT robots.txt (confirmed 2026-09-02) is just
//        `Disallow: /` with NO `Sitemap:` line at all (correctly keeping a
//        non-production environment out of search engines) - this test
//        treats an environment with zero Sitemap: lines as passing this
//        specific check (nothing points at the WRONG domain), it only fails
//        when a Sitemap: line exists and points somewhere else.
//   Sitemap availability and URL-count parity - both /sitemap.xml files
//        return 200 and aren't wildly different sizes.
//   Analytics container must not be shared across environments - the most
//        important test in this file - a HARD (non-soft) assertion, since a
//        shared GTM/GA container between environments means test traffic
//        pollutes real production analytics. CONFIRMED REAL DEFECT
//        (2026-09-02): UAT and Live both fire into the SAME GTM container
//        (GTM-TKRL77R) - this test is expected to genuinely FAIL against
//        real NPL infrastructure right now, mirroring the CareUK XBK-28
//        finding. That's a live, unresolved bug, not a spec problem.
//   Social-share (og:image) and structured-data (JSON-LD) parity - both
//        environments should expose an og:image tag on the homepage.
//        NOTE: NPL's homepage (and every other page checked) has ZERO
//        JSON-LD structured data (confirmed 2026-09-02, unlike CareUK which
//        has some) - so unlike CareUK's version, this test does NOT assert
//        JSON-LD presence as a requirement, it only asserts JSON-LD COUNT
//        PARITY between the two environments (both being 0 is a pass).
//   Favicon path parity - informational; a differing CDN/build path isn't
//        necessarily a bug on its own.
//   Broken images on key pages - sweeps KEY_PATHS_FOR_CONSOLE_SWEEP on both
//        environments checking for any `<img>` that loaded with zero natural
//        width (the standard signal for a broken/missing image).
//
// Most tests here run once per device project (desktop-chromium,
// tablet-webkit, mobile-chromium) since UI order/structure genuinely can
// differ by breakpoint. The pure HTTP-level tests (headers, robots.txt,
// sitemap, GTM, structured data, favicon) are gated to desktop-chromium only
// via `test.skip` inside each test, since they don't depend on viewport and
// running them 3x would just waste CI time. The cookie test also runs
// desktop-chromium only, even though it drives a real browser (cookies set
// on first load are device-independent here too).
// ============================================================================

const COMPARE_BASE_URL = (process.env.NPL_COMPARE_BASE_URL || '').trim().replace(/\/+$/, '');

// A representative, deliberately-curated (not fully dynamic) set of pages
// spanning every major site section, confirmed to resolve with a 200 on Live
// on 2026-09-02. Add more paths here as new templates/sections are added to
// the site, rather than crawling live on every run (a fixed list keeps this
// spec fast, deterministic, and git-diffable).
const PAGES_TO_COMPARE = [
    { path: '/', label: 'Homepage' },
    { path: '/research', label: 'Research and Science' },
    { path: '/research/acoustics', label: 'Research - Acoustics' },
    { path: '/products-services', label: 'Products and Services' },
    { path: '/products-services/calibration', label: 'Products and Services - Calibration' },
    { path: '/products-services/consultancy', label: 'Products and Services - Consultancy' },
    { path: '/ntc', label: 'Strategic Programmes - National Timing Centre' },
    { path: '/about-us', label: 'About NPL' },
    { path: '/about-us/history', label: 'About NPL - History' },
    { path: '/news', label: 'News and Events - News' },
    { path: '/events', label: 'News and Events - Events' },
    { path: '/careers', label: 'Careers' },
    { path: '/contact', label: 'Contact' },
    { path: '/search', label: 'Site Search' },
    { path: '/health-safety-and-environment', label: 'HSE' },
    { path: '/quality', label: 'Quality' },
    { path: '/privacy-notice', label: 'Privacy Notice' },
    { path: '/privacy-notice/cookies', label: 'Cookies' },
    { path: '/terms-conditions', label: 'Terms' },
    { path: '/accessibility', label: 'Accessibility' },
    { path: '/anti-slavery-and-ethics', label: 'Anti-slavery and Ethics' },
];

const KEY_PATHS_FOR_CONSOLE_SWEEP = [
    '/', '/research', '/products-services', '/about-us', '/news', '/careers', '/contact',
];

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

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
    if (projectName === 'tablet-webkit') return { ...devices['iPad Pro 11'] };
    if (projectName === 'mobile-chromium') return { ...devices['Pixel 7'] };
    return { ...devices['Desktop Chrome'] };
}

// NPL's OneTrust accept button renders before its click handler finishes attaching -
// clicking the instant it's visible silently no-ops, so this retries until dismissed.
// Same pattern used across every other NPL spec file (see 02-npl.meganav.spec.js).
async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (!(await cookieOverlay.isVisible().catch(() => false))) {
        return;
    }

    const acceptAllButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await acceptAllButton.isVisible().catch(() => false)) {
        await expect.poll(async () => {
            await acceptAllButton.click({ force: true, timeout: 2000 }).catch(() => {});
            return await cookieOverlay.isVisible().catch(() => false);
        }, {
            message: 'Cookie overlay should be dismissed after accepting',
            timeout: 8000,
            intervals: [300, 500, 1000],
        }).toBe(false).catch(() => {});
        return;
    }

    await page.keyboard.press('Escape').catch(() => {});
}

async function openHomepage(page, base) {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await expect.poll(async () => {
            await cookieButton.click({ force: true, timeout: 2000 }).catch(() => {});
            return await cookieButton.isVisible().catch(() => false);
        }, {
            message: 'Cookie banner should be dismissed after accepting',
            timeout: 8000,
            intervals: [300, 500, 1000],
        }).toBe(false).catch(() => {});
    }
    await dismissCookieOverlayIfPresent(page);
}

async function openComparePage(browser, testInfo) {
    const context = await browser.newContext(deviceOptionsForProject(testInfo.project.name));
    const comparePage = await context.newPage();
    await openHomepage(comparePage, COMPARE_BASE_URL);
    return { context, comparePage };
}

async function fetchTitle(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.status !== 200) return { status: res.status, title: null };
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return { status: res.status, title: m ? normalizeWhitespace(m[1]) : null };
}

async function getQuickLinksOrder(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('.header-main__quick-links a'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean));
}

async function getFooterLinkOrder(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('.footer__links-list a'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean));
}

// Reuses the confirmed level1/level2 structure from 02-npl.meganav.spec.js: 6 top-level
// items, each with a panel containing one or more `.nav-main__level2` column lists of
// `.nav-main__level2-item` entries (some headings, most links). No level3 tier exists on
// this site (confirmed directly in the DOM) - unlike CareUK's three-level meganav.
async function getNavTree(page) {
    return page.evaluate(() => {
        const norm = (v) => (v || '').replace(/\s+/g, ' ').trim();

        const roots = Array.from(document.querySelectorAll('.nav-main__level1-item'));
        return roots.map((root) => {
            const control = root.querySelector(':scope > a.nav-main__control, :scope a.nav-main__control');
            const label = norm(control ? control.textContent : '');
            const children = Array.from(root.querySelectorAll('.nav-main__level2-item')).map((item) => norm(item.textContent));
            return { label, children };
        });
    });
}

function flattenNavTree(tree) {
    const out = [];
    tree.forEach((root, i) => {
        out.push({ key: `${i}`, label: root.label });
        (root.children || []).forEach((child, j) => {
            out.push({ key: `${i}.${j}`, label: child });
        });
    });
    return out;
}

test.describe('Environment Comparison', () => {
    test.skip(!COMPARE_BASE_URL, 'Environment comparison spec only runs when NPL_COMPARE_BASE_URL is set alongside NPL_BASE_URL - see README.md "Comparing two environments". Skipped for normal single-environment runs.');

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

    test('Environment Compare - Header quick-links order', async ({ page, browser, baseURL }, testInfo) => {
        await openHomepage(page, baseURL);
        const orderA = await getQuickLinksOrder(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const orderB = await getQuickLinksOrder(comparePage);
        await context.close();

        expect(orderA, `Header quick-links order should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toEqual(orderB);
    });

    test('Environment Compare - Footer link list and order', async ({ page, browser, baseURL }, testInfo) => {
        await openHomepage(page, baseURL);
        const linksA = await getFooterLinkOrder(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const linksB = await getFooterLinkOrder(comparePage);
        await context.close();

        expect.soft(linksA.length, `Footer should expose the same number of links on ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)} (NPL's UAT footer legitimately has 1 extra "Share your feedback" link as of 2026-07-30 - see 03-npl.footer.spec.js - so a count mismatch here isn't necessarily a new defect)`).toBe(linksB.length);

        const count = Math.min(linksA.length, linksB.length);
        for (let i = 0; i < count; i += 1) {
            expect.soft(linksA[i], `Footer link at position ${i + 1} should match on ${hostLabel(baseURL)} vs ${hostLabel(COMPARE_BASE_URL)}`).toBe(linksB[i]);
        }
    });

    test('Environment Compare - Meganav labels and order', async ({ page, browser, baseURL }, testInfo) => {
        await openHomepage(page, baseURL);
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

        expect.soft(treeA.length, `Meganav should expose the same number of menu items (top-level + panel items) on ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(treeB.length);
    });

    test('Environment Compare - Security & caching response headers', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'HTTP headers are device-independent - only needs to run once.');

        const [resA, resB] = await Promise.all([fetch(baseURL), fetch(COMPARE_BASE_URL)]);
        const labelA = hostLabel(baseURL);
        const labelB = hostLabel(COMPARE_BASE_URL);

        ['strict-transport-security', 'cache-control', 'x-content-type-options', 'referrer-policy'].forEach((name) => {
            const a = resA.headers.get(name);
            const b = resB.headers.get(name);
            expect.soft(a, `${name} header should be present/absent the same way on both environments (${labelA}: "${a || 'absent'}" vs ${labelB}: "${b || 'absent'}")`).toBe(b);
        });

        // "Server" is expected to legitimately differ here (Live: "PALSS ..." vs UAT: "PAC ...",
        // confirmed 2026-09-02 - different hosting layers in front of the same app) so it's
        // reported informationally rather than asserted equal, unlike the other headers above.
        const serverA = resA.headers.get('server');
        const serverB = resB.headers.get('server');
        test.info().annotations.push({ type: 'info', description: `Server header - ${labelA}: "${serverA || 'absent'}" vs ${labelB}: "${serverB || 'absent'}" (expected to differ - informational only)` });
    });

    test('Environment Compare - CurrentContact cookie shape and SameSite policy', async ({ page, browser, baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Cookies set on first load are device-independent.');

        // Unlike CareUK, this cookie is set client-side (not on the raw HTTP response -
        // confirmed via curl), so this drives a real browser page on each environment instead
        // of a plain fetch.
        await openHomepage(page, baseURL);
        const cookiesA = await page.context().cookies();

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const cookiesB = await comparePage.context().cookies();
        await context.close();

        const cookieA = cookiesA.find((c) => c.name === 'CurrentContact');
        const cookieB = cookiesB.find((c) => c.name === 'CurrentContact');

        expect.soft(Boolean(cookieA), `CurrentContact cookie should be set on ${hostLabel(baseURL)}`).toBe(true);
        expect.soft(Boolean(cookieB), `CurrentContact cookie should be set on ${hostLabel(COMPARE_BASE_URL)}`).toBe(true);

        if (cookieA) {
            expect.soft(/^[0-9a-f-]{36}$/i.test(cookieA.value || ''), `CurrentContact cookie value on ${hostLabel(baseURL)} should be a clean GUID with nothing appended, not "${cookieA.value}"`).toBe(true);
        }
        if (cookieB) {
            expect.soft(/^[0-9a-f-]{36}$/i.test(cookieB.value || ''), `CurrentContact cookie value on ${hostLabel(COMPARE_BASE_URL)} should be a clean GUID with nothing appended, not "${cookieB.value}"`).toBe(true);
        }

        if (cookieA && cookieB) {
            expect.soft(String(cookieA.sameSite || '').toLowerCase(), `CurrentContact SameSite policy should match between ${hostLabel(baseURL)} ("${cookieA.sameSite}") and ${hostLabel(COMPARE_BASE_URL)} ("${cookieB.sameSite}")`).toBe(String(cookieB.sameSite || '').toLowerCase());
        }
    });

    test('Environment Compare - robots.txt Sitemap: lines point at their own domain', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'robots.txt is device-independent.');

        // An environment with NO Sitemap: line at all (e.g. NPL's UAT, which is just
        // "Disallow: /" as of 2026-09-02 - correctly keeping a non-prod env out of search
        // engines) passes this check: nothing there points at the WRONG domain. This only
        // fails when a Sitemap: line exists and points somewhere other than its own host.
        async function pointsAtOwnDomainOrIsAbsent(base) {
            const res = await fetch(new URL('/robots.txt', base).toString());
            const text = await res.text();
            const sitemapLines = [...text.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
            const ownHost = hostLabel(base);
            return sitemapLines.length === 0 || sitemapLines.every((line) => hostLabel(line) === ownHost);
        }

        expect.soft(await pointsAtOwnDomainOrIsAbsent(baseURL), `${hostLabel(baseURL)}'s robots.txt Sitemap: line(s) (if any) should point at its own domain, not another environment's`).toBe(true);
        expect.soft(await pointsAtOwnDomainOrIsAbsent(COMPARE_BASE_URL), `${hostLabel(COMPARE_BASE_URL)}'s robots.txt Sitemap: line(s) (if any) should point at its own domain, not another environment's`).toBe(true);
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

        // NPL's homepage has NO JSON-LD structured data on either environment (confirmed
        // 2026-09-02, unlike CareUK which has some) - so this only checks the COUNT matches
        // between environments (both being 0 is a pass), it doesn't require JSON-LD to exist.
        expect.soft(a.jsonLdCount, `Homepage JSON-LD structured-data block count should match between ${hostLabel(baseURL)} (${a.jsonLdCount}) and ${hostLabel(COMPARE_BASE_URL)} (${b.jsonLdCount})`).toBe(b.jsonLdCount);
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
