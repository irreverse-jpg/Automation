const { test, expect } = require('@playwright/test');

// Captures the page's web address at the moment a test fails, so the
// findings report can tell teammates exactly where an issue was seen.
test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('failure-context', {
            body: JSON.stringify({
                url: page.url(),
                pageTitle: await page.title().catch(() => ''),
                environment: testInfo.project.use.baseURL || '',
                viewport: testInfo.project.name,
            }),
            contentType: 'application/json',
        }).catch(() => {});
    }
});


// ============================================================================
// Coverage notes - npl.co.uk "About NPL" meganav section
// ============================================================================
// Scope: the full "About NPL" top-level meganav item - the largest section
// in the suite (23 sub-items on Live). 21 of them get the full traversal +
// deep per-page check treatment (same depth as
// [[08-npl.education-and-learning.spec.js]]); "Job vacancies" (external,
// jobs.npl.co.uk) gets a lighter href-only check.
//
// Confirmed sub-items (2026-07-30, Live), in panel order:
//   About us overview, Corporate information, Who we work with, How we
//   deliver impact, National Metrology Institute, National challenges, Our
//   history, Find us, Careers overview, Job vacancies, Graduate programme,
//   Benefits, Diversity and inclusion, Our values, Our people overview,
//   Executive team, NPL board, NPL fellows, Science and Technology Advisory
//   Council, Major Programme Portfolio Advisory Council, Join our team,
//   Case studies, Contact NPL.
//
// CONFIRMED CATASTROPHIC DEFECT (2026-07-30): of the 21 in-scope links,
// only 8 are correct on UAT. Breakdown:
//   - MISSING FROM THE PANEL ENTIRELY: "About us overview" doesn't appear
//     anywhere in UAT's panel (22 links vs Live's 23) - already flagged
//     once via this same missing link in
//     [[05-npl.research-and-science.spec.js]]'s coverage notes, but this is
//     the actual section it belongs to. The "Meganav Exposes All 23
//     Expected Sub-Items" test below is expected to fail on UAT (count 22)
//     for this same reason - not a spec bug.
//   - HARDCODED href="/" (dead ends to homepage): National challenges,
//     Careers overview, Graduate programme, Our people overview, Major
//     Programme Portfolio Advisory Council, Join our team (6 links).
//   - RETURNS A GENUINE 404 (not a dead-end-to-homepage - a real "page not
//     found" response): Corporate information, National Metrology
//     Institute, Benefits, Diversity and inclusion, Our values (5 links).
//     These are especially easy to miss with a naive check: a 404 page
//     still has exactly one H1 (reading "404"), so the "exactly one H1"
//     check alone would NOT catch this - see the dedicated "not a 404/error
//     page" check added below specifically because of this section.
//   - POINTS TO A WRONG, UNRELATED PAGE: Job vacancies (goes to the
//     internal "/careers" page instead of the external jobs.npl.co.uk
//     board), Executive team (goes to "/contact"), NPL board (goes to an
//     unrelated news article), NPL fellows (goes to a different unrelated
//     news article), Science and Technology Advisory Council (goes to an
//     individual person's bio page, not the council overview) (5 links).
// Their LINKS are correct on UAT ("Who we work with", "How we deliver
// impact", "Our history", "Find us", "Case studies", "Contact NPL" - 6 of
// 21), but only 2 of those 6 ("Our history", "Find us") pass every deep
// check with zero findings:
//   - "Who we work with" and "How we deliver impact" link correctly but
//     their landing pages have pre-existing multi-H1 issues (5 and 4 H1s
//     respectively) - present on Live too, so not a UAT regression, just
//     surfaced by this section's traversal for the first time.
//   - "Case studies" carries its now-familiar multi-H1 finding (same page
//     already documented in [[05-npl.research-and-science.spec.js]] and
//     elsewhere - don't double-count it as a new defect).
//   - "Contact NPL" links correctly but its landing page throws a console
//     error ("requestStorageAccess: Permission denied.") - likely from an
//     embedded chat/support widget attempting the Storage Access API.
//     Flagged here for visibility, but unconfirmed whether this reflects a
//     genuine user-facing issue or is an artifact of the stricter
//     third-party-cookie policy automated/headless browsing runs under -
//     worth a human's judgement rather than a confident "broken" claim.
// So the true fully-clean count is 2 of 21 ("Our history", "Find us") -
// this is the most thoroughly broken section found in the suite so far,
// once page-content checks are considered alongside link correctness.
// All 21 in-scope links are fine on Live.
//
// MATCHING STRATEGY IMPROVEMENT (used here, worth carrying into future
// traversal specs): this file tries an EXACT link-text match first, before
// falling back to slug-based or substring matching. Two different items in
// this section point to the identical destination on Live ("Careers
// overview" and "Join our team" both go to "/careers"), so slug-based
// matching alone would ambiguously find whichever link happens to appear
// first in the panel regardless of which item is actually being tested.
// Exact text matching resolves this cleanly since the two items' own link
// text is distinct even though their destination coincides.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

