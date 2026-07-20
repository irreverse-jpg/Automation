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


// COVERAGE NOTES - Sponsors / Our Partners page (/information/sponsors)
// =======================================================================
//
// What this file covers:
// - The "Our Partners" page, accessed directly by URL (there is no menu-driven route to it - see
//   "Why standalone" below). Renumbered from 07 to 12 as part of the 2026-07 meganav reorg (see
//   project memory).
// - The footer sponsors block (logo link on desktop, "View our partners" link on mobile/tablet) is
//   also checked at the bottom of the test via the shared verifySponsorsAndFooter helper used across
//   the other specs in this project. Actually clicking through from the footer link is out of scope
//   here - this file always opens the page directly by URL instead.
//
// Why standalone: this page has no entry anywhere in the current meganav tree (top-level or nested) -
// it's purely footer-linked utility content, so it stays its own direct-goto file rather than living
// inside one of the menu-driven files.
//
// Test list (single test, broken into steps):
// - "Sponsors - Our Partners Page Checks"
//   1. Open the page directly and verify the H1
//   2. Verify the page title (environment-aware: UAT2 uses a generic env title on every page)
//   3. Verify the Principal Partner section (Barclays - pinned by name, since it's consistent
//      across environments)
//   4. Verify the Partners & Suppliers section (flexible - iterates over however many cards exist,
//      by name, without hardcoding the roster)
//   5. Verify the Partnership Opportunities section (Get in Touch mailto link)
//   6. Scroll to the bottom and verify the sponsors block / footer
//
// Re-verified 2026-07-16, after the broader Live -> UAT2 content sync:
// - The partner roster is now IDENTICAL on both environments (13 named cards: Barclays, Asahi UK,
//   CGI, Vitality, Hendrick's Gin, Majestic Wines, Guinness, Veuve Clicquot, Westons - Stowford
//   Press, BT, Re:Water, Destination Sport, The PCA). The previously-documented UAT2-vs-Live roster
//   difference (UAT2 showing BrewDog where Live showed Asahi UK) no longer reproduces - that was
//   resolved by the sync.
// - The previously-documented 2 blank placeholder `<h5>&nbsp;</h5>` slots on UAT2 are also gone -
//   0 blank headings found on UAT2 as of this date. The filtering-out-blank-h5s logic in
//   extractPartnerCards() is kept as a defensive no-op in case blank placeholders reappear, but it is
//   not currently exercised by real page content on either environment.
// - The Partners & Suppliers section is still deliberately NOT hardcoded to a specific roster (only
//   generic per-card checks), since Hector expects this list to keep changing over time even now that
//   the two environments match.

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function isUatEnvironment(baseURL) {
    return /uat/i.test(new URL(baseURL).hostname);
}

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

    const overlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (await overlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }

    const preferenceCenterBackdrop = page.locator('.onetrust-pc-dark-filter').first();
    if (await preferenceCenterBackdrop.isVisible().catch(() => false)) {
        await page.waitForTimeout(600);
        const closeButton = page.locator('#close-pc-btn-handler').first();
        await closeButton.click({ timeout: 3000 }).catch(() => closeButton.click({ force: true, timeout: 3000 }).catch(() => { }));
        await preferenceCenterBackdrop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
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

async function openPage(page, path) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

async function verifySponsorsAndFooter(page) {
    const desktopSponsorsLink = page.locator('.footer__partners a[href*="/information/sponsors"]').first();
    const mobileSponsorsLink = page.locator('.footerButton__button[href*="/information/sponsors"]').first();

    if (await desktopSponsorsLink.isVisible().catch(() => false)) {
        await desktopSponsorsLink.scrollIntoViewIfNeeded();
        const naturalWidth = await desktopSponsorsLink.locator('img').first().evaluate((img) => img.naturalWidth);
        expect(naturalWidth, 'The sponsors logo image should load with real dimensions (0 means it failed to load)').toBeGreaterThan(0);
    } else {
        await expect(mobileSponsorsLink, 'A "View our partners" link should be present on mobile/tablet').toBeVisible();
    }

    const footer = page.locator('footer.footer').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'The standard MCC footer should be visible at the bottom of the page').toBeVisible();
}

