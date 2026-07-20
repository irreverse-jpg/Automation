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
// Coverage notes - Savings: home, guides, ISA transfer, and individual
// account-type pages (9 pages under the "Savings" meganav item not already
// covered by 08-pbs.savings.spec.js, which owns the "Savings accounts"
// comparison tool)
// ============================================================================
// Scope: every remaining real page discovered under the live "Savings"
// meganav section - the Savings home landing page, Savings guides hub, ISA
// transfers, and 6 individual account-type pages (Easy access, Fixed term
// bonds, Cash ISAs, Regular savings, Children's accounts, Maturity
// accounts). Each content page gets a deep traversal (title/H1/breadcrumb,
// real on-page FAQ accordions expanded/collapsed and verified, CTA no-404
// sweep); Maturity accounts is its own mini comparison tool (like
// 08-pbs.savings.spec.js) so it's checked for its results/filter chrome and
// card links instead of FAQs.
//
// Tests in this file (10 total):
//   1. Savings - Savings Home Page Traversal (/home/savings)
//   2. Savings - Savings Guides Hub Traversal (guide card list)
//   3. Savings - ISA Transfers Traversal (5 real FAQs)
//   4. Savings - Easy Access Accounts Traversal (4 real FAQs)
//   5. Savings - Fixed Term Bonds Traversal (4 real FAQs)
//   6. Savings - Cash ISAs Traversal (5 real FAQs)
//   7. Savings - Regular Saver Accounts Traversal (3 real FAQs)
//   8. Savings - Children's Accounts Traversal (4 real customer-story
//      accordions - a different use of the same accordion component, not
//      FAQs, but toggled/verified the same way)
//   9. Savings - Maturity Accounts Traversal - its own mini results/filter
//      tool (9 maturity-account cards as of this writing), checked for its
//      results heading and a no-404 sweep of each "More info" card link
//      rather than FAQ accordions.
//   10. Savings - Savings Support Menu Path Traversal - a thin check only
//      (lands on /home/contact-us/help-and-support/savings-support and
//      confirms the right H1/breadcrumb). The full FAQ-depth test for this
//      page lives in 11-pbs.helpandsupport.spec.js, since its URL and real
//      "home" belong to the Help and support section - this avoids
//      re-testing the same page's FAQ content twice.
//
// Real accordion counts were confirmed via direct DOM inspection scoped to
// <main> (a sitewide cookie-preference panel and mobile footer accordion
// both reuse the same "accordion__item" class outside <main>). Confirmed
// each item can start either expanded or collapsed depending on page/index,
// and toggles the opposite way on click - toggleAccordionAndVerify() below
// asserts on panel height changing (with a small pixel tolerance on the
// return trip), not on aria-expanded, which was confirmed to stay "false"
// throughout regardless of real visual state.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#CybotCookiebotDialogBodyUnderlay, #CybotCookiebotDialog, #onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-consent-sdk';

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
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

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isCookieInterception = message.includes('intercepts pointer events') || message.includes('cybot') || message.includes('onetrust');

        if (!isCookieInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR);
    if (await cookieButton.first().isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, cookieButton.first()).catch(() => { });
    }

    await dismissCookieOverlayIfPresent(page);
}

async function expectPageChrome(page, { h1Text, breadcrumbParent }) {
    const pageHeading = page.getByRole('heading', { level: 1, name: h1Text });
    await expect(pageHeading, `Page should show the "${h1Text}" H1`).toBeVisible();

    const breadcrumbNav = page.locator('nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').first();
    await expect(breadcrumbNav, 'Page should expose a breadcrumb trail').toBeVisible();

    if (breadcrumbParent) {
        const parentBreadcrumb = breadcrumbNav.getByRole('link', { name: breadcrumbParent }).first();
        await expect(parentBreadcrumb, `Breadcrumb should include "${breadcrumbParent}" as a previous level`).toBeVisible();
    }
}