// Identified by label (exact match tried first, then slug, then a substring fallback) and
// expected URL slug (sourced from Live - see file header for confirmed Live/UAT differences).
const SUB_ITEMS = [
    { label: 'About us overview', slug: 'about-us', knownMissingOnUat: true },
    { label: 'Corporate information', slug: 'corporate-information', knownBrokenOnUat: true },
    { label: 'Who we work with', slug: 'who-we-work-with' },
    { label: 'How we deliver impact', slug: 'delivering-impact' },
    { label: 'National Metrology Institute', slug: 'national-metrology-institute', knownBrokenOnUat: true },
    { label: 'National challenges', slug: 'national-challenges', knownBrokenOnUat: true },
    { label: 'Our history', slug: 'history' },
    { label: 'Find us', slug: 'find-us' },
    { label: 'Careers overview', slug: 'careers', knownBrokenOnUat: true },
    { label: 'Graduate programme', slug: 'graduates', knownBrokenOnUat: true },
    { label: 'Benefits', slug: 'benefits', knownBrokenOnUat: true },
    { label: 'Diversity and inclusion', slug: 'diversity-and-inclusion', knownBrokenOnUat: true },
    { label: 'Our values', slug: 'values', knownBrokenOnUat: true },
    { label: 'Our people overview', slug: 'our-people', knownBrokenOnUat: true },
    { label: 'Executive team', slug: 'nplx', knownWrongLinkOnUat: true },
    { label: 'NPL board', slug: 'nplml-board', knownWrongLinkOnUat: true },
    { label: 'NPL fellows', slug: 'fellows', knownWrongLinkOnUat: true },
    { label: 'Science and Technology Advisory Council', slug: 'stac', knownWrongLinkOnUat: true },
    { label: 'Major Programme Portfolio Advisory Council', slug: 'major-programme-portfolio-advisory-council', knownBrokenOnUat: true },
    { label: 'Join our team', slug: 'careers', knownBrokenOnUat: true },
    { label: 'Case studies', slug: 'case-studies' },
    { label: 'Contact NPL', slug: 'contact' },
];

// External link (jobs.npl.co.uk) - checked by href pattern only, no page load, since
// validating third-party page content is out of scope for this suite.
const EXTERNAL_LINKS = [
    { label: 'Job vacancies', hrefPattern: /^https:\/\/jobs\.npl\.co\.uk\//i, knownWrongLinkOnUat: true },
];

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (!(await cookieOverlay.isVisible().catch(() => false))) {
        return;
    }

    const acceptAllButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await acceptAllButton.isVisible().catch(() => false)) {
        // NPL's OneTrust accept button renders before its click handler finishes attaching -
        // clicking the instant it's visible silently no-ops, so this retries until dismissed.
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

async function openHomepage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
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
}