// Extracts partner "cards" (heading + Find Out More button) from the page, in document order.
// Two things make this non-trivial:
// 1. The "Partners & Suppliers" content on Live has a malformed/unclosed wysiwyg container - every
//    card after the first one ends up nested INSIDE the previous card's own content div (confirmed
//    directly: closest('.oneColumnContentRow__wysiwyg') from any later button resolves to an
//    earlier, unrelated card's container). This makes per-card containment (`closest()`) unreliable,
//    so cards are paired by flat document order instead (every <h5> is a name, the next
//    "Find Out More" button belongs to it), which works regardless of the nesting bug.
// 2. UAT2 previously had 2 completely blank `<h5>&nbsp;</h5>` placeholder headings mixed in among the
//    real ones (no name text, and no matching button follows them at all) - re-verified 2026-07-16
//    that these are gone post-sync (0 blank headings found on either environment now). The filter
//    below is kept as a defensive no-op in case blank placeholders reappear, silently skipping any
//    blank heading rather than letting it corrupt the H5/button alternation.
async function extractPartnerCards(page) {
    return page.evaluate(() => {
        const candidates = Array.from(document.body.querySelectorAll('h5, a.button'))
            .filter((el) => !el.closest('header') && !el.closest('footer') && !el.closest('.meganav') && !el.closest('#onetrust-consent-sdk'))
            .filter((el) => el.tagName !== 'H5' || el.textContent.trim().length > 0);

        const cards = [];
        let pendingName = null;

        for (const el of candidates) {
            if (el.tagName === 'H5') {
                pendingName = el.textContent.trim();
            } else if (pendingName && /find out more/i.test(el.textContent)) {
                cards.push({ name: pendingName, href: el.getAttribute('href'), target: el.getAttribute('target') });
                pendingName = null;
            }
        }

        return cards;
    });
}

// Checking real external destinations without ever navigating away from the page (matching the
// "verify the resource, don't actually follow it" convention already used for the PDF/download links
// elsewhere in this project). Some legitimate partner sites (confirmed directly: Vitality, Majestic
// Wines, Westons-cider) return a genuine Cloudflare-challenge 403 to any automated request, browser
// navigation included - that's third-party bot protection, not evidence the link on THIS site is
// broken, so only a 404 (truly gone) or a 5xx (destination server error) counts as a failure here.
async function verifyExternalLinkNotBroken(page, { name, href }) {
    const response = await page.request.get(href, { timeout: 15000, failOnStatusCode: false }).catch((error) => {
        throw new Error(`"${name}"'s link (${href}) could not be reached at all: ${error.message}`);
    });

    const status = response.status();
    expect(status, `"${name}"'s link (${href}) should not be a dead/not-found link`).not.toBe(404);
    expect(status, `"${name}"'s link (${href}) should not return a server error`).toBeLessThan(500);
}

test('Sponsors - Our Partners Page Checks', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Open the Our Partners page directly', async () => {
        await openPage(page, '/information/sponsors');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Our Partners heading').toHaveText(/Our Partners/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should contain the page name').toHaveTitle(/Our Partners/i);
        }
    });

    await test.step('Verify the Principal Partner section (Barclays)', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /principal partner/i }).first(), 'The page should show the Principal Partner heading').toBeVisible();

        const cards = await extractPartnerCards(page);
        const principalPartner = cards[0];

        // Barclays is consistent on both environments (unlike the flexible list below), so this one
        // is worth pinning down exactly rather than treated generically.
        expect(principalPartner?.name, 'The Principal Partner should be Barclays').toBe('Barclays');
        expect(principalPartner?.target, 'The Barclays Find Out More link should open in a new tab').toBe('_blank');
        await verifyExternalLinkNotBroken(page, { name: principalPartner.name, href: principalPartner.href });
    });

    await test.step('Verify the Partners & Suppliers section (flexible - the exact partner list differs by environment)', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /partners (&|and) suppliers/i }).first(), 'The page should show the Partners & Suppliers heading').toBeVisible();

        // Re-verified 2026-07-16: the roster here is now identical on both environments (13 named
        // cards on Live and UAT2 alike), resolving the previously-documented UAT2-vs-Live difference
        // (UAT2 used to list BrewDog where Live listed Asahi UK). Per Hector, this list is still
        // expected to keep changing over time, so names are deliberately not hardcoded. Every card
        // found (however many, whatever their names) gets the same check: a real heading, and a Find
        // Out More button whose destination isn't dead.
        const cards = await extractPartnerCards(page);
        const suppliers = cards.slice(1);

        expect(suppliers.length, 'There should be at least one Partners & Suppliers card listed').toBeGreaterThan(0);

        for (const supplier of suppliers) {
            await test.step(`"${supplier.name}" card`, async () => {
                expect(supplier.name, 'The card should have a non-empty heading').toBeTruthy();
                expect(supplier.href, 'The card\'s Find Out More button should have a real href').toBeTruthy();
                await verifyExternalLinkNotBroken(page, supplier);
            });
        }
    });

    await test.step('Verify the Partnership Opportunities section (Get in Touch mailto)', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /partnership opportunities/i }).first(), 'The page should show the Partnership Opportunities heading').toBeVisible();

        const getInTouchButton = page.locator('a.button', { hasText: /get in touch/i }).first();
        await getInTouchButton.scrollIntoViewIfNeeded();
        await expect(getInTouchButton, 'The Get in Touch button should be visible').toBeVisible();

        // Confirming the mailto is well-formed without ever clicking it - clicking would hand off to
        // the OS's default mail client, which is unreliable/hangs in a headless test environment and
        // isn't what "confirm functionality" means here.
        const href = await getInTouchButton.getAttribute('href');
        expect(href, 'The Get in Touch button should be a mailto link').toMatch(/^mailto:/i);
        expect(href, 'The mailto should point at the commercial partnerships address').toContain('commercialpartnerships@mcc.org.uk');
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});
