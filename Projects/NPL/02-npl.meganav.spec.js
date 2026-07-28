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
// Coverage notes - npl.co.uk main navigation
// ============================================================================
// Scope: the site-wide primary navigation accordion (6 top-level items) and
// header logo. Not scoped to any single page - these tests open the
// homepage first, then drive the menu from there.
//
// Confirmed top-level items (2026-07-28, both Live and UAT):
//   Research and science, Products and services, Strategic programmes,
//   Education and learning, News and events, About NPL.
//
// Tests in this file:
//   1. Meganav - Verify Meganav is Present
//      Confirms the primary navigation is visible.
//   2. Meganav - Verify Header Logo is Present
//      Confirms the NPL header logo link is visible.
//   3. Meganav - Expand Each of the Meganav Links
//      Expands each of the 6 top-level items and confirms its panel reveals
//      an expected overview link.
//   4. Meganav - Navigate to Second Level
//      Walks a real second-level link from each of the 6 top-level items,
//      confirming each lands on its expected page.
//
// On mobile/tablet the accordion is reached through the "#nav-toggle" (Open
// menu) button first; the top-level items themselves use the same
// `.nav-main__level1-item > a.nav-main__control` structure on every
// viewport, and respond to a genuine Playwright `.click()` (no synthetic
// `evaluate((el) => el.click())` needed here - confirmed directly against
// the real site, unlike the accordion pitfall found on other projects'
// meganav specs).
//
// CONFIRMED UAT DEFECT (2026-07-28): expectations below are written against
// Live content (per team convention - test cases are based on Live, the
// suite runs against UAT by default). Two real Live/UAT content gaps were
// found while building this suite and are expected to make the affected
// UAT assertions fail (not a spec bug):
//   - "About NPL" panel is missing the "About us overview" link entirely
//     on UAT (Live has it as the first item in that panel).
//   - "Products and services" panel's calibration link reads "Calibration"
//     on UAT vs "Calibration services" on Live.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

const TOP_LEVEL_ITEMS = [
    { name: 'Research and science', expectedOption: 'Overview of research' },
    { name: 'Products and services', expectedOption: 'Products and services overview' },
    { name: 'Strategic programmes', expectedOption: 'National Timing Centre (NTC)' },
    { name: 'Education and learning', expectedOption: 'Training and courses' },
    { name: 'News and events', expectedOption: 'News and blog' },
    { name: 'About NPL', expectedOption: 'About us overview' },
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

// NPL's OneTrust accept button renders before its click handler finishes attaching -
// clicking the instant it's visible silently no-ops and leaves the overlay intercepting
// later clicks, so this retries the click until the banner actually disappears.
async function openHomepage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await dismissCookieOverlayIfPresent(page);
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
}

// "#nav-toggle" is a toggle button (same button opens AND closes the menu), so this must
// check whether the menu is already open before clicking - otherwise a second call (e.g.
// expanding a 2nd top-level item after the 1st) would close the menu it just opened.
async function openMenuIfPresent(page) {
    const navToggle = page.locator('#nav-toggle');
    if (!(await navToggle.isVisible().catch(() => false))) {
        return;
    }

    if (await page.locator('.nav-main__level1-item').first().isVisible().catch(() => false)) {
        return;
    }

    // A floating widget (feedback tab / cookie-settings pill) sits over the header on
    // tablet/mobile, so the plain actionability-checked click in clickWithCookieGuard can
    // hang waiting for stability - force-click nav-toggle directly instead. The click also
    // doesn't always register on the first attempt, so this retries a few times.
    await dismissCookieOverlayIfPresent(page);
    const level1Items = page.locator('.nav-main__level1-item').first();
    await expect.poll(async () => {
        await navToggle.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        return await level1Items.isVisible().catch(() => false);
    }, {
        message: 'Opening the mobile menu should expose the primary navigation items',
        timeout: 10000,
        intervals: [300, 500, 1000],
    }).toBe(true);
}

function level1Item(page, name) {
    return page.locator('.nav-main__level1-item > a.nav-main__control').filter({ hasText: name }).first();
}

