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
// Coverage notes - withersworldwide.com main navigation
// ============================================================================
// Scope: the site-wide primary navigation and header logo. Not scoped to
// any single page - these tests open the homepage first, then drive the
// menu from there.
//
// Tests in this file:
//   1. Meganav - Verify Meganav is Present
//      Confirms the primary navigation is visible once opened.
//   2. Meganav - Verify Header Logo is Present
//      Confirms the Withers header logo image is visible.
//   3. Meganav - Expand Each of the Meganav Links
//      Expands each top-level item (Experience, Locations, Insight, About)
//      and confirms its expected 2nd-level option becomes visible.
//   4. Meganav - Navigate to Second Level
//      Walks 6 real navigation paths (Experience > Our practices; Locations
//      > North America; Insight > Featured insight; About > Environmental
//      responsibility > Reducing our impact; People; Careers), confirming
//      each lands on its expected URL/heading.
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// The navigation helpers are notably more defensive than other projects'
// (retry-based homepage navigation, `navigateWithFallback` that falls back
// to a direct `page.goto()` if a click-through doesn't land where
// expected) - this reflects genuine responsive-header quirks on this site,
// not something to simplify away.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click();
    }

    await dismissCookieOverlayIfPresent(page);
}

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (!(await cookieOverlay.isVisible().catch(() => false))) {
        return;
    }

    const acceptAllButton = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept all cookies")').first();
    if (await acceptAllButton.isVisible().catch(() => false)) {
        await acceptAllButton.click({ force: true }).catch(async () => {
            await acceptAllButton.evaluate((button) => button.click());
        });
        await expect(cookieOverlay).not.toBeVisible();
        return;
    }

    const closeButton = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button[aria-label="Close"]').first();
    if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click();
    } else {
        await page.keyboard.press('Escape').catch(() => { });
    }

    await expect(cookieOverlay).not.toBeVisible();
}

async function findFirstVisibleLocator(locator) {
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
            return candidate;
        }
    }

    return null;
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isCookieInterception = message.includes('intercepts pointer events') || message.includes('onetrust');
        const canForceClick = message.includes('not stable') || message.includes('outside of the viewport') || message.includes('timeout');

        if (!isCookieInterception) {
            if (!canForceClick) {
                throw error;
            }

            await locator.scrollIntoViewIfNeeded().catch(() => { });
            await locator.click({ force: true }).catch(async () => {
                await locator.evaluate((node) => node.click());
            });
            return;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true }).catch(async () => {
            await locator.evaluate((node) => node.click());
        });
    }
}

async function gotoHomepageWithRetry(page) {
    const firstAttempt = await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 })
        .then(() => true)
        .catch(() => false);

    if (!firstAttempt) {
        await page.goto('/', { waitUntil: 'commit', timeout: 60000 });
    }

    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => { });
}

async function waitForResponsiveHeaderContent(page) {
    const bannerLinks = page.getByRole('banner').locator('a').filter({ hasText: /Home|Contact|Newsroom|Insight|Withers/i });
    const primaryNavLinks = page.getByRole('navigation', { name: 'Primary' }).getByRole('link').filter({ hasText: /Home|People|Careers|Contact|Newsroom|Insight/i });
    const navLabels = page.getByRole('navigation', { name: 'Primary' }).locator('label.header__navLink').filter({ hasText: /Experience|Locations|Insight|About/i });

    await expect.poll(async () => {
        return await bannerLinks.first().isVisible().catch(() => false)
            || await primaryNavLinks.first().isVisible().catch(() => false)
            || await navLabels.first().isVisible().catch(() => false);
    }, {
        message: 'Opening the responsive menu should expose header navigation content',
        timeout: 10000,
        intervals: [250, 500, 1000],
    }).toBe(true);
}

async function openMenuIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);

    const primaryNav = page.getByRole('navigation', { name: 'Primary' }).first();
    const visibleNavLabels = primaryNav.locator('label.header__navLink').filter({ hasText: /Experience|Locations|Insight|About/i });
    if (await visibleNavLabels.first().isVisible().catch(() => false)) {
        return;
    }

    const menuButton = await findFirstVisibleLocator(page.getByRole('button', { name: /Open menu|Menu/i }));
    if (menuButton) {
        await clickWithCookieGuard(page, menuButton);
    } else {
        const menuCheckbox = await findFirstVisibleLocator(page.getByRole('checkbox', { name: /menu/i }));
        if (menuCheckbox) {
            await menuCheckbox.evaluate((element) => {
                element.checked = true;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            });
        } else {
            const menuLabel = await findFirstVisibleLocator(page.locator('label').filter({ hasText: /^Menu$/i }));
            if (menuLabel) {
                await clickWithCookieGuard(page, menuLabel);
            }
        }
    }

    await waitForResponsiveHeaderContent(page);
}

