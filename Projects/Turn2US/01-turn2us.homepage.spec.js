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
// Coverage notes - turn2us.org.uk homepage ("/")
// ============================================================================
// Scope: the homepage only - title, hero heading, top-level nav (desktop and
// mobile), footer visibility, and skip links. Confirmed via direct probing
// against Staging (2026-09-23):
//   - Title: "Tackling financial insecurity together | Turn2us"
//   - Hero H1: "We believe everyone in the UK should have financial security
//     so they can thrive."
//   - Top-level nav + confirmed real hrefs: Get support (/get-support), Get
//     involved (/get-involved), Campaigns & research (/campaigns-and-policy),
//     Services for organisations (/services-for-organisations), About us
//     (/about-us), Login (/myturn2us).
//   - IMPORTANT correction: an initial WebFetch-based pass wrongly concluded
//     there was no cookie-consent banner. There IS one - it's Cookiebot (not
//     OneTrust, unlike most other client projects in this workspace),
//     injected via JS so a static page fetch misses it entirely. Confirmed
//     dialog id `#CybotCookiebotDialog`, "Allow all cookies" button id
//     `#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll`.
//   - On mobile/tablet-width viewports, the top-level nav items are hidden
//     until a hamburger toggle is opened - confirmed via direct probing:
//     button `#nav-toggle` (aria-label "Toggle menu"), visible whenever the
//     desktop nav isn't. Tests below open it before checking nav item
//     presence.
//
// The full main menu (dropdown structure per top-level item) and footer
// column structure are NOT covered here - they get their own dedicated
// specs (02-turn2us.meganav.spec.js, 03-turn2us.footer.spec.js) per project
// convention, once each menu's real submenu items are confirmed.
//
// Per Hector: Live has some extra content and a few differently-named menu
// options versus Staging - most spec-building work happens against Staging,
// reconciling naming/content differences with Live as each area is built out
// rather than trying to fully match them upfront.
// ============================================================================

const TOP_LEVEL_NAV_ITEMS = [
    { name: 'Get support', hrefPath: '/get-support' },
    { name: 'Get involved', hrefPath: '/get-involved' },
    { name: 'Campaigns & research', hrefPath: '/campaigns-and-policy' },
    { name: 'Services for organisations', hrefPath: '/services-for-organisations' },
    { name: 'About us', hrefPath: '/about-us' },
];

const COOKIE_DIALOG_SELECTOR = '#CybotCookiebotDialog';

async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator(COOKIE_DIALOG_SELECTOR).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

// Below the breakpoint where the desktop nav collapses, top-level nav items are hidden until this
// hamburger toggle is opened - confirmed via direct probing 2026-09-23.
async function openMobileMenuIfPresent(page) {
    const toggleButton = page.locator('#nav-toggle');
    if (await toggleButton.isVisible().catch(() => false)) {
        const alreadyOpenNavLink = page.getByRole('link', { name: 'Get support', exact: true }).first();
        if (!(await alreadyOpenNavLink.isVisible().catch(() => false))) {
            await toggleButton.click();
            await page.waitForTimeout(300);
        }
    }
}

async function waitForHomepageContent(page) {
    await expect(page.locator('h1').first(), 'Homepage should show its hero heading').toBeVisible();
}

test('Homepage - Homepage Loads', async ({ page }) => {
    test.setTimeout(30000);

    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await waitForHomepageContent(page);
    });

    await test.step('Verify homepage title', async () => {
        await expect(page, 'Homepage should load with the expected Turn2us title').toHaveTitle(/Turn2us/i);
    });

    await test.step('Verify hero heading', async () => {
        const h1 = page.locator('h1').first();
        await expect(h1, 'Homepage hero heading should have meaningful text').not.toHaveText('');
        expect((await h1.textContent())?.trim().length, 'Homepage hero heading should have meaningful text').toBeGreaterThan(10);
    });
});

test('Homepage - Scrolling Through the Page', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await waitForHomepageContent(page);
    });

    await test.step('Scroll to the footer', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(page.getByRole('contentinfo'), 'Scrolling to the bottom should reveal the footer').toBeVisible();
    });

    await test.step('Scroll back to the top', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), {
            message: 'Scrolling back to the top should return the viewport to the top edge of the page',
        }).toBeLessThanOrEqual(5);
    });
});

test('Homepage - Top-Level Navigation is Present', async ({ page }) => {
    test.setTimeout(45000);

    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await waitForHomepageContent(page);
        await openMobileMenuIfPresent(page);
    });

    for (const item of TOP_LEVEL_NAV_ITEMS) {
        await test.step(`Verify "${item.name}" nav item is present and points to ${item.hrefPath}`, async () => {
            const navItem = page.getByRole('link', { name: item.name, exact: true }).first();
            await expect(navItem, `Top-level nav item "${item.name}" should be attached`).toBeAttached();

            const href = await navItem.getAttribute('href');
            expect(href, `Top-level nav item "${item.name}" should link to ${item.hrefPath}`).toBe(item.hrefPath);
        });
    }
});

// Skip link(s) are discovered live via keyboard Tab rather than hardcoded, since sites differ on how
// many exist and what they're labelled. Missing a skip link entirely is a real accessibility gap, so
// this test is expected to fail on sites that don't have one rather than being skipped.
test('Homepage - Skip Links', async ({ page }) => {
    test.setTimeout(60000);

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
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

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
            await page.goto('/', { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await waitForAndAcceptCookieBanner(page);

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
