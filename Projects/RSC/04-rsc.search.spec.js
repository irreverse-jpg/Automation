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
// Coverage notes - rsc.org site search
// ============================================================================
// Scope: the header search box (`#header-search-input` + `button.search-submit`)
// and the `/search-results` page it submits to - result cards, the pagination
// control, the sort-by dropdown (a select2 widget over a native <select>), and
// the no-results state.
//
// Tests in this file:
//   1. Search - Empty Query
//      Confirms the submit button stays disabled with an empty input, so
//      clicking it does nothing (no navigation away from the homepage).
//   2. Search - With and Without Results
//      Searches "chemistry" (has results) and "microbiologyxxx" (no results),
//      confirming the "No results found..." message and the "Search all RSC
//      websites" link, which lands on /search-results/all-rsc-websites with a
//      #gsc.tab=0 hash appended by a client-side Google CSE widget.
//   3. Search - Pagination
//      Searches "chemistry", confirms Previous is disabled/Next is enabled on
//      page 1, clicking Next enables Previous, jumping to a specific page
//      number navigates directly there, and jumping to the last page disables
//      Next (Previous stays enabled). The numbered-page-link jumps are
//      desktop-only (see KEY MECHANICS below); Previous/Next coverage runs on
//      every viewport.
//   4. Search - Sort Options and Result Persistence
//      Clicks through all 5 selectable sort options (Relevance, Alphabetical
//      A-Z/Z-A, Pub date Oldest/Newest to X), confirming the `sortby` URL
//      param and the dropdown's displayed value update each time. Ends on
//      "Pub date: Newest to oldest", clicks a result, confirms it navigated
//      away, then goes back and confirms the sort selection (both the URL and
//      the dropdown's displayed text) survived the round trip.
//
// KEY MECHANICS confirmed 2026-07-21:
//   - The submit button (`button.search-submit`) stays disabled until the
//     input receives real keystrokes - `fill()` alone doesn't trigger the
//     enabling JS, must use `pressSequentially()` (same finding as the
//     homepage spec's header search box).
//   - The sort dropdown is a select2 widget: the real <select name="sortby">
//     is hidden: interact with the visible `[role="combobox"]` trigger and
//     the `.select2-results__option` list it opens, not the native <select>.
//     Its first/default option ("Default") is aria-disabled and cannot be
//     selected - it's a placeholder label, not a real sort mode.
//   - Pagination's Previous/Next controls render as a disabled <button> when
//     inactive and as a real <a href> when active - never hidden outright, so
//     "should not appear" here is checked as "disabled", not "not visible".
//     The "First page"/"Last page" jump buttons are mobile/tablet-only
//     (`d-lg-none`) and aren't covered by this file - Previous/Next appear on
//     every viewport, which is what this file exercises.
//   - The numbered page-jump links (`.pagination__link`, e.g. "1", "2", "3")
//     are the inverse: desktop-only. Confirmed via direct probe that on both
//     mobile (393px) and tablet (iPad Pro 11, 834px) every numbered link is
//     present in the DOM with a correct href but computed non-visible (zero
//     rendered size) - mobile/tablet users are expected to page via
//     Previous/Next/First/Last only. The "jump to a specific page number" and
//     "jump to the last page number" steps are gated to desktop for this
//     reason.
//   - Any interaction that submits a new query/sort/page is a full page
//     navigation (not an SPA route change) - the OneTrust banner can and
//     does reappear after each one, so waitForAndAcceptCookieBanner() is
//     called after every such step.
//   - Below the "lg" breakpoint, the hamburger "Toggle navigation" button
//     stays visible whether the menu is open or collapsed - it's a toggle,
//     not a show-once affordance. openMobileMenuIfPresent() checks its
//     aria-expanded attribute before clicking, so calling it a second time
//     on an already-open menu (e.g. once from openHomepage(), again from
//     submitHeaderSearch()) doesn't close what it just opened.
//
// QA/LIVE ENVIRONMENT DRIFT confirmed 2026-07-21:
//   - The two "Pub date" sort labels are worded differently: QA shows
//     "Pub date: Oldest to newest"/"...Newest to oldest", Live shows
//     "Published: old to new"/"...new to old". The underlying sortby URL
//     slug (old-new/new-old) is identical on both. SORT_OPTIONS lists every
//     known label per option and selectSortOption() picks whichever one the
//     current environment actually renders.
//   - The "Search all RSC websites" link's href differs: QA is
//     "/search-results/all-rsc-websites", Live is
//     "/search-results/search-all-rsc-websites". The test matches the
//     shared /search-results/...all-rsc-websites shape and reads the real
//     href to build the expected post-click URL, rather than hardcoding one
//     environment's path.
// ============================================================================

