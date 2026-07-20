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
// Coverage notes - Branch Finder (/home/contact-us/branch-finder)
// ============================================================================
// Scope: the branch finder page - title/H1/breadcrumb chrome, the
// city/postcode search box, selecting a result, and the empty-results case.
//
// Tests in this file:
//   1. Branch Finder - Initial Page Load Checks
//      Verifies the title, H1, and breadcrumb trail (Contact us > Branch
//      Finder).
//   2. Branch Finder - Use Branch Finder Search Functionality
//      Searches "Cardiff" and confirms the "Results for: Cardiff" heading
//      appears.
//   3. Branch Finder - Select a Branch from the Search Results
//      Searches "Cardiff", opens the first "View branch details" result,
//      confirms it navigates to a real branch details page with its own H1.
//   4. Branch Finder - Shows empty results list for invalid search
//      Searches a nonsense location and confirms zero "View branch
//      details" links are returned (while the generic results heading
//      still appears).
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

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
        await page.goto('/home/contact-us/branch-finder', { waitUntil: 'load' });
        await acceptCookiesIfPresent(page);
        await page.waitForLoadState('load');
        await expectBranchFinderPageChrome(page);
    });

    await test.step('Search branch finder for Cardiff', async () => {
        const searchBox = page.getByRole('searchbox', { name: 'Search by city or postcode' });
        await expect(searchBox, 'Branch finder should expose the search input').toBeVisible({ timeout: 5000 });
        await searchBox.fill('Cardiff');
        await searchBox.press('Enter');

        const resultsHeading = page.getByRole('heading', { level: 2, name: /Results for: Cardiff/ });
        await expect(resultsHeading, 'Searching for Cardiff should show the Cardiff results heading').toBeVisible({ timeout: 20000 });
    });

    await test.step('Open the first branch details page from the Cardiff results', async () => {
        const firstViewDetailsLink = page.getByRole('link', { name: 'View branch details' }).first();
        await expect(firstViewDetailsLink, 'Cardiff results should expose at least one View branch details link').toBeVisible({ timeout: 20000 });
        await firstViewDetailsLink.click();

        await expect(page, 'Selecting the first Cardiff result should navigate to a branch details page').toHaveURL(/\/home\/contact-us\/branch-finder\/.+/);
        const branchDetailsHeading = page.getByRole('heading', { level: 1 });
        await expect(branchDetailsHeading, 'Branch details page should show an H1 heading for the selected branch').toBeVisible();
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
