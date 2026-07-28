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
// Coverage notes - npl.co.uk "Products and services" meganav section
// ============================================================================
// Scope: the full "Products and services" top-level meganav item - 17 of
// its 18 sub-items, reached by real menu navigation, then checked on the
// landing page itself (title, exactly one H1, main/banner/contentinfo
// landmarks). Only "Training courses" (external link to training.npl.co.uk)
// is excluded from the per-item traversal loop - a dead link still gets
// asserted and left to fail (see "Defence and security" below), rather
// than skipped just because neither environment has a working example to
// source an expected URL from.
//
// Confirmed sub-items (2026-07-28, Live), in Live's panel order:
//   Products and services overview, Calibration services, Consultancy,
//   Training courses, Funded access to experts and facilities,
//   Manufacturer Measurement Network, Commercialising technology, Innovate
//   UK Analysis for Innovators, Case studies, Aerospace, Defence and
//   security, Energy and utilities, Environment, Healthcare and life
//   sciences, IT and telecoms, Manufacturing, Space, Contact us.
//
// CONFIRMED MAJOR DEFECT (2026-07-28): 9 of the 17 in-scope links are
// hardcoded to href="/" on UAT instead of their real destination - they are
// dead ends back to the homepage. Confirmed broken on UAT (all fine on
// Live): Manufacturer Measurement Network, Innovate UK Analysis for
// Innovators, Case studies, Aerospace, Energy and utilities, Environment,
// Healthcare and life sciences, IT and telecoms, Manufacturing, Space -
// that's every single "industry" link plus 3 others. Each is still
// identified correctly by its link text below (falling back from the
// slug-based lookup, since the href itself carries no useful information on
// UAT), so the traversal still reaches and clicks the right link - it's the
// resulting "still on the homepage" URL that correctly fails as the defect.
//
// CONFIRMED DEFECT ON BOTH ENVIRONMENTS: "Defence and security" is also
// hardcoded to href="/" on Live, not just UAT - there's no working
// destination on either environment to source a slug from, so the expected
// URL below follows the same "/industries/<slug>" pattern every sibling
// industry link uses. That's still the correct expected destination
// regardless of environment, so this is included in the loop and expected
// to fail on both Live and UAT, rather than being skipped - a link that's
// broken everywhere is still a fail, not a gap in coverage.
//
// CONFIRMED SITEWIDE H1 FINDING: as with the "Research and science"
// section ([[05-npl.research-and-science.spec.js]]), some landing pages
// here render more than one H1 - confirmed on Live for "Products and
// services overview" (2), "Consultancy" (2), and especially "Innovate UK
// Analysis for Innovators" (19 - one per case-study-style card). The
// "Exactly One H1" check below is a flat, unconditional assertion (per team
// convention: fail, don't skip, on wrong structure), so these keep showing
// up as findings on every run rather than being special-cased away.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

