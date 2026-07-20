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
// Coverage notes - withersworldwide.com site-wide footer
// ============================================================================
// Scope: the footer (`contentinfo` landmark), reached from the homepage -
// every visible navigable/external link (discovered dynamically), the
// social icon row (Twitter/X, LinkedIn, Instagram), and 5 fixed legal links
// (Legal and regulatory, Pricing, Cookies and privacy, Accessibility,
// Attorney advertising).
//
// Tests in this file:
//   1. Footer - Verify Footer is Present
//      Confirms the footer and its "View all offices" link are visible.
//   2. Footer - Verify Links
//      Discovers every visible footer link, splits them into internal
//      "navigable" links (clicked for real, confirming the destination
//      URL) and external non-social links (checked only for a
//      well-formed absolute URL, not clicked).
//   3. Footer - Verify Social Links
//      Discovers every footer link pointing at a known social domain and
//      confirms it opens in a new tab and points at a supported domain
//      (x.com is normalized to twitter.com for comparison).
//   4. Footer - Verify Legal Links
//      Clicks each of the 5 fixed legal links for real, confirming each
//      navigates to its expected destination.
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';
const SOCIAL_DOMAINS = ['twitter.com', 'linkedin.com', 'instagram.com'];
const LEGAL_FOOTER_LINKS = [
    { name: 'Legal and regulatory', href: '/en-gb/legal-and-regulatory' },
    { name: 'Pricing', href: '/en-gb/price-and-service-information' },
    { name: 'Cookies and privacy', href: '/en-gb/legal-and-regulatory/data-privacy' },
    { name: 'Accessibility', href: '/en-gb/accessibility' },
    { name: 'Attorney advertising', href: '/en-gb/legal-and-regulatory/attorney-advertising' },
];

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click({ timeout: 2000 }).catch(() => { });
    }

    await dismissCookieOverlayIfPresent(page);
}

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    const acceptAllButton = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept all cookies")').first();
    const closeButton = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button[aria-label="Close"]').first();

    const overlayVisible = await cookieOverlay.isVisible().catch(() => false);
    const acceptVisible = await acceptAllButton.isVisible().catch(() => false);
    const closeVisible = await closeButton.isVisible().catch(() => false);

    if (!overlayVisible && !acceptVisible && !closeVisible) {
        return;
    }

    if (acceptVisible) {
        await acceptAllButton.click({ timeout: 2000 }).catch(() => { });
    }

    if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click({ timeout: 2000 }).catch(() => { });
    }

    if (await cookieOverlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }
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

