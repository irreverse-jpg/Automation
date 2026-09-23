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
// Coverage notes - turn2us.org.uk site-wide footer
// ============================================================================
// Scope: the footer (`contentinfo` landmark), reached from the homepage - the
// full flat list of footer navigation links and the social icon row
// (Facebook, Instagram, LinkedIn, YouTube). No accordion/collapse behaviour
// on mobile - confirmed via 01-turn2us.homepage.spec.js's scroll test and
// direct probing 2026-09-23, every footer link stays directly visible on all
// 3 viewports.
//
// Tests in this file:
//   1. Footer - Verify Footer is Present
//      Confirms the footer and a stable footer link are visible.
//   2. Footer - Verify Links
//      Clicks each of the 14 real footer navigation links for real,
//      confirming each navigates to its expected URL with a visible H1.
//   3. Footer - Verify Social Links
//      Confirms each social icon (Facebook, Instagram, LinkedIn, YouTube) is
//      visible, has the right accessible name, and points at its expected
//      social domain. Does NOT assert target="_blank" - like RSC (and
//      unlike most other client projects in this workspace), Turn2us's
//      social footer links have no target attribute at all and navigate
//      away in the SAME tab (confirmed via direct probing 2026-09-23).
//
// Confirmed real content quirks (not test bugs), left as notes rather than
// failing assertions:
//   - "Back to top" (an in-page anchor, `#main-content`) and "Sign up to our
//     mailing list" (a duplicate CTA of the "eNewsletter" link, same
//     destination `/about-us/news-and-media/subscribe-enewsletter`) both
//     appear TWICE in the rendered footer DOM - a responsive-layout
//     duplication (like the header's two logo wrappers), not a content bug.
//     Both are excluded from FOOTER_LINKS below (chrome/duplicate-CTA, not
//     primary footer navigation) - `.first()` is used throughout so the
//     duplication doesn't cause strict-mode locator errors.
//   - Confirmed genuine inconsistency: of the two "Sign up to our mailing
//     list" duplicates, one has `target="_blank"` and the other
//     `target="_self"` - the same visible link behaves differently
//     depending on which responsive-layout copy is currently rendered.
//     Worth raising with the dev team, but not asserted on here since
//     neither copy is in FOOTER_LINKS's scope.
//   - Accreditation badge links (Eco-friendly web alliance, etc.) are
//     image-only with no accessible text and are footer decoration rather
//     than navigation - excluded from FOOTER_LINKS for the same reason.
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
//
// Confirmed CURRENT defect, left as a deliberately failing assertion (per
// this workspace's "don't skip broken links" convention) rather than
// excluded: the "Media Centre" footer link (/about-us/news-and-media/
// media-centre) loads (200) on Staging as of 2026-09-23, but the page has a
// literal empty `<h1></h1>` (zero height, so Playwright's own isVisible()
// correctly reports false) and an unformatted raw-slug page title
// ("media-centre | Turn2us" instead of a real title). The same URL on Live
// shows real content ("News and media | Turn2us" / H1 "News and media") -
// confirmed via direct side-by-side probing, not just a copy/paste error
// this time (see [[feedback_verify_before_reporting_defect]] for why that
// caveat matters here specifically - an earlier href for a different footer
// link in this same file was originally misreported as broken due to a
// transcription mistake, then corrected).
// ============================================================================

const SOCIAL_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'youtube.com'];

const FOOTER_LINKS = [
    { name: 'Latest news', href: '/about-us/news-and-media/latest-news' },
    { name: 'Media Centre', href: '/about-us/news-and-media/media-centre' },
    { name: 'Press releases', href: '/about-us/news-and-media/media-centre/press-releases-and-comments' },
    { name: 'eNewsletter', href: '/about-us/news-and-media/subscribe-enewsletter' },
    { name: 'Jobs at Turn2us', href: '/about-us/jobs' },
    { name: 'Jargon Buster', href: '/jargon-buster' },
    { name: 'Sitemap', href: '/sitemap' },
    { name: 'Modern Slavery Statement', href: '/modern-slavery-statement' },
    { name: 'Safeguarding', href: '/safeguarding' },
    { name: 'Complaints & Feedback', href: '/turn2us-complaints-and-feedback-policy' },
    { name: 'Accessibility', href: '/turn2us-website-accessibility' },
    { name: 'Cookie Policy', href: '/turn2us-website-cookie-policy' },
    { name: 'Privacy Policy', href: '/turn2us-privacy-policy' },
    { name: 'Terms & Conditions', href: '/turn2us-website-and-turn2us-helpline-terms-and-conditions' },
];

const SOCIAL_FOOTER_LINKS = [
    { name: 'Facebook', href: 'https://www.facebook.com/turn2us' },
    { name: 'Instagram', href: 'https://www.instagram.com/turn2us_org/' },
    { name: 'LinkedIn', href: 'https://www.linkedin.com/company/turn2us/' },
    { name: 'YouTube', href: 'https://www.youtube.com/user/Turn2us' },
];

function buildExpectedUrl(baseURL, path) {
    return new URL(path, baseURL).toString();
}

async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#CybotCookiebotDialog').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

async function openHomeFooter(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);

    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'The Turn2us footer should be visible on the homepage').toBeVisible();
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
        await expect(footer.getByRole('link', { name: 'Sitemap', exact: true }).first(), 'The footer should expose a stable footer link').toBeVisible();
    });
});

test('Footer - Verify Links', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    for (const target of FOOTER_LINKS) {
        await test.step(`Footer link: ${target.name} -> ${target.href}`, async () => {
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