const SORT_OPTIONS = [
    { labels: ['Relevance'], slug: 'score' },
    { labels: ['Alphabetical (A-Z)'], slug: 'a-z' },
    { labels: ['Alphabetical (Z-A)'], slug: 'z-a' },
    { labels: ['Pub date: Oldest to newest', 'Published: old to new'], slug: 'old-new' },
    { labels: ['Pub date: Newest to oldest', 'Published: new to old'], slug: 'new-old' },
];

// The OneTrust banner is injected asynchronously via GTM - a same-tick isVisible()
// check races it and misses it, leaving its dark overlay blocking clicks lower on
// the page. Wait for the accept button before moving on.
async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

// Below the "lg" breakpoint, the header collapses behind a "Toggle navigation" hamburger button -
// the search input is present in the DOM but hidden until it's opened. Confirmed 2026-07-20.
// The hamburger button itself stays visible whether the menu is open or collapsed (it's a toggle,
// not a show/hide-once affordance), so this must check aria-expanded before clicking - calling it
// a second time on an already-open menu (e.g. once from openHomepage(), then again from
// submitHeaderSearch()) would otherwise close the menu it just opened. Confirmed 2026-07-21.
async function openMobileMenuIfPresent(page) {
    const toggleButton = page.getByRole('button', { name: 'Toggle navigation' });
    const toggleVisible = await toggleButton.isVisible().catch(() => false);
    if (!toggleVisible) return;

    const isExpanded = await toggleButton.getAttribute('aria-expanded').catch(() => null);
    if (isExpanded !== 'true') {
        await toggleButton.click();
        await page.waitForTimeout(300);
    }
}

async function openHomepage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    await openMobileMenuIfPresent(page);
}

// The submit button stays disabled until the input receives real keystrokes - fill() alone does
// not trigger the JS that enables it.
async function submitHeaderSearch(page, term) {
    // The header (and its search input) re-collapses behind the hamburger on every fresh page
    // load below the "lg" breakpoint, so this needs re-checking before every search, not just once
    // on the homepage.
    await openMobileMenuIfPresent(page);

    const input = page.locator('#header-search-input');
    await input.click();
    await input.pressSequentially(term, { delay: 20 });

    const submit = page.locator('button.search-submit').first();
    await submit.click();
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

function getResultCards(page) {
    return page.locator('.card.card--search');
}

function paginationControl(page, ariaLabel) {
    return page.locator(`.pagination [aria-label="${ariaLabel}"]`).first();
}

// Previous/Next render as a disabled <button> when inactive and a real <a href> when active -
// never hidden outright.
async function isPaginationControlDisabled(control) {
    const tagName = await control.evaluate((el) => el.tagName);
    return tagName === 'BUTTON';
}

// The numbered page-jump links only render (visibly) at the "lg" breakpoint and above -
// same signal already used elsewhere in this file (absence of the mobile hamburger).
async function isDesktopViewport(page) {
    const toggleButton = page.getByRole('button', { name: 'Toggle navigation' });
    return !(await toggleButton.isVisible().catch(() => false));
}

function sortCombobox(page) {
    return page.locator('[role="combobox"][aria-labelledby*="sortby"]').first();
}

// Tries each known label for this sort option (see SORT_OPTIONS above) and clicks whichever
// one the current environment actually renders, returning that label so callers can assert
// against what's really displayed rather than a hardcoded string.
async function selectSortOption(page, labelCandidates) {
    await sortCombobox(page).click();

    let matchedLabel = null;
    for (const candidate of labelCandidates) {
        const option = page.locator('.select2-results__option', { hasText: candidate }).first();
        const appeared = await option.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
        if (appeared) {
            matchedLabel = candidate;
            await option.click();
            break;
        }
    }
    expect(matchedLabel, `One of the expected sort labels (${labelCandidates.join(' / ')}) should be visible once the dropdown opens`).not.toBeNull();

    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    return matchedLabel;
}

function getSelectedSortText(page) {
    return page.locator('.select2-selection__rendered').first().innerText();
}

test('Search - Empty Query', async ({ page, baseURL }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Clicking the search icon with an empty input should do nothing', async () => {
        const submit = page.locator('button.search-submit').first();
        await expect(submit, 'The search submit button should be disabled while the input is empty').toBeDisabled();

        await submit.click({ force: true }).catch(() => { });
        await page.waitForTimeout(500);

        expect(page.url(), 'Clicking the disabled search icon should not navigate away from the homepage').toBe(new URL('/', baseURL).toString());
    });
});

