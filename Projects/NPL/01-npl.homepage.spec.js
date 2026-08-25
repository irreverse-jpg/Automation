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
// Coverage notes - npl.co.uk homepage ("/")
// ============================================================================
// Scope: the homepage only - title, cookie consent, the "Careers"/"Contact"
// utility links in the header, and the skip link.
//
// Tests in this file:
//   1. Homepage - Homepage Loads
//      Loads "/" and checks the page title.
//   2. Homepage - Scrolling Through the Page
//      Scrolls to the footer, back to the top, and to the middle, checking
//      scroll position at each step.
//   3. Homepage - Utility Links Navigate Correctly
//      Clicks the "Careers" and "Contact" header utility links and confirms
//      each lands on its expected destination.
//   4. Homepage - Skip Links
//      Discovers skip link(s) live via keyboard Tab (rather than hardcoding a
//      label), then verifies each one is reachable again via Tab and that
//      activating it lands on its target element. NPL exposes one as of
//      2026-07-28: "Skip to content".
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

// NPL's OneTrust accept button renders before its click handler finishes attaching -
// clicking the instant it's visible silently no-ops and leaves the overlay intercepting
// later clicks, so this retries the click until the banner actually disappears.
async function acceptCookiesIfPresent(page) {
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

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (!(await cookieOverlay.isVisible().catch(() => false))) {
        return;
    }

    const acceptAllButton = page.locator('#onetrust-accept-btn-handler').first();
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
    await expect(cookieOverlay).not.toBeVisible();
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isCookieInterception = message.includes('intercepts pointer events') || message.includes('onetrust');

        if (!isCookieInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

async function openHomepage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await acceptCookiesIfPresent(page);
}

// On tablet/mobile the header collapses behind a hamburger button - the Careers/Contact
// utility links only become visible after opening it. "#nav-toggle" is a toggle button
// (same button opens AND closes the menu), so this checks whether it's already open
// before clicking - otherwise a second call in the same page session would close it.
async function openMenuIfPresent(page) {
    const navToggle = page.locator('#nav-toggle');
    if (!(await navToggle.isVisible().catch(() => false))) {
        return;
    }

    if (await page.getByRole('link', { name: 'Careers', exact: true }).first().isVisible().catch(() => false)) {
        return;
    }

    // A floating widget (feedback tab / cookie-settings pill) sits over the header on
    // tablet/mobile, so the plain actionability-checked click in clickWithCookieGuard can
    // hang waiting for stability - force-click nav-toggle directly instead. The click also
    // doesn't always register on the first attempt, so this retries a few times.
    await dismissCookieOverlayIfPresent(page);
    const careersLink = page.getByRole('link', { name: 'Careers', exact: true }).first();
    await expect.poll(async () => {
        await navToggle.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        return await careersLink.isVisible().catch(() => false);
    }, {
        message: 'Opening the mobile menu should expose the Careers utility link',
        timeout: 10000,
        intervals: [300, 500, 1000],
    }).toBe(true);
}

test('Homepage - Homepage Loads', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Verify homepage title', async () => {
        await expect(page, 'Homepage should load with the expected NPL title').toHaveTitle(/National Physical Laboratory.*NPL/i);
    });
}, 30000);

test('Homepage - Scrolling Through the Page', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Scroll to the footer', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(page.locator('footer'), 'Scrolling to the bottom should reveal the footer').toBeVisible();
    });

    await test.step('Scroll back to the top', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.keyboard.press('Home').catch(() => {});
        await expect
            .poll(() => page.evaluate(() => Math.round(window.scrollY)), {
                message: 'Scrolling back to the top should return the viewport to the top edge of the page',
                timeout: 10000,
            })
            .toBeLessThanOrEqual(20);
    });

    await test.step('Scroll to the middle of the page', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await expect
            .poll(() => page.evaluate(() => Math.round(window.scrollY)), {
                message: 'Scrolling to the middle should move the page away from the top position',
            })
            .toBeGreaterThan(0);
    });
}, 30000);

