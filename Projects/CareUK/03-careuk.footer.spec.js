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
// Coverage notes - careuk.co.uk site-wide footer
// ============================================================================
// Scope: the footer (`contentinfo` landmark), reached from the homepage -
// 4 fixed primary links, 5 fixed legal links, and 3 fixed social links
// (Facebook, LinkedIn, Twitter/X).
//
// Tests in this file:
//   1. Footer - Verify Footer is Present
//      Confirms the footer and its "About Care UK" link are visible.
//   2. Footer - Verify Links
//      Clicks each of the 4 primary links (About Care UK, Press & media,
//      Feedback & complaints, Careers at Care UK) for real, confirming
//      each navigates to its expected URL with a visible H1.
//   3. Footer - Verify Legal Links
//      Same real-click check for the 5 legal links (Legal & regulatory
//      information, Privacy notice (Residents), Cookies policy, Web
//      Accessibility, Privacy notice (Job Applicants)).
//   4. Footer - Verify Social Links
//      Checks each of the 3 social links' visibility, accessible name,
//      new-tab target, and that the href points at a supported domain -
//      configuration only, not clicked.
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';
const SOCIAL_DOMAINS = ['facebook.com', 'linkedin.com', 'twitter.com'];
const PRIMARY_FOOTER_LINKS = [
    { name: 'About Care UK', href: '/company' },
    { name: 'Press & media', href: '/news' },
    { name: 'Feedback & complaints', href: '/company/complaints' },
    { name: 'Careers at Care UK', href: '/careers' },
];
const LEGAL_FOOTER_LINKS = [
    { name: 'Legal & regulatory information', href: '/legal-regulatory' },
    { name: 'Privacy notice (Residents)', href: '/legal-regulatory/privacy-policy' },
    { name: 'Cookies policy', href: '/legal-regulatory/cookie-declaration' },
    { name: 'Web Accessibility', href: '/legal-regulatory/web-accessibility-statement' },
    { name: 'Privacy notice (Job Applicants)', href: '/legal-regulatory/privacy-notice-job-applicants' },
];
const SOCIAL_FOOTER_LINKS = [
    { name: 'Visit Care UK on Facebook', href: 'https://www.facebook.com/careukcarehomes' },
    { name: 'Visit Care UK on LinkedIn', href: 'https://www.linkedin.com/company/care-uk/' },
    { name: 'Visit Care UK on Twitter', href: 'https://twitter.com/careuk' },
];

function getComparableUrl(url) {
    const current = new URL(url);
    const host = current.hostname === 'x.com' ? 'twitter.com' : current.hostname;
    return `${current.protocol}//${host}${current.pathname}`;
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
    await acceptCookiesIfPresent(page);

    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'The CareUK footer should be visible on the homepage').toBeVisible();
    return footer;
}

async function clickFooterLinkAndVerify(page, baseURL, href, name) {
    const footer = await openHomeFooter(page);
    const link = footer.locator(`a[href=${JSON.stringify(href)}]`).first();

    await expect(link, `Footer link "${name}" should be visible before clicking`).toBeVisible();
    await expect(link, `Footer link "${name}" should point to ${href}`).toHaveAttribute('href', href);
    await clickWithCookieGuard(page, link);
    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, `Footer link "${name}" should navigate to ${href}`).toHaveURL(new URL(href, baseURL).toString());
    await expect(page.locator('h1').first(), `Page opened from footer link "${name}" should expose a visible H1`).toBeVisible();
}

test('Footer - Verify Footer is Present', async ({ page }) => {
    await test.step('Open homepage and scroll to the footer', async () => {
        const footer = await openHomeFooter(page);
        await expect(footer.getByRole('link', { name: 'About Care UK' }).first(), 'The footer should expose a stable primary footer link').toBeVisible();
    });
}, 30000);

test('Footer - Verify Links', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    for (const { href, name } of PRIMARY_FOOTER_LINKS) {
        await test.step(`Footer link: ${name} -> ${href}`, async () => {
            await clickFooterLinkAndVerify(page, baseURL, href, name);
        });
    }
}, 30000);

test('Footer - Verify Legal Links', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    for (const { href, name } of LEGAL_FOOTER_LINKS) {
        await test.step(`Footer legal link: ${name} -> ${href}`, async () => {
            await clickFooterLinkAndVerify(page, baseURL, href, name);
        });
    }
}, 30000);

test('Footer - Verify Social Links', async ({ page }) => {
    await test.step('Open homepage and footer', async () => {
        await openHomeFooter(page);
    });

    for (const { href, name } of SOCIAL_FOOTER_LINKS) {
        await test.step(`Footer social link configuration: ${name} -> ${href}`, async () => {
            const footer = page.getByRole('contentinfo').first();
            const link = footer.locator(`a[href=${JSON.stringify(href)}]`).first();

            await expect(link, `Footer social link "${name}" should be visible`).toBeVisible();
            await expect(link, `Footer social link "${name}" should expose the expected accessible name`).toHaveAccessibleName(name);
            await expect(link, `Footer social link "${name}" should open in a new tab`).toHaveAttribute('target', '_blank');

            const normalizedComparableUrl = getComparableUrl(href);
            expect(SOCIAL_DOMAINS.some((domain) => normalizedComparableUrl.includes(domain)), `Footer social link "${name}" should point to a supported social domain`).toBe(true);
        });
    }
}, 30000);