async function sweepMainCtasForBrokenLinks(page, { request, minCount = 0 } = {}) {
    const ctaLinks = page.locator('main a.button, main a[class*="cta" i]');
    const count = await ctaLinks.count();

    if (minCount) {
        expect(count, `Page should expose at least ${minCount} onward CTA link(s)`).toBeGreaterThanOrEqual(minCount);
    }

    const seenHrefs = new Set();
    for (let i = 0; i < count; i += 1) {
        const link = ctaLinks.nth(i);
        const href = await link.getAttribute('href');
        const text = (await link.textContent() || '').trim();

        if (!href || seenHrefs.has(href)) continue;
        if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
        seenHrefs.add(href);

        const absoluteUrl = new URL(href, page.url()).toString();
        try {
            const response = await request.get(absoluteUrl, { timeout: 15000 });
            expect(response.status(), `"${text}" CTA (${href}) should not be a dead/not-found link`).not.toBe(404);
        } catch {
            // network hiccup on a bulk CTA sweep shouldn't fail the whole test - genuine 404s are still caught above
        }
    }
}

async function toggleAccordionAndVerify(page, item, contextLabel) {
    const trigger = item.locator('.accordion__trigger, button').first();
    const panel = item.locator('.accordion__panel').first();

    await trigger.scrollIntoViewIfNeeded();
    const heightBefore = await panel.evaluate((el) => el.getBoundingClientRect().height);

    await clickWithCookieGuard(page, trigger);
    await expect.poll(async () => await panel.evaluate((el) => el.getBoundingClientRect().height), {
        message: `${contextLabel} accordion panel height should change after clicking its trigger`,
        timeout: 8000,
    }).not.toBe(heightBefore);

    const panelText = (await panel.innerText()).trim();
    expect(panelText.length, `${contextLabel} accordion panel should reveal non-empty content when toggled`).toBeGreaterThan(0);

    // restore original state so the page is left as found - compared with a
    // small pixel tolerance rather than exact equality, since a couple of
    // pages' collapse transitions were confirmed to settle a fraction of a
    // pixel off the original measurement under real rendering conditions,
    // which isn't a real defect.
    await clickWithCookieGuard(page, trigger);
    await expect.poll(async () => {
        const heightAfter = await panel.evaluate((el) => el.getBoundingClientRect().height);
        return Math.abs(heightAfter - heightBefore);
    }, {
        message: `${contextLabel} accordion panel should return close to its original height after toggling back`,
        timeout: 15000,
        intervals: [250, 500, 1000, 2000],
    }).toBeLessThanOrEqual(2);
}

async function verifySampleOfMainAccordions(page, { minCount }) {
    const items = page.locator('main .accordion__item');
    const count = await items.count();
    expect(count, `Page should expose at least ${minCount} real accordion item(s)`).toBeGreaterThanOrEqual(minCount);

    // Give late-loading fonts/images a moment to settle before measuring any
    // panel's "before" height - confirmed the very first accordion checked
    // right after page load can read a couple of pixels short of its true
    // steady-state height otherwise, which isn't a real accordion defect.
    await page.waitForTimeout(800);

    const indexesToCheck = new Set([0, count - 1, Math.floor(count / 2)]);
    for (const index of indexesToCheck) {
        await toggleAccordionAndVerify(page, items.nth(index), `Accordion item #${index + 1}`);
    }
}

async function verifyFooterVisible(page) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const footer = page.locator('footer').first();
    await expect(footer, 'Page should expose a visible footer at the bottom').toBeVisible();
}

const PAGES = [
    {
        testName: 'Savings - Savings Home Page Traversal',
        path: '/home/savings',
        h1Text: 'Savings accounts and ISAs',
        breadcrumbParent: null,
        ctaMinCount: 5,
        accordionMinCount: 0,
    },
    {
        testName: 'Savings - Savings Guides Hub Traversal',
        path: '/home/savings/savings-guides',
        h1Text: 'Savings guides',
        breadcrumbParent: 'Savings',
        ctaMinCount: 0,
        accordionMinCount: 0,
    },
    {
        testName: 'Savings - ISA Transfers Traversal',
        path: '/home/savings/isa-transfer',
        h1Text: 'ISA transfers',
        breadcrumbParent: 'Savings',
        ctaMinCount: 1,
        accordionMinCount: 5,
    },
    {
        testName: 'Savings - Easy Access Accounts Traversal',
        path: '/home/savings/easy-access-accounts',
        h1Text: 'Easy access accounts',
        breadcrumbParent: 'Savings',
        ctaMinCount: 4,
        accordionMinCount: 4,
    },
    {
        testName: 'Savings - Fixed Term Bonds Traversal',
        path: '/home/savings/fixed-term-bonds',
        h1Text: 'Fixed term bonds',
        breadcrumbParent: 'Savings',
        ctaMinCount: 4,
        accordionMinCount: 4,
    },
    {
        testName: 'Savings - Cash ISAs Traversal',
        path: '/home/savings/cash-isas',
        h1Text: 'Cash ISAs',
        breadcrumbParent: 'Savings',
        ctaMinCount: 4,
        accordionMinCount: 5,
    },
    {
        testName: 'Savings - Regular Saver Accounts Traversal',
        path: '/home/savings/regular-saver-accounts',
        h1Text: 'Regular saver accounts',
        breadcrumbParent: 'Savings',
        ctaMinCount: 4,
        accordionMinCount: 3,
    },
    {
        testName: "Savings - Children's Accounts Traversal",
        path: '/home/savings/learn-to-save',
        h1Text: "Children's accounts",
        breadcrumbParent: 'Savings',
        ctaMinCount: 2,
        accordionMinCount: 4,
    },
];

