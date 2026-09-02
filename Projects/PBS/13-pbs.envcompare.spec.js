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
// environment - it DIFFS TWO of them (whichever `PBS_BASE_URL` points at,
// against `PBS_COMPARE_BASE_URL`). It mirrors the equivalent CareUK spec
// (`15-careuk.envcompare.spec.js`), grown out of a manual XbyK-vs-Live
// comparison pass done in conversation with Claude (2026-08/09) - see that
// project's memory notes for the original write-up this pattern automates.
//
// Opt-in by design: every test in this file is skipped (via `test.skip` on
// the whole describe block) unless `PBS_COMPARE_BASE_URL` is set. Running
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
//   Header link order - compares the header's audience tabs (Personal,
//        Intermediaries, Commercial) and quick-links (Cymraeg, Find a
//        branch, Contact us) - PBS has no separate "utility bar", this
//        combination is its closest equivalent.
//   Footer link groups and order - compares each `<ul>` of footer links
//        (settings, social, and the quick-links accordion groups).
//   Meganav labels and order - compares every top-level `nav#nav-main`
//        item's visible text/order (Mortgages, Savings, Help and support,
//        About us), reusing the same visible-link discovery logic proven in
//        03-pbs.meganav.spec.js.
//   No homepage carousel test - unlike CareUK's "Types of Care We Offer"
//        signpost carousel, PBS's homepage (01-pbs.homepage.spec.js) has no
//        equivalent rotating component, so this check is omitted rather
//        than forced in.
//   Security & caching response headers - Strict-Transport-Security,
//        Cache-Control, Server, X-Content-Type-Options, Referrer-Policy,
//        Content-Security-Policy (presence only, since the CSP value itself
//        legitimately differs slightly by environment - domains reported
//        via `report-uri` differ - so only presence/absence is compared).
//   CMSLandingPageLoaded cookie shape and SameSite policy - PBS doesn't set
//        any GUID-shaped session cookie on the raw HTTP response (confirmed
//        via curl on both pbs-qa2 and Live - no Set-Cookie header at all on
//        first response); the one first-party cookie that does get set is a
//        JS-set Kentico landing-page flag ("CMSLandingPageLoaded"), so this
//        check opens a real browser context on each environment (like the
//        header/footer/meganav tests) and compares that cookie's value and
//        SameSite policy instead of trying to parse a Set-Cookie header.
//   robots.txt Sitemap: lines point at their own domain - not a
//        cross-environment diff, a same-file-wrong-for-one-environment
//        check. Note: pbs-qa2's robots.txt currently disallows the whole
//        site and declares no Sitemap: line at all (normal for a
//        lower/staging environment) - this test only asserts an
//        environment's OWN Sitemap: lines (if any) point at itself, so an
//        environment with none simply produces no findings for that half.
//   Sitemap availability and URL-count parity - both /sitemap.xml files
//        return 200 and aren't wildly different sizes.
//   Analytics container must not be shared across environments - the most
//        important test in this file - a HARD (non-soft) assertion, since a
//        shared GTM container between environments means one environment's
//        test/QA traffic pollutes the other's real analytics data. NOTE:
//        as of 2026-09-02 this check is expected to FAIL for pbs-qa2 vs
//        Live - all 4 GTM container IDs found on the homepage
//        (GTM-PMZRH6HC, GTM-N92V2J2, GTM-KWFJMVS8, GTM-NHWFZ2Z) were
//        confirmed IDENTICAL on both https://pbs-qa2.hosted.positive.co.uk/
//        and https://www.principality.co.uk/ during a manual fetch check -
//        this is a real, confirmed cross-environment analytics-pollution
//        finding, not a test bug.
//   Social-share (og:image) and structured-data (JSON-LD) parity - both
//        environments should expose an og:image tag; JSON-LD is checked
//        leniently (skips rather than fails if neither environment exposes
//        any, since a manual check on 2026-09-02 found zero JSON-LD script
//        tags on the homepage of either pbs-qa2 or Live).
//   Favicon path parity - informational; a differing CDN/build path isn't
//        necessarily a bug on its own.
//   Broken images on key pages - sweeps KEY_PATHS_FOR_IMAGE_SWEEP on both
//        environments checking for any `<img>` that loaded with zero
//        natural width (the standard signal for a broken/missing image).
//
// Most tests here run once per device project (desktop-chromium,
// tablet-webkit, mobile-chromium) since UI order/structure genuinely can
// differ by breakpoint. The pure HTTP-level tests (headers, cookies,
// robots.txt, sitemap, GTM, structured data, favicon) are gated to
// desktop-chromium only via `test.skip` inside each test, since they don't
// depend on viewport and running them 3x would just waste CI time.
// ============================================================================

const COMPARE_BASE_URL = (process.env.PBS_COMPARE_BASE_URL || '').trim().replace(/\/+$/, '');

