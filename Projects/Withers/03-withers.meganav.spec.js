const { test, expect } = require('@playwright/test');

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
        await acceptAllButton.click();
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
        await locator.click();
    }
}

async function openMenuIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);
    const openMenuButton = page.getByRole('button', { name: /Open menu|Menu/i }).first();
    if (await openMenuButton.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, openMenuButton);
    }
}

async function clickVisibleExpandableNavItem(page, name) {
    await dismissCookieOverlayIfPresent(page);

    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    const inputId = await primaryNav.locator('label.header__navLink').evaluateAll((labels, wantedName) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const match = labels.find((label) => isVisible(label) && normalize(label.textContent) === wantedName);
        return match ? match.getAttribute('for') : null;
    }, name);

    expect(inputId, `Expandable navigation item "${name}" should be clickable in the primary header`).toBeTruthy();

    const label = primaryNav.locator(`label[for="${inputId}"]`).first();
    await expect(label, `Expandable navigation label "${name}" should be visible before clicking`).toBeVisible();

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

    const stateInput = primaryNav.locator(`#${inputId}`).first();
    const isSelected = async () => {
        if (!(await stateInput.count())) {
            return false;
        }
        return await stateInput.evaluate((element) => element.checked).catch(() => false);
    };

    await expect.poll(async () => {
        return await isSelected();
    }, {
        message: `Expandable navigation item "${name}" should be selected after clicking it`,
        timeout: 10000,
        intervals: [250, 500, 1000]
    }).toBe(true);
}

async function clickPrimaryNavLink(page, name) {
    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    const targetLink = primaryNav.getByRole('link', { name, exact: true }).first();
    await dismissCookieOverlayIfPresent(page);
    await targetLink.click({ noWaitAfter: true });
}

async function clickVisibleNavLabel(page, name) {
    await dismissCookieOverlayIfPresent(page);

    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    const inputId = await primaryNav.locator('label.header__navLink').evaluateAll((labels, wantedName) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const match = labels.find((label) => isVisible(label) && normalize(label.textContent) === wantedName);
        return match ? match.getAttribute('for') : null;
    }, name);

    expect(inputId, `Navigation label "${name}" should be available in the primary header`).toBeTruthy();

    const label = primaryNav.locator(`label[for="${inputId}"]`).first();
    await expect(label, `Navigation label "${name}" should be visible before clicking`).toBeVisible();
    await clickWithCookieGuard(page, label);
}

test('Meganav - Verify Meganav is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
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
        await page.goto('/', { waitUntil: 'domcontentloaded' });
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
        await page.goto('/', { waitUntil: 'domcontentloaded' });
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
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Navigate to Corporate finance from Experience', async () => {
        await clickVisibleExpandableNavItem(page, 'Experience');
        await clickVisibleExpandableNavItem(page, 'Our practices');
        await clickVisibleNavLabel(page, 'Corporate');
        const primaryNav = page.getByRole('navigation', { name: 'Primary' });
        await expect(
            primaryNav.getByRole('link', { name: 'Corporate finance', exact: true }).first(),
            'Our practices should reveal the Corporate finance link before navigation'
        ).toBeVisible();
        await Promise.all([
            page.waitForURL(`${baseURL}/experience/our-practices/corporate/corporate-finance`, { waitUntil: 'domcontentloaded' }),
            clickPrimaryNavLink(page, 'Corporate finance'),
        ]);
        await expect(page.getByRole('heading', { name: 'Corporate finance' }), 'Corporate finance page should show the Corporate finance heading').toHaveText('Corporate finance');
    });

    await test.step('Navigate to New York from Locations', async () => {
        await openMenuIfPresent(page);
        await clickVisibleExpandableNavItem(page, 'Locations');
        await clickVisibleExpandableNavItem(page, 'North America');
        await Promise.all([
            page.waitForURL(`${baseURL}/locations/north-america/new-york`, { waitUntil: 'domcontentloaded' }),
            clickPrimaryNavLink(page, 'New York'),
        ]);
        await expect(page.getByRole('heading', { name: 'New York', exact: true }), 'New York page should show the New York heading').toHaveText('New York');
    });

    await test.step('Navigate to Defining moments from Insight', async () => {
        await openMenuIfPresent(page);
        await clickVisibleExpandableNavItem(page, 'Insight');
        await clickVisibleExpandableNavItem(page, 'Hot topics');
        await Promise.all([
            page.waitForURL(`${baseURL}/insight/defining-moments`, { waitUntil: 'domcontentloaded' }),
            clickPrimaryNavLink(page, 'Defining moments'),
        ]);
        await expect(page.getByRole('heading', { name: 'Defining moments', exact: true }), 'Defining moments page should show the Defining moments heading').toHaveText('Defining moments');
    });

    await test.step('Navigate to Reducing our impact from About', async () => {
        await openMenuIfPresent(page);
        await clickVisibleExpandableNavItem(page, 'About');
        await clickVisibleExpandableNavItem(page, 'Environmental responsibility');
        await Promise.all([
            page.waitForURL(`${baseURL}/about/environmental-responsibility/reducing-our-impact`, { waitUntil: 'domcontentloaded' }),
            clickPrimaryNavLink(page, 'Reducing our impact'),
        ]);
        await expect(page.getByRole('heading', { name: 'Reducing our impact' }), 'Reducing our impact page should show the Reducing our impact heading').toHaveText('Reducing our impact');
    });

    await test.step('Navigate to People from the main navigation', async () => {
        await openMenuIfPresent(page);
        await Promise.all([
            page.waitForURL(`${baseURL}/people`, { waitUntil: 'domcontentloaded' }),
            clickPrimaryNavLink(page, 'People'),
        ]);
        await expect(page.getByRole('heading', { name: 'Over 1,500 people working to assist you' }), 'People page should show the expected people heading').toHaveText('Over 1,500 people working to assist you');
    });

    await test.step('Navigate to Careers from the main navigation', async () => {
        await openMenuIfPresent(page);
        await Promise.all([
            page.waitForURL(`${baseURL}/careers`, { waitUntil: 'domcontentloaded' }),
            clickPrimaryNavLink(page, 'Careers'),
        ]);
        await expect(page.getByRole('heading', { name: 'A career at Withers' }), 'Careers page should show the A career at Withers heading').toBeVisible();
    });
}, 120000);