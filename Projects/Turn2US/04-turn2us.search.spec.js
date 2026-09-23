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
// Coverage notes - turn2us.org.uk site search
// ============================================================================
// Scope: the header search toggle (`#open-search` -> `#search`) and the
// `/search` results page it submits to - the results page's OWN, separate
// search box (`#search-t2u`), its "Clear search" link, result cards, and
// pagination. Confirmed via direct probing 2026-09-23: there is no sort-by
// control on this site (unlike RSC/PBS/Withers/MCC/NPL), so this file's 4th
// test covers the results page's own search box and its "Clear search"
// behaviour instead of a sort dropdown.
//
// Tests in this file:
//   1. Search - Empty Query
//      Opens the header search box via its toggle icon, confirms submitting
//      an empty query does nothing (native HTML5 required/minlength
//      validation blocks it - no navigation away from the homepage), then
//      confirms clicking the search toggle icon a second time collapses the
//      box again.
//   2. Search - With and Without Results
//      Searches "benefit" (has results) and "benefittt" (no results),
//      confirming the results count/cards and the "couldn't find any
//      results" message respectively.
//   3. Search - Pagination of Results
//      Searches "benefit" (2 pages of results as of 2026-09-23), confirms
//      Previous is disabled/Next is enabled on page 1, clicking Next moves
//      to page 2 and enables Previous, and Next becomes disabled on the
//      last page.
//   4. Search - Clear Search and Second Search
//      Searches "benefit", confirms the results page's OWN search box
//      (`#search-t2u` - a different element from the header's `#search`,
//      confirmed via direct probing) is present, clicks "Clear search" and
//      confirms both the query and the results are cleared (URL resets to
//      bare `/search`, zero result cards), then uses that same in-page box
//      to search "policy" and confirms new, real results appear.
//
// KEY MECHANICS confirmed via direct probing 2026-09-23:
//   - The header search toggle (`#open-search`, aria-label "Search Toggle")
//     is independent of the `#nav-toggle` hamburger - present and clickable
//     on every viewport without needing to open the main menu first.
//   - The header search submit button (`.header__search button[type=
//     "submit"]`) is never disabled (unlike RSC's `button.search-submit`) -
//     an empty/too-short query is blocked by the input's own
//     `required`/`minlength="3"` HTML5 validation instead, which prevents
//     the browser from submitting the form at all.
//   - Pagination's Previous/Next controls are always real `<a>` tags -
//     "disabled" is signalled by `href="#"` rather than a disabled
//     attribute or a different tag, unlike every other client project in
//     this workspace. `isPaginationLinkDisabled()` below checks the href.
//   - Result cards are `ul.cardsList > li.listCard`, each with a
//     `h3.listCard__title > a` title link - not any of the `.card`/
//     `article`/`.search-result` shapes used elsewhere in this workspace.
//   - "Clear search" (`a[aria-label="Clear search results"]`) is a plain
//     link to bare `/search` (no query string) - a full page navigation,
//     not a client-side reset. It's a different control from the small
//     `input[type="reset"]` next to the in-page search box (aria-label
//     "Clear search field"), which only clears that input's typed text
//     without navigating or affecting any results - this file uses the
//     former, matching what "Clear search" means per Hector's description.
//   - Any interaction that submits a new query or paginates is a full page
//     navigation (not an SPA route change) - the Cookiebot banner can and
//     does reappear after each one, so waitForAndAcceptCookieBanner() is
//     called after every such step.
// ============================================================================

async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#CybotCookiebotDialog').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

async function openHomepage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

async function submitHeaderSearch(page, term) {
    await page.locator('#open-search').click();
    const input = page.locator('#search');
    await expect(input, 'The header search field should be visible once the search toggle is opened').toBeVisible();

    await input.click();
    await input.fill(term);
    await page.locator('.header__search button[type="submit"]').click();
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

function getResultCards(page) {
    return page.locator('ul.cardsList > li.listCard');
}

function paginationLink(page, ariaLabel) {
    return page.locator(`#pagination a[aria-label="${ariaLabel}"]`).first();
}

// Previous/Next are always real <a> tags on this site - "disabled" is signalled by href="#"
// rather than a disabled attribute or a different tag, confirmed via direct probing 2026-09-23.
async function isPaginationLinkDisabled(link) {
    const href = await link.getAttribute('href');
    return href === '#';
}

test('Search - Empty Query', async ({ page, baseURL }) => {
    const homepageUrl = new URL('/', baseURL).toString();

    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Open the search toggle', async () => {
        await page.locator('#open-search').click();
        await expect(page.locator('#search'), 'The header search field should be visible once opened').toBeVisible();
    });

    await test.step('Submitting an empty query should do nothing', async () => {
        await page.locator('.header__search button[type="submit"]').click();
        await page.waitForTimeout(500);

        expect(page.url(), 'Submitting an empty query should not navigate away from the homepage').toBe(homepageUrl);
    });

    await test.step('Clicking the search toggle again collapses the search box', async () => {
        await page.locator('#open-search').click();
        await expect(page.locator('#search'), 'The header search field should be hidden again after a second click on the toggle').toBeHidden();
    });
});