// "#nav-toggle" is a toggle button, and its click doesn't always register on the first
// attempt - this retries a few times and is a no-op on desktop where it isn't rendered.
async function openMenuIfPresent(page) {
    const navToggle = page.locator('#nav-toggle');
    if (!(await navToggle.isVisible().catch(() => false))) {
        return;
    }

    if (await page.locator('.nav-main__level1-item').first().isVisible().catch(() => false)) {
        return;
    }

    await dismissCookieOverlayIfPresent(page);
    const level1Items = page.locator('.nav-main__level1-item').first();
    await expect.poll(async () => {
        await navToggle.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        return await level1Items.isVisible().catch(() => false);
    }, {
        message: 'Opening the mobile menu should expose the primary navigation items',
        timeout: 10000,
        intervals: [300, 500, 1000],
    }).toBe(true);
}

// On tablet/mobile, re-clicking an already-expanded top-level item does not collapse it
// (aria-expanded stays "true") - "#back-to-main" is what actually resets the accordion, and
// skipping this before expanding a 2nd item leaves that 2nd panel's own links obstructed.
async function collapseAnyExpandedItem(page) {
    const anyExpanded = await page.locator('.nav-main__level1-item > a.nav-main__control[aria-expanded="true"]').first().isVisible().catch(() => false);
    if (!anyExpanded) {
        return;
    }

    const backButton = page.locator('#back-to-main');
    if (await backButton.isVisible().catch(() => false)) {
        await backButton.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
    }
}

async function expandAboutNpl(page) {
    await openMenuIfPresent(page);
    await collapseAnyExpandedItem(page);

    const item = page.locator('.nav-main__level1-item > a.nav-main__control').filter({ hasText: 'About NPL' }).first();
    await expect(item, 'Top-level navigation item "About NPL" should be visible before expanding').toBeVisible();
    const controlsId = await item.getAttribute('aria-controls');
    const panel = page.locator(`#${controlsId}`);

    await expect.poll(async () => {
        await dismissCookieOverlayIfPresent(page);
        await item.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(400);
        return await panel.isVisible().catch(() => false);
    }, {
        message: 'Expanding "About NPL" should reveal its panel',
        timeout: 15000,
        intervals: [400, 700, 1200, 2000],
    }).toBe(true);

    return panel;
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click({ timeout: 3000 });
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isInterception = message.includes('intercepts pointer events') || message.includes('onetrust') || message.includes('timeout');

        if (!isInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

test('About NPL - Meganav Exposes All 23 Expected Sub-Items', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Expand About NPL and count sub-items', async () => {
        const panel = await expandAboutNpl(page);
        const linkTexts = await panel.locator('a').evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
        // Expected count is sourced from Live and is expected to fail on UAT (22, not 23) -
        // "About us overview" is confirmed missing from the UAT panel entirely, see file header.
        expect(linkTexts.length, 'About NPL panel should expose all 23 links (confirmed only 22 on UAT as of 2026-07-30 - "About us overview" is missing - see file header)').toBe(23);
    });
}, 30000);

for (const externalLink of EXTERNAL_LINKS) {
    test(`About NPL - Verify External Link "${externalLink.label}"`, async ({ page }) => {
        await test.step('Open homepage', async () => {
            await openHomepage(page);
        });

        await test.step(`Check the href for "${externalLink.label}"`, async () => {
            const panel = await expandAboutNpl(page);
            const link = panel.getByRole('link', { name: externalLink.label, exact: true }).first();
            await expect(link, `About NPL panel should expose a link for "${externalLink.label}"`).toBeVisible();
            const href = await link.getAttribute('href');
            const note = externalLink.knownWrongLinkOnUat ? ' (confirmed pointing to the wrong page on UAT as of 2026-07-30 - see file header)' : '';
            expect(href || '', `"${externalLink.label}" should point to the external jobs board${note}`).toMatch(externalLink.hrefPattern);
        });
    }, 30000);
}

