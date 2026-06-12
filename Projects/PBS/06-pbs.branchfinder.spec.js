const { test, expect } = require('@playwright/test');

// Cookie Selector (If there is one)
const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR);
    if (await cookieButton.first().isVisible().catch(() => false)) {
        await cookieButton.first().click();
    }
}

async function expectBranchFinderPageChrome(page) {
    await expect(page, 'Branch finder page should load the expected page title').toHaveTitle(/Find Your Nearest Branch/i);

    const branchFinderHeading = page.getByRole('heading', { level: 1, name: /Branch Finder/i });
    await expect(branchFinderHeading, 'Branch finder page should show the Branch Finder H1').toBeVisible();

    const breadcrumbNav = page.locator('nav[aria-label*="breadcrumb" i], nav[aria-label*="Breadcrumb" i], [aria-label*="breadcrumb" i]').first();
    await expect(breadcrumbNav, 'Branch finder page should expose a breadcrumb trail').toBeVisible();

    const contactUsBreadcrumb = breadcrumbNav.getByRole('link', { name: /Contact us/i }).first();
    await expect(contactUsBreadcrumb, 'Branch finder breadcrumb should include Contact us as the previous level').toBeVisible();

    const currentBreadcrumb = breadcrumbNav.getByText(/^Branch Finder$/i).first();
    await expect(currentBreadcrumb, 'Branch finder breadcrumb should show Branch Finder as the current level').toBeVisible();
}

test('Branch Finder - Initial Page Load Checks', async ({ page }) => {
    await test.step('Open the branch finder page', async () => {
        await page.goto('/home/contact-us/branch-finder', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    await test.step('Verify the title, H1, and breadcrumb trail', async () => {
        await expectBranchFinderPageChrome(page);
    });
});

test('Branch Finder - Use Branch Finder Search Functionality', async ({ page }) => {
    await test.step('Open the branch finder page', async () => {
        await page.goto('/home/contact-us/branch-finder', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expectBranchFinderPageChrome(page);
    });

    await test.step('Search branch finder for Cardiff', async () => {
        const searchBox = page.getByRole('searchbox', { name: 'Search by city or postcode' });
        await searchBox.fill('Cardiff');
        await searchBox.press('Enter');
        const resultsHeading = page.getByRole('heading', { level: 2, name: /Results for: Cardiff/ });
        await expect(resultsHeading, 'Searching for Cardiff should show the Cardiff results heading').toBeVisible();
    });
});

test('Branch Finder - Select a Branch from the Search Results', async ({ page }) => {
    await test.step('Open the branch finder page', async () => {
        await page.goto('/home/contact-us/branch-finder', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expectBranchFinderPageChrome(page);
    });

    await test.step('Search branch finder for Cardiff', async () => {
        const searchBox = page.getByRole('searchbox', { name: 'Search by city or postcode' });
        await searchBox.fill('Cardiff');
        await searchBox.press('Enter');

        const albanyResult = page.locator('text=Albany Road').first();
        await expect(albanyResult, 'Searching for Cardiff should reveal the Albany Road result').toBeVisible({ timeout: 10000 });
    });

    await test.step('Open the Albany Road branch details page', async () => {
        const viewDetailsLink = page.getByRole('link', { name: 'View branch details' }).nth(2);
        await expect(viewDetailsLink, 'Albany Road result should expose a View branch details link').toBeVisible({ timeout: 5000 });
        await viewDetailsLink.click();

        await expect(page, 'Selecting Albany Road should navigate to its branch details page').toHaveURL(/\/home\/contact-us\/branch-finder\/albany-road/);
        const branchDetailsHeading = page.getByRole('heading', { level: 1, name: /Albany Road/ });
        await expect(branchDetailsHeading, 'Albany Road details page should show the Albany Road heading').toBeVisible();
    });
});

test('Branch Finder - Shows empty results list for invalid search', async ({ page }) => {
    await test.step('Open the branch finder page', async () => {
        await page.goto('/home/contact-us/branch-finder', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expectBranchFinderPageChrome(page);
    });

    await test.step('Search branch finder with an invalid location', async () => {
        const searchBox = page.getByRole('searchbox', { name: 'Search by city or postcode' });
        await searchBox.fill('InvalidLocation123');
        await searchBox.press('Enter');

        const resultsHeading = page.getByRole('heading', { level: 2, name: /Results for:/ });
        await expect(resultsHeading, 'Invalid search should still show the generic results heading').toBeVisible();

        const branchResults = page.locator('a', { hasText: 'View branch details' });
        await expect(branchResults, 'Invalid search should return zero branch detail links').toHaveCount(0);
    });
});
