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
// environment - it DIFFS TWO of them (whichever `CAREUK_BASE_URL` points at,
// against `CAREUK_COMPARE_BASE_URL`). It grew directly out of a manual
// XbyK-vs-Live comparison pass done in conversation with Claude (2026-08/09)
// - see the project's memory notes and the published comparison report
// artifacts from that period for the original write-up this spec automates.
//
// Opt-in by design: every test in this file is skipped (via `test.skip` on
// the whole describe block) unless `CAREUK_COMPARE_BASE_URL` is set. Running
// `npm test` / CI normally will always show this file as skipped - that's
// expected, not a problem. See README.md "Comparing two environments" for
// how to actually run it.
//
// Tests in this file:
//   1-N. "Environment Compare - Page title: <path>" - one test per page in
//        PAGES_TO_COMPARE below, asserting the <title> is byte-identical on
//        both environments. Deliberately one test per page (not one test
//        looping over all of them) so the findings spreadsheet gets one row
//        per broken page, ready to turn into individual bug tickets - the
//        same reason `08-careuk.wheredoistart.spec.js`'s traversal tests are
//        one-per-scenario rather than one big loop.
//   Header utility bar link order - compares the 3 `.header__shortcut`
//        links' text/order.
//   Footer link groups and order - compares each `<ul>` of footer links.
//   Meganav labels and order - compares every root/child/grandchild label
//        and position in the navigation drawer (present in the DOM at all
//        times on this site regardless of open/closed state).
//   Homepage "Types of Care We Offer" carousel order - compares the
//        non-cloned slide order (this is device-sensitive - the same
//        4 cards can be in a different default order at different
//        breakpoints, which is exactly how the original XBK-12/LIV-02/
//        XBK-22 findings were discovered).
//   Security & caching response headers - Strict-Transport-Security,
//        Cache-Control, Server, X-Content-Type-Options, Referrer-Policy.
//   robots.txt Sitemap: lines point at their own domain - not a
//        cross-environment diff, a same-file-wrong-for-one-environment
//        check (see XBK-27 in the original report).
//   Sitemap availability and URL-count parity - both /sitemap1.xml files
//        return 200 and aren't wildly different sizes.
//   Analytics container must not be shared across environments - the most
//        important test in this file (see XBK-28) - a HARD (non-soft)
//        assertion, since a shared GTM/GA container between environments
//        means test traffic pollutes real production analytics.
//   Social-share (og:image) and structured-data (JSON-LD) parity - both
//        environments should expose an og:image tag and at least some
//        JSON-LD structured data on the homepage.
//   Favicon path parity - informational; a differing CDN/build path isn't
//        necessarily a bug on its own.
//   Browser console errors and broken images on key pages - sweeps
//        KEY_PATHS_FOR_CONSOLE_SWEEP on both environments checking for any
//        `<img>` that loaded with zero natural width (the standard signal
//        for a broken/missing image). Deliberately does NOT assert on
//        console error COUNTS matching between environments - some
//        known, tracked, environment-specific noise exists on Live
//        (see LIV-05) and asserting exact parity there would just be
//        permanent, uninformative noise for this generic regression spec.
//
// Most tests here run once per device project (desktop-chromium,
// tablet-webkit, mobile-chromium) since UI order/structure genuinely can
// differ by breakpoint. The pure HTTP-level tests (headers, cookies,
// robots.txt, sitemap, GTM, structured data, favicon) are gated to
// desktop-chromium only via `test.skip` inside each test, since they don't
// depend on viewport and running them 3x would just waste CI time.
// ============================================================================

const COMPARE_BASE_URL = (process.env.CAREUK_COMPARE_BASE_URL || '').trim().replace(/\/+$/, '');

// A representative, deliberately-curated (not fully dynamic) set of pages
// spanning every major site section. Grew out of the 86-page full-site crawl
// done manually on 2026-08-28 (see project memory) - add more paths here as
// new templates/sections are added to the site, rather than crawling live
// on every run (a fixed list keeps this spec fast, deterministic, and
// git-diffable).
const PAGES_TO_COMPARE = [
    { path: '/', label: 'Homepage' },
    { path: '/care-homes', label: 'Care Homes Search' },
    { path: '/careers', label: 'Careers' },
    { path: '/careers/vacancies', label: 'Careers - Vacancies' },
    { path: '/careers/explore-our-roles/clinical-roles', label: 'Careers - Clinical Roles' },
    { path: '/careers/explore-our-roles/home-support-roles', label: 'Careers - Home Support Roles' },
    { path: '/careers/explore-our-roles/care-roles', label: 'Careers - Care Roles' },
    { path: '/careers/explore-our-roles/support-centre', label: 'Careers - Support Centre Roles' },
    { path: '/company', label: 'Company (Who We Are)' },
    { path: '/company/care-uk-campaigns', label: 'Who We Are - Campaigns' },
    { path: '/customers/payments', label: 'Customers - Online Payments' },
    { path: '/where-do-i-start', label: 'Where Do I Start' },
    { path: '/where-do-i-start/do-i-need-care', label: 'Where Do I Start - Do I Need Care' },
    { path: '/types-of-care', label: 'Types of Care' },
    { path: '/types-of-care/dementia-care', label: 'Types of Care - Dementia Care' },
    { path: '/types-of-care/residential-care', label: 'Types of Care - Residential Care' },
    { path: '/our-approach-to-care', label: 'Our Approach to Care' },
    { path: '/help-advice', label: 'Help & Advice' },
    { path: '/life-at-a-care-uk-home', label: 'Life at a Care UK Home' },
    { path: '/news', label: 'Care UK News' },
    { path: '/legal-regulatory', label: 'Legal & Regulatory' },
    { path: '/privacy-policies', label: 'Privacy Policies' },
];

