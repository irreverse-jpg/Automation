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
// environment - it DIFFS TWO of them (whichever `WITHERS_BASE_URL` points at,
// against `WITHERS_COMPARE_BASE_URL`). It mirrors the equivalent spec built
// for the CareUK sibling project (`15-careuk.envcompare.spec.js`), which grew
// out of a manual UAT2-vs-Live comparison pass done in conversation with
// Claude - this file automates the same class of checks for
// withersworldwide.com, adapted to this site's own markup/selectors.
//
// Opt-in by design: every test in this file is skipped (via `test.skip` on
// the whole describe block) unless `WITHERS_COMPARE_BASE_URL` is set. Running
// `npm test` / CI normally will always show this file as skipped - that's
// expected, not a problem. See README.md "Comparing two environments" for
// how to actually run it.
//
// A note on baseURL shape: this project's `baseURL` already includes an
// `/en-gb` locale segment (e.g. `https://w-uat.hosted.positive.co.uk/en-gb`),
// unlike CareUK's root-domain baseURL. Every path below is written WITHOUT a
// leading slash and joined against `${baseURL}/` so it resolves relative to
// that locale segment instead of replacing it - a leading-slash path here
// would silently drop `/en-gb` and hit the wrong (default English-US /
// unlocalized) route.
//
// Tests in this file:
//   1-N. "Environment Compare - Page title: <path>" - one test per page in
//        PAGES_TO_COMPARE below, asserting the <title> is byte-identical on
//        both environments. Deliberately one test per page (not one test
//        looping over all of them) so the findings spreadsheet gets one row
//        per broken page, ready to turn into individual bug tickets. This
//        already surfaced a real difference during manual validation: the
//        homepage title itself differs between UAT ("The law firm for
//        success | Withersworldwide") and Live ("International Law Firm |
//        International Lawyers | Withers") - worth confirming whether that's
//        an intentional Live-only rebrand or a stale UAT title before
//        treating every homepage-title mismatch here as informational.
//   Header banner links order - compares the primary banner's Home/Contact/
//        Newsroom/Insight-style link order (this site has no separate
//        small "utility bar" the way CareUK does - the banner IS the
//        equivalent fixed link set).
//   Footer link groups and order - compares each `<ul>` of footer links
//        inside the `contentinfo` landmark, reusing the same footer-link
//        discovery approach as `03-withers.footer.spec.js`.
//   Meganav top-level and second-level labels and order - compares the
//        primary navigation's `label.header__navLink` items (top-level:
//        Experience/Locations/Insight/About) and, for each, its directly
//        nested second-level `label.header__navLink` items, read directly
//        from the DOM rather than by expanding the checkbox-driven menu
//        (the labels/inputs exist in the DOM regardless of open/closed
//        state, matching the pattern already used by
//        `02-withers.meganav.spec.js`'s `resolveVisibleNavInputId`).
//   No homepage carousel comparison - unlike CareUK's homepage, Withers's
//        homepage doesn't have an equivalent rotating multi-card carousel
//        (only a hero region, excluded from H1-count checks via
//        `.hero--carousel` in `14-withers.nonfunctional.spec.js`, but not a
//        reorderable list of content cards) - so this check is intentionally
//        omitted rather than forced onto a component that doesn't exist.
//   Security & caching response headers - Strict-Transport-Security,
//        Cache-Control, Server, X-Content-Type-Options, Referrer-Policy.
//   No cookie-shape comparison - manual validation (2026-09-02) found
//        neither environment sets any cookie on the initial HTML response
//        (no `Set-Cookie` header at all), so there's no first-party session/
//        tracking cookie to compare shape/SameSite policy for - omitted
//        rather than fabricated. If a cookie is added later, add a test
//        here mirroring CareUK's CurrentContact cookie check.
//   robots.txt Sitemap: lines point at their own domain - not a
//        cross-environment diff, a same-file-wrong-for-one-environment
//        check. Manual validation found UAT's robots.txt is a blanket
//        `Disallow: /` with no `Sitemap:` line at all (expected for a
//        non-production environment meant to stay out of search engines),
//        so this test treats a fully-disallowed environment with no
//        Sitemap: line as fine, and only flags a Sitemap: line that points
//        at the WRONG domain.
//   Sitemap availability and URL-count parity - both `/sitemap.xml` files
//        return 200 and aren't wildly different sizes.
//   Analytics container must not be shared across environments - the most
//        important test in this file - a HARD (non-soft) assertion, since a
//        shared GTM/GA container between environments means test traffic
//        pollutes real production analytics. Manual validation (2026-09-02)
//        found this is CURRENTLY TRUE for Withers: both UAT
//        (w-uat.hosted.positive.co.uk) and Live (www.withersworldwide.com)
//        fire into the same `GTM-MQDLX2V` container - this test is expected
//        to genuinely FAIL until that's fixed, exactly the kind of finding
//        this spec exists to catch automatically going forward.
//   Social-share (og:image) and structured-data (JSON-LD) parity - both
//        environments should expose an og:image tag and at least some
//        JSON-LD structured data on the homepage.
//   Favicon path parity - informational; a differing CDN/build path isn't
//        necessarily a bug on its own.
//   Broken images on key pages - sweeps KEY_PATHS_FOR_IMAGE_SWEEP on both
//        environments checking for any `<img>` that loaded with zero
//        natural width (the standard signal for a broken/missing image).
//
// Most tests here run once per device project (desktop-chromium,
// tablet-webkit, mobile-chromium) since UI order/structure genuinely can
// differ by breakpoint. The pure HTTP-level tests (headers, robots.txt,
// sitemap, GTM, structured data, favicon, page titles) are gated to
// desktop-chromium only via `test.skip` inside each test, since they don't
// depend on viewport and running them 3x would just waste CI time.
// ============================================================================

