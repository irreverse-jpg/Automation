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
// Coverage notes - rsc.org site-wide footer
// ============================================================================
// Scope: the footer (`contentinfo` landmark), reached from the homepage - the
// "About us" and "Contact us" link groups (treated as one "primary" set), the
// "Help and legal" group, and the social icon row (YouTube, Facebook,
// LinkedIn, BlueSky). No accordion/collapse behaviour on mobile - confirmed
// 2026-07-20 every footer link stays directly visible on all 3 viewports,
// unlike this project's header nav.
//
// Tests in this file:
//   1. Footer - Verify Footer is Present
//      Confirms the footer and its "About us" link are visible.
//   2. Footer - Verify Links
//      Clicks each of 5 primary links (About us, History, Corporate
//      information, Contact us, Offices) for real, confirming each
//      navigates to its expected URL with a visible H1.
//   3. Footer - Verify Legal Links
//      Same real-click check for 4 "Help and legal" links (Cookies,
//      Privacy, Terms and conditions, Accessibility).
//   4. Footer - Verify Social Links
//      Confirms each social icon (YouTube, Facebook, LinkedIn, BlueSky) is
//      visible, has the right accessible name, and points at its expected
//      social domain. Does NOT assert target="_blank" - unlike every other
//      project in this workspace, RSC's social footer links have no target
//      attribute at all and navigate away in the SAME tab (confirmed
//      2026-07-20 by actually clicking the YouTube link and watching it
//      replace the current tab rather than open a popup).
//
// ENVIRONMENT DRIFT (confirmed 2026-07-20 - none of this affects the tests
// above, which only use links confirmed identical on both environments):
// Live's footer has 4 links QA's doesn't ("Our websites", "Press Office",
// "Follow us", "Safeguarding"), and "Venue hire" resolves to a different path
// on each environment (QA: /our-events/venue-hire/..., Live: /venue-hire/...).
// Everything used in this file - all 9 primary/legal links and all 4 social
// links - was confirmed identical (same label, same href) on both QA and
// Live before being hardcoded here.
// ============================================================================

const SOCIAL_DOMAINS = ['youtube.com', 'facebook.com', 'linkedin.com', 'bsky.app'];

const PRIMARY_FOOTER_LINKS = [
    { name: 'About us', href: '/about-us' },
    { name: 'History', href: '/about-us/our-history' },
    { name: 'Corporate information', href: '/about-us/corporate-information' },
    { name: 'Contact us', href: '/contact-us' },
    { name: 'Offices', href: '/contact-us/offices' },
];

const LEGAL_FOOTER_LINKS = [
    { name: 'Cookies', href: '/help-and-legal/cookies' },
    { name: 'Privacy', href: '/help-and-legal/privacy' },
    { name: 'Terms and conditions', href: '/help-and-legal/terms-of-use' },
    { name: 'Accessibility', href: '/help-and-legal/accessibility' },
];

const SOCIAL_FOOTER_LINKS = [
    { name: 'YouTube', href: 'https://www.youtube.com/user/wwwRSCorg' },
    { name: 'Facebook', href: 'https://www.facebook.com/RoyalSocietyofChemistry' },
    { name: 'LinkedIn', href: 'https://www.linkedin.com/company/roysocchem/' },
    { name: 'BlueSky', href: 'https://bsky.app/profile/rsc.org' },
];

function buildExpectedUrl(baseURL, path) {
    return new URL(path, baseURL).toString();
}

// The OneTrust banner is injected asynchronously via GTM - a same-tick isVisible()
// check races it and misses it, leaving its dark overlay blocking clicks lower on
// the page. Wait for the accept button before moving on.
async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

async function openHomeFooter(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);

    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'The RSC footer should be visible on the homepage').toBeVisible();
    return footer;
}

async function clickFooterLinkAndVerify(page, baseURL, { href, name }) {
    const footer = await openHomeFooter(page);
    const link = footer.locator(`a[href="${href}"]`).first();

    await expect(link, `Footer link "${name}" should be visible before clicking`).toBeVisible();
    await link.click();
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);

    await expect(page, `Footer link "${name}" should navigate to ${href}`).toHaveURL(buildExpectedUrl(baseURL, href));
    await expect(page.locator('h1').first(), `Page opened from footer link "${name}" should expose a visible H1`).toBeVisible();
}

test('Footer - Verify Footer is Present', async ({ page }) => {
    await test.step('Open homepage and scroll to the footer', async () => {
        const footer = await openHomeFooter(page);
        await expect(footer.getByRole('link', { name: 'About us', exact: true }).first(), 'The footer should expose a stable primary footer link').toBeVisible();
    });
});

test('Footer - Verify Links', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    for (const target of PRIMARY_FOOTER_LINKS) {
        await test.step(`Footer link: ${target.name} -> ${target.href}`, async () => {
            await clickFooterLinkAndVerify(page, baseURL, target);
        });
    }
});

test('Footer - Verify Legal Links', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    for (const target of LEGAL_FOOTER_LINKS) {
        await test.step(`Footer legal link: ${target.name} -> ${target.href}`, async () => {
            await clickFooterLinkAndVerify(page, baseURL, target);
        });
    }
});

test('Footer - Verify Social Links', async ({ page }) => {
    await test.step('Open homepage and footer', async () => {
        await openHomeFooter(page);
    });

    for (const { href, name } of SOCIAL_FOOTER_LINKS) {
        await test.step(`Footer social link configuration: ${name} -> ${href}`, async () => {
            const footer = page.getByRole('contentinfo').first();
            const link = footer.locator(`a[href="${href}"]`).first();

            await expect(link, `Footer social link "${name}" should be visible`).toBeVisible();
            await expect(link, `Footer social link "${name}" should expose the expected accessible name`).toHaveAccessibleName(name);

            const linkHost = new URL(href).hostname.replace(/^www\./i, '');
            expect(SOCIAL_DOMAINS.some((domain) => linkHost === domain || linkHost.endsWith(`.${domain}`)), `Footer social link "${name}" should point to a supported social domain`).toBe(true);
        });
    }
});
