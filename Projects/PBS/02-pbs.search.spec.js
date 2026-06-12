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

async function getVisibleSearchBox(page) {
    const desktopSearchBox = page.locator('#search-desktop');
    if (await desktopSearchBox.isVisible().catch(() => false)) {
        return desktopSearchBox;
    }

    const mobileSearchBox = page.locator('#search-mobile');
    if (await mobileSearchBox.isVisible().catch(() => false)) {
        return mobileSearchBox;
    }

    await openMenuIfPresent(page);

    if (await desktopSearchBox.isVisible().catch(() => false)) {
        return desktopSearchBox;
    }

    await expect(mobileSearchBox, 'Homepage should expose a visible search input after opening the menu when needed').toBeVisible();
    return mobileSearchBox;
}

test('Search - Empty Query', async ({ page }) => {
    await test.step('Open homepage and focus the search box', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        const searchBox = await getVisibleSearchBox(page);
        await searchBox.focus();
        await searchBox.press('Enter');

        const validity = await searchBox.evaluate(input => input.validationMessage);
        expect(validity, 'Submitting an empty search should trigger the browser required-field validation').toMatch(/fill (in|out) this field/i);
    });
});

test('Search - With and Without Results', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });
    const searchBox = await getVisibleSearchBox(page);

    await test.step('Search with a term that returns no results', async () => {
        await searchBox.fill('asdasdasd');
        await searchBox.press('Enter');
        await expect(page, 'No-result search should navigate to the expected search results URL').toHaveURL(/search-results\?search=asdasdasd/);
        const noResultsHeading = page.getByRole('heading', { name: /No results found/ });
        await expect(noResultsHeading, 'No-result search should show the No results found heading').toBeVisible();
    });

    await test.step('Search with a term that returns results', async () => {
        await searchBox.fill('mortgage');
        await searchBox.press('Enter');
        await expect(page, 'Results search should navigate to the expected search results URL').toHaveURL(/search-results\?search=mortgage/);
        const resultsHeading = page.getByRole('heading', { name: /Showing results 1 to 15 of/ });
        await expect(resultsHeading, 'Results search should show the heading describing the first results page').toBeVisible();
    });
});

test('Search - Pagination of Results', async ({ page }) => {
    await test.step('Open a multi-page search results view', async () => {
        await page.goto('/search-results?search=savings&media=guide-article-5616,savings-products-listing-page-5610', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expect(page.getByText(/Oops! Something went wrong/i), 'Search pagination test should not land on the PBS error page before pagination is checked').not.toBeVisible();
    });

    await test.step('Open the second results page', async () => {
        const secondPageLink = page.getByRole('link', { name: /^(?:Go to page )?2$/ }).first();
        await expect(secondPageLink, 'Search results should expose a page 2 link before pagination is exercised').toBeVisible();
        await clickWithCookieGuard(page, secondPageLink);
        await expect(page, 'Selecting page 2 should update the pageNumber query parameter').toHaveURL(/search-results\?search=savings&media=guide-article-5616%2csavings-products-listing-page-5610&pageNumber=2/);
    });
});

test('Search - Filter Results', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });
    const searchBox = await getVisibleSearchBox(page);
    await test.step('Search for savings', async () => {
        await searchBox.fill('savings');
        await searchBox.press('Enter');
        await expect(page, 'Savings search should navigate to the search results page').toHaveURL(/search-results\?search=savings/);
        const resultsSummary = page.getByRole('heading', { name: /Showing results \d+ to \d+ of \d+/ }).first();
        await expect(resultsSummary, 'Savings search should show the visible results summary').toBeVisible();
    });

    await test.step('Toggle the Everyday finance category filter', async () => {
        const everydayFinanceLabel = page.getByText('Everyday finance').first();
        await clickWithCookieGuard(page, everydayFinanceLabel);
        await expect(page, 'Applying Everyday finance should add its category query parameter').toHaveURL(/search-results\?search=savings&categories=everyday-finance-1849/);
        await clickWithCookieGuard(page, everydayFinanceLabel);
        await expect(page, 'Removing Everyday finance should clear its category query parameter').toHaveURL(/search-results\?search=savings/);
    });

    await test.step('Apply multiple media and category filters', async () => {
        await clickWithCookieGuard(page, page.getByLabel('Media type').getByText('Guide', { exact: true }));
        await clickWithCookieGuard(page, page.getByText('News article', { exact: true }));
        await clickWithCookieGuard(page, page.getByText('Saving your deposit', { exact: true }));
        await clickWithCookieGuard(page, page.getByText('ISAs', { exact: true }));
        await expect(page, 'Applying multiple filters should update the media and categories query parameters').toHaveURL(/search-results\?search=savings&media=guide-article-5616,news-article-5617&categories=isas-1254,saving-your-deposit-1256/);
    });
});

test('Search - Remove Filters Applied One by One', async ({ page }) => {
    await test.step('Open filtered search results', async () => {
        await page.goto('/search-results?search=savings&media=guide-article-5616,news-article-5617&categories=isas-1254,saving-your-deposit-1256', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expect(page.getByText(/Oops! Something went wrong/i), 'Filtered search test should not land on the PBS error page before filters are changed').not.toBeVisible();
        await expect(page.getByLabel('Categories'), 'Filtered search results should expose the Categories filter group before filters are removed').toBeVisible();
    });

    await test.step('Remove filters one by one', async () => {
        await clickWithCookieGuard(page, page.getByLabel('Categories').getByText('ISAs', { exact: true }));
        await expect(page, 'Removing ISAs should leave only Saving your deposit in the categories query parameter').toHaveURL(/search-results\?search=savings&media=guide-article-5616,news-article-5617&categories=saving-your-deposit-1256/);
        await clickWithCookieGuard(page, page.getByLabel('Categories').getByText('Saving your deposit'));
        await clickWithCookieGuard(page, page.getByLabel('Media type').getByText('News article'));
        await clickWithCookieGuard(page, page.getByLabel('Media type').getByText('Guide', { exact: true }));
        await expect(page, 'Removing all filters one by one should return to the unfiltered savings results URL').toHaveURL(/search-results\?search=savings/);
    });
});

test('Search - Remove All Filters Applied at Once', async ({ page }) => {
    await test.step('Open filtered search results', async () => {
        await page.goto('/search-results?search=savings&media=guide-article-5616,news-article-5617&categories=isas-1254,saving-your-deposit-1256', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expect(page.getByText(/Oops! Something went wrong/i), 'Clear-all search test should not land on the PBS error page before filters are cleared').not.toBeVisible();
        await expect(page.getByRole('button', { name: 'Clear all' }), 'Filtered search results should expose a Clear all button before clearing filters').toBeVisible();
    });

    await test.step('Clear all filters at once', async () => {
        await clickWithCookieGuard(page, page.getByRole('button', { name: 'Clear all' }));
        await expect(page, 'Clearing all filters should return to the unfiltered savings results URL').toHaveURL(/search-results\?search=savings/);
    });
});