const COMPARE_BASE_URL = (process.env.WITHERS_COMPARE_BASE_URL || '').trim().replace(/\/+$/, '');

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

// A representative, deliberately-curated (not fully dynamic) set of pages
// spanning every major site section, gathered from the paths already
// exercised across this project's other spec files (meganav, footer,
// homepage, about, careers, insight, contact, search). Add more paths here
// as new templates/sections are added to the site, rather than crawling
// live on every run (a fixed list keeps this spec fast, deterministic, and
// git-diffable). Paths are written WITHOUT a leading slash - see the
// baseURL-shape note above.
const PAGES_TO_COMPARE = [
    { path: '', label: 'Homepage' },
    { path: 'people', label: 'People' },
    { path: 'careers', label: 'Careers' },
    { path: 'careers/recruitment-enquiries', label: 'Careers - Recruitment Enquiries' },
    { path: 'locations', label: 'Locations' },
    { path: 'locations/north-america', label: 'Locations - North America' },
    { path: 'insight', label: 'Insight' },
    { path: 'insight/newsroom', label: 'Insight - Newsroom' },
    { path: 'about', label: 'About' },
    { path: 'about/responsible-business', label: 'About - Responsible Business' },
    { path: 'about/sustainable-development-goals', label: 'About - Sustainable Development Goals' },
    { path: 'about/diversity-equity-and-inclusion', label: 'About - Diversity, Equity and Inclusion' },
    { path: 'about/environmental-responsibility', label: 'About - Environmental Responsibility' },
    { path: 'about/environmental-responsibility/reducing-our-impact', label: 'About - Reducing Our Impact' },
    { path: 'about/our-pro-bono-commitment', label: 'About - Our Pro Bono Commitment' },
    { path: 'about/our-clients', label: 'About - Our Clients' },
    { path: 'experience', label: 'Experience' },
    { path: 'experience/our-practices', label: 'Experience - Our Practices' },
    { path: 'contact-us', label: 'Contact Us' },
    { path: 'search', label: 'Site Search' },
];

