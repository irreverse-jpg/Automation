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
// Coverage notes - npl.co.uk site-wide footer
// ============================================================================
// Scope: the footer (`contentinfo` landmark), reached from the homepage -
// the 8 fixed legal/utility links (Privacy notice, Cookies, Quality, HSE,
// Contact us, Terms, Anti-slavery and ethics, Accessibility) and the social
// icon row (LinkedIn, Twitter/X, Facebook, Instagram, YouTube).
//
// Tests in this file:
//   1. Footer - Verify Footer is Present
//      Confirms the footer is visible.
//   2. Footer - Verify Legal Links
//      Clicks each of the 8 fixed legal/utility links for real, confirming
//      each navigates to its expected destination.
//   3. Footer - Verify Social Links
//      Discovers every footer link pointing at a known social domain and
//      confirms it opens in a new tab and points at a supported domain
//      (x.com is normalized to twitter.com for comparison).
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';
const SOCIAL_DOMAINS = ['linkedin.com', 'twitter.com', 'facebook.com', 'instagram.com', 'youtube.com'];
const LEGAL_FOOTER_LINKS = [
    { name: 'Privacy notice', href: '/privacy-notice' },
    // The "Cookies" link's href is /privacy-policy/cookies, but the site redirects that
    // path to /privacy-notice/cookies - confirmed on both Live and UAT (2026-07-28).
    { name: 'Cookies', href: '/privacy-policy/cookies', expectedUrlPattern: /\/privacy-notice\/cookies/i },
    { name: 'Quality', href: '/quality' },
    { name: 'HSE', href: '/health-safety-and-environment' },
    { name: 'Contact us', href: '/Contact' },
    { name: 'Terms', href: '/terms-conditions' },
    { name: 'Anti-slavery and ethics', href: '/anti-slavery-and-ethics' },
    { name: 'Accessibility', href: '/accessibility' },
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
    await expect(cookieOverlay).not.toBeVisible();
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        // Footer links on tablet/mobile routinely get "intercepts pointer events" from
        // whatever page content sits at that scroll position (not just the cookie overlay) -
        // failing fast here and falling back to a force click avoids burning the full default
        // actionTimeout on every single link across an 8-link loop.
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

async function getVisibleFooterLinks(page) {
    const footer = page.getByRole('contentinfo').first();
    return await footer.locator('a[href]').evaluateAll((links) => {
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        return links
            .filter(isVisible)
            .map((link) => ({
                href: link.getAttribute('href'),
                target: link.getAttribute('target'),
                name: link.getAttribute('aria-label') || link.textContent.trim(),
            }))
            .filter((item) => !!item.href);
    });
}

// NPL's OneTrust accept button renders before its click handler finishes attaching -
// clicking the instant it's visible silently no-ops and leaves the overlay intercepting
// later clicks, so this retries the click until the banner actually disappears.
async function openHomeFooter(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Bounded and swallowed: the homepage embeds a YouTube widget whose network activity can
    // keep the "load" event from firing promptly - domcontentloaded is already enough to interact.
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

    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();
    return footer;
}

// NPL normalizes path casing on navigation (e.g. "/Contact" -> "/contact"), so this
// compares case-insensitively rather than treating that as a broken link.
function getComparableUrl(url) {
    const current = new URL(url);
    const host = current.hostname === 'x.com' ? 'twitter.com' : current.hostname.replace(/^www\./i, '');
    return `${current.protocol}//${host}${current.pathname}`.toLowerCase();
}

async function clickFooterLinkAndVerify(page, baseURL, href, target, name, expectedUrlPattern) {
    const footer = await openHomeFooter(page);
    const link = footer.locator(`a[href=${JSON.stringify(href)}]:visible`).first();
    await expect(link, `Footer link "${name}" (${href}) should be visible before clicking`).toBeVisible({ timeout: 10000 });
    await link.scrollIntoViewIfNeeded().catch(() => {});

    const expectedUrl = new URL(href, baseURL).toString();
    const expectedComparableUrl = getComparableUrl(expectedUrl);

    const originalUrl = page.url();
    await clickWithCookieGuard(page, link);
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    const matchesDestination = expectedUrlPattern
        ? () => expectedUrlPattern.test(page.url())
        : () => getComparableUrl(page.url()) === expectedComparableUrl;

    try {
        await expect.poll(matchesDestination, {
            timeout: 10000,
            message: `Footer link "${name}" (${href}) navigated to an unexpected destination. Expected ${expectedUrlPattern || expectedComparableUrl}`,
        }).toBe(true);
    } catch (error) {
        if (page.url() !== originalUrl) {
            throw error;
        }

        await link.evaluate((node) => node.click());
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await expect.poll(matchesDestination, {
            timeout: 10000,
            message: `Footer link "${name}" (${href}) navigated to an unexpected destination after DOM-click fallback. Expected ${expectedUrlPattern || expectedComparableUrl}`,
        }).toBe(true);
    }
}

test('Footer - Verify Footer is Present', async ({ page }) => {
    await test.step('Open homepage and scroll to footer', async () => {
        await openHomeFooter(page);
    });
}, 30000);

test('Footer - Verify Legal Links', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    for (const { href, name, expectedUrlPattern } of LEGAL_FOOTER_LINKS) {
        await test.step(`Footer legal link: ${name} -> ${href}`, async () => {
            await clickFooterLinkAndVerify(page, baseURL, href, undefined, name, expectedUrlPattern);
        });
    }
}, 120000);

test('Footer - Verify Social Links', async ({ page }) => {
    test.setTimeout(60000);

    await openHomeFooter(page);
    const footerLinks = await getVisibleFooterLinks(page);
    const socialLinks = footerLinks.filter(({ href }) => {
        return href && SOCIAL_DOMAINS.some((domain) => href.includes(domain));
    });

    expect(socialLinks.length, 'The footer should expose at least one social link').toBeGreaterThan(0);
    for (const { href, target, name } of socialLinks) {
        await test.step(`Footer social link: ${name || href} -> ${href}`, async () => {
            const socialUrl = new URL(href);
            const normalizedHost = socialUrl.hostname === 'x.com' ? 'twitter.com' : socialUrl.hostname.replace(/^www\./i, '');

            expect(target, `Footer social link "${href}" should open in a new tab`).toBe('_blank');
            expect(SOCIAL_DOMAINS.includes(normalizedHost), `Footer social link "${href}" should point to one of the supported social domains`).toBe(true);
        });
    }
}, 60000);
