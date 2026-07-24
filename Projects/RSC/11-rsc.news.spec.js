const { test, expect } = require('@playwright/test');
const { sampleUpToSix, verifyPageLinksNavigateCorrectly } = require('./linkNavigationHelpers');

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
// Coverage notes - rsc.org News (top nav "News", a single top-level item with
// no meganav children - confirmed via direct DOM probe)
// ============================================================================
// Scope: the /news listing page's own self-contained filter widget (its own
// search box, a "Content Type" filter, a sort-by dropdown, pagination) and a
// SAMPLE of individual article pages reached from it. There are 1000+
// articles in this listing (1165 on Live, 829 on QA as of 2026-07-23) - per
// explicit project instruction, individual articles are sampled (not
// exhaustively traversed) using this project's usual sampleUpToSix pattern.
//
// Tests in this file:
//   1. News - Page Chrome and Card Listing
//      Title/H1/breadcrumb/footer/card-count/link-navigation-check on the
//      base /news listing (no filters applied) - the standard page-chrome
//      check used across every spec in this project.
//   2. News - Search With and Without Results
//      Searches "physics" (has results) and "physicsss" (no results), per
//      explicit project instruction for this spec.
//   3. News - Content Type Filter
//      Filters to "Article" (present with an identical value/label on both
//      environments - confirmed via direct probe, unlike several of the
//      other Content Type options, which differ - see ENVIRONMENT DRIFT
//      below), confirms the result count updates and a removable filter pill
//      appears, then Clear All resets to the unfiltered listing.
//   4. News - Sort Options
//      Clicks through all 4 sort options (Alphabetical A-Z/Z-A, Published
//      Oldest/Newest), confirming the sortby URL param and the dropdown's
//      selected option update each time - this widget's sort control is a
//      select2 widget over a hidden native <select>, the same pattern as the
//      header search's own sort dropdown (04-rsc.search.spec.js).
//   5. News - Pagination
//      Previous disabled/Next enabled on page 1, clicking Next moves to
//      Page=2, jumping to a specific page number and to the last page
//      (desktop-only numbered links, same precedent as
//      04-rsc.search.spec.js) - 98 total pages on Live as of 2026-07-23.
//   6. News - Sample Article Traversal
//      Opens a sampleUpToSix() sample of the default listing's 12 article
//      cards and confirms each exposes real page chrome (non-empty H1,
//      visible breadcrumb, visible footer) - NOT hardcoded titles, since the
//      listing's contents change over time and cover multiple content types
//      (regular articles, obituaries, etc. each with slightly different
//      layouts).
//
// KEY MECHANICS confirmed 2026-07-23:
//   - This page's own search box (#search-input, name="Search") is a plain,
//     always-visible field embedded in the page body's filter form - NOT the
//     header's collapsible-behind-a-hamburger search box covered by
//     04-rsc.search.spec.js, so no openMobileMenuIfPresent() step is needed
//     to reach it on any viewport.
//   - Its submit button (button.search-submit) stays PERMANENTLY disabled
//     regardless of input content - confirmed via direct probe this is not
//     a timing issue (tried fill(), pressSequentially(), a manual blur, and
//     manually dispatching input/keyup events - the disabled attribute never
//     clears). Pressing Enter in the input is the only working way to
//     submit a search here - unlike the header search's submit button,
//     which does enable once the input receives real keystrokes. Worth
//     flagging to the team as a likely real accessibility/UX gap (a mouse-
//     only user has no way to trigger a search via that button), even
//     though this suite works around it with Enter.
//   - The "Content Type" filter select is hidden behind a collapsed
//     #filterOptions panel, toggled open via the "Filter" button
//     (filterForm__filterTrigger) - must be expanded before the select is
//     interactable.
//   - Both the Content Type filter and the sort-by dropdown here are select2
//     widgets over a hidden native <select> (`select2-hidden-accessible`) -
//     confirmed via direct probe after this project's initial assumption,
//     based on the server-rendered HTML alone (which doesn't reflect
//     select2's client-side JS init), that they were plain native <select>
//     elements turned out to be wrong. Interact with the visible
//     `[role="combobox"]` trigger and the `.select2-results__option` list it
//     opens, the same pattern as the header search's sort dropdown.
//   - The whole widget is one <form method="get">, so every filter/sort/
//     search/page change is a full page navigation (not an SPA route
//     change) - the OneTrust banner can and does reappear after each one.
//   - Zero-result states remove the pagination control entirely (not just
//     disable it) and show "No results" in place of the usual
//     "Showing X to Y of Z" text in .filterForm__result - confirmed via
//     direct probe, not guessed.
//
// ENVIRONMENT DRIFT confirmed 2026-07-23 (same category as this project's
// other content-drift findings):
//   - The Content Type filter's option list differs: QA has 2 extra options
//     Live doesn't ("Evidence", "Test type"), and QA's "Journal Highlight"
//     capitalizes "Highlight" where Live's "Journal highlight" doesn't. The
//     shared options (Article/Community/Feature/Obituary/Opinion/Profile)
//     have identical values and labels on both environments - "Article" is
//     used here for exactly that reason.
//   - The two "Published"/"Pub date" sort labels are worded differently:
//     QA shows "Pub date: Oldest to newest"/"...Newest to oldest", Live
//     shows "Published: old to new"/"...new to old" - the exact same drift
//     already documented for the header search's sort dropdown. The
//     underlying sortby URL slug (old-new/new-old) is identical on both.
// ============================================================================

