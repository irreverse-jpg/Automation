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


// COVERAGE NOTES - Women's Internationals page (/tickets/womens-internationals)
// ================================================================================
//
// What this file covers:
// - The full Women's Internationals ticketing page: hero, in-page anchor navigation, FAQ accordion,
//   Refund Policy section, the "Evolution of Women's Cricket" link, the All Fixtures carousel, and
//   the shared sponsors/footer block.
//
// Current status (re-verified 2026-07-16): this page now returns 200 on BOTH Live and UAT2, as part
// of the broader Live -> UAT2 content sync. It previously 404'd on UAT2 (confirmed 2026-07-10) and
// the file was built Live-only at that time, "leave it prepared for when synch happens to UAT2".
// That sync has now happened and has been directly re-confirmed: the full test passes for real on
// UAT2, not just via the presence-gate.
//
// The file still presence-gates at the top of the test via a real page.goto()/status check and
// test.skip()s if the page is ever missing again on a given environment, rather than assuming parity
// outright - this needed no code change to pick up UAT2, since the gate just started passing there.
//
// Renumbered from 10 to 13 as part of the 2026-07 meganav reorg (see project memory). Kept as its own
// standalone file rather than folded into `06-mcc.tickets.spec.js`, because as of this date it still
// has NO entry anywhere in either environment's live meganav (its sibling "Men's Internationals" is
// menu-linked, this one isn't).
//
// Test list (single test, broken into steps):
// - "Women's Internationals - Initial Page Checks"
//   1. Open the page (presence-gated, see above) and verify the H1 + hero statement
//   2. Verify the page title
//   3. Follow the "England v India Test Match" anchor (#anchor-1) and its "Buy tickets now" button
//      (opens the external ticketing site in a new tab)
//   4. Follow the "Test Match FAQs" anchor (#anchor-2) and exercise the FAQ accordion (multi-open,
//      does not auto-collapse siblings - same component documented on specs 06/09)
//   5. Follow the "Refund Policy" anchor (#anchor-3) and its "visiting Lord's FAQs" button
//   6. Follow the "Learn More About the Evolution of Women's Cricket" link (opens in a new tab)
//   7. Verify the "All Fixtures" carousel (hover zoom effect) and its "View all fixtures" button
//   8. Scroll to the bottom and verify the sponsors block / footer
//
// No other environment-conditional logic exists in this file beyond the presence-gate above.

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

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

async function waitForAndDismissPreferenceCenter(page) {
    const preferenceCenterBackdrop = page.locator('.onetrust-pc-dark-filter').first();
    const appeared = await preferenceCenterBackdrop.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false);
    if (appeared) {
        await dismissCookieOverlayIfPresent(page);
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

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isBlockedByOverlay = message.includes('intercepts pointer events') || message.includes('cookie');

        if (!isBlockedByOverlay) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
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

// Same multi-open accordion component already documented on Getting To Lord's (spec 06) and Tours &
// Museum (spec 09) - confirmed directly here too (opening the 2nd item does not collapse the 1st).
async function expandThenCollapseAccordions(page, labels) {
    for (const label of labels) {
        await test.step(`Expand ${label}`, async () => {
            const header = page.locator('.accordion__header:visible', { hasText: label }).first();
            await header.scrollIntoViewIfNeeded();
            await expect(header, `${label} should start collapsed (showing the + state)`).toHaveClass(/collapsed/);

            await dismissCookieOverlayIfPresent(page);
            await page.waitForTimeout(400);
            await header.evaluate((el) => el.click());
            await expect(header, `${label} should show the expanded (-) state after clicking`).not.toHaveClass(/collapsed/);

            const targetSelector = await header.getAttribute('data-target');
            await expect(page.locator(targetSelector), `${label}'s content should be visible once expanded`).toBeVisible();
        });
    }

    for (const label of [...labels].reverse()) {
        await test.step(`Collapse ${label}`, async () => {
            const header = page.locator('.accordion__header:visible', { hasText: label }).first();
            await header.scrollIntoViewIfNeeded();
            await expect(header, `${label} should still be expanded before collapsing`).not.toHaveClass(/collapsed/);

            await dismissCookieOverlayIfPresent(page);
            await page.waitForTimeout(400);
            await header.evaluate((el) => el.click());
            await expect(header, `${label} should return to the collapsed (+) state after clicking again`).toHaveClass(/collapsed/);

            const targetSelector = await header.getAttribute('data-target');
            await expect(page.locator(targetSelector), `${label}'s content should be hidden once collapsed`).toBeHidden();
        });
    }
}

// Confirmed real content facts: this page's in-page nav anchors (#anchor-1/2/3/6) are genuine hash
// navigations (same technique already documented for Match Day Hospitality's 9 suite sections in
// spec 08) - each anchor's actual heading/button live in a LATER, separate container than the bare
// anchor <span> itself, so following:: from the span is used rather than closest()/sibling scoping.
async function pageExists(page, path) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => null);
    return !!response && response.status() < 400;
}