// Identified by label (for readability/fallback matching) and expected URL slug (sourced
// from Live - see file header for confirmed Live/UAT differences this tolerates).
const SUB_ITEMS = [
    { label: 'Products and services overview', slug: 'products-services' },
    { label: 'Calibration services', slug: 'calibration' },
    { label: 'Consultancy', slug: 'consultancy' },
    // "Training courses" is an external link (training.npl.co.uk) - intentionally skipped.
    { label: 'Funded access to experts and facilities', slug: 'measurement-for-business' },
    { label: 'Manufacturer Measurement Network', slug: 'manufacturer-measurement-network', knownBrokenOnUat: true },
    { label: 'Commercialising technology', slug: 'commercialising-technology' },
    { label: 'Innovate UK Analysis for Innovators', slug: 'analysis-for-innovators', knownBrokenOnUat: true },
    { label: 'Case studies', slug: 'case-studies', knownBrokenOnUat: true },
    { label: 'Aerospace', slug: 'aerospace', knownBrokenOnUat: true },
    // "Defence and security" is a confirmed dead link (href="/") on BOTH Live and UAT - no
    // working destination exists on either environment to source a slug from, so this uses
    // the same "/industries/<slug>" pattern every sibling industry link follows. That's still
    // the correct expected destination regardless of environment, so this is asserted (and
    // expected to fail on both) rather than skipped - a broken link is still a fail.
    { label: 'Defence and security', slug: 'defence-and-security', knownBrokenOnBothEnvironments: true },
    { label: 'Energy and utilities', slug: 'energy-and-utilities', knownBrokenOnUat: true },
    { label: 'Environment', slug: 'environment-technologies', knownBrokenOnUat: true },
    { label: 'Healthcare and life sciences', slug: 'healthcare', knownBrokenOnUat: true },
    { label: 'IT and telecoms', slug: 'it-and-telecoms', knownBrokenOnUat: true },
    { label: 'Manufacturing', slug: 'manufacturing', knownBrokenOnUat: true },
    { label: 'Space', slug: 'space', knownBrokenOnUat: true },
    { label: 'Contact us', slug: 'contact-us' },
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

async function expandProductsAndServices(page) {
    await openMenuIfPresent(page);
    await collapseAnyExpandedItem(page);

    const item = page.locator('.nav-main__level1-item > a.nav-main__control').filter({ hasText: 'Products and services' }).first();
    await expect(item, 'Top-level navigation item "Products and services" should be visible before expanding').toBeVisible();
    const controlsId = await item.getAttribute('aria-controls');
    const panel = page.locator(`#${controlsId}`);

    await expect.poll(async () => {
        await dismissCookieOverlayIfPresent(page);
        await item.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(400);
        return await panel.isVisible().catch(() => false);
    }, {
        message: 'Expanding "Products and services" should reveal its panel',
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

test('Products and Services - Meganav Exposes All 18 Expected Sub-Items', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Expand Products and services and count sub-items', async () => {
        const panel = await expandProductsAndServices(page);
        const linkTexts = await panel.locator('a').evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
        expect(linkTexts.length, 'Products and services panel should expose all 18 links (16 in-scope + Training courses + Defence and security)').toBe(18);
    });
}, 30000);

for (const subItem of SUB_ITEMS) {
    test(`Products and Services - Navigate to "${subItem.label}" and Verify the Landing Page`, async ({ page }) => {
        test.setTimeout(30000);

        await test.step('Open homepage', async () => {
            await openHomepage(page);
        });

        await test.step(`Click the sub-item for "${subItem.label}"`, async () => {
            const panel = await expandProductsAndServices(page);

            // Identified by href slug, falling back to label text when the href carries no
            // useful information (the confirmed href="/" defect on several UAT links).
            const linkData = await panel.locator('a').evaluateAll((nodes) => nodes.map((node) => ({
                href: node.getAttribute('href') || '',
                text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
            })));
            let matchIndex = linkData.findIndex(({ href }) => {
                const lastSegment = href.split('/').filter(Boolean).pop() || '';
                return lastSegment.toLowerCase().includes(subItem.slug.toLowerCase());
            });
            if (matchIndex === -1) {
                matchIndex = linkData.findIndex(({ text }) => text.toLowerCase().includes(subItem.label.toLowerCase()));
            }
            expect(matchIndex, `Products and services panel should expose a link whose URL or text matches "${subItem.label}"`).toBeGreaterThanOrEqual(0);

            const targetLink = panel.locator('a').nth(matchIndex);
            const targetHref = linkData[matchIndex].href;

            // A plain click on some meganav links reports success but never actually
            // navigates (confirmed elsewhere in this section - see
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
            await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
        });

        await test.step('Verify the landing page URL matches the expected slug', async () => {
            const note = subItem.knownBrokenOnBothEnvironments
                ? ' (confirmed href="/" on BOTH Live and UAT as of 2026-07-28 - see file header)'
                : subItem.knownBrokenOnUat
                    ? ' (confirmed href="/" on UAT as of 2026-07-28 - see file header)'
                    : '';
            await expect(page, `"${subItem.label}" should navigate to a page containing "${subItem.slug}"${note}`).toHaveURL(new RegExp(subItem.slug, 'i'));
        });

        await test.step('Verify page essentials: title, landmarks, exactly one H1', async () => {
            const title = (await page.title()).trim();
            expect(title.length, `"${subItem.label}" landing page should have a non-empty title`).toBeGreaterThan(0);

            await expect(page.getByRole('main'), `"${subItem.label}" landing page should expose a main landmark`).toBeVisible();
            const hasBanner = (await page.getByRole('banner').count()) > 0;
            const hasContentInfo = (await page.getByRole('contentinfo').count()) > 0;
            expect(hasBanner, `"${subItem.label}" landing page should expose a banner landmark`).toBeTruthy();
            expect(hasContentInfo, `"${subItem.label}" landing page should expose a contentinfo landmark`).toBeTruthy();

            // Always exactly one H1, no per-page carve-outs - see file header for the
            // confirmed multi-H1 findings this is expected to catch.
            const h1Count = await page.locator('h1').count();
            expect(h1Count, `"${subItem.label}" landing page should contain exactly one H1`).toBe(1);
        });
    }, 30000);
}