test('Search - With and Without Results', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Search "benefit" and confirm results are shown', async () => {
        await submitHeaderSearch(page, 'benefit');
        expect(page.url(), 'Searching should navigate to the /search page with the query').toContain('/search?search=benefit');

        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'Searching "benefit" should return at least one result card').toBeGreaterThan(0);
        await expect(page.locator('.cardsList__resultsCount'), 'A results count heading should be shown').toBeVisible();
    });

    await test.step('Search "benefittt" and confirm the no-results state', async () => {
        await submitHeaderSearch(page, 'benefittt');

        await expect(getResultCards(page), 'A term with no matches should show no result cards').toHaveCount(0);
        await expect(page.getByText("Sorry, we couldn't find any results for that."), 'The no-results message should be visible').toBeVisible();
    });
});

test('Search - Pagination of Results', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open homepage and search "benefit"', async () => {
        await openHomepage(page);
        await submitHeaderSearch(page, 'benefit');
        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'Searching "benefit" should return results to paginate through').toBeGreaterThan(0);
    });

    await test.step('On the first page, Previous should be disabled and Next enabled', async () => {
        expect(new URL(page.url()).searchParams.get('page'), 'The first page of results should not carry a page param').toBeNull();
        expect(await isPaginationLinkDisabled(paginationLink(page, 'Previous page')), 'Previous page should be disabled on the first page').toBe(true);
        expect(await isPaginationLinkDisabled(paginationLink(page, 'Next page')), 'Next page should be enabled on the first page').toBe(false);
    });

    await test.step('Clicking Next page moves to page 2 and enables Previous', async () => {
        await paginationLink(page, 'Next page').click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(new URL(page.url()).searchParams.get('page'), 'Clicking Next page should navigate to page=2').toBe('2');
        expect(await isPaginationLinkDisabled(paginationLink(page, 'Previous page')), 'Previous page should be enabled once past the first page').toBe(false);
    });

    await test.step('On the last page, Next should be disabled (Previous stays enabled)', async () => {
        expect(await isPaginationLinkDisabled(paginationLink(page, 'Next page')), 'Next page should be disabled on the last page').toBe(true);
        expect(await isPaginationLinkDisabled(paginationLink(page, 'Previous page')), 'Previous page should still be enabled on the last page').toBe(false);
    });
});

test('Search - Clear Search and Second Search', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open homepage and search "benefit"', async () => {
        await openHomepage(page);
        await submitHeaderSearch(page, 'benefit');
        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'Searching "benefit" should return results to clear').toBeGreaterThan(0);
    });

    await test.step('The results page should expose its own, separate search box', async () => {
        const inPageSearchInput = page.locator('#search-t2u');
        await expect(inPageSearchInput, 'The results page should show its own search box, distinct from the header search box').toBeVisible();
    });

    await test.step('"Clear search" clears both the query and the results', async () => {
        const clearLink = page.locator('a[aria-label="Clear search results"]');
        await expect(clearLink, 'A "Clear search" link should be visible').toBeVisible();

        await clearLink.click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(page.url(), 'Clicking "Clear search" should navigate back to a bare /search with no query').toMatch(/\/search\/?(\?.*)?$/);
        expect(new URL(page.url()).searchParams.get('search'), 'Clicking "Clear search" should remove the search term from the URL').toBeNull();
        expect(await page.locator('#search-t2u').inputValue(), 'The in-page search box should be empty after clearing').toBe('');
        await expect(getResultCards(page), 'Clearing the search should leave no result cards showing').toHaveCount(0);
    });

    await test.step('Searching "policy" from the same in-page search box returns real results', async () => {
        const inPageSearchInput = page.locator('#search-t2u');
        await inPageSearchInput.click();
        await inPageSearchInput.fill('policy');
        await page.locator('#search-t2u').locator('xpath=following-sibling::button[@type="submit"]').first().click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(page.url(), 'Searching "policy" should navigate to /search with the new query').toContain('/search?search=policy');

        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'Searching "policy" should return at least one real result card').toBeGreaterThan(0);
    });
});