const SORT_OPTIONS = [
    { labels: ['Alphabetical (A-Z)'], slug: 'a-z' },
    { labels: ['Alphabetical (Z-A)'], slug: 'z-a' },
    { labels: ['Pub date: Oldest to newest', 'Published: old to new'], slug: 'old-new' },
    { labels: ['Pub date: Newest to oldest', 'Published: new to old'], slug: 'new-old' },
];

async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

async function openPage(page, path) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    return response;
}

async function openNews(page) {
    await openPage(page, '/news');
}

async function verifyFooterVisible(page) {
    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'Page should expose a visible footer at the bottom').toBeVisible();
}

function getResultCards(page) {
    return page.locator('.listWrapper .card.card--link');
}

function resultSummary(page) {
    return page.locator('.filterForm__result').first();
}

async function submitNewsSearch(page, term) {
    // The search-submit icon button stays permanently disabled regardless of input content
    // (confirmed via direct probe - not a timing issue, it never enables) - submitting via
    // Enter in the input is the only working path, unlike the header search's submit button
    // (04-rsc.search.spec.js), which does enable on keystrokes.
    const input = page.locator('#search-input');
    await input.click();
    await input.pressSequentially(term, { delay: 20 });
    await input.press('Enter');
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

async function openFilterPanelIfCollapsed(page) {
    const filterTrigger = page.locator('button.filterForm__filterTrigger').first();
    const isExpanded = await filterTrigger.getAttribute('aria-expanded').catch(() => null);
    if (isExpanded !== 'true') {
        await filterTrigger.click();
        await page.locator('#filterOptions').waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
    }
}

function paginationControl(page, ariaLabel) {
    return page.locator(`.pagination [aria-label="${ariaLabel}"]`).first();
}

// Previous/Next render as a disabled <button> when inactive and a real <a href> when active -
// never hidden outright (same finding already documented in 04-rsc.search.spec.js).
async function isPaginationControlDisabled(control) {
    const tagName = await control.evaluate((el) => el.tagName);
    return tagName === 'BUTTON';
}

// The numbered page-jump links only render (visibly) at the "lg" breakpoint and above -
// same signal already used in 04-rsc.search.spec.js (absence of the mobile hamburger).
async function isDesktopViewport(page) {
    const toggleButton = page.getByRole('button', { name: 'Toggle navigation' });
    return !(await toggleButton.isVisible().catch(() => false));
}

// Both the Content Type filter and the sort-by dropdown are select2 widgets underneath -
// the underlying native <select> is `select2-hidden-accessible` (visually and interactively
// hidden), confirmed via direct probe after this project's initial assumption (based on the
// server-rendered HTML alone, which doesn't reflect select2's client-side JS initialization)
// that they were plain native <select> elements turned out to be wrong. Interact with the
// visible `[role="combobox"]` trigger and the `.select2-results__option` list it opens, same
// pattern already used for the header search's sort dropdown in 04-rsc.search.spec.js.
function contentTypeCombobox(page) {
    return page.locator('[role="combobox"][aria-labelledby="Content_Type__label"]');
}

function sortCombobox(page) {
    return page.locator('[role="combobox"][aria-labelledby="sortby__label"]');
}

async function selectSelect2Option(page, combobox, labelCandidates) {
    await combobox.click();

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
    expect(matchedLabel, `One of the expected labels (${labelCandidates.join(' / ')}) should be visible once the dropdown opens`).not.toBeNull();
    return matchedLabel;
}

async function selectSortOption(page, labelCandidates) {
    const matchedLabel = await selectSelect2Option(page, sortCombobox(page), labelCandidates);
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    return matchedLabel;
}

test('News - Page Chrome and Card Listing', async ({ page }) => {
    test.setTimeout(600000);

    await test.step('Open /news and verify page chrome', async () => {
        await openNews(page);
        const pageHeading = page.locator('h1').first();
        await expect(pageHeading, 'Page should show the "News" H1').toHaveText('News');

        const breadcrumbNav = page.locator('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]').first();
        await expect(breadcrumbNav, 'Page should expose a breadcrumb trail').toBeVisible();
    });

    await test.step('Verify the listing exposes real articles and a result summary', async () => {
        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'The unfiltered News listing should expose at least one article card').toBeGreaterThan(0);
        await expect(resultSummary(page), 'The listing should show a "Showing X to Y of Z" result summary').toContainText('Showing');
    });

    await test.step('Verify every link/card on the page navigates correctly', async () => {
        await verifyPageLinksNavigateCorrectly(page, '/news', { openPage, waitForAndAcceptCookieBanner, expect, test });
    });

    await test.step('Verify footer visibility', async () => {
        await verifyFooterVisible(page);
    });
});

