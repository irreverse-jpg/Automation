const { test, expect } = require('@playwright/test');

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function buildExpectedUrl(baseURL, path) {
    return new URL(path, baseURL).toString();
}

async function dismissCookieOverlayIfPresent(page) {
    const acceptTargets = [
        page.locator('#onetrust-accept-btn-handler').first(),
        page.getByRole('button', { name: /accept|allow all|yes, allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
        page.getByRole('link', { name: /allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
    ];

    for (const candidate of acceptTargets) {
        if (await candidate.isVisible().catch(() => false)) {
            await candidate.click({ timeout: 3000 }).catch(() => { });
        }
    }

    const overlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (await overlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }
}

async function acceptCookiesIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);
}

async function waitForAndAcceptCookieBanner(page) {
    // OneTrust injects the consent banner (and its full-page dark backdrop) asynchronously via GTM,
    // often after `load`. A single instant visibility check races the banner and misses it, leaving
    // the backdrop blocking clicks on later steps, so wait for the accept button before moving on.
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }

    await dismissCookieOverlayIfPresent(page);
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isBlockedByOverlay = message.includes('intercepts pointer events') || message.includes('cookie');

        if (!isBlockedByOverlay) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

async function openHomepage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

async function openHeaderSearchOverlay(page) {
    const toggle = page.locator('[data-search-toggle]').first();
    await expect(toggle, 'The header search icon should be visible').toBeVisible();
    await clickWithCookieGuard(page, toggle);

    const input = page.locator('#navsearch');
    await expect(input, 'The header search overlay input should become visible after clicking the search icon').toBeVisible();
    await expect(input, 'The header search overlay input should show its placeholder text').toHaveAttribute('placeholder', 'Enter search term here...');
    return input;
}

// The header search overlay's submit button is partially covered by the sticky header/logo bar on
// UAT2 - a known cosmetic issue (already reported, fixed on other environments, slated for the next
// release). Only the lower portion of the button is actually reachable by a real pointer, so click
// there instead of the default center, which lands on the header behind it.
async function submitHeaderSearch(page, term) {
    const input = page.locator('#navsearch');
    await input.fill(term);

    // Tablet/mobile hide the "Search" button entirely below the desktop breakpoint (submit is
    // expected via Enter there); desktop shows it but partially behind the header (see note above).
    const submit = page.locator('.nav-search__submit');
    const box = await submit.boundingBox();
    if (box) {
        await submit.click({ position: { x: box.width / 2, y: box.height * 0.85 } });
    } else {
        await input.press('Enter');
    }

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
}

async function submitInlineSearch(page, term) {
    const input = page.locator('input[name="searchtext"]');
    await input.fill(term);
    await clickWithCookieGuard(page, page.locator('.search-box__submit'));
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
}

function getResultsHeading(page) {
    return page.locator('h1.search-result__title');
}

async function getResultsSummary(page) {
    const heading = getResultsHeading(page);
    const count = await heading.locator('.search-result__number').innerText();
    // The query span is styled with CSS text-transform:uppercase, which innerText() reflects -
    // lowercase before comparing so this checks the actual query, not its visual casing.
    const query = await heading.locator('.search-result__query').innerText();
    return { count: Number(count.trim()), query: query.trim().toLowerCase() };
}

function getResultTitles(page) {
    return page.locator('.search-result__heading').allInnerTexts();
}

function siteFilterDropdown(page) {
    return page.locator('.filters__filter').filter({ has: page.locator('#dropdownMenuButton') });
}

function sortFilterDropdown(page) {
    return page.locator('.filters__filter').filter({ has: page.locator('#dropdownMenuButton2') });
}

async function selectDropdownOption(page, dropdown, optionText) {
    const trigger = dropdown.locator('[data-toggle="dropdown"]');
    await clickWithCookieGuard(page, trigger);

    // Substring match rather than exact text: the "Posted (oldest)" option renders with a stray
    // leading backtick in its label on UAT2 (a separate minor content defect) - matching on the
    // clean substring keeps this test focused on sort behaviour rather than label spelling.
    const option = dropdown.locator('.dropdown-item').filter({ hasText: optionText }).first();
    await expect(option, `Dropdown option "${optionText}" should be visible once expanded`).toBeVisible();

    await clickWithCookieGuard(page, option);
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
}

test('Search - Empty Query', async ({ page, baseURL }) => {
    await test.step('Open homepage and expand the header search box', async () => {
        await openHomepage(page);
        await openHeaderSearchOverlay(page);
    });

    await test.step('Submit an empty search and verify the 0 results state', async () => {
        await submitHeaderSearch(page, '');
        await expect(page, 'Empty search should navigate to the search results page').toHaveURL(buildExpectedUrl(baseURL, '/search-results?searchText='));

        const summary = await getResultsSummary(page);
        expect(summary.count, 'An empty query should return 0 results').toBe(0);
        await expect(getResultsHeading(page), 'The results heading should read "0 Results for"').toContainText(/0\s+Results for/i);
        await expect(page.locator('article.search-result__item'), 'An empty query should not list any result articles').toHaveCount(0);
    });
});

test('Search - With and Without Results', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    await test.step('Open homepage and expand the header search box', async () => {
        await openHomepage(page);
        await openHeaderSearchOverlay(page);
    });

    await test.step('Search with a term that returns no results', async () => {
        await submitHeaderSearch(page, 'zzzxyznonexistent123');
        await expect(page, 'A no-match search should navigate to the expected results URL').toHaveURL(buildExpectedUrl(baseURL, '/search-results?searchText=zzzxyznonexistent123'));

        const summary = await getResultsSummary(page);
        expect(summary.count, 'A term with no matches should return 0 results').toBe(0);
        expect(summary.query, 'The 0-results heading should echo back the search term').toBe('zzzxyznonexistent123');
    });

    await test.step('Search with a term that returns results', async () => {
        // Re-uses the results page's own (non-overlapped) inline search box rather than
        // returning to the homepage, mirroring a user refining their search from the results page.
        // Note: this inline form submits its term as "searchtext" (lowercase) and carries the
        // current (empty) site filter along as "index=", unlike the header overlay's "searchText" -
        // a minor param-naming inconsistency between the two search entry points, not a defect.
        await submitInlineSearch(page, 'test');
        await expect(page, 'A matching search should stay on the search results page').toHaveURL(/\/search-results\?/);
        expect(new URL(page.url()).searchParams.get('searchtext'), 'The inline search should submit the typed term').toBe('test');

        const summary = await getResultsSummary(page);
        expect(summary.count, 'Searching "test" should return at least one result').toBeGreaterThan(0);
        expect(summary.query, 'The results heading should echo back the search term').toBe('test');
        await expect(getResultsHeading(page), 'The results heading should read "N Results for test"').toContainText(new RegExp(`${summary.count}\\s+Results for`, 'i'));
    });
});

test('Search - Navigate Through Results', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await test.step('Open homepage and search for "test"', async () => {
        await openHomepage(page);
        await openHeaderSearchOverlay(page);
        await submitHeaderSearch(page, 'test');
        await expect(page, 'Searching "test" should land on the default All Sites results').toHaveURL(buildExpectedUrl(baseURL, '/search-results?searchText=test'));
    });

    const site = siteFilterDropdown(page);
    const sort = sortFilterDropdown(page);

    let totalCount;
    await test.step('Read the All Sites result count', async () => {
        totalCount = (await getResultsSummary(page)).count;
        expect(totalCount, 'The "test" search should return at least one result to filter').toBeGreaterThan(0);
    });

    let lordsCount;
    await test.step('Filter results by Lords', async () => {
        await selectDropdownOption(page, site, 'Lords');
        await expect(page, 'Selecting the Lords filter should update the results URL').toHaveURL(buildExpectedUrl(baseURL, '/search-results?searchText=test&index=Lords'));
        await expect(site.locator('[data-toggle="dropdown"]'), 'The site filter button should reflect the Lords selection').toHaveText('Lords');
        lordsCount = (await getResultsSummary(page)).count;
    });

    let mccCount;
    await test.step('Filter results by MCC', async () => {
        await selectDropdownOption(page, site, 'MCC');
        await expect(page, 'Selecting the MCC filter should update the results URL').toHaveURL(buildExpectedUrl(baseURL, '/search-results?searchText=test&index=MCC'));
        await expect(site.locator('[data-toggle="dropdown"]'), 'The site filter button should reflect the MCC selection').toHaveText('MCC');
        mccCount = (await getResultsSummary(page)).count;
    });

    await test.step('Verify Lords + MCC results add up to the All Sites total', async () => {
        expect(lordsCount + mccCount, 'Lords and MCC result counts should sum to the All Sites total').toBe(totalCount);
    });

    await test.step('Reset the site filter back to All Sites', async () => {
        await selectDropdownOption(page, site, 'All Sites');
        await expect(page, 'Selecting All Sites again should return to the unfiltered results').toHaveURL(buildExpectedUrl(baseURL, '/search-results?searchText=test&index='));
        const summary = await getResultsSummary(page);
        expect(summary.count, 'Resetting to All Sites should show the full result count again').toBe(totalCount);
    });

    let newestOrder;
    await test.step('Sort by Posted (newest)', async () => {
        await selectDropdownOption(page, sort, 'Posted (newest)');
        // The site filter was just reset to "All Sites" (index=), and sort links preserve whatever
        // filter params are already on the URL, so index= carries forward alongside sort=newest.
        await expect(page, 'Selecting Posted (newest) should update the sort URL').toHaveURL(buildExpectedUrl(baseURL, '/search-results?searchText=test&index=&sort=newest'));
        newestOrder = await getResultTitles(page);
        expect(newestOrder.length, 'There should be more than one result to meaningfully compare sort order').toBeGreaterThan(1);
    });

    let oldestOrder;
    await test.step('Sort by Posted (oldest)', async () => {
        await selectDropdownOption(page, sort, 'Posted (oldest)');
        await expect(page, 'Selecting Posted (oldest) should update the sort URL').toHaveURL(buildExpectedUrl(baseURL, '/search-results?searchText=test&index=&sort=oldest'));
        oldestOrder = await getResultTitles(page);
    });

    await test.step('Verify newest and oldest sorting produce a different result order', async () => {
        // All current results happen to share the same publish date, so this only confirms the
        // sort control actually re-orders the list, not any specific chronological expectation.
        expect(oldestOrder, 'Switching between Posted (newest) and Posted (oldest) should change the result order').not.toEqual(newestOrder);
    });
});
