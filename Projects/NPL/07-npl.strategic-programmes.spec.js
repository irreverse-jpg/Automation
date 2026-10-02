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
// Coverage notes - npl.co.uk "Strategic programmes" meganav section
// ============================================================================
// Scope: the full "Strategic programmes" top-level meganav item - all 6 of
// its sub-items, reached by real menu navigation, then checked on the
// landing page itself (title, exactly one H1, main/banner/contentinfo
// landmarks). No items are excluded from the per-item loop - see the
// "no skipping broken links" principle below.
//
// Confirmed sub-items (2026-07-28, Live), in panel order:
//   National Timing Centre (NTC), UK Telecoms Lab, The NPL Quantum
//   Programme, Advanced Machinery & Productivity Institute (AMPI),
//   Artificial Intelligence (AI), National Measurement System (NMS).
//
// CONFIRMED SEVERE DEFECT (2026-07-28): 5 of the 6 links in this section
// are broken on UAT - the worst rate seen in any meganav section so far
// (compare to Products and services' 9 of 17: [[06-npl.products-and-services.spec.js]]).
//   - "National Timing Centre (NTC)", "Artificial Intelligence (AI)", and
//     "National Measurement System (NMS)" are hardcoded to href="/" -
//     dead ends back to the homepage.
//   - "Quantum Programme" and "Advanced Machinery & Productivity Institute
//     (AMPI)" both point to href="/uk-telecoms-lab" instead of their own
//     pages - not a dead link, but a wrong-target link (both silently land
//     on the UK Telecoms Lab page instead).
//   - Only "UK Telecoms Lab (UKTL)" itself is correct on UAT.
// All 6 are fine on Live. Per the "no skipping broken/wrong links" rule
// (see HANDOVER.md at the repo root), all 6 stay in the traversal
// loop and are asserted against their correct (Live) destination, so these
// failures show up on every run rather than being silently excluded.
//
// Sub-items are identified by URL slug (falling back to a shortened label
// substring that matches both environments' link text - e.g. "Quantum
// Programme" rather than Live's full "The NPL Quantum Programme", since
// UAT's shorter label wouldn't otherwise satisfy an includes() check).
//
// CONFIRMED H1 FINDINGS (2026-07-28, verified against UAT - the suite's
// default run target): "UK Telecoms Lab" has 2 H1s on UAT (page heading
// plus a secondary heading) despite having only 1 on Live - a UAT-specific
// regression, not something Live alone would predict. "The NPL Quantum
// Programme" landing page has 3 H1s on Live (page heading plus 2
// related-topic cards), though that page is currently unreachable via this
// meganav section on UAT due to the wrong-link defect above. The
// "Exactly One H1" check below is a flat, unconditional assertion (per
// team convention: fail, don't skip, on wrong structure), so these keep
// showing up as findings on every run.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

// Identified by label (for readability/fallback matching) and expected URL slug (sourced
// from Live - see file header for confirmed Live/UAT differences this tolerates).
const SUB_ITEMS = [
    { label: 'National Timing Centre (NTC)', slug: 'ntc', knownBrokenOnUat: true },
    { label: 'UK Telecoms Lab', slug: 'uk-telecoms-lab' },
    { label: 'Quantum Programme', slug: 'npl-quantum-programme', knownWrongLinkOnUat: true },
    { label: 'Advanced Machinery & Productivity Institute (AMPI)', slug: 'advanced-machinery-productivity-institute', knownWrongLinkOnUat: true },
    { label: 'Artificial Intelligence (AI)', slug: 'data-science-and-ai', knownBrokenOnUat: true },
    { label: 'National Measurement System (NMS)', slug: 'national-measurement-system', knownBrokenOnUat: true },
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

async function expandStrategicProgrammes(page) {
    await openMenuIfPresent(page);
    await collapseAnyExpandedItem(page);

    const item = page.locator('.nav-main__level1-item > a.nav-main__control').filter({ hasText: 'Strategic programmes' }).first();
    await expect(item, 'Top-level navigation item "Strategic programmes" should be visible before expanding').toBeVisible();
    const controlsId = await item.getAttribute('aria-controls');
    const panel = page.locator(`#${controlsId}`);

    await expect.poll(async () => {
        await dismissCookieOverlayIfPresent(page);
        await item.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(400);
        return await panel.isVisible().catch(() => false);
    }, {
        message: 'Expanding "Strategic programmes" should reveal its panel',
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

test('Strategic Programmes - Meganav Exposes All 6 Expected Sub-Items', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Expand Strategic programmes and count sub-items', async () => {
        const panel = await expandStrategicProgrammes(page);
        const linkTexts = await panel.locator('a').evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
        expect(linkTexts.length, 'Strategic programmes panel should expose all 6 links').toBe(6);
    });
}, 30000);

for (const subItem of SUB_ITEMS) {
    test(`Strategic Programmes - Navigate to "${subItem.label}" and Verify the Landing Page`, async ({ page }) => {
        test.setTimeout(30000);

        await test.step('Open homepage', async () => {
            await openHomepage(page);
        });

        await test.step(`Click the sub-item for "${subItem.label}"`, async () => {
            const panel = await expandStrategicProgrammes(page);

            // Identified by href slug, falling back to label text when the href carries no
            // useful information (the confirmed href="/" and wrong-target defects on UAT).
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
            expect(matchIndex, `Strategic programmes panel should expose a link whose URL or text matches "${subItem.label}"`).toBeGreaterThanOrEqual(0);

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
                ? ' (confirmed href="/" on UAT as of 2026-07-28 - see file header)'
                : subItem.knownWrongLinkOnUat
                    ? ' (confirmed pointing to the wrong page on UAT as of 2026-07-28 - see file header)'
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
            // confirmed multi-H1 finding this is expected to catch.
            const h1Count = await page.locator('h1').count();
            expect(h1Count, `"${subItem.label}" landing page should contain exactly one H1`).toBe(1);
        });
    }, 30000);
}