test('News - Search With and Without Results', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Open /news', async () => {
        await openNews(page);
    });

    await test.step('The search-submit icon button stays disabled even with text entered (known UX gap - see KEY MECHANICS)', async () => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('physics', { delay: 20 });
        await expect(page.locator('button.search-submit').first(), 'The search-submit button never enables here, unlike the header search').toBeDisabled();
        await input.fill('');
    });

    await test.step('Search "physics" and confirm results are shown', async () => {
        await submitNewsSearch(page, 'physics');
        expect(new URL(page.url()).searchParams.get('Search'), 'The search URL should carry the submitted term').toBe('physics');

        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'Searching "physics" should return at least one result card').toBeGreaterThan(0);
        await expect(resultSummary(page), 'A term with matches should show a "Showing X to Y of Z" summary').toContainText('Showing');
    });

    await test.step('Search "physicsss" and confirm the no-results state', async () => {
        await submitNewsSearch(page, 'physicsss');

        await expect(getResultCards(page), 'A term with no matches should show no result cards').toHaveCount(0);
        await expect(resultSummary(page), 'A term with no matches should show a "No results" summary').toHaveText(/No results/i);
        await expect(page.locator('.pagination'), 'Pagination should not render for a zero-result search').toHaveCount(0);
    });
});