for (const subItem of SUB_ITEMS) {
    test(`About NPL - Navigate to "${subItem.label}" and Verify the Landing Page`, async ({ page }) => {
        test.setTimeout(30000);

        await test.step('Open homepage', async () => {
            await openHomepage(page);
        });

        // Attached after the homepage load (not before) so this only captures errors from
        // the actual landing page traversal, not homepage-load noise unrelated to this item -
        // NPL's own GTM/ad-tracking script violates the site's CSP on every page load
        // (confirmed sitewide in [[08-npl.education-and-learning.spec.js]]).
        const consoleErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });

        await test.step(`Click the sub-item for "${subItem.label}"`, async () => {
            const panel = await expandAboutNpl(page);

            // Exact text match first (resolves the "Careers overview"/"Join our team" collision
            // - both point to the same "/careers" destination on Live, so slug-based matching
            // alone can't tell them apart), then slug, then a substring fallback.
            const linkData = await panel.locator('a').evaluateAll((nodes) => nodes.map((node) => ({
                href: node.getAttribute('href') || '',
                text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
            })));
            let matchIndex = linkData.findIndex(({ text }) => text.toLowerCase() === subItem.label.toLowerCase());
            if (matchIndex === -1) {
                matchIndex = linkData.findIndex(({ href }) => {
                    const lastSegment = href.split('/').filter(Boolean).pop() || '';
                    return lastSegment.toLowerCase().includes(subItem.slug.toLowerCase());
                });
            }
            if (matchIndex === -1) {
                const fallbackText = (subItem.matchLabel || subItem.label).toLowerCase();
                matchIndex = linkData.findIndex(({ text }) => text.toLowerCase().includes(fallbackText));
            }
            expect(matchIndex, `About NPL panel should expose a link whose text or URL matches "${subItem.label}"${subItem.knownMissingOnUat ? ' (confirmed missing from the UAT panel entirely as of 2026-07-30 - see file header)' : ''}`).toBeGreaterThanOrEqual(0);

            const targetLink = panel.locator('a').nth(matchIndex);
            const targetHref = linkData[matchIndex].href;

            // A plain click on some meganav links reports success but never actually
            // navigates (confirmed elsewhere in this suite - see
            // [[05-npl.research-and-science.spec.js]]) - falling back to a direct goto keeps
            // the traversal moving. For the confirmed href="/" defects this fallback is a
            // no-op (goto("/") stays on the homepage too), so it doesn't mask that finding.
            await clickWithCookieGuard(page, targetLink);
            const navigated = await page.waitForURL((url) => url.pathname !== '/', { timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            if (!navigated) {
                await page.goto(targetHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }

            // Fail fast and specifically here rather than letting the test run out its
            // 30s budget on the later toHaveURL assertion - when a link genuinely redirects
            // to the homepage, the accumulated waits above already eat most of that budget,
            // so without this check the failure surfaces as an unhelpful generic
            // "Test timeout exceeded" instead of naming the actual defect.
            if (new URL(page.url()).pathname === '/') {
                throw new Error(`"${subItem.label}" link redirects to the homepage instead of navigating to a page containing "${subItem.slug}"`);
            }

            await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
        });

        await test.step('Verify the landing page URL matches the expected slug', async () => {
            const note = subItem.knownBrokenOnUat
                ? ' (confirmed broken on UAT as of 2026-07-30 - see file header)'
                : subItem.knownWrongLinkOnUat
                    ? ' (confirmed pointing to the wrong page on UAT as of 2026-07-30 - see file header)'
                    : '';
            await expect(page, `"${subItem.label}" should navigate to a page containing "${subItem.slug}"${note}`).toHaveURL(new RegExp(subItem.slug, 'i'));
        });

        await test.step('Verify the page is not a 404/error page', async () => {
            // Added specifically because of this section: several UAT links here return a
            // genuine 404 rather than dead-ending to the homepage - and a 404 page still has
            // exactly one H1 (reading "404"), so the "exactly one H1" check alone would miss it.
            const title = (await page.title()).trim();
            const h1Text = (await page.locator('h1').first().textContent().catch(() => '') || '').trim();
            expect(`${title} ${h1Text}`, `"${subItem.label}" landing page appears to be a 404/error page (title: "${title}", H1: "${h1Text}")`).not.toMatch(/\b404\b|page not found/i);
        });

        await test.step('Verify SEO/head essentials: title, meta description, canonical, favicon', async () => {
            const title = (await page.title()).trim();
            expect(title.length, `"${subItem.label}" landing page should have a non-empty title`).toBeGreaterThan(0);

            const description = page.locator('meta[name="description"]').first();
            await expect(description, `"${subItem.label}" landing page should expose a meta description`).toBeAttached();
            const descriptionContent = (await description.getAttribute('content')) || '';
            expect(descriptionContent.trim().length, `"${subItem.label}" landing page's meta description should not be empty`).toBeGreaterThan(0);

            const canonical = page.locator('link[rel="canonical"]').first();
            await expect(canonical, `"${subItem.label}" landing page should expose a canonical link`).toHaveAttribute('href', /https?:\/\//i);

            const favicon = page.locator('link[rel~="icon" i], link[rel="shortcut icon" i]').first();
            await expect(favicon, `"${subItem.label}" landing page should expose a favicon link tag`).toBeAttached();
        });

        await test.step('Verify landmarks and exactly one H1', async () => {
            await expect(page.getByRole('main'), `"${subItem.label}" landing page should expose a main landmark`).toBeVisible();
            const hasBanner = (await page.getByRole('banner').count()) > 0;
            const hasContentInfo = (await page.getByRole('contentinfo').count()) > 0;
            expect(hasBanner, `"${subItem.label}" landing page should expose a banner landmark`).toBeTruthy();
            expect(hasContentInfo, `"${subItem.label}" landing page should expose a contentinfo landmark`).toBeTruthy();

            // Always exactly one H1, no per-page carve-outs - matches the convention used by
            // every other traversal spec in this suite.
            const h1Count = await page.locator('h1').count();
            expect(h1Count, `"${subItem.label}" landing page should contain exactly one H1`).toBe(1);
        });

        await test.step('Verify no broken images', async () => {
            const brokenImages = await page.evaluate(() => {
                const isVisible = (el) => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
                };

                return Array.from(document.querySelectorAll('img'))
                    .filter((img) => isVisible(img))
                    .filter((img) => img.complete && img.naturalWidth === 0)
                    .slice(0, 10)
                    .map((img) => (img.getAttribute('src') || img.getAttribute('data-src') || '').slice(0, 150));
            });

            expect(brokenImages, `"${subItem.label}" landing page has broken image(s) that failed to load: ${JSON.stringify(brokenImages)}`).toEqual([]);
        });

        await test.step('Verify a sample of main-content links resolve (no 4xx/5xx)', async () => {
            const origin = new URL(page.url()).origin;
            const sampleLinks = await page.evaluate((pageOrigin) => {
                const main = document.querySelector('main');
                if (!main) return [];

                const isVisible = (el) => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
                };

                const seen = new Set();
                const hrefs = [];
                for (const link of main.querySelectorAll('a[href]')) {
                    if (!isVisible(link)) continue;
                    const href = link.getAttribute('href') || '';
                    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

                    try {
                        const resolved = new URL(href, window.location.href);
                        if (resolved.origin !== pageOrigin) continue;
                        if (seen.has(resolved.href)) continue;
                        seen.add(resolved.href);
                        hrefs.push(resolved.href);
                    } catch {
                        // ignore unparsable hrefs
                    }

                    if (hrefs.length >= 6) break;
                }
                return hrefs;
            }, origin);

            for (const link of sampleLinks) {
                await test.step(`Check link resolves: ${link}`, async () => {
                    const response = await page.request.get(link, { timeout: 15000 }).catch(() => null);
                    expect(response && response.status() < 400, `Main-content link on "${subItem.label}" should not return a 4xx/5xx status: ${link}`).toBeTruthy();
                });
            }
        });

        await test.step('Verify no console errors fired while loading', async () => {
            expect(consoleErrors, `"${subItem.label}" landing page produced console error(s): ${JSON.stringify(consoleErrors.slice(0, 5))}`).toEqual([]);
        });
    }, 45000);
}