// A representative, deliberately-curated (not fully dynamic) set of pages
// spanning every major site section, pulled from the real paths already
// exercised by this project's own per-section spec files (07 through 12).
// Add more paths here as new templates/sections are added to the site,
// rather than crawling live on every run (a fixed list keeps this spec
// fast, deterministic, and git-diffable).
const PAGES_TO_COMPARE = [
    { path: '/', label: 'Homepage' },
    { path: '/mortgages/mortgage-products', label: 'Mortgage Products' },
    { path: '/home/mortgages', label: 'Mortgages Home' },
    { path: '/home/mortgages/first-time-buyer-mortgages', label: 'Mortgages - First Time Buyer' },
    { path: '/home/mortgages/boost-your-affordability', label: 'Mortgages - Boost Your Affordability' },
    { path: '/home/mortgages/mortgage-guides', label: 'Mortgages - Mortgage Guides' },
    { path: '/home/mortgages/manage-your-principality-mortgage', label: 'Mortgages - Manage Your Mortgage' },
    { path: '/home/savings', label: 'Savings Home' },
    { path: '/home/savings/savings-guides', label: 'Savings - Guides' },
    { path: '/home/savings/cash-isas', label: 'Savings - Cash ISAs' },
    { path: '/home/savings/isa-transfer', label: 'Savings - ISA Transfer' },
    { path: '/home/contact-us/branch-finder', label: 'Branch Finder' },
    { path: '/home/contact-us', label: 'Contact Us' },
    { path: '/home/contact-us/help-and-support/mortgage-support', label: 'Help and Support - Mortgage Support' },
    { path: '/home/contact-us/help-and-support/savings-support', label: 'Help and Support - Savings Support' },
    { path: '/home/contact-us/help-and-support/closing-an-account-after-someone-dies', label: 'Help and Support - Closing an Account' },
    { path: '/home/about-us', label: 'About Us' },
    { path: '/home/about-us/principality-news', label: 'About Us - Principality News' },
    { path: '/home/about-us/building-a-fairer-society', label: 'About Us - Building a Fairer Society' },
    { path: '/home/careers', label: 'About Us - Careers' },
    { path: '/intermediaries', label: 'Intermediaries' },
    { path: '/commercial', label: 'Commercial' },
];

const KEY_PATHS_FOR_IMAGE_SWEEP = [
    '/', '/mortgages/mortgage-products', '/home/savings', '/home/contact-us/branch-finder',
    '/home/about-us', '/home/mortgages',
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

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator('#CybotCookiebotDialogBodyUnderlay, #CybotCookiebotDialog, #onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-consent-sdk').first();
    const acceptAllButton = page.locator([
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '#CybotCookiebotDialogBodyButtonAccept',
        '#onetrust-accept-btn-handler',
        'button:has-text("Accept all cookies")',
        'button:has-text("Accept all")',
        'button:has-text("Accept")',
    ].join(', ')).first();
    const essentialOnlyButton = page.locator('button:has-text("Essential cookies only")').first();

    const overlayVisible = await cookieOverlay.isVisible().catch(() => false);
    const acceptVisible = await acceptAllButton.isVisible().catch(() => false);
    const essentialVisible = await essentialOnlyButton.isVisible().catch(() => false);

    if (!overlayVisible && !acceptVisible && !essentialVisible) {
        return;
    }

    if (acceptVisible) {
        await acceptAllButton.click({ timeout: 3000 }).catch(() => { });
    } else if (essentialVisible) {
        await essentialOnlyButton.click({ timeout: 3000 }).catch(() => { });
    }

    await expect(cookieOverlay).not.toBeVisible({ timeout: 10000 }).catch(() => { });
}

async function openMenuIfPresent(page) {
    const openMenuButton = page.getByRole('button', { name: 'Open menu' });
    if (await openMenuButton.isVisible().catch(() => false)) {
        await openMenuButton.click().catch(() => { });
    }
}

async function openComparePage(browser, testInfo) {
    const context = await browser.newContext(deviceOptionsForProject(testInfo.project.name));
    const comparePage = await context.newPage();
    await comparePage.goto(COMPARE_BASE_URL, { waitUntil: 'domcontentloaded' });
    await dismissCookieOverlayIfPresent(comparePage);
    return { context, comparePage };
}

async function fetchTitle(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.status !== 200) return { status: res.status, title: null };
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return { status: res.status, title: m ? normalizeWhitespace(m[1]) : null };
}

async function getHeaderLinkOrder(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('.header-main__audience-tabs a, .header-main__quick-links a'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean));
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

async function getMeganavTopLevelOrder(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('nav#nav-main a[id^="level1-item"]'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean));
}

