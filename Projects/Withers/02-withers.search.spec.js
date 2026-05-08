const { test, expect } = require('@playwright/test');

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

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

test('Search - Empty Query', async ({ page }) => {
    await test.step('Open search page', async () => {
        await page.goto('/search');
        await page.waitForLoadState('load');
        await acceptCookiesIfPresent(page);
    });

    await test.step('Submit empty search and verify empty results state', async () => {
        await clickWithCookieGuard(page, page.locator('button[type="submit"]'));
        await expect(page, 'Empty search should redirect to the filter results URL').toHaveURL(/\/search\?term=&type=all#filter$/);
        await expect(page.getByRole('heading', { name: 'Search' }), 'Search results page should show the Search heading').toHaveText('Search');
        await expect(page.locator('.search-results .result-item'), 'Empty search should not list any result items').toHaveCount(0);
    });
}, 30000);

test('Search - With and Without Results', async ({ page }) => {
    await test.step('Open search page', async () => {
        await page.goto('/search');
        await page.waitForLoadState('load');
        await acceptCookiesIfPresent(page);
    });
    const searchBox = page.getByRole('textbox', { name: /Search Withersworldwide/i });

    await test.step('Search with a term that returns no results', async () => {
        await searchBox.fill('asdasdasd');
        await clickWithCookieGuard(page, page.locator('button[type="submit"]'));
        await expect(page, 'No-result search should redirect to the expected results URL').toHaveURL(/\/search\?term=asdasdasd&type=all#filter$/);
        await expect(page.getByRole('heading', { name: 'Search' }), 'No-result search should keep the Search heading visible').toHaveText('Search');
        await expect(page.getByText(/0 results match your search/i), 'No-result search should show the 0 results summary').toBeVisible();
    });

    await test.step('Search with a term that returns results', async () => {
        await searchBox.fill('practices');
        await clickWithCookieGuard(page, page.locator('button[type="submit"]'));
        await expect(page, 'Results search should redirect to the expected results URL').toHaveURL(/\/search\?term=practices&type=all#filter$/);
        await expect(page.getByRole('heading', { name: 'Search' }), 'Results search should keep the Search heading visible').toHaveText('Search');
        await expect(page.getByText(/[1-9]\d* results match your search/i), 'Results search should show a non-zero results summary').toBeVisible();
    });
}, 30000);

test('Search - Navigate Through Results', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open search page', async () => {
        await page.goto('/search');
        await page.waitForLoadState('load');
        await acceptCookiesIfPresent(page);
    });

    const resultsSummary = () => page.locator('div').filter({ hasText: 'results match your search' }).nth(2);
    const resultTabs = [
        {
            name: 'Experience',
            type: 'experience',
            link: () => page.getByRole('link', { name: 'Experience', exact: true }),
        },
        {
            name: 'People',
            type: 'people',
            link: () => page.locator('#container').getByRole('link', { name: 'People' }),
        },
        {
            name: 'Insight',
            type: 'insights',
            link: () => page.locator('#container').getByRole('link', { name: 'Insight' }),
        },
        {
            name: 'Other',
            type: 'other',
            link: () => page.getByRole('link', { name: 'Other' }),
        },
    ];

    await test.step('Search for practices to reach the default All tab', async () => {
        await page.getByRole('textbox', { name: /Search Withersworldwide/i }).fill('practices');
        await clickWithCookieGuard(page, page.locator('button[type="submit"]'));
        await expect(page, 'Default search results should land on the All tab URL').toHaveURL(/\/search\?term=practices&type=all#filter$/);
    });

    for (const tab of resultTabs) {
        await test.step(`Open ${tab.name} results tab`, async () => {
            await Promise.all([
                page.waitForURL(new RegExp(`/search\\?term=practices&type=${tab.type}#filter$`), { waitUntil: 'domcontentloaded' }),
                clickWithCookieGuard(page, tab.link()),
            ]);
            await page.waitForLoadState('load');
            await acceptCookiesIfPresent(page);
            await expect(page, `${tab.name} tab should update the results URL`).toHaveURL(new RegExp(`/search\\?term=practices&type=${tab.type}#filter$`));
            await expect(resultsSummary(), `${tab.name} tab should show a non-zero results summary`).toContainText(/[1-9]\d* results match your search/i);
            await expect(page.getByRole('heading', { name: tab.name, exact: true }), `${tab.name} tab should show the matching section heading`).toBeVisible();
        });
    }
}, 60000);