test('Homepage - Utility Links Navigate Correctly', async ({ page, baseURL }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Navigate to Careers', async () => {
        await openMenuIfPresent(page);
        const careersLink = page.getByRole('link', { name: 'Careers', exact: true }).first();
        await expect(careersLink, 'Header should show a Careers link before clicking').toBeVisible();
        await clickWithCookieGuard(page, careersLink);
        await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
        await expect(page, 'Careers link should navigate to a careers page').toHaveURL(/careers/i);
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Navigate to Contact', async () => {
        await openHomepage(page);
        await openMenuIfPresent(page);
        const contactLink = page.getByRole('link', { name: 'Contact', exact: true }).first();
        await expect(contactLink, 'Header should show a Contact link before clicking').toBeVisible();
        await clickWithCookieGuard(page, contactLink);
        await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
        await expect(page, 'Contact link should navigate to the contact page').toHaveURL(/\/Contact/i);
        await dismissCookieOverlayIfPresent(page);
    });
}, 60000);

// Skip link(s) are discovered live via keyboard Tab rather than hardcoded, since sites differ on how
// many exist and what they're labelled. Missing a skip link entirely is a real accessibility gap, so
// this test is expected to fail on sites that don't have one rather than being skipped.
test('Homepage - Skip Links', async ({ page }) => {
    test.setTimeout(60000);

    // WebKit (Safari's engine, used by the tablet-webkit project) doesn't include plain <a>
    // links in its default keyboard Tab order - only form controls - matching real desktop/
    // mobile Safari's default "Full Keyboard Access" setting (off). That's a genuine platform
    // convention, not a site defect, so Tab-key discovery/verification only works reliably on
    // the Chromium-based projects; WebKit falls back to a DOM-based discovery + focus() check.
    const isWebkit = test.info().project.name === 'tablet-webkit';

    async function tabToNextLink() {
        await page.keyboard.press('Tab');
        return page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el.tagName !== 'A') return null;
            return { text: (el.textContent || '').trim(), href: el.getAttribute('href') || '' };
        });
    }

    async function discoverSkipLinksViaDom() {
        return page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href^="#"]'))
                .filter((a) => /skip to/i.test((a.textContent || '').trim()))
                .map((a) => ({ text: (a.textContent || '').trim(), href: a.getAttribute('href') || '' }));
        });
    }

    const skipLinks = await test.step('Discover skip links', async () => {
        await openHomepage(page);

        if (isWebkit) {
            return discoverSkipLinksViaDom();
        }

        const links = [];
        const seenHrefs = new Set();
        for (let i = 0; i < 8; i++) {
            const info = await tabToNextLink();
            if (info && /skip to/i.test(info.text) && info.href.startsWith('#') && !seenHrefs.has(info.href)) {
                seenHrefs.add(info.href);
                links.push(info);
            }
        }
        return links;
    });

    expect(skipLinks.length, 'Homepage should expose at least one "Skip to..." link').toBeGreaterThan(0);

    for (const skipLink of skipLinks) {
        await test.step(`Verify "${skipLink.text}" navigates to its target`, async () => {
            await openHomepage(page);

            if (isWebkit) {
                const link = page.locator(`a[href="${skipLink.href}"]`, { hasText: skipLink.text }).first();
                await link.focus();
                await expect(link, `"${skipLink.text}" skip link should be focusable`).toBeFocused();
                await page.keyboard.press('Enter');
            } else {
                let matched = false;
                for (let i = 0; i < 8 && !matched; i++) {
                    const info = await tabToNextLink();
                    if (info && info.href === skipLink.href) matched = true;
                }
                expect(matched, `Should be able to Tab back to the "${skipLink.text}" skip link`).toBeTruthy();
                await page.keyboard.press('Enter');
            }

            await page.waitForTimeout(300);

            expect(page.url(), `Activating "${skipLink.text}" should update the URL to include ${skipLink.href}`).toContain(skipLink.href);

            const targetId = skipLink.href.slice(1);
            await expect(page.locator(`#${targetId}`), `Skip link target "${skipLink.href}" should exist on the page`).toBeAttached();
        });
    }
});