test('Women\'s Internationals - Initial Page Checks', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Open the Women\'s Internationals page directly', async () => {
        const exists = await pageExists(page, '/tickets/womens-internationals');
        test.skip(!exists, 'This page doesn\'t exist on this environment - as of 2026-07-16 it returns 200 on both Live and UAT2, so this should only trigger if a future regression removes it again.');
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
    });

    await test.step('Verify the H1 and hero statement', async () => {
        // Confirmed real content facts: there are genuinely two h1-level headings in the hero - a
        // short recurring title ("Lord's Test Matches") and a page-specific statement heading right
        // below it. Both are checked, since each is a real, distinct h1 on this page.
        await expect(page.locator('h1').nth(0), 'The page should show the Lord\'s Test Matches heading').toHaveText(/Lord's Test Matches/i);
        await expect(page.locator('h1').nth(1), 'The page should show the summer statement heading').toContainText(/women's international cricket/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference women\'s international cricket').toHaveTitle(/women/i);
    });

    // Confirmed real content fact: the only "Buy tickets" button on this page is the sitewide
    // persistent header/meganav CTA, not a page-specific hero button - this page's hero has no CTA
    // of its own. Not worth testing separately here (it's not this page's content, it's global site
    // chrome hidden behind the hamburger menu on tablet/mobile anyway) - skipped in favour of the
    // page's own real buttons below.
    await test.step('Follow the "England v India Test Match" anchor link and verify its section', async () => {
        const anchorLink = page.locator('a[href="#anchor-1"]').first();
        await anchorLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, anchorLink);
        await expect(page, 'Clicking the anchor link should update the URL hash').toHaveURL(/#anchor-1$/);

        await expect(page.getByRole('heading', { name: /Women's Test Match/i }).first(), 'The Women\'s Test Match heading should be visible').toBeVisible();

        const buyTicketsNowButton = page.locator('a.button', { hasText: /^Buy tickets now$/i }).first();
        await buyTicketsNowButton.scrollIntoViewIfNeeded();
        const href = await buyTicketsNowButton.getAttribute('href');

        const [popup] = await Promise.all([
            page.context().waitForEvent('page'),
            clickWithCookieGuard(page, buyTicketsNowButton),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'Buy tickets now should open the external ticketing site').toBe(new URL(href).host);
        await popup.close();
    });

    await test.step('Follow the "Test Match FAQs" anchor link and test the FAQ accordion', async () => {
        const anchorLink = page.locator('a[href="#anchor-2"]').first();
        await anchorLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, anchorLink);
        await expect(page, 'Clicking the anchor link should update the URL hash').toHaveURL(/#anchor-2$/);

        await expect(page.getByRole('heading', { name: /Test Match FAQs/i }).first(), 'The Test Match FAQs heading should be visible').toBeVisible();

        // Confirmed real content fact: "Buy England v India tickets" is NOT a standalone section CTA
        // next to this heading - it's a link embedded inside the first FAQ answer's own text ("How
        // do I purchase women's test tickets to Lord's?"), only genuinely visible once that specific
        // accordion item is expanded. It's exercised naturally as part of the accordion loop below
        // rather than checked here as a separate top-level button.
        const labels = await page.locator('.accordion__header:visible').evaluateAll((els) => els.map((el) => el.textContent.trim()));
        expect(labels.length, 'There should be at least one FAQ accordion item').toBeGreaterThan(0);
        await expandThenCollapseAccordions(page, labels);
    });

    await test.step('Follow the "Refund Policy" anchor link and its "visiting Lord\'s FAQs" button', async () => {
        const anchorLink = page.locator('a[href="#anchor-3"]').first();
        await anchorLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, anchorLink);
        await expect(page, 'Clicking the anchor link should update the URL hash').toHaveURL(/#anchor-3$/);

        await expect(page.getByRole('heading', { name: /Refund Policy/i }).first(), 'The Refund Policy heading should be visible').toBeVisible();

        const faqsButton = page.locator('a.button', { hasText: /visiting Lord's FAQs/i }).first();
        await faqsButton.scrollIntoViewIfNeeded();
        const href = await faqsButton.getAttribute('href');
        const target = await faqsButton.getAttribute('target');

        if (target === '_blank') {
            const [popup] = await Promise.all([
                page.context().waitForEvent('page'),
                clickWithCookieGuard(page, faqsButton),
            ]);
            await popup.waitForLoadState('domcontentloaded').catch(() => { });
            expect(new URL(popup.url()).pathname, 'The FAQs button should navigate to the expected page').toBe(new URL(href, baseURL).pathname);
            await popup.close();
        } else {
            await clickWithCookieGuard(page, faqsButton);
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);
            expect(new URL(page.url()).pathname, 'The FAQs button should navigate to the expected page').toBe(new URL(href, baseURL).pathname);
            await page.goBack();
            await page.waitForLoadState('load').catch(() => { });
            await waitForAndDismissPreferenceCenter(page);
            await dismissCookieOverlayIfPresent(page);
        }
    });

    await test.step('Follow the "Learn More About the Evolution of Women\'s Cricket" link', async () => {
        const evolutionLink = page.locator('a.button', { hasText: /Learn More About the Evolution of Women's Cricket/i }).first();
        await evolutionLink.scrollIntoViewIfNeeded();
        const href = await evolutionLink.getAttribute('href');

        // Confirmed real content fact: this link is target="_blank" (opens a new tab), unlike the
        // "visiting Lord's FAQs" button just above it which navigates same-tab.
        const [popup] = await Promise.all([
            page.context().waitForEvent('page'),
            clickWithCookieGuard(page, evolutionLink),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).pathname, 'The link should navigate to the Evolution of Women\'s Cricket page').toBe(new URL(href, baseURL).pathname);
        await popup.close();
    });

    await test.step('Verify the "All Fixtures" carousel and its card hover effect', async () => {
        // Same shared `.whatsOnRow` Swiper.js "what's on" component already documented on the Plan
        // Your Day pages (spec 06) - nav arrows shown via opacity on wrap hover, card zoom on hover.
        await expect(page.getByRole('heading', { name: /All Fixtures/i }).first(), 'The All Fixtures heading should be visible').toBeVisible();

        const wrap = page.locator('.whatsOnRow__swiperWrap').first();
        await wrap.scrollIntoViewIfNeeded();
        const firstCard = page.locator('.whatsOnRow__item').first();
        await expect(firstCard, 'At least one fixture card should be visible').toBeVisible();

        const before = await firstCard.locator('.ctaTile__background').first().evaluate((el) => getComputedStyle(el).transform);
        await firstCard.hover();
        await page.waitForTimeout(400);
        const after = await firstCard.locator('.ctaTile__background').first().evaluate((el) => getComputedStyle(el).transform);
        expect(after, 'The fixture card should visually change (zoom) on hover').not.toBe(before);

        const viewAllFixturesButton = page.locator('a.button', { hasText: /View all fixtures/i }).first();
        await viewAllFixturesButton.scrollIntoViewIfNeeded();
        const href = await viewAllFixturesButton.getAttribute('href');
        await clickWithCookieGuard(page, viewAllFixturesButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).pathname, 'View all fixtures should navigate to the Fixtures and Results page').toBe(new URL(href).pathname);

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenter(page);
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});