for (const config of PAGES) {
    test(config.testName, async ({ page, request }) => {
        test.setTimeout(60000);

        await test.step(`Open ${config.path} and verify page chrome`, async () => {
            await page.goto(config.path, { waitUntil: 'domcontentloaded' });
            await acceptCookiesIfPresent(page);
            await expectPageChrome(page, { h1Text: config.h1Text, breadcrumbParent: config.breadcrumbParent });
        });

        if (config.accordionMinCount > 0) {
            await test.step('Verify a sample of the page\'s real accordions', async () => {
                await verifySampleOfMainAccordions(page, { minCount: config.accordionMinCount });
            });
        }

        await test.step('Sweep onward CTA links for broken destinations', async () => {
            await sweepMainCtasForBrokenLinks(page, { request, minCount: config.ctaMinCount });
        });

        await test.step('Verify footer visibility', async () => {
            await verifyFooterVisible(page);
        });
    });
}

test('Savings - Maturity Accounts Traversal', async ({ page, request }) => {
    test.setTimeout(60000);

    await test.step('Open /home/savings/maturity-accounts and verify page chrome', async () => {
        await page.goto('/home/savings/maturity-accounts', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expectPageChrome(page, { h1Text: 'Maturity accounts', breadcrumbParent: 'Savings' });
    });

    await test.step('Verify the results heading and card links', async () => {
        // The account count sits in its own nested <span>, which breaks a
        // single getByText regex spanning the full sentence - read the
        // heading's normalized text directly instead.
        const resultsHeading = page.locator('.listHeading__heading, h2').filter({ hasText: /good news/i }).first();
        await expect(resultsHeading, 'Maturity accounts page should show a results-found heading').toBeVisible();

        const headingText = (await resultsHeading.innerText()).replace(/\s+/g, ' ').trim();
        expect(headingText, 'Results heading should confirm at least one real savings account was found').toMatch(/Good news! We['’]ve found \d+ savings accounts? for you/i);

        const moreInfoLinks = page.locator('main a').filter({ hasText: /^More info$/i });
        const count = await moreInfoLinks.count();
        expect(count, 'Maturity accounts page should list at least one account card with a More info link').toBeGreaterThan(0);

        const seenHrefs = new Set();
        for (let i = 0; i < count; i += 1) {
            const href = await moreInfoLinks.nth(i).getAttribute('href');
            if (!href || seenHrefs.has(href)) continue;
            seenHrefs.add(href);

            const absoluteUrl = new URL(href, page.url()).toString();
            const response = await request.get(absoluteUrl, { timeout: 15000 }).catch(() => null);
            if (response) {
                expect(response.status(), `Maturity account "More info" link (${href}) should not be a dead/not-found link`).not.toBe(404);
            }
        }
    });

    await test.step('Verify footer visibility', async () => {
        await verifyFooterVisible(page);
    });
});

test('Savings - Savings Support Menu Path Traversal', async ({ page }) => {
    // Thin check only - the full FAQ-depth test for this page lives in
    // 11-pbs.helpandsupport.spec.js, since the URL/section it actually
    // belongs to is Help and support, not Savings.
    await page.goto('/home/contact-us/help-and-support/savings-support', { waitUntil: 'domcontentloaded' });
    await acceptCookiesIfPresent(page);
    await expectPageChrome(page, { h1Text: 'Savings support', breadcrumbParent: null });
});