test('News - Content Type Filter', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Open /news and note the unfiltered result count', async () => {
        await openNews(page);
    });

    let unfilteredCount;
    await test.step('Read the unfiltered "Showing X to Y of Z" total', async () => {
        const summaryText = await resultSummary(page).innerText();
        const match = summaryText.match(/of\s+(\d+)/i);
        expect(match, 'The unfiltered listing should show a parseable "of N" total').not.toBeNull();
        unfilteredCount = Number(match[1]);
    });

    await test.step('Open the filter panel and apply the "Article" content type', async () => {
        await openFilterPanelIfCollapsed(page);
        await selectSelect2Option(page, contentTypeCombobox(page), ['Article']);
        await page.locator('.filterOptions button[type="submit"]', { hasText: 'Apply Filter' }).click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
    });

    await test.step('Verify the filter is reflected in the URL and narrows the results', async () => {
        expect(new URL(page.url()).searchParams.get('Content Type'), 'Applying the Article filter should set it in the URL').toBeTruthy();

        const summaryText = await resultSummary(page).innerText();
        const match = summaryText.match(/of\s+(\d+)/i);
        expect(match, 'The filtered listing should show a parseable "of N" total').not.toBeNull();
        expect(Number(match[1]), 'Filtering to a single content type should show no more results than the unfiltered total').toBeLessThanOrEqual(unfilteredCount);
    });

    await test.step('Verify a removable filter pill for the applied filter is shown', async () => {
        const pills = page.locator('.filterPills').first();
        await expect(pills, 'A filter pill should appear once a content type filter is applied').not.toBeEmpty();
    });

    await test.step('Clearing all filters restores the unfiltered listing', async () => {
        await openFilterPanelIfCollapsed(page);
        await page.locator('.filterOptions button[type="reset"]', { hasText: 'Clear All' }).click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(new URL(page.url()).searchParams.get('Content Type'), 'Clear All should remove the Content Type filter from the URL').toBeFalsy();
    });
});

test('News - Sort Options', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Open /news', async () => {
        await openNews(page);
        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'The listing should expose results to sort').toBeGreaterThan(0);
    });

    for (const { labels, slug } of SORT_OPTIONS) {
        await test.step(`Select sort option "${labels[0]}"`, async () => {
            const matchedLabel = await selectSortOption(page, labels);

            expect(new URL(page.url()).searchParams.get('sortby'), `Selecting "${matchedLabel}" should set sortby=${slug} in the URL`).toBe(slug);
            await expect(page.locator('#sortby__order')).toHaveValue(slug);
        });
    }
});

test('News - Pagination', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Open /news', async () => {
        await openNews(page);
        const cardCount = await getResultCards(page).count();
        expect(cardCount, 'The listing should expose results to paginate through').toBeGreaterThan(0);
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
    // of this file, same precedent as 04-rsc.search.spec.js).
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

test('News - Sample Article Traversal', async ({ page }) => {
    test.setTimeout(180000);

    let sampledArticles;
    await test.step('Open /news and sample up to 6 of the default listing\'s article cards', async () => {
        await openNews(page);
        const cards = await page.locator('.listWrapper .card.card--link .card__title a').evaluateAll(
            (anchors) => anchors.map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim() })),
        );
        expect(cards.length, 'The default News listing should expose article cards to sample from').toBeGreaterThan(0);
        sampledArticles = sampleUpToSix(cards);
    });

    for (const [index, article] of (sampledArticles || []).entries()) {
        await test.step(`Open sampled article #${index + 1}: "${article.text}"`, async () => {
            await openPage(page, article.href);

            const pageHeading = page.locator('h1').first();
            await expect(pageHeading, 'The article should expose a non-empty H1').toBeVisible();
            const h1Text = (await pageHeading.innerText()).trim();
            expect(h1Text.length, 'The article H1 should not be empty').toBeGreaterThan(0);

            const breadcrumbNav = page.locator('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]').first();
            await expect(breadcrumbNav, 'The article should expose a breadcrumb trail').toBeVisible();

            await verifyFooterVisible(page);
        });
    }
});
