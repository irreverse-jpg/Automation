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
// Coverage notes - lords.org site-wide footer
// ============================================================================
// Scope: `footer.footer`, reached by scrolling to the bottom of the
// homepage - the primary site-links group, the secondary/legal links group
// (duplicated in the DOM for mobile vs. desktop, hence the `:visible`
// filters used throughout this file), and the social icon row.
//
// Tests in this file:
//   1. Footer - Verify Footer is Present
//      Confirms the footer and a stable primary link (Privacy Notice) are
//      visible on the homepage.
//   2. Footer - Verify Links
//      Clicks each primary footer link (Privacy Notice, Ground Regulations,
//      Contact Us), confirming href/navigation, a non-error response
//      status, and a visible H1 on the destination.
//   3. Footer - Verify Legal Links
//      Same checks as above for the secondary/legal group (Terms &
//      Conditions, Corporate Information, Report discrimination), all of
//      which open in a new tab except Report discrimination.
//   4. Footer - Verify Social Links
//      Confirms each social icon (Facebook, LinkedIn, Twitter/X, Instagram,
//      YouTube) is visible, has the right accessible name, opens in a new
//      tab, and points at its expected social domain.
//
// ============================================================================

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';
const SOCIAL_DOMAINS = ['facebook.com', 'linkedin.com', 'twitter.com', 'instagram.com', 'youtube.com'];

const PRIMARY_FOOTER_LINKS = [
    { name: 'Privacy Notice', href: '/footer/privacy-policy', expectedPath: '/information/privacy-notice' },
    { name: 'Ground Regulations', href: '/information/general-ground-regulations', expectedPath: '/information/general-ground-regulations' },
    { name: 'Contact Us', href: '/lords/visit-us/contact', expectedPath: '/lords/visit-us/contact' },
];

const LEGAL_FOOTER_LINKS = [
    { name: 'Terms & Conditions', href: '/information/general-ground-regulations-1', expectedPath: '/information/terms-and-conditions', target: '_blank' },
    { name: 'Corporate Information', href: 'https://www.lords.org/information/about', expectedPath: 'https://www.lords.org/information/about', target: '_blank' },
    { name: 'Report discrimination', href: 'https://www.lords.org/internal-incident-reporting/report-an-incident', expectedPath: 'https://www.lords.org/internal-incident-reporting/report-an-incident', target: '_self' },
];

const SOCIAL_FOOTER_LINKS = [
    { name: 'Facebook', href: 'https://www.facebook.com/HomeOfCricket/' },
    { name: 'LinkedIn', href: 'https://www.linkedin.com/company/marylebone-cricket-club-' },
    { name: 'Twitter', href: 'https://twitter.com/homeofcricket' },
    { name: 'Instagram', href: 'https://www.instagram.com/homeofcricket/' },
    { name: 'YouTube', href: 'https://www.youtube.com/user/lordscricketground' },
];

function buildExpectedUrl(baseURL, path) {
    return new URL(path, baseURL).toString();
}

function resolveExpectedUrl(baseURL, pathOrUrl) {
    return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : buildExpectedUrl(baseURL, pathOrUrl);
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
}

async function acceptCookiesIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);
}

async function waitForAndAcceptCookieBanner(page) {
    // OneTrust injects the consent banner (and its full-page dark backdrop) asynchronously via GTM,
    // often after `load`. A single instant visibility check races the banner and misses it, leaving
    // the backdrop blocking clicks on later steps, so wait for the accept button before moving on.
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }

    await dismissCookieOverlayIfPresent(page);
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

async function openHomeFooter(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);

    const footer = page.locator('footer.footer').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'The MCC footer should be visible on the homepage').toBeVisible();
    return footer;
}

function getVisibleFooterLink(footer, href) {
    // Several footer link groups render twice in the DOM (once for the mobile layout, once for
    // desktop) and are toggled with responsive CSS classes rather than removed, so ":visible" is
    // needed to land on whichever instance actually applies at the current viewport.
    return footer.locator(`a[href=${JSON.stringify(href)}]:visible`).first();
}

async function clickFooterLinkAndVerify(page, context, baseURL, { href, name, expectedPath, target }) {
    const footer = await openHomeFooter(page);
    const link = getVisibleFooterLink(footer, href);
    const expectedUrl = resolveExpectedUrl(baseURL, expectedPath);

    await expect(link, `Footer link "${name}" should be visible before clicking`).toBeVisible();
    await expect(link, `Footer link "${name}" should point to ${href}`).toHaveAttribute('href', href);
    if (target) {
        await expect(link, `Footer link "${name}" should use target="${target}"`).toHaveAttribute('target', target);
    }

    if (target === '_blank') {
        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, link),
        ]);
        await popup.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(popup);

        expect(popup.url(), `Footer link "${name}" should open ${expectedUrl}`).toBe(expectedUrl);
        const statusCheck = await popup.request.get(popup.url());
        expect(statusCheck.status(), `Footer link "${name}" destination should not return an error status`).toBeLessThan(400);
        await expect(popup.locator('h1').first(), `Page opened from footer link "${name}" should expose a visible H1`).toBeVisible();
        await popup.close();
        return;
    }

    await clickWithCookieGuard(page, link);
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);

    await expect(page, `Footer link "${name}" should navigate to ${expectedUrl}`).toHaveURL(expectedUrl);
    const statusCheck = await page.request.get(page.url());
    expect(statusCheck.status(), `Footer link "${name}" destination should not return an error status`).toBeLessThan(400);
    await expect(page.locator('h1').first(), `Page opened from footer link "${name}" should expose a visible H1`).toBeVisible();
}

test('Footer - Verify Footer is Present', async ({ page }) => {
    await test.step('Open homepage and scroll to the footer', async () => {
        const footer = await openHomeFooter(page);
        await expect(footer.getByRole('link', { name: 'Privacy Notice' }).first(), 'The footer should expose a stable primary footer link').toBeVisible();
    });
});

test('Footer - Verify Links', async ({ page, context, baseURL }) => {
    test.setTimeout(60000);

    for (const target of PRIMARY_FOOTER_LINKS) {
        await test.step(`Footer link: ${target.name} -> ${target.href}`, async () => {
            await clickFooterLinkAndVerify(page, context, baseURL, target);
        });
    }
});

test('Footer - Verify Legal Links', async ({ page, context, baseURL }) => {
    test.setTimeout(60000);

    for (const target of LEGAL_FOOTER_LINKS) {
        await test.step(`Footer legal link: ${target.name} -> ${target.href}`, async () => {
            await clickFooterLinkAndVerify(page, context, baseURL, target);
        });
    }
});

test('Footer - Verify Social Links', async ({ page }) => {
    await test.step('Open homepage and footer', async () => {
        await openHomeFooter(page);
    });

    for (const { href, name } of SOCIAL_FOOTER_LINKS) {
        await test.step(`Footer social link configuration: ${name} -> ${href}`, async () => {
            const footer = page.locator('footer.footer').first();
            const link = getVisibleFooterLink(footer, href);

            await expect(link, `Footer social link "${name}" should be visible`).toBeVisible();
            await expect(link, `Footer social link "${name}" should expose the expected accessible name`).toHaveAccessibleName(name);
            await expect(link, `Footer social link "${name}" should open in a new tab`).toHaveAttribute('target', '_blank');

            const linkHost = new URL(href).hostname;
            expect(SOCIAL_DOMAINS.some((domain) => linkHost === domain || linkHost.endsWith(`.${domain}`)), `Footer social link "${name}" should point to a supported social domain`).toBe(true);
        });
    }
});