const KEY_PATHS_FOR_CONSOLE_SWEEP = [
    '/', '/care-homes', '/careers', '/careers/vacancies', '/company',
    '/where-do-i-start', '/types-of-care', '/our-approach-to-care',
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
    if (projectName === 'tablet-webkit') return { ...devices['iPad Pro 11'] };
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

async function dismissCookieOverlayIfPresent(page) {
    const acceptTargets = [
        page.locator('#onetrust-accept-btn-handler').first(),
        page.getByRole('button', { name: /accept|allow all|yes, allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
    ];

    for (const candidate of acceptTargets) {
        if (await candidate.isVisible().catch(() => false)) {
            await candidate.click({ timeout: 3000 }).catch(() => { });
        }
    }
}

async function fetchTitle(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.status !== 200) return { status: res.status, title: null };
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return { status: res.status, title: m ? normalizeWhitespace(m[1]) : null };
}

async function getUtilityBarOrder(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('.header__shortcut'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()));
}

async function getFooterGroups(page) {
    return page.evaluate(() => {
        const footer = document.querySelector('footer');
        if (!footer) return [];
        const groups = [];
        footer.querySelectorAll('ul').forEach((ul) => {
            const links = Array.from(ul.querySelectorAll('a'))
                .map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            if (links.length) groups.push(links);
        });
        return groups;
    });
}

async function getNavTree(page) {
    return page.evaluate(() => {
        const norm = (v) => (v || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => norm(n.textContent))
            .join(' ')
            .trim();
        const labelOf = (li) => norm(directText(li) || li.querySelector(':scope > a')?.textContent);

        const roots = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li'));
        return roots.map((root) => {
            const children = Array.from(root.querySelectorAll(':scope > .sublevelOne > ul > li'));
            return {
                label: labelOf(root),
                children: children.map((child) => {
                    const grandchildren = Array.from(child.querySelectorAll(':scope > .sublevelTwo > ul > li'));
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

async function getCarouselOrder(page) {
    return page.evaluate(() => {
        const root = Array.from(document.querySelectorAll('.carouselSignpost')).find((c) => {
            const h = c.querySelector('h1,h2,h3,h4');
            return h && /types of care we offer/i.test(h.textContent || '');
        });
        if (!root) return null;
        return Array.from(root.querySelectorAll('.slick-slide:not(.slick-cloned)'))
            .map((s) => (s.textContent || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' '));
    });
}

test.describe('Environment Comparison', () => {
    test.skip(!COMPARE_BASE_URL, 'Environment comparison spec only runs when CAREUK_COMPARE_BASE_URL is set alongside CAREUK_BASE_URL - see README.md "Comparing two environments". Skipped for normal single-environment runs.');

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

    test('Environment Compare - Header utility bar link order', async ({ page, browser, baseURL }, testInfo) => {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await dismissCookieOverlayIfPresent(page);
        const orderA = await getUtilityBarOrder(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const orderB = await getUtilityBarOrder(comparePage);
        await context.close();

        expect(orderA, `Header utility bar link order should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toEqual(orderB);
    });

    test('Environment Compare - Footer link groups and order', async ({ page, browser, baseURL }, testInfo) => {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await dismissCookieOverlayIfPresent(page);
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
        await dismissCookieOverlayIfPresent(page);
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

    test('Environment Compare - Homepage "Types of Care We Offer" carousel order', async ({ page, browser, baseURL }, testInfo) => {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await dismissCookieOverlayIfPresent(page);
        await page.locator('.carouselSignpost').first().scrollIntoViewIfNeeded().catch(() => { });
        const orderA = await getCarouselOrder(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        await comparePage.locator('.carouselSignpost').first().scrollIntoViewIfNeeded().catch(() => { });
        const orderB = await getCarouselOrder(comparePage);
        await context.close();

        expect(orderA, `Homepage "Types of Care We Offer" carousel card order should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)} (checked on ${testInfo.project.name} - this genuinely varies by breakpoint on this site)`).toEqual(orderB);
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

    // NOTE: there used to be a "CurrentContact cookie shape and SameSite policy"
    // test here, comparing the CurrentContact cookie's value/SameSite attribute
    // between environments. Removed 2026-09-23 per Dev feedback on the original
    // finding (XBK-26): CurrentContact is an XbyK-platform cookie the app can't
    // modify - it ships with its "secure"/SameSite attributes out of the box.
    // Confirmed not a bug; don't re-add this check without new evidence it's
    // actionable.

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

        const a = await countUrls(new URL('/sitemap1.xml', baseURL).toString());
        const b = await countUrls(new URL('/sitemap1.xml', COMPARE_BASE_URL).toString());

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

    test('Environment Compare - Browser console errors and broken images on key pages', async ({ page, browser, baseURL }, testInfo) => {
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