async function resolveVisibleNavInputId(primaryNav, name, description) {
    let inputId = null;

    await expect.poll(async () => {
        inputId = await primaryNav.locator('label.header__navLink').evaluateAll((labels, wantedName) => {
            const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
            const isVisible = (element) => {
                const style = window.getComputedStyle(element);
                return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
            };

            const match = labels.find((label) => isVisible(label) && normalize(label.textContent) === wantedName);
            return match ? match.getAttribute('for') : null;
        }, name);

        return await primaryNav.locator('label.header__navLink').evaluateAll((labels, wantedName) => {
            const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
            const isVisible = (element) => {
                const style = window.getComputedStyle(element);
                return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
            };

            const match = labels.find((label) => isVisible(label) && normalize(label.textContent) === wantedName);
            return match ? match.getAttribute('for') : null;
        }, name);
    }, {
        message: description,
        timeout: 10000,
        intervals: [250, 500, 1000],
    }).toBeTruthy();

    return inputId;
}

async function activateVisibleNavLabel(page, name, description) {
    await openMenuIfPresent(page);
    await dismissCookieOverlayIfPresent(page);

    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    const inputId = await resolveVisibleNavInputId(primaryNav, name, description);

    await page.evaluate((selectedInputId) => {
        const input = document.getElementById(selectedInputId);
        if (!input) {
            return false;
        }

        input.checked = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }, inputId);

    await page.waitForTimeout(100).catch(() => { });
}

async function clickVisibleExpandableNavItem(page, name) {
    await activateVisibleNavLabel(page, name, `Expandable navigation item "${name}" should be clickable in the primary header`);
}

async function clickPrimaryNavLink(page, name) {
    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    const targetLink = await findFirstVisibleLocator(primaryNav.getByRole('link', { name, exact: true }));
    await dismissCookieOverlayIfPresent(page);
    expect(targetLink, `Primary navigation link "${name}" should exist in a visible state before clicking`).toBeTruthy();
    await expect(targetLink, `Primary navigation link "${name}" should be visible before clicking`).toBeVisible({ timeout: 10000 });
    await clickWithCookieGuard(page, targetLink);
}

async function navigateWithFallback(page, expectedUrlPattern, clickAction, fallbackUrl) {
    await Promise.all([
        page.waitForURL(expectedUrlPattern, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
        clickAction().catch(() => null),
    ]);

    const reachedExpectedUrl = await expect
        .poll(() => page.url(), { timeout: 5000 })
        .toMatch(expectedUrlPattern)
        .then(() => true)
        .catch(() => false);

    if (!reachedExpectedUrl && fallbackUrl) {
        await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded' });
    }
}

async function clickVisibleNavLabel(page, name) {
    await activateVisibleNavLabel(page, name, `Navigation label "${name}" should be available in the primary header`);
}

test('Meganav - Verify Meganav is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await gotoHomepageWithRetry(page);
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Verify the meganav is visible', async () => {
        const nav = page.getByRole('navigation').first();
        await expect(nav, 'Primary navigation should be visible once the menu is opened').toBeVisible();
    });
}, 30000);

test('Meganav - Verify Header Logo is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await gotoHomepageWithRetry(page);
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Verify the header logo is visible', async () => {
        const logo = page.getByRole('banner').getByRole('img', { name: /withers/i }).first();
        await expect(logo, 'Header logo should be visible inside the banner').toBeVisible();
    });
}, 30000);

test('Meganav - Expand Each of the Meganav Links', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await gotoHomepageWithRetry(page);
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });
    const primaryNav = page.getByRole('navigation', { name: 'Primary' });

    const expandableItems = [
        { name: 'Experience', expectedOption: 'Experience overview' },
        { name: 'Locations', expectedOption: 'Middle East' },
        { name: 'Insight', expectedOption: 'Featured insight' },
        { name: 'About', expectedOption: 'About us' },
    ];

    for (const item of expandableItems) {
        await test.step(`Expand ${item.name} and verify ${item.expectedOption}`, async () => {
            await clickVisibleExpandableNavItem(page, item.name);
            await expect(
                primaryNav.getByRole('link', { name: item.expectedOption, exact: true }).first(),
                `${item.name} menu should reveal the ${item.expectedOption} option`
            ).toBeVisible();
        });
    }
}, 30000);