const KEY_PATHS_FOR_IMAGE_SWEEP = [
    '', 'people', 'careers', 'locations', 'insight', 'about', 'experience', 'contact-us',
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

// Resolves `path` (no leading slash) relative to `base` while preserving
// any locale segment already present in `base` (e.g. `/en-gb`) - a plain
// `new URL(path, base)` with a leading-slash path would replace that
// segment entirely. See the "baseURL shape" note in the coverage box above.
function resolveUrl(path, base) {
    const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
    return new URL(path, baseWithSlash).toString();
}

function deviceOptionsForProject(projectName) {
    if (projectName === 'tablet-webkit') return { ...devices['iPad Pro 11'], browserName: 'chromium' };
    if (projectName === 'mobile-chromium') return { ...devices['Pixel 7'] };
    return { ...devices['Desktop Chrome'] };
}

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (!(await cookieOverlay.isVisible().catch(() => false))) {
        return;
    }

    const acceptAllButton = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept all cookies")').first();
    if (await acceptAllButton.isVisible().catch(() => false)) {
        await acceptAllButton.click({ force: true }).catch(async () => {
            await acceptAllButton.evaluate((button) => button.click());
        });
        return;
    }

    const closeButton = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button[aria-label="Close"]').first();
    if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click().catch(() => { });
    } else {
        await page.keyboard.press('Escape').catch(() => { });
    }
}

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click({ timeout: 2000 }).catch(() => { });
    }

    await dismissCookieOverlayIfPresent(page);
}

async function openComparePage(browser, testInfo) {
    const context = await browser.newContext(deviceOptionsForProject(testInfo.project.name));
    const comparePage = await context.newPage();
    await comparePage.goto(COMPARE_BASE_URL, { waitUntil: 'domcontentloaded' });
    await acceptCookiesIfPresent(comparePage);
    return { context, comparePage };
}

async function fetchTitle(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.status !== 200) return { status: res.status, title: null };
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return { status: res.status, title: m ? normalizeWhitespace(m[1]) : null };
}