async function getVisibleFooterLinks(page) {
    const footer = page.getByRole('contentinfo').first();
    return await footer.locator('a[href]').evaluateAll((links) => {
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        const items = links
            .filter(isVisible)
            .map((link) => ({
                href: link.getAttribute('href'),
                target: link.getAttribute('target'),
                name: link.getAttribute('aria-label') || link.textContent.trim(),
            }))
            .filter((item) => !!item.href && !!item.name);

        const seen = new Set();
        return items.filter((item) => {
            const key = `${item.href}__${item.target || ''}__${item.name}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    });
}

async function openHomeFooter(page) {
    await page.goto('/');
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);

    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();
    return footer;
}

function getComparableUrl(url) {
    const current = new URL(url);
    const host = current.hostname === 'x.com' ? 'twitter.com' : current.hostname;
    return `${current.protocol}//${host}${current.pathname}`;
}

function getComparableOrigin(url) {
    const current = new URL(url);
    const host = current.hostname === 'x.com' ? 'twitter.com' : current.hostname;
    return `${current.protocol}//${host}`;
}

function isAbsoluteHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
}

async function clickFooterLinkAndVerify(page, baseURL, href, target, name, options = {}) {
    const footer = await openHomeFooter(page);
    const link = footer.locator(`a[href=${JSON.stringify(href)}]:visible`).first();
    await expect(link, `Footer link "${name}" (${href}) should be visible before clicking`).toBeVisible({ timeout: 10000 });
    await expect(link, `Footer link "${href}" should expose the expected accessible name`).toHaveAccessibleName(name, { timeout: 10000 });
    await expect(link, `Footer link "${name}" should point to the expected destination`).toHaveAttribute('href', href);
    await link.scrollIntoViewIfNeeded().catch(() => { });

    const expectedUrl = new URL(href, baseURL).toString();
    const expectedComparableUrl = getComparableUrl(expectedUrl);
    const expectedComparableOrigin = getComparableOrigin(expectedUrl);
    const compareResult = options.compareHostOnly
        ? (url) => getComparableOrigin(url)
        : (url) => getComparableUrl(url);
    const expectedResult = options.compareHostOnly
        ? expectedComparableOrigin
        : expectedComparableUrl;

    if (target === '_blank') {
        const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
        const contextPagePromise = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
        const originalUrl = page.url();

        await clickWithCookieGuard(page, link);

        const popup = await popupPromise;
        const contextPage = await contextPagePromise;
        const destinationPage = popup || (contextPage && contextPage !== page ? contextPage : null);

        if (destinationPage) {
            await destinationPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
            await expect.poll(
                () => compareResult(destinationPage.url()),
                {
                    timeout: 10000,
                    message: `Footer link "${name}" (${href}) opened an unexpected destination. Expected ${expectedResult}`,
                }
            ).toBe(expectedResult);
            await destinationPage.close().catch(() => { });
            return;
        }

        await expect.poll(
            () => compareResult(page.url()),
            {
                timeout: 10000,
                message: `Footer link "${name}" (${href}) opened an unexpected destination. Expected ${expectedResult}`,
            }
        ).toBe(expectedResult);
        expect(page.url(), `Footer link "${name}" should change the current page URL when no popup is created`).not.toBe(originalUrl);
        return;
    }

    const originalUrl = page.url();
    await clickWithCookieGuard(page, link);
    await page.waitForLoadState('domcontentloaded').catch(() => { });

    try {
        await expect.poll(
            () => compareResult(page.url()),
            {
                timeout: 10000,
                message: `Footer link "${name}" (${href}) navigated to an unexpected destination. Expected ${expectedResult}`,
            }
        ).toBe(expectedResult);
    } catch (error) {
        if (page.url() !== originalUrl) {
            throw error;
        }

        await link.evaluate((node) => node.click());
        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await expect.poll(
            () => compareResult(page.url()),
            {
                timeout: 10000,
                message: `Footer link "${name}" (${href}) navigated to an unexpected destination after DOM-click fallback. Expected ${expectedResult}`,
            }
        ).toBe(expectedResult);
    }
}

test('Footer - Verify Footer is Present', async ({ page }) => {
    await test.step('Open homepage and scroll to footer', async () => {
        await page.goto('/');
        await page.waitForLoadState('load');
        await acceptCookiesIfPresent(page);

        const footer = page.getByRole('contentinfo').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'Footer region should be visible at the bottom of the page').toBeVisible();
        await expect(footer.getByRole('link', { name: 'View all offices' }).first(), 'Footer should expose a stable navigation link on all viewports').toBeVisible();
    });
}, 30000);

test('Footer - Verify Links', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await openHomeFooter(page);
    const footerLinks = await getVisibleFooterLinks(page);
    const legalFooterHrefs = new Set(LEGAL_FOOTER_LINKS.map((link) => link.href));
    const navigableLinks = footerLinks.filter(({ href }) => {
        return href &&
            !isAbsoluteHttpUrl(href) &&
            !href.startsWith('#') &&
            !href.startsWith('javascript:') &&
            !href.startsWith('mailto:') &&
            !href.startsWith('tel:') &&
            !legalFooterHrefs.has(href) &&
            !SOCIAL_DOMAINS.some((domain) => href.includes(domain));
    });
    const externalLinks = footerLinks.filter(({ href }) => {
        return href &&
            isAbsoluteHttpUrl(href) &&
            !SOCIAL_DOMAINS.some((domain) => href.includes(domain));
    });

    expect(navigableLinks.length).toBeGreaterThan(0);
    for (const { href, target, name } of navigableLinks) {
        await test.step(`Footer link: ${name} -> ${href}`, async () => {
            await clickFooterLinkAndVerify(page, baseURL, href, target, name);
        });
    }

    expect(externalLinks.length, 'The footer should expose at least one non-social external link').toBeGreaterThan(0);
    for (const { href, name } of externalLinks) {
        await test.step(`Footer external link configuration: ${name} -> ${href}`, async () => {
            expect(() => new URL(href), `Footer external link "${name}" should expose a valid absolute URL`).not.toThrow();
        });
    }
}, 30000);

test('Footer - Verify Social Links', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await openHomeFooter(page);
    const footerLinks = await getVisibleFooterLinks(page);
    const socialLinks = footerLinks.filter(({ href }) => {
        return href && SOCIAL_DOMAINS.some((domain) => href.includes(domain));
    });

    expect(socialLinks.length).toBeGreaterThan(0);
    for (const { href, target, name } of socialLinks) {
        await test.step(`Footer social link: ${name} -> ${href}`, async () => {
            const socialUrl = new URL(href);
            const normalizedHost = socialUrl.hostname === 'x.com' ? 'twitter.com' : socialUrl.hostname.replace(/^www\./i, '');

            expect(target, `Footer social link "${name}" should open in a new tab`).toBe('_blank');
            expect(SOCIAL_DOMAINS.includes(normalizedHost), `Footer social link "${name}" should point to one of the supported social domains`).toBe(true);
        });
    }
}, 30000);

test('Footer - Verify Legal Links', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    for (const { href, name } of LEGAL_FOOTER_LINKS) {
        await test.step(`Footer legal link: ${name} -> ${href}`, async () => {
            await clickFooterLinkAndVerify(page, baseURL, href, undefined, name);
        });
    }
}, 30000);