// On tablet/mobile only one top-level panel renders its content correctly at a time - the
// DOM lets a 2nd panel report itself as "visible" while the previous one is still expanded,
// but that 2nd panel's own links end up visually obstructed until the 1st one is collapsed.
// Re-clicking an already-expanded item does NOT collapse it (confirmed: aria-expanded stays
// "true"); the "#back-to-main" button is what actually resets the accordion to collapsed.
async function collapseAnyExpandedItem(page) {
    const anyExpanded = await page.locator('.nav-main__level1-item > a.nav-main__control[aria-expanded="true"]').first().isVisible().catch(() => false);
    if (!anyExpanded) {
        return;
    }

    const backButton = page.locator('#back-to-main');
    if (await backButton.isVisible().catch(() => false)) {
        await backButton.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
    }
}

// The accordion click doesn't always register on the first attempt (same flakiness as
// "#nav-toggle"), so this retries until the panel is actually visible rather than trusting
// a single click.
async function expandTopLevelItem(page, name) {
    await openMenuIfPresent(page);
    const item = level1Item(page, name);
    await expect(item, `Top-level navigation item "${name}" should be visible before expanding`).toBeVisible();
    await collapseAnyExpandedItem(page);
    const controlsId = await item.getAttribute('aria-controls');
    const panel = page.locator(`#${controlsId}`);

    await expect.poll(async () => {
        await dismissCookieOverlayIfPresent(page);
        await item.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        return await panel.isVisible().catch(() => false);
    }, {
        message: `Expanding "${name}" should reveal its panel`,
        timeout: 10000,
        intervals: [300, 500, 1000],
    }).toBe(true);

    return panel;
}

test('Meganav - Verify Meganav is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await openHomepage(page);
        await openMenuIfPresent(page);
    });

    await test.step('Verify the meganav is visible', async () => {
        const nav = page.getByRole('navigation').first();
        await expect(nav, 'Primary navigation should be visible').toBeVisible();
        await expect(level1Item(page, 'Research and science'), 'Primary navigation should list its top-level items').toBeVisible();
    });
}, 30000);

test('Meganav - Verify Header Logo is Present', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Verify the header logo is visible', async () => {
        const logo = page.getByRole('banner').getByRole('link', { name: /national physical laboratory/i }).first();
        await expect(logo, 'Header logo link should be visible inside the banner').toBeVisible();
    });
}, 30000);

test('Meganav - Expand Each of the Meganav Links', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    for (const item of TOP_LEVEL_ITEMS) {
        await test.step(`Expand ${item.name} and verify ${item.expectedOption}`, async () => {
            const panel = await expandTopLevelItem(page, item.name);
            await expect(
                panel.getByRole('link', { name: item.expectedOption, exact: true }).first(),
                `${item.name} menu should reveal the ${item.expectedOption} option`
            ).toBeVisible();
        });
    }
}, 60000);

test('Meganav - Navigate to Second Level', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    const navigationTargets = [
        { topLevel: 'Research and science', linkName: 'Overview of research', urlPattern: /\/research(?:[?#].*)?$/i },
        { topLevel: 'Products and services', linkName: 'Calibration services', urlPattern: /\/products-services\/calibration(?:[?#].*)?$/i },
        { topLevel: 'Strategic programmes', linkName: 'National Timing Centre (NTC)', urlPattern: /national-timing-centre/i },
        { topLevel: 'Education and learning', linkName: 'Training and courses', urlPattern: /training/i },
        { topLevel: 'News and events', linkName: 'News and blog', urlPattern: /news/i },
        { topLevel: 'About NPL', linkName: 'About us overview', urlPattern: /about/i },
    ];

    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    for (const target of navigationTargets) {
        await test.step(`Navigate to ${target.linkName} from ${target.topLevel}`, async () => {
            const panel = await expandTopLevelItem(page, target.topLevel);
            const link = panel.getByRole('link', { name: target.linkName, exact: true }).first();
            await expect(link, `${target.topLevel} menu should expose the ${target.linkName} link before navigation`).toBeVisible();
            await clickWithCookieGuard(page, link);
            await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
            await expect(page, `${target.linkName} should navigate to the expected page`).toHaveURL(target.urlPattern);
            await dismissCookieOverlayIfPresent(page);
            await openHomepage(page);
        });
    }
}, 120000);