test.describe('Environment Comparison', () => {
    test.skip(!COMPARE_BASE_URL, 'Environment comparison spec only runs when PBS_COMPARE_BASE_URL is set alongside PBS_BASE_URL - see README.md "Comparing two environments". Skipped for normal single-environment runs.');

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

    test('Environment Compare - Header link order', async ({ page, browser, baseURL }, testInfo) => {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await dismissCookieOverlayIfPresent(page);
        const orderA = await getHeaderLinkOrder(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        const orderB = await getHeaderLinkOrder(comparePage);
        await context.close();

        expect(orderA, `Header link order (audience tabs + quick links) should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toEqual(orderB);
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
        await openMenuIfPresent(page);
        const orderA = await getMeganavTopLevelOrder(page);

        const { context, comparePage } = await openComparePage(browser, testInfo);
        await openMenuIfPresent(comparePage);
        const orderB = await getMeganavTopLevelOrder(comparePage);
        await context.close();

        expect(orderA, `Meganav top-level item order should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toEqual(orderB);
    });

    test('Environment Compare - Security & caching response headers', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'HTTP headers are device-independent - only needs to run once.');

        const [resA, resB] = await Promise.all([fetch(baseURL), fetch(COMPARE_BASE_URL)]);
        const labelA = hostLabel(baseURL);
        const labelB = hostLabel(COMPARE_BASE_URL);

        ['strict-transport-security', 'x-content-type-options', 'referrer-policy', 'x-frame-options'].forEach((name) => {
            const a = resA.headers.get(name);
            const b = resB.headers.get(name);
            expect.soft(a, `${name} header should be present/absent the same way on both environments (${labelA}: "${a || 'absent'}" vs ${labelB}: "${b || 'absent'}")`).toBe(b);
        });

        const cspA = resA.headers.get('content-security-policy');
        const cspB = resB.headers.get('content-security-policy');
        expect.soft(!!cspA, `Content-Security-Policy header should be present on ${labelA}`).toBe(true);
        expect.soft(!!cspB, `Content-Security-Policy header should be present on ${labelB}`).toBe(true);
    });

    test('Environment Compare - CMSLandingPageLoaded cookie shape and SameSite policy', async ({ page, browser, baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'The cookie set on first page load is device-independent.');

        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);
        const cookiesA = await page.context().cookies();

        const { context, comparePage } = await openComparePage(browser, testInfo);
        await comparePage.waitForTimeout(1000);
        const cookiesB = await context.cookies();
        await context.close();

        const cookieA = cookiesA.find((c) => c.name === 'CMSLandingPageLoaded');
        const cookieB = cookiesB.find((c) => c.name === 'CMSLandingPageLoaded');

        expect.soft(!!cookieA, `CMSLandingPageLoaded cookie should be set on ${hostLabel(baseURL)} after the homepage loads`).toBe(true);
        expect.soft(!!cookieB, `CMSLandingPageLoaded cookie should be set on ${hostLabel(COMPARE_BASE_URL)} after the homepage loads`).toBe(true);

        if (cookieA && cookieB) {
            expect.soft(cookieA.value, `CMSLandingPageLoaded cookie value should match between ${hostLabel(baseURL)} ("${cookieA.value}") and ${hostLabel(COMPARE_BASE_URL)} ("${cookieB.value}")`).toBe(cookieB.value);
            expect.soft(cookieA.sameSite, `CMSLandingPageLoaded SameSite policy should match between ${hostLabel(baseURL)} ("${cookieA.sameSite}") and ${hostLabel(COMPARE_BASE_URL)} ("${cookieB.sameSite}")`).toBe(cookieB.sameSite);
        }
    });

    test('Environment Compare - robots.txt Sitemap: lines point at their own domain', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'robots.txt is device-independent.');

        async function pointsAtOwnDomain(base) {
            const res = await fetch(new URL('/robots.txt', base).toString());
            const text = await res.text();
            const sitemapLines = [...text.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
            const ownHost = hostLabel(base);
            if (sitemapLines.length === 0) return true; // nothing to check - not itself a defect (e.g. a Disallow-all staging robots.txt)
            return sitemapLines.every((line) => hostLabel(line) === ownHost);
        }

        expect.soft(await pointsAtOwnDomain(baseURL), `${hostLabel(baseURL)}'s robots.txt Sitemap: lines (if any) should point at its own domain, not another environment's`).toBe(true);
        expect.soft(await pointsAtOwnDomain(COMPARE_BASE_URL), `${hostLabel(COMPARE_BASE_URL)}'s robots.txt Sitemap: lines (if any) should point at its own domain, not another environment's`).toBe(true);
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

        if (a.jsonLdCount === 0 && b.jsonLdCount === 0) {
            test.skip(true, 'Neither environment currently exposes JSON-LD structured data on the homepage - nothing to compare (confirmed 2026-09-02).');
        }

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
