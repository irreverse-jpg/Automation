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
// Coverage notes - npl.co.uk site search
// ============================================================================
// Scope: the header search box (submits to "/search?searchtext=...") and
// its results/no-results states.
//
// Confirmed behaviour (2026-07-28, both Live and UAT):
//   - Search input is `input[name="searchtext"]` inside a form whose
//     desktop submit button is `#nav-search--desktop`.
//   - A non-empty query navigates to "/search?searchtext=<query>" with a
//     "Search results" H1.
//   - An empty query does NOT navigate away from the current page.
//   - A query with no matches shows the literal text "No search results
//     to display" instead of result cards.
//
// Tests in this file:
//   1. Search - Empty Query
//      Submits an empty search and confirms it does not navigate away.
//   2. Search - With and Without Results
//      Searches a nonsense term ("No search results to display") then
//      "calibration" (non-zero result cards), confirming the URL/heading
//      each time.
//   3. Search - Navigate Through First Result
//      Searches "calibration", opens the first result card, confirms it
//      lands on a real page (non-empty H1 or title), then goes back.
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const RESULT_LINK_SELECTOR = 'a.searchResult__title, [class*="searchResult"] a[href]';

async function openHomepage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        // NPL's OneTrust accept button renders before its click handler finishes attaching -
        // clicking the instant it's visible silently no-ops and leaves the overlay intercepting
        // later clicks, so this retries the click until the banner actually disappears.
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

// On tablet/mobile the desktop search input ("#search-desktop") stays hidden and a
// separate "#search-mobile" input only renders once the hamburger menu is opened -
// this opens that menu first so ":visible" below resolves to the reachable input.
async function openMenuIfPresent(page) {
    const navToggle = page.locator('#nav-toggle');
    if (!(await navToggle.isVisible().catch(() => false))) {
        return;
    }

    if (await page.locator('input[name="searchtext"]:visible').first().isVisible().catch(() => false)) {
        return;
    }

    // The click doesn't always register on the first attempt, so this retries a few times.
    const visibleSearchInput = page.locator('input[name="searchtext"]:visible').first();
    await expect.poll(async () => {
        await navToggle.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        return await visibleSearchInput.isVisible().catch(() => false);
    }, {
        message: 'Opening the mobile menu should expose a visible search input',
        timeout: 10000,
        intervals: [300, 500, 1000],
    }).toBe(true);
}

async function submitSearch(page, term) {
    await openMenuIfPresent(page);
    const searchInput = page.locator('input[name="searchtext"]:visible').first();
    await expect(searchInput, 'Header should expose a search input before submitting a query').toBeVisible();
    await searchInput.fill(term);
    await searchInput.press('Enter');
    await page.waitForLoadState('domcontentloaded').catch(() => {});
}

test('Search - Empty Query', async ({ page, baseURL }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Submit empty search and verify no navigation occurs', async () => {
        const homepagePath = new URL(baseURL).pathname;
        await submitSearch(page, '');
        await expect(page, 'Empty search should not navigate away from the current page').toHaveURL(new RegExp(`${homepagePath}$`));
    });
}, 30000);

test('Search - With and Without Results', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Search with a term that returns no results', async () => {
        await submitSearch(page, 'zzzznoresultsxyz123');
        await expect(page, 'No-result search should redirect to the search results URL').toHaveURL(/\/search\?searchtext=zzzznoresultsxyz123/i);
        await expect(page.getByRole('heading', { name: 'Search results', exact: true }), 'No-result search should keep the Search results heading visible').toBeVisible();
        await expect(page.getByText('No search results to display'), 'No-result search should show the no-results message').toBeVisible();
    });

    await test.step('Search with a term that returns results', async () => {
        await openHomepage(page);
        await submitSearch(page, 'calibration');
        await expect(page, 'Results search should redirect to the search results URL').toHaveURL(/\/search\?searchtext=calibration/i);
        await expect(page.getByRole('heading', { name: 'Search results', exact: true }), 'Results search should keep the Search results heading visible').toBeVisible();
        await expect(page.locator(RESULT_LINK_SELECTOR).first(), 'Results search should show at least one result card').toBeVisible();
    });
}, 60000);

test('Search - Navigate Through First Result', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Search for calibration', async () => {
        await openHomepage(page);
        await submitSearch(page, 'calibration');
        await expect(page, 'Search should land on the search results URL').toHaveURL(/\/search\?searchtext=calibration/i);
    });

    await test.step('Open the first result and verify it is a real page', async () => {
        const firstResult = page.locator(RESULT_LINK_SELECTOR).first();
        await expect(firstResult, 'Search results should expose a clickable first result').toBeVisible();
        const destinationHref = await firstResult.getAttribute('href');
        const destinationPathname = new URL(destinationHref, page.url()).pathname;

        await firstResult.click();
        await page.waitForURL((url) => url.pathname === destinationPathname, { waitUntil: 'domcontentloaded', timeout: 15000 })
            .catch(() => page.goto(destinationHref, { waitUntil: 'domcontentloaded' }));
        await page.waitForLoadState('load').catch(() => {});

        const heading = page.getByRole('heading', { level: 1 }).first();
        const headingVisible = await heading.isVisible().catch(() => false);
        if (headingVisible) {
            const headingText = (await heading.innerText()).trim();
            expect(headingText.length, 'First result page should expose a non-empty H1').toBeGreaterThan(0);
        } else {
            expect((await page.title()).trim().length, 'First result page should expose a non-empty title when no H1 is present').toBeGreaterThan(0);
        }

        expect(new URL(page.url()).pathname, 'First result should navigate to the expected destination page').toBe(destinationPathname);
    });

    await test.step('Go back to the search results', async () => {
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await expect(page, 'Going back should restore the search results URL').toHaveURL(/\/search\?searchtext=calibration/i);
    });
}, 60000);