test('Search - With and Without Results', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Search "chemistry" and confirm results are shown', async () => {
        await submitHeaderSearch(page, 'chemistry');
        expect(page.url(), 'Searching should navigate to the search-results page with the query').toContain('search-results');
        expect(new URL(page.url()).searchParams.get('search'), 'The search URL should carry the submitted term').toBe('chemistry');

        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'Searching "chemistry" should return at least one result card').toBeGreaterThan(0);
    });

    await test.step('Search "microbiologyxxx" and confirm the no-results state', async () => {
        await submitHeaderSearch(page, 'microbiologyxxx');

        await expect(getResultCards(page), 'A term with no matches should show no result cards').toHaveCount(0);
        await expect(page.getByText('No results found. Please try a different search phrase.'), 'The no-results message should be visible').toBeVisible();
    });

    await test.step('"Search all RSC websites" navigates to the expected destination', async () => {
        const link = page.getByRole('link', { name: 'Search all RSC websites', exact: false });
        await expect(link, 'The "Search all RSC websites" link should be visible').toBeVisible();

        // The path differs between QA ("/search-results/all-rsc-websites") and Live
        // ("/search-results/search-all-rsc-websites") - confirmed 2026-07-21 - so this checks
        // the shared shape rather than one hardcoded string, then reads the real href to build
        // the expected post-navigation URL.
        const href = await link.getAttribute('href');
        expect(href, 'The link should point to a /search-results/.../all-rsc-websites path').toMatch(/^\/search-results\/.*all-rsc-websites$/);

        await link.click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        // A client-side Google Custom Search Engine widget appends this hash shortly after load.
        await expect.poll(() => page.url(), {
            message: 'Clicking through should land on the all-rsc-websites page with the Google CSE tab hash',
        }).toBe(`${new URL(href, baseURL).toString()}#gsc.tab=0`);
    });
});