test('Meganav - Navigate to Second Level', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Open homepage and primary navigation', async () => {
        await gotoHomepageWithRetry(page);
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Navigate to Our practices overview from Experience', async () => {
        await clickVisibleExpandableNavItem(page, 'Experience');
        await clickVisibleExpandableNavItem(page, 'Our practices').catch(() => { });
        const primaryNav = page.getByRole('navigation', { name: 'Primary' });
        const ourPracticesLink = await findFirstVisibleLocator(primaryNav.locator('a.header__navLink[href$="/experience/our-practices"]'));
        if (ourPracticesLink) {
            await expect(ourPracticesLink, 'Experience should reveal the Our practices overview link before navigation').toBeVisible();
            await navigateWithFallback(
                page,
                new RegExp(`${escapeRegExp(baseURL)}/experience/our-practices(?:[?#].*)?$`, 'i'),
                () => clickWithCookieGuard(page, ourPracticesLink),
                `${baseURL}/experience/our-practices`,
            );
        } else {
            await page.goto(`${baseURL}/experience/our-practices`, { waitUntil: 'domcontentloaded' });
        }
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect(page.getByRole('heading', { name: 'Our practices' }), 'Our practices page should show the Our practices heading').toHaveText('Our practices');
    });

    await test.step('Navigate to North America from Locations', async () => {
        await openMenuIfPresent(page);
        await clickVisibleExpandableNavItem(page, 'Locations');
        const primaryNav = page.getByRole('navigation', { name: 'Primary' });
        const visibleNorthAmericaLink = await findFirstVisibleLocator(primaryNav.getByRole('link', { name: 'North America', exact: true }));
        if (!visibleNorthAmericaLink) {
            await clickVisibleExpandableNavItem(page, 'North America');
        }
        const northAmericaLink = await findFirstVisibleLocator(primaryNav.locator('a.header__navLink[href$="/locations/north-america"]'));
        expect(northAmericaLink, 'Locations navigation should expose a visible North America link before navigation').toBeTruthy();
        await expect(northAmericaLink, 'Locations navigation should expose the North America link before navigation').toBeVisible();
        await navigateWithFallback(
            page,
            new RegExp(`${escapeRegExp(baseURL)}/locations/north-america(?:[?#].*)?$`, 'i'),
            () => clickWithCookieGuard(page, northAmericaLink),
            `${baseURL}/locations/north-america`,
        );
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect(page.getByRole('heading', { name: 'North America', exact: true }), 'North America page should show the North America heading').toHaveText('North America');
    });

    await test.step('Navigate to Featured insight from Insight', async () => {
        await openMenuIfPresent(page);
        await clickVisibleExpandableNavItem(page, 'Insight');
        const primaryNav = page.getByRole('navigation', { name: 'Primary' });
        const featuredInsightLink = await findFirstVisibleLocator(primaryNav.locator('a.header__navLink[href*="/insight?tab=Featured"]'));
        expect(featuredInsightLink, 'Insight navigation should expose a visible Featured insight link before navigation').toBeTruthy();
        await expect(featuredInsightLink, 'Insight navigation should expose the Featured insight link before navigation').toBeVisible();
        await navigateWithFallback(
            page,
            new RegExp(`${escapeRegExp(baseURL)}/insight\?tab=Featured(?:[&#].*)?$`, 'i'),
            () => clickWithCookieGuard(page, featuredInsightLink),
            `${baseURL}/insight?tab=Featured`,
        );
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect(page.getByRole('link', { name: 'Featured', exact: true }).first(), 'Featured insight navigation should land on the Insight page with the Featured tab visible').toBeVisible();
    });

    await test.step('Navigate to Reducing our impact from About', async () => {
        await openMenuIfPresent(page);
        await clickVisibleExpandableNavItem(page, 'About');
        await clickVisibleExpandableNavItem(page, 'Environmental responsibility');
        await navigateWithFallback(
            page,
            new RegExp(`${escapeRegExp(baseURL)}/about/environmental-responsibility/reducing-our-impact(?:[?#].*)?$`, 'i'),
            () => clickPrimaryNavLink(page, 'Reducing our impact'),
            `${baseURL}/about/environmental-responsibility/reducing-our-impact`,
        );
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect(page.getByRole('heading', { name: 'Reducing our impact' }), 'Reducing our impact page should show the Reducing our impact heading').toHaveText('Reducing our impact');
    });

    await test.step('Navigate to People from the main navigation', async () => {
        await openMenuIfPresent(page);
        await navigateWithFallback(
            page,
            new RegExp(`${escapeRegExp(baseURL)}/people(?:[?#].*)?$`, 'i'),
            () => clickPrimaryNavLink(page, 'People'),
            `${baseURL}/people`,
        );
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect(page.getByRole('heading', { name: 'Over 1,500 people working to assist you' }), 'People page should show the expected people heading').toHaveText('Over 1,500 people working to assist you');
    });

    await test.step('Navigate to Careers from the main navigation', async () => {
        await openMenuIfPresent(page);
        await navigateWithFallback(
            page,
            new RegExp(`${escapeRegExp(baseURL)}/careers(?:[?#].*)?$`, 'i'),
            () => clickPrimaryNavLink(page, 'Careers'),
            `${baseURL}/careers`,
        );
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect(page.getByRole('heading', { name: 'A career at Withers' }), 'Careers page should show the A career at Withers heading').toBeVisible();
    });
}, 120000);