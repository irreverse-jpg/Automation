const { test, expect } = require('@playwright/test');

// Cookie Selector (If there is one)
const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#CybotCookiebotDialogBodyUnderlay, #CybotCookiebotDialog, #onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-consent-sdk';

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    const acceptAllButton = page.locator([
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '#CybotCookiebotDialogBodyButtonAccept',
        '#onetrust-accept-btn-handler',
        'button:has-text("Accept all cookies")',
        'button:has-text("Accept all")',
        'button:has-text("Accept")',
    ].join(', ')).first();
    const essentialOnlyButton = page.locator('button:has-text("Essential cookies only")').first();

    const overlayVisible = await cookieOverlay.isVisible().catch(() => false);
    const acceptVisible = await acceptAllButton.isVisible().catch(() => false);
    const essentialVisible = await essentialOnlyButton.isVisible().catch(() => false);

    if (!overlayVisible && !acceptVisible && !essentialVisible) {
        return;
    }

    if (acceptVisible) {
        await acceptAllButton.click({ timeout: 3000 }).catch(() => { });
    } else if (essentialVisible) {
        await essentialOnlyButton.click({ timeout: 3000 }).catch(() => { });
    }

    await expect(cookieOverlay).not.toBeVisible({ timeout: 10000 }).catch(() => { });
}

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR);
    if (await cookieButton.first().isVisible().catch(() => false)) {
        await cookieButton.first().click();
    }

    await dismissCookieOverlayIfPresent(page);
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openMenuIfPresent(page) {
    const openMenuButton = page.getByRole('button', { name: 'Open menu' });
    if (await openMenuButton.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, openMenuButton);
    }
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isCookieInterception = message.includes('intercepts pointer events') || message.includes('cybot') || message.includes('onetrust');

        if (!isCookieInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

async function clickVisibleNavLink(page, name) {
    const clicked = await page.evaluate((wantedName) => {
        const isVisible = (el) => {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
        };

        const links = Array.from(document.querySelectorAll('nav#nav-main a[id^="level1-item"]'));
        const target = links.find(link =>
            isVisible(link) && (link.textContent || '').trim().toLowerCase() === wantedName.toLowerCase()
        );

        if (!target) return false;
        target.click();
        return true;
    }, name);

    expect(clicked, `Top-level navigation item "${name}" should be clickable in the PBS meganav`).toBeTruthy();
}

async function expectTopLevelNavExpanded(page, name) {
    await expect.poll(async () => {
        return await page.evaluate((wantedName) => {
            const isVisible = (el) => {
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
            };

            const links = Array.from(document.querySelectorAll('nav#nav-main a[id^="level1-item"]'));
            const target = links.find(link =>
                isVisible(link) && (link.textContent || '').trim().toLowerCase() === wantedName.toLowerCase()
            );

            return !!target && (target.getAttribute('aria-expanded') || '').toLowerCase() === 'true';
        }, name);
    }, {
        timeout: 10000,
        intervals: [250, 500, 1000]
    }).toBe(true);
}

test('Meganav - Verify Meganav is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Verify PBS meganav is visible', async () => {
        const navMain = page.locator('nav.nav-main#nav-main');
        await expect(navMain, 'PBS meganav should be visible once the menu is opened').toBeVisible({ timeout: 10000 });
    });
});

test('Meganav - Verify Header Logo is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Verify header logo is visible', async () => {
        const headerLogo = page.locator('header').getByRole('link', { name: /Principality Building Society/i });
        await expect(headerLogo, 'PBS header logo should be visible in the header').toBeVisible();
    });
});

test('Meganav - Expand Each of the Meganav Links', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    const expandableItems = ['Mortgages', 'Savings', 'Help and support', 'About us'];
    for (const item of expandableItems) {
        await test.step(`Expand ${item}`, async () => {
            await clickVisibleNavLink(page, item);
            await expectTopLevelNavExpanded(page, item);
        });
    }
});

test('Meganav - Navigate to Second Level', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    await test.step('Open homepage and primary navigation', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Navigate to Residential mortgages from Mortgages', async () => {
        await clickVisibleNavLink(page, 'Mortgages');
        await clickWithCookieGuard(page, page.getByRole('link', { name: 'Mortgage products', exact: true }));
        await clickWithCookieGuard(page, page.getByRole('link', { name: 'Residential mortgages', exact: true }));
        await expect(page, 'Residential mortgages link should navigate to the mortgage products page').toHaveURL(`${baseURL}home/mortgages/mortgage-products`);
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Navigate to Mortgages home from Choosing a mortgage', async () => {
        await clickVisibleNavLink(page, 'Mortgages');
        await clickWithCookieGuard(page, page.getByRole('link', { name: 'Choosing a mortgage', exact: true }));
        await clickWithCookieGuard(page, page.getByLabel('Choosing a mortgage').getByRole('link', { name: 'Mortgages home' }));
        await expect(page, 'Mortgages home link should navigate back to the main mortgages page').toHaveURL(`${baseURL}home/mortgages`);
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Navigate to Savings support from Savings', async () => {
        await clickVisibleNavLink(page, 'Savings');
        await clickWithCookieGuard(page, page.getByRole('link', { name: 'Need help with savings', exact: true }));
        await clickWithCookieGuard(page, page.getByLabel('Need help with savings').getByRole('link', { name: 'Savings support', exact: true }));
        await expect(page, 'Savings support link should navigate to the savings support page').toHaveURL(`${baseURL}home/contact-us/help-and-support/savings-support`);
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Navigate to Closing an account from Help and support', async () => {
        await clickVisibleNavLink(page, 'Help and support');
        await clickWithCookieGuard(page, page.getByRole('link', { name: 'Difficult times', exact: true }));
        await clickWithCookieGuard(page, page.getByLabel('Difficult times').getByRole('link', { name: 'Closing an account', exact: true }));
        await expect(page, 'Closing an account link should navigate to the bereavement support page').toHaveURL(`${baseURL}home/contact-us/help-and-support/closing-an-account-after-someone-dies`);
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Navigate to Building a fairer society from About us', async () => {
        await clickVisibleNavLink(page, 'About us');
        await clickWithCookieGuard(page, page.getByRole('link', { name: 'Our impact', exact: true }));
        await clickWithCookieGuard(page, page.getByRole('link', { name: 'Building a fairer society', exact: true }));
        await expect(page, 'Building a fairer society link should navigate to the about-us impact page').toHaveURL(`${baseURL}home/about-us/building-a-fairer-society`);
        await page.goBack({ waitUntil: 'domcontentloaded' });
    });
});