test('Search - Pagination', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Open homepage and search "chemistry"', async () => {
        await openHomepage(page);
        await submitHeaderSearch(page, 'chemistry');
        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'Searching "chemistry" should return results to paginate through').toBeGreaterThan(0);
    });

    await test.step('On the first page, Previous should be disabled and Next enabled', async () => {
        expect(new URLSearchParams(new URL(page.url()).search).get('Page'), 'The first page of results should not carry a Page param').toBeNull();
        await expect(paginationControl(page, 'Previous'), 'Previous should be disabled on the first page').toBeDisabled();
        expect(await isPaginationControlDisabled(paginationControl(page, 'Next page')), 'Next page should be enabled on the first page').toBe(false);
    });

    await test.step('Clicking Next page moves to page 2 and enables Previous', async () => {
        await paginationControl(page, 'Next page').click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(new URL(page.url()).searchParams.get('Page'), 'Clicking Next page should navigate to Page=2').toBe('2');
        expect(await isPaginationControlDisabled(paginationControl(page, 'Previous')), 'Previous should be enabled once past the first page').toBe(false);
    });

    // Numbered page-jump links only render visibly on desktop (see KEY MECHANICS at the top
    // of this file) - mobile/tablet users page via Previous/Next/First/Last instead.
    test.skip(!(await isDesktopViewport(page)), 'Numbered page-jump links are desktop-only');

    let lastPageNumber;
    await test.step('Jumping to a specific page number navigates directly there', async () => {
        const pageLinks = page.locator('.pagination__items > li:not(.dots) > a.pagination__link[href]');
        const linkTexts = (await pageLinks.allInnerTexts()).map((text) => text.trim()).filter((text) => /^\d+$/.test(text));
        lastPageNumber = Math.max(...linkTexts.map(Number));

        const targetPage = linkTexts.map(Number).find((num) => num !== 1 && num !== 2) || 3;
        await page.locator(`.pagination__link[href*="Page=${targetPage}"]`).first().click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(new URL(page.url()).searchParams.get('Page'), `Clicking page number ${targetPage} should navigate directly there`).toBe(String(targetPage));
    });

    await test.step('Jumping to the last page disables Next (Previous stays enabled)', async () => {
        await page.locator(`.pagination__link[href*="Page=${lastPageNumber}"]`).first().click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(new URL(page.url()).searchParams.get('Page'), 'Clicking the last page number should navigate to the final page').toBe(String(lastPageNumber));
        await expect(paginationControl(page, 'Next page'), 'Next page should be disabled on the last page').toBeDisabled();
        expect(await isPaginationControlDisabled(paginationControl(page, 'Previous')), 'Previous should still be enabled on the last page').toBe(false);
    });
});

test('Search - Sort Options and Result Persistence', async ({ page }) => {
    // 5 sort selections + the initial search + a result click + a back-navigation is 8 full
    // page loads in one test - needs a bigger margin for Live's slower response times, matching
    // the convention established in the homepage/footer specs.
    test.setTimeout(180000);

    await test.step('Open homepage and search "chemistry"', async () => {
        await openHomepage(page);
        await submitHeaderSearch(page, 'chemistry');
        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'Searching "chemistry" should return results to sort').toBeGreaterThan(0);
    });

    let lastSelectedLabel;
    for (const { labels, slug } of SORT_OPTIONS) {
        await test.step(`Select sort option "${labels[0]}"`, async () => {
            lastSelectedLabel = await selectSortOption(page, labels);

            expect(new URL(page.url()).searchParams.get('sortby'), `Selecting "${lastSelectedLabel}" should set sortby=${slug} in the URL`).toBe(slug);
            await expect.poll(() => getSelectedSortText(page), {
                message: `The sort dropdown should display "${lastSelectedLabel}" as selected`,
            }).toBe(lastSelectedLabel);
        });
    }

    await test.step('Click a result while sorted by the last-applied sort option and confirm it navigates', async () => {
        const firstResultLink = getResultCards(page).locator('a.searchResult__link').first();
        await expect(firstResultLink, 'The first result card should expose a title link').toBeVisible();
        await firstResultLink.click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(page.url(), 'Clicking a result should navigate away from the search-results page').not.toContain('search-results');
    });

    await test.step('Going back restores the last-applied sort, in both the URL and the dropdown', async () => {
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(new URL(page.url()).searchParams.get('sortby'), 'Going back should restore sortby=new-old in the URL').toBe('new-old');
        await expect.poll(() => getSelectedSortText(page), {
            message: `Going back should restore "${lastSelectedLabel}" as the displayed sort selection`,
        }).toBe(lastSelectedLabel);
    });
});