async function getBannerLinkOrder(page) {
    return page.evaluate(() => {
        const banner = document.querySelector('[role="banner"], header');
        if (!banner) return [];
        return Array.from(banner.querySelectorAll('a'))
            .filter((a) => {
                const style = window.getComputedStyle(a);
                const rect = a.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            })
            .map((a) => (a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean);
    });
}

async function getFooterGroups(page) {
    return page.evaluate(() => {
        const footer = document.querySelector('[role="contentinfo"], footer');
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

// Reads the meganav tree directly from the DOM (checkbox-driven labels are
// present regardless of open/closed responsive state), rather than clicking
// through - matching the underlying structure `02-withers.meganav.spec.js`
// drives interactively, but without needing to expand every branch.
async function getNavTree(page) {
    return page.evaluate(() => {
        const norm = (v) => (v || '').replace(/\s+/g, ' ').trim();
        const primaryNav = document.querySelector('nav[aria-label="Primary"], [role="navigation"][aria-label="Primary"]');
        if (!primaryNav) return [];

        const topLevelItems = Array.from(primaryNav.querySelectorAll(':scope > ul > li, :scope > div > ul > li'));
        const source = topLevelItems.length
            ? topLevelItems
            : Array.from(primaryNav.querySelectorAll('li')).filter((li) => li.querySelector(':scope > label.header__navLink'));

        return source
            .filter((li) => li.querySelector(':scope > label.header__navLink, :scope > a.header__navLink'))
            .map((li) => {
                const topLabel = li.querySelector(':scope > label.header__navLink, :scope > a.header__navLink');
                const label = norm(topLabel ? topLabel.textContent : '');
                const childLabels = Array.from(li.querySelectorAll('label.header__navLink, a.header__navLink'))
                    .filter((el) => el !== topLabel)
                    .map((el) => norm(el.textContent))
                    .filter(Boolean);
                return { label, children: childLabels };
            })
            .filter((item) => item.label);
    });
}

function flattenNavTree(tree) {
    const out = [];
    tree.forEach((root, i) => {
        out.push({ key: `${i}`, label: root.label });
        (root.children || []).forEach((childLabel, j) => {
            out.push({ key: `${i}.${j}`, label: childLabel });
        });
    });
    return out;
}

test.describe('Environment Comparison', () => {
    test.skip(!COMPARE_BASE_URL, 'Environment comparison spec only runs when WITHERS_COMPARE_BASE_URL is set alongside WITHERS_BASE_URL - see README.md "Comparing two environments". Skipped for normal single-environment runs.');

    for (const { path: pagePath, label } of PAGES_TO_COMPARE) {
        test(`Environment Compare - Page title: ${label}`, async ({ baseURL }, testInfo) => {
            test.skip(testInfo.project.name !== 'desktop-chromium', 'Page titles are device-independent - only needs to run once.');

            const [a, b] = await Promise.all([
                fetchTitle(resolveUrl(pagePath, baseURL)),
                fetchTitle(resolveUrl(pagePath, COMPARE_BASE_URL)),
            ]);

            expect(a.status, `${pagePath || '(homepage)'} should return the same HTTP status on ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(b.status);
            if (a.status === 200 && b.status === 200) {
                expect(a.title, `${pagePath || '(homepage)'} page title should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(b.title);
            }
        });
    }

    test('Environment Compare - Header banner link order', async ({ page, browser, baseURL }, testInfo) => {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        const orderA = await getBannerLinkOrder(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const orderB = await getBannerLinkOrder(comparePage);
        await context.close();

        expect(orderA, `Header banner link order should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toEqual(orderB);
    });

    test('Environment Compare - Footer link groups and order', async ({ page, browser, baseURL }, testInfo) => {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
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
        await acceptCookiesIfPresent(page);
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

        expect.soft(treeA.length, `Meganav should expose the same number of menu items (top-level+second-level) on ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(treeB.length);
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

        async function checkOwnDomain(base) {
            const res = await fetch(new URL('/robots.txt', base).toString());
            const text = await res.text();
            const disallowsEverything = /^Disallow:\s*\/\s*$/im.test(text) && !/^Allow:/im.test(text);
            const sitemapLines = [...text.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);

            if (sitemapLines.length === 0) {
                // A blanket "Disallow: /" with no Sitemap: line at all is expected on a
                // non-production environment deliberately kept out of search engines
                // (confirmed on UAT during manual validation, 2026-09-02) - not a bug.
                return { ok: disallowsEverything, sitemapLines };
            }

            const ownHost = hostLabel(base);
            return { ok: sitemapLines.every((line) => hostLabel(line) === ownHost), sitemapLines };
        }

        const resultA = await checkOwnDomain(baseURL);
        const resultB = await checkOwnDomain(COMPARE_BASE_URL);

        expect.soft(resultA.ok, `${hostLabel(baseURL)}'s robots.txt should either point its Sitemap: lines at its own domain, or (if fully disallowed) have none at all - found: ${resultA.sitemapLines.join(', ') || 'none'}`).toBe(true);
        expect.soft(resultB.ok, `${hostLabel(COMPARE_BASE_URL)}'s robots.txt should either point its Sitemap: lines at its own domain, or (if fully disallowed) have none at all - found: ${resultB.sitemapLines.join(', ') || 'none'}`).toBe(true);
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
                    await p.goto(resolveUrl(path, base), { waitUntil: 'load', timeout: 30000 });
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
            expect.soft(resultsA[i].brokenImages, `${KEY_PATHS_FOR_IMAGE_SWEEP[i] || '(homepage)'} should have no broken images on ${hostLabel(baseURL)}`).toBe(0);
            expect.soft(resultsB[i].brokenImages, `${KEY_PATHS_FOR_IMAGE_SWEEP[i] || '(homepage)'} should have no broken images on ${hostLabel(COMPARE_BASE_URL)}`).toBe(0);
        }
    });
});
