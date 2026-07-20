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
// Coverage notes - Insight (/insight) hub and all 7 tabs
// ============================================================================
// Scope: the Insight hub page and its 7 tabs (Featured, Latest, Read,
// Listen, Watch, Events, Search), including the search tab's dropdown/text
// filtering, plus a sample of individual article pages reached from
// several of those tabs.
//
// Tests in this file (12 total):
//   1. Insight - Featured
//      Verifies the hero/tab highlight, hot topic cards, #WorkingWorld
//      section, and Resources section/footer.
//   2. Insight - Latest / 3. Read / 4. Listen / 5. Watch (4 near-identical
//      tests, one per tab)
//      Verifies the hero/tab highlight, confirms that tab's items are
//      sorted in descending date order, and checks the optional "Show
//      more" button + footer.
//   6. Insight - Events
//      Same shape as above, but events are checked in ASCENDING date
//      order (upcoming-first), not descending like the other tabs.
//   7. Insight - Search
//      Verifies the hero/tab highlight and the default (empty) search
//      controls, plus the footer.
//   8. Insight - Search - Filter Using Dropdowns
//      Cycles through the live dropdown option sets for practice/area of
//      focus/applicable law/client type, applying combinations and
//      confirming results update.
//   9. Insight - Search - Filter Using Text
//      Cycles through 5 free-text search terms (united kingdom, practice,
//      law, fraud, charity), confirming results for each.
//   10. Insight - Search - Filter Using Dropdowns and Text
//      Combines both filter types together across several cycles.
//   11. Insight - Search - Triggering No Results
//      Forces a unique, guaranteed-empty search term and confirms the
//      "Can't find what you are looking for?" message appears.
//   12. Insight - Sample Articles - Keep Their Expected Metadata and Page
//      Elements
//      Deliberately a SAMPLE, not exhaustive: opens the Featured hero
//      article, samples several cards from at least one other tab, and
//      separately traverses a UK-free-text-filtered Search result -
//      confirming each opened article's metadata/page elements are intact.
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';
const INSIGHT_TAB_ORDER = ['Featured', 'Latest', 'Read', 'Listen', 'Watch', 'Events', 'Search'];
const SEARCH_NO_RESULTS_MESSAGE = "Can't find what you are looking for? Please try another search term or contact us.";
const SEARCH_TEXT_TERMS = ['united kingdom', 'practice', 'law', 'fraud', 'charity'];
const SEARCH_DROPDOWN_CONFIG = [
    { fieldName: 'practice', defaultLabel: 'All practices', expectedOptionCount: 16 },
    { fieldName: 'areaoffocus', defaultLabel: 'All areas of focus', expectedOptionCount: 1 },
    { fieldName: 'applicablelaw', defaultLabel: 'All applicable law', expectedOptionCount: 18 },
    { fieldName: 'clienttype', defaultLabel: 'All client types', expectedOptionCount: 15 },
];
const MONTHS = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
};

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click();
    }

    await dismissCookieOverlayIfPresent(page);
}

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    const acceptAllButton = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept all cookies")').first();
    const closeButton = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button[aria-label="Close"]').first();

    const overlayVisible = await cookieOverlay.isVisible().catch(() => false);
    const acceptVisible = await acceptAllButton.isVisible().catch(() => false);
    const closeVisible = await closeButton.isVisible().catch(() => false);

    if (!overlayVisible && !acceptVisible && !closeVisible) {
        return;
    }

    if (acceptVisible) {
        await acceptAllButton.click({ timeout: 2000 }).catch(() => { });
    }

    if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click({ timeout: 2000 }).catch(() => { });
    }

    if (await cookieOverlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }
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

async function getInsightTabLabelsInOrder(page) {
    return await page.locator('.rowLabel__link').evaluateAll((nodes, expectedLabels) => nodes
        .map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(text => expectedLabels.includes(text)), INSIGHT_TAB_ORDER);
}

async function getInsightDateLabels(page) {
    const bodyText = await page.locator('body').innerText();
    return bodyText
        .split(/\r?\n/)
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter(line => /^(?:\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?|[A-Za-z]+\s+\d{4})\s+\|\s+[A-Za-z]+$/i.test(line));
}

function parseInsightDateLabel(label) {
    const [datePart] = label.split('|');
    const tokens = datePart.trim().split(/\s+/);
    const currentYear = new Date().getFullYear();

    if (tokens.length === 3) {
        const day = Number(tokens[0]);
        const month = MONTHS[tokens[1].toLowerCase()];
        const year = Number(tokens[2]);
        return Date.UTC(year, month, day);
    }

    if (tokens.length === 2 && /^\d{4}$/.test(tokens[1])) {
        const month = MONTHS[tokens[0].toLowerCase()];
        const year = Number(tokens[1]);
        return Date.UTC(year, month, 1);
    }

    if (tokens.length === 2) {
        const day = Number(tokens[0]);
        const month = MONTHS[tokens[1].toLowerCase()];
        return Date.UTC(currentYear, month, day);
    }

    return Number.NaN;
}

function trimCollapsedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getLeadingTitleFragment(value, wordCount = 10) {
    return trimCollapsedText(value).split(/\s+/).slice(0, wordCount).join(' ');
}

function normalizeInsightArticleTitle(value) {
    return trimCollapsedText(String(value || '').replace(/^(?:HERO TITLE|HT|LABEL)\s+/i, ''));
}

function normalizeInsightPath(value) {
    return decodeURIComponent(new URL(String(value || ''), 'https://www.withersworldwide.com').pathname);
}

function createSeededNumberGenerator(seed) {
    let state = seed >>> 0;

    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function pickDeterministicOptions(options, count, seed) {
    const shuffledOptions = [...options];
    const nextRandom = createSeededNumberGenerator(seed);

    for (let index = shuffledOptions.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(nextRandom() * (index + 1));
        [shuffledOptions[index], shuffledOptions[swapIndex]] = [shuffledOptions[swapIndex], shuffledOptions[index]];
    }

    return shuffledOptions.slice(0, count);
}

function getSearchTabLink(page) {
    return page.locator('a[href*="/insight?tab=search&scrollToTabs"]').first();
}

function getSearchTextbox(page) {
    return page.getByRole('textbox', { name: 'Including the words...' });
}

function getSearchApplyButton(page) {
    return page.getByRole('button', { name: 'Apply filters' });
}

function getSearchClearAllLink(page) {
    return page.getByRole('link', { name: 'clear all' });
}

function getSearchNoResultsMessage(page) {
    return page.getByText(SEARCH_NO_RESULTS_MESSAGE, { exact: true });
}

function getSearchDropdown(page, fieldName) {
    return page.locator('.filter__select').filter({ has: page.locator(`input[name="${fieldName}"]`) }).first();
}

function getInsightTabLink(page, tabLabel) {
    if (tabLabel === 'Search') {
        return page.getByText('Search', { exact: true });
    }

    if (tabLabel === 'Read') {
        return page.getByRole('link', { name: 'Read', exact: true });
    }

    return page.getByRole('link', { name: tabLabel });
}

function getInsightTabUrlPattern(tabLabel) {
    return new RegExp(`/insight\\?tab=${tabLabel.toLowerCase()}(?:&scrollToTabs)?$`, 'i');
}

async function openInsightLandingPage(page) {
    await page.goto('/insight', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);
    await expect(page, 'The Insight traversal flow should start from the localized Insight page').toHaveURL(/\/insight$/i);
}

async function openInsightTab(page, tabLabel) {
    const tabLink = getInsightTabLink(page, tabLabel);
    await expect(tabLink, `The Insight page should expose the ${tabLabel} tab before opening it`).toBeVisible();
    await clickWithCookieGuard(page, tabLink);
    await expect(page, `Selecting ${tabLabel} should update the URL to the expected Insight tab route`).toHaveURL(getInsightTabUrlPattern(tabLabel));

    if (tabLabel === 'Search') {
        await getSearchApplyButton(page).waitFor({ state: 'visible', timeout: 30000 });
    } else {
        await page.waitForLoadState('domcontentloaded');
    }

    await dismissCookieOverlayIfPresent(page);
}

async function getFeaturedInsightSample(page) {
    const featuredHeading = page.getByRole('heading', { level: 1 }).first();
    await expect(featuredHeading, 'The Featured Insight hero should expose the lead article heading before traversal starts').toBeVisible();

    const readMoreLink = page.getByRole('link', { name: 'READ MORE' }).first();
    await expect(readMoreLink, 'The Featured Insight hero should expose the READ MORE CTA before traversal starts').toBeVisible();

    const href = await readMoreLink.getAttribute('href');
    expect(href, 'The Featured Insight hero should link to an article destination').toBeTruthy();

    return {
        index: 1,
        title: trimCollapsedText(await featuredHeading.innerText()),
        normalizedTitle: normalizeInsightArticleTitle(await featuredHeading.innerText()),
        titleFragment: getLeadingTitleFragment(normalizeInsightArticleTitle(await featuredHeading.innerText())),
        date: null,
        path: normalizeInsightPath(href),
        requiredVisibleCardCount: 1,
    };
}

async function getInsightArticleCards(page) {
    return page.locator('.articleCard').evaluateAll((nodes) => {
        const trimText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const normalizeTitle = (value) => trimText(String(value || '').replace(/^(?:HERO TITLE|HT|LABEL)\s+/i, ''));

        return nodes.map((node, index) => {
            const link = node.querySelector('h3 a[href]');
            const title = trimText(link?.textContent || '');
            const date = trimText(node.querySelector('.label p')?.textContent || '');
            const href = link?.getAttribute('href') || '';
            const path = href ? decodeURIComponent(new URL(href, window.location.origin).pathname) : '';

            return {
                index: index + 1,
                title,
                normalizedTitle: normalizeTitle(title),
                titleFragment: trimText(normalizeTitle(title)).split(/\s+/).slice(0, 10).join(' '),
                date,
                path,
            };
        }).filter((card) => card.title && card.path);
    });
}

async function revealInsightCardsToCount(page, targetCount, scenarioLabel) {
    let cards = await getInsightArticleCards(page);

    while (cards.length < targetCount) {
        const showMoreButton = page.getByRole('button', { name: /^Show more$/i }).first();
        const previousCount = cards.length;

        await expect(showMoreButton, `${scenarioLabel} should keep exposing Show more until at least ${targetCount} cards are visible`).toBeVisible();

        let expanded = false;
        for (let attempt = 0; attempt < 3 && !expanded; attempt += 1) {
            await dismissCookieOverlayIfPresent(page);
            await showMoreButton.scrollIntoViewIfNeeded().catch(() => { });

            if (attempt === 0) {
                await clickWithCookieGuard(page, showMoreButton);
            } else {
                await showMoreButton.click({ force: true });
            }

            try {
                await expect.poll(async () => {
                    const nextCards = await getInsightArticleCards(page);
                    return nextCards.length;
                }, {
                    timeout: 5000,
                }).toBeGreaterThan(previousCount);
                expanded = true;
            } catch (error) {
                if (attempt === 2) {
                    throw error;
                }
            }
        }

        cards = await getInsightArticleCards(page);
    }

    return cards;
}

async function assertInsightArticlePage(page, sample, scenarioLabel) {
    await page.waitForLoadState('load');
    await dismissCookieOverlayIfPresent(page);

    await expect.poll(() => normalizeInsightPath(page.url()), {
        message: `${scenarioLabel} should open the expected Insight article route`,
        timeout: 30000,
    }).toBe(sample.path);

    await expect(page, `${scenarioLabel} should expose the sampled article title in the page title`).toHaveTitle(new RegExp(escapeRegExp(sample.titleFragment), 'i'));

    const articleH1 = page.getByRole('heading', { level: 1 }).first();
    await expect(articleH1, `${scenarioLabel} should load a visible article H1`).toBeVisible();
    await expect.poll(async () => normalizeInsightArticleTitle(await articleH1.innerText()), {
        message: `${scenarioLabel} should keep the sampled title in the article H1`,
        timeout: 30000,
    }).toContain(sample.titleFragment);

    const hero = page.locator('.hero').first();
    await expect(hero, `${scenarioLabel} should load with a visible article hero`).toBeVisible();

    if (sample.date) {
        const [publishedDate, articleType] = sample.date.split('|').map(trimCollapsedText);
        await expect(hero, `${scenarioLabel} should keep the sampled card date in the article hero`).toContainText(new RegExp(escapeRegExp(publishedDate), 'i'));

        if (articleType) {
            await expect(hero, `${scenarioLabel} should keep the sampled card type in the article hero`).toContainText(new RegExp(escapeRegExp(articleType), 'i'));
        }
    } else {
        await expect(hero, `${scenarioLabel} should show a published date in the article hero even when the Featured card does not expose it pre-click`).toContainText(/\d{1,2}\s+[A-Z]+\s+\d{4}/i);
    }

    const xShareLink = page.locator('a[href*="twitter.com/share"], a[aria-label*="Twitter" i], a[aria-label*="X" i]').first();
    const linkedInShareLink = page.getByRole('link', { name: /Share on LinkedIn/i }).first();
    const facebookShareLink = page.getByRole('link', { name: /Share on Facebook/i }).first();
    const emailShareLink = page.getByRole('link', { name: /Share on Email/i }).first();

    await expect(xShareLink, `${scenarioLabel} should expose the X or Twitter share control below the article content`).toBeVisible();
    await expect(xShareLink, `${scenarioLabel} should link the X or Twitter share control to the expected share endpoint`).toHaveAttribute('href', /twitter\.com|x\.com/i);
    await expect(xShareLink, `${scenarioLabel} should open the X or Twitter share control in a new page`).toHaveAttribute('target', '_blank');

    await expect(linkedInShareLink, `${scenarioLabel} should expose the LinkedIn share control below the article content`).toBeVisible();
    await expect(linkedInShareLink, `${scenarioLabel} should link the LinkedIn share control to the expected share endpoint`).toHaveAttribute('href', /linkedin\.com/i);
    await expect(linkedInShareLink, `${scenarioLabel} should open the LinkedIn share control in a new page`).toHaveAttribute('target', '_blank');

    await expect(facebookShareLink, `${scenarioLabel} should expose the Facebook share control below the article content`).toBeVisible();
    await expect(facebookShareLink, `${scenarioLabel} should link the Facebook share control to the expected share endpoint`).toHaveAttribute('href', /facebook\.com/i);
    await expect(facebookShareLink, `${scenarioLabel} should open the Facebook share control in a new page`).toHaveAttribute('target', '_blank');

    await expect(emailShareLink, `${scenarioLabel} should expose the Email share control below the article content`).toBeVisible();
    await expect(emailShareLink, `${scenarioLabel} should keep the Email share control as a mailto link`).toHaveAttribute('href', /^mailto:/i);

    const joinHeading = page.getByRole('heading', { level: 2, name: 'Join the club' }).first();
    if (await joinHeading.isVisible().catch(() => false)) {
        await joinHeading.scrollIntoViewIfNeeded();
        await expect(joinHeading, `${scenarioLabel} should expose the optional Join the club section when it is present`).toBeVisible();

        const joinSection = page.locator('xpath=//h2[normalize-space()="Join the club"]/ancestor::section[1]').first();
        const signUpHereLink = joinSection.getByRole('link', { name: /Sign up here/i }).first();
        await expect(signUpHereLink, `${scenarioLabel} should show the Sign up here CTA when Join the club is present`).toBeVisible();
    }

    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, `${scenarioLabel} should keep the footer visible below the article page content`).toBeVisible();
}

async function openInsightSearchTab(page) {
    await page.goto('/insight', { waitUntil: 'domcontentloaded' });
    await acceptCookiesIfPresent(page);

    const searchTabLink = getSearchTabLink(page);
    await expect(searchTabLink, 'The insight page should expose the Search tab link').toBeVisible();
    await clickWithCookieGuard(page, searchTabLink);

    await expect(page, 'Selecting Search should update the URL to the localized search tab route').toHaveURL(/\/insight\?tab=search(?:&scrollToTabs)?$/i);
    await getSearchApplyButton(page).waitFor({ state: 'visible', timeout: 30000 });
}

async function getSearchDropdownOptionLabels(page, fieldName) {
    const optionTexts = await getSearchDropdown(page, fieldName).locator('a.filter__item').allTextContents();
    return optionTexts.map(trimCollapsedText).filter(Boolean);
}

async function assertSearchFilterControls(page) {
    for (const config of SEARCH_DROPDOWN_CONFIG) {
        const dropdown = getSearchDropdown(page, config.fieldName);
        const button = dropdown.locator('button.filter__btn');
        const options = dropdown.locator('a.filter__item');

        await expect(button, `${config.defaultLabel} should be visible in the Search filter area`).toBeVisible();
        await expect(button, `${config.defaultLabel} should be the default text before any filters are applied`).toContainText(config.defaultLabel);
        await expect(options, `${config.defaultLabel} should expose the expected number of filter options on the live page`).toHaveCount(config.expectedOptionCount);
    }

    await expect(getSearchTextbox(page), 'The Search tab should expose the free-text search box').toBeVisible();
    await expect(getSearchApplyButton(page), 'The Search tab should expose the Apply filters button').toBeVisible();
    await expect(getSearchClearAllLink(page), 'The Search tab should expose the clear all link').toBeVisible();
}

async function selectSearchDropdownOption(page, fieldName, optionLabel) {
    const dropdown = getSearchDropdown(page, fieldName);
    const button = dropdown.locator('button.filter__btn');
    const option = dropdown.locator('a.filter__item').filter({ hasText: new RegExp(`^${escapeRegExp(optionLabel)}$`) }).first();

    await clickWithCookieGuard(page, button);

    try {
        await option.click();
    } catch {
        await option.evaluate(node => node.click());
    }

    await expect(button, `${optionLabel} should be reflected in the ${fieldName} dropdown button after selection`).toContainText(optionLabel);
}

async function applySearchFilters(page) {
    await expect(getSearchApplyButton(page), 'The Search tab should show the Apply filters button before submitting filters').toBeVisible();
    await clickWithCookieGuard(page, getSearchApplyButton(page));

    await expect.poll(() => page.url(), {
        message: 'Applying search filters should keep the user on the Search results route',
        timeout: 30000,
    }).toContain('tab=search');

    await expect.poll(() => page.url(), {
        message: 'Applying search filters should persist the active filter state in the URL',
        timeout: 30000,
    }).toContain('filter=1');

    await getSearchApplyButton(page).waitFor({ state: 'visible', timeout: 30000 });
}

async function clearSearchFilters(page) {
    const clearAllLink = getSearchClearAllLink(page);

    await expect(clearAllLink, 'The clear all link should be visible after filters are applied').toBeVisible();
    await dismissCookieOverlayIfPresent(page);

    try {
        await clearAllLink.click({ noWaitAfter: true });
    } catch {
        await clearAllLink.evaluate(node => node.click());
    }

    await expect(page, 'Clearing search filters should return the Search tab to its base route').toHaveURL(/\/insight\?tab=search(?:&scrollToTabs)?$/i);
    await getSearchApplyButton(page).waitFor({ state: 'visible', timeout: 30000 });
    await expect(getSearchTextbox(page), 'Clearing filters should empty the free-text search box').toHaveValue('');

    for (const config of SEARCH_DROPDOWN_CONFIG) {
        await expect(getSearchDropdown(page, config.fieldName).locator('button.filter__btn'), `Clearing filters should reset ${config.defaultLabel} back to its default label`).toContainText(config.defaultLabel);
    }
}

async function assertSearchResultsOrNoResults(page, scenarioLabel) {
    const noResultsMessage = getSearchNoResultsMessage(page);
    const noResultsVisible = await noResultsMessage.isVisible().catch(() => false);

    await expect(getSearchClearAllLink(page), `${scenarioLabel} should keep the clear all link available after applying filters`).toBeVisible();

    if (noResultsVisible) {
        await expect(noResultsMessage, `${scenarioLabel} should show the accepted no-results message when the chosen filters match nothing`).toBeVisible();
        return false;
    }

    const dateLabels = await getInsightDateLabels(page);
    expect(dateLabels.length, `${scenarioLabel} should show date-labelled results when the no-results message is absent`).toBeGreaterThan(0);

    const parsedDates = dateLabels.map(parseInsightDateLabel);
    expect(parsedDates.every(timestamp => Number.isFinite(timestamp)), `${scenarioLabel} should only show parseable result-date labels`).toBe(true);

    for (let index = 0; index < parsedDates.length - 1; index += 1) {
        expect(parsedDates[index], `${scenarioLabel} should keep results ordered from newer to older between ${dateLabels[index]} and ${dateLabels[index + 1]}`).toBeGreaterThanOrEqual(parsedDates[index + 1]);
    }

    return true;
}

async function runSearchScenario(page, scenarioLabel, selections, searchTerm) {
    for (const selection of selections) {
        await selectSearchDropdownOption(page, selection.fieldName, selection.optionLabel);
    }

    const searchTextbox = getSearchTextbox(page);
    await searchTextbox.fill(searchTerm);
    await applySearchFilters(page);
    await assertSearchResultsOrNoResults(page, scenarioLabel);
}

async function getDeterministicSearchCycleChoices(page) {
    const searchOptionsByField = {};
    for (const config of SEARCH_DROPDOWN_CONFIG) {
        searchOptionsByField[config.fieldName] = (await getSearchDropdownOptionLabels(page, config.fieldName)).slice(1);
    }

    return {
        practiceChoices: pickDeterministicOptions(searchOptionsByField.practice, 3, 20260507),
        lawChoices: pickDeterministicOptions(searchOptionsByField.applicablelaw, 2, 20260508),
    };
}

test('Insight - Featured', async ({ page }) => {
    await test.step('Open the Insight page', async () => {
        await page.goto('/insight', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await page.waitForLoadState('domcontentloaded');
        await expect(page, 'The insight test should land on the localized /insight page').toHaveURL(/\/insight$/);
    });

    await test.step('Verify the hero and highlighted insight tabs', async () => {
        const featuredHeadline = page.getByRole('heading', { level: 1 }).first();
        const featuredHero = featuredHeadline.locator('xpath=ancestor::*[self::section or self::div][1]');

        await expect(featuredHeadline, 'The insight landing page should show a featured insight headline').toBeVisible();
        await expect(featuredHero.locator('p').filter({ hasText: /^Insight$/i }).first(), 'The insight landing page should show the Insight section label in the hero').toBeVisible();

        const readMoreLink = page.getByRole('link', { name: 'READ MORE' });
        await expect(readMoreLink, 'The insight hero should include a READ MORE link').toBeVisible();

        const featuredTab = page.getByRole('link', { name: 'Featured' });
        const latestTab = page.getByRole('link', { name: 'Latest' });
        const readTab = page.getByRole('link', { name: 'Read', exact: true });
        const listenTab = page.getByRole('link', { name: 'Listen' });
        const watchTab = page.getByRole('link', { name: 'Watch' });
        const eventsTab = page.getByRole('link', { name: 'Events' });
        const searchTab = page.getByText('Search', { exact: true });

        await expect(featuredTab, 'The insight landing page should show the Featured tab').toBeVisible();
        await expect(featuredTab.locator('..'), 'The Featured tab should be highlighted on initial page load').toHaveClass(/active/);
        await expect(latestTab, 'The insight landing page should show the Latest tab').toBeVisible();
        await expect(readTab, 'The insight landing page should show the Read tab').toBeVisible();
        await expect(listenTab, 'The insight landing page should show the Listen tab').toBeVisible();
        await expect(watchTab, 'The insight landing page should show the Watch tab').toBeVisible();
        await expect(eventsTab, 'The insight landing page should show the Events tab').toBeVisible();
        await expect(searchTab, 'The insight landing page should show the Search tab').toBeVisible();

        const tabLabelsInOrder = await getInsightTabLabelsInOrder(page);
        expect(tabLabelsInOrder, 'The insight tabs should appear in the expected order').toEqual(INSIGHT_TAB_ORDER);
    });

    await test.step('Verify the hot topic cards', async () => {
        const hotTopicHeadings = page.getByRole('heading', { name: 'HOT TOPIC' });
        await expect(hotTopicHeadings, 'The insight page should show three HOT TOPIC sections').toHaveCount(3);

        for (let index = 0; index < 3; index += 1) {
            const hotTopicHeading = hotTopicHeadings.nth(index);
            const card = hotTopicHeading.locator('..');
            await expect(hotTopicHeading, `HOT TOPIC section ${index + 1} should be visible`).toBeVisible();
            await expect(card.getByRole('link', { name: /FIND OUT MORE/i }), `HOT TOPIC section ${index + 1} should include a FIND OUT MORE link`).toBeVisible();
        }
    });

    await test.step('Verify the #WorkingWorld section', async () => {
        await expect(page.getByText('#WorkingWorld Sharing insight'), 'The insight page should show the #WorkingWorld Sharing insight text').toBeVisible();
        await expect(page.getByRole('link', { name: '#WorkingWorld' }), 'The insight page should include the #WorkingWorld link').toBeVisible();
    });

    await test.step('Verify the Resources section and footer', async () => {
        const resourcesHeading = page.getByRole('heading', { name: 'Resources' });
        await expect(resourcesHeading, 'The insight page should show the Resources heading').toBeVisible();

        const resourceLinks = resourcesHeading.locator('..').locator('..').getByRole('link');
        await expect(resourceLinks, 'The Resources section should contain exactly two resource articles').toHaveCount(2);

        const footer = page.locator('footer');
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The page should show the footer after the content sections').toBeVisible();
    });
});

test('Insight - Latest', async ({ page }) => {
    await test.step('Open the Insight Latest tab', async () => {
        await page.goto('/insight', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);

        const latestTab = page.getByRole('link', { name: 'Latest' });
        await expect(latestTab, 'The insight page should expose the Latest tab').toBeVisible();
        await clickWithCookieGuard(page, latestTab);

        await expect(page, 'Selecting Latest should update the URL to the localized latest tab route').toHaveURL(/\/insight\?tab=latest(?:&scrollToTabs)?$/i);
        await page.waitForLoadState('domcontentloaded');
    });

    await test.step('Verify the hero and highlighted Latest tab', async () => {
        const readMoreLink = page.getByRole('link', { name: 'READ MORE' });
        const featuredTab = page.getByRole('link', { name: 'Featured' });
        const latestTab = page.getByRole('link', { name: 'Latest' });
        const readTab = page.getByRole('link', { name: 'Read', exact: true });
        const listenTab = page.getByRole('link', { name: 'Listen' });
        const watchTab = page.getByRole('link', { name: 'Watch' });
        const eventsTab = page.getByRole('link', { name: 'Events' });
        const searchTab = page.getByText('Search', { exact: true });

        await expect(readMoreLink, 'The Latest tab hero should still include a READ MORE link').toBeVisible();
        await expect(featuredTab, 'The Featured tab should remain visible from the Latest view').toBeVisible();
        await expect(latestTab, 'The Latest tab should remain visible after the page reload').toBeVisible();
        await expect(latestTab.locator('..'), 'The Latest tab should be highlighted after it is selected').toHaveClass(/active/);
        await expect(readTab, 'The Read tab should remain visible from the Latest view').toBeVisible();
        await expect(listenTab, 'The Listen tab should remain visible from the Latest view').toBeVisible();
        await expect(watchTab, 'The Watch tab should remain visible from the Latest view').toBeVisible();
        await expect(eventsTab, 'The Events tab should remain visible from the Latest view').toBeVisible();
        await expect(searchTab, 'The Search tab should remain visible from the Latest view').toBeVisible();

        const tabLabelsInOrder = await getInsightTabLabelsInOrder(page);
        expect(tabLabelsInOrder, 'The insight tabs should remain in the expected order after switching to Latest').toEqual(INSIGHT_TAB_ORDER);
    });

    const latestDateLabels = await test.step('Verify latest insight articles are shown in descending date order', async () => {
        const dateLabels = await getInsightDateLabels(page);
        expect(dateLabels.length, 'The Latest tab should show date-labelled article metadata').toBeGreaterThan(0);

        const parsedDates = dateLabels.map(parseInsightDateLabel);
        expect(parsedDates.every(timestamp => Number.isFinite(timestamp)), 'Each latest article date label should be parseable').toBe(true);

        for (let index = 0; index < parsedDates.length - 1; index += 1) {
            expect(parsedDates[index], `Latest article date ${dateLabels[index]} should not be older than the next item ${dateLabels[index + 1]}`).toBeGreaterThanOrEqual(parsedDates[index + 1]);
        }

        return dateLabels;
    });

    await test.step('Verify the optional Show more button and footer', async () => {
        const showMoreButton = page.getByRole('button', { name: 'Show more' });
        const showMoreVisible = await showMoreButton.isVisible().catch(() => false);

        if (latestDateLabels.length >= 12) {
            await expect(showMoreButton, 'A full Latest listing should expose the Show more button when additional items are available').toBeVisible();
        } else {
            expect(showMoreVisible, 'The Show more button should not appear when fewer than 12 latest articles are shown').toBe(false);
        }

        const footer = page.locator('footer');
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Latest tab page should still show the footer').toBeVisible();
    });
});

test('Insight - Read', async ({ page }) => {
    await test.step('Open the Insight Read tab', async () => {
        await page.goto('/insight', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);

        const readTab = page.getByRole('link', { name: 'Read', exact: true });
        await expect(readTab, 'The insight page should expose the Read tab').toBeVisible();
        await clickWithCookieGuard(page, readTab);

        await expect(page, 'Selecting Read should update the URL to the localized read tab route').toHaveURL(/\/insight\?tab=read(?:&scrollToTabs)?$/i);
        await page.waitForLoadState('domcontentloaded');
    });

    await test.step('Verify the hero and highlighted Read tab', async () => {
        const readMoreLink = page.getByRole('link', { name: 'READ MORE' });
        const featuredTab = page.getByRole('link', { name: 'Featured' });
        const latestTab = page.getByRole('link', { name: 'Latest' });
        const readTab = page.getByRole('link', { name: 'Read', exact: true });
        const listenTab = page.getByRole('link', { name: 'Listen' });
        const watchTab = page.getByRole('link', { name: 'Watch' });
        const eventsTab = page.getByRole('link', { name: 'Events' });
        const searchTab = page.getByText('Search', { exact: true });

        await expect(readMoreLink, 'The Read tab hero should still include a READ MORE link').toBeVisible();
        await expect(featuredTab, 'The Featured tab should remain visible from the Read view').toBeVisible();
        await expect(latestTab, 'The Latest tab should remain visible from the Read view').toBeVisible();
        await expect(readTab, 'The Read tab should remain visible after the page reload').toBeVisible();
        await expect(readTab.locator('..'), 'The Read tab should be highlighted after it is selected').toHaveClass(/active/);
        await expect(listenTab, 'The Listen tab should remain visible from the Read view').toBeVisible();
        await expect(watchTab, 'The Watch tab should remain visible from the Read view').toBeVisible();
        await expect(eventsTab, 'The Events tab should remain visible from the Read view').toBeVisible();
        await expect(searchTab, 'The Search tab should remain visible from the Read view').toBeVisible();

        const tabLabelsInOrder = await getInsightTabLabelsInOrder(page);
        expect(tabLabelsInOrder, 'The insight tabs should remain in the expected order after switching to Read').toEqual(INSIGHT_TAB_ORDER);
    });

    const readDateLabels = await test.step('Verify read insight articles are shown in descending date order', async () => {
        const dateLabels = await getInsightDateLabels(page);
        expect(dateLabels.length, 'The Read tab should show date-labelled article metadata').toBeGreaterThan(0);

        const parsedDates = dateLabels.map(parseInsightDateLabel);
        expect(parsedDates.every(timestamp => Number.isFinite(timestamp)), 'Each read article date label should be parseable').toBe(true);

        for (let index = 0; index < parsedDates.length - 1; index += 1) {
            expect(parsedDates[index], `Read article date ${dateLabels[index]} should not be older than the next item ${dateLabels[index + 1]}`).toBeGreaterThanOrEqual(parsedDates[index + 1]);
        }

        return dateLabels;
    });

    await test.step('Verify the optional Show more button and footer', async () => {
        const showMoreButton = page.getByRole('button', { name: 'Show more' });
        const showMoreVisible = await showMoreButton.isVisible().catch(() => false);

        if (readDateLabels.length >= 12) {
            await expect(showMoreButton, 'A full Read listing should expose the Show more button when additional items are available').toBeVisible();
        } else {
            expect(showMoreVisible, 'The Show more button should not appear when fewer than 12 read articles are shown').toBe(false);
        }

        const footer = page.locator('footer');
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Read tab page should still show the footer').toBeVisible();
    });
});

test('Insight - Listen', async ({ page }) => {
    await test.step('Open the Insight Listen tab', async () => {
        await page.goto('/insight', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);

        const listenTab = page.getByRole('link', { name: 'Listen' });
        await expect(listenTab, 'The insight page should expose the Listen tab').toBeVisible();
        await clickWithCookieGuard(page, listenTab);

        await expect(page, 'Selecting Listen should update the URL to the localized listen tab route').toHaveURL(/\/insight\?tab=listen(?:&scrollToTabs)?$/i);
        await page.waitForLoadState('domcontentloaded');
    });

    await test.step('Verify the hero and highlighted Listen tab', async () => {
        const readMoreLink = page.getByRole('link', { name: 'READ MORE' });
        const featuredTab = page.getByRole('link', { name: 'Featured' });
        const latestTab = page.getByRole('link', { name: 'Latest' });
        const readTab = page.getByRole('link', { name: 'Read', exact: true });
        const listenTab = page.getByRole('link', { name: 'Listen' });
        const watchTab = page.getByRole('link', { name: 'Watch' });
        const eventsTab = page.getByRole('link', { name: 'Events' });
        const searchTab = page.getByText('Search', { exact: true });

        await expect(readMoreLink, 'The Listen tab hero should still include a READ MORE link').toBeVisible();
        await expect(featuredTab, 'The Featured tab should remain visible from the Listen view').toBeVisible();
        await expect(latestTab, 'The Latest tab should remain visible from the Listen view').toBeVisible();
        await expect(readTab, 'The Read tab should remain visible from the Listen view').toBeVisible();
        await expect(listenTab, 'The Listen tab should remain visible after the page reload').toBeVisible();
        await expect(listenTab.locator('..'), 'The Listen tab should be highlighted after it is selected').toHaveClass(/active/);
        await expect(watchTab, 'The Watch tab should remain visible from the Listen view').toBeVisible();
        await expect(eventsTab, 'The Events tab should remain visible from the Listen view').toBeVisible();
        await expect(searchTab, 'The Search tab should remain visible from the Listen view').toBeVisible();

        const tabLabelsInOrder = await getInsightTabLabelsInOrder(page);
        expect(tabLabelsInOrder, 'The insight tabs should remain in the expected order after switching to Listen').toEqual(INSIGHT_TAB_ORDER);
    });

    const listenDateLabels = await test.step('Verify listen insight items are shown in descending date order', async () => {
        const dateLabels = await getInsightDateLabels(page);
        expect(dateLabels.length, 'The Listen tab should show date-labelled item metadata').toBeGreaterThan(0);

        const parsedDates = dateLabels.map(parseInsightDateLabel);
        expect(parsedDates.every(timestamp => Number.isFinite(timestamp)), 'Each listen item date label should be parseable').toBe(true);

        for (let index = 0; index < parsedDates.length - 1; index += 1) {
            expect(parsedDates[index], `Listen item date ${dateLabels[index]} should not be older than the next item ${dateLabels[index + 1]}`).toBeGreaterThanOrEqual(parsedDates[index + 1]);
        }

        return dateLabels;
    });

    await test.step('Verify the optional Show more button and footer', async () => {
        const showMoreButton = page.getByRole('button', { name: 'Show more' });
        const showMoreVisible = await showMoreButton.isVisible().catch(() => false);

        if (listenDateLabels.length >= 12) {
            await expect(showMoreButton, 'A full Listen listing should expose the Show more button when additional items are available').toBeVisible();
        } else {
            expect(showMoreVisible, 'The Show more button should not appear when fewer than 12 listen items are shown').toBe(false);
        }

        const footer = page.locator('footer');
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Listen tab page should still show the footer').toBeVisible();
    });
});

test('Insight - Watch', async ({ page }) => {
    await test.step('Open the Insight Watch tab', async () => {
        await page.goto('/insight', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);

        const watchTab = page.getByRole('link', { name: 'Watch' });
        await expect(watchTab, 'The insight page should expose the Watch tab').toBeVisible();
        await clickWithCookieGuard(page, watchTab);

        await expect(page, 'Selecting Watch should update the URL to the localized watch tab route').toHaveURL(/\/insight\?tab=watch(?:&scrollToTabs)?$/i);
        await page.waitForLoadState('domcontentloaded');
    });

    await test.step('Verify the hero and highlighted Watch tab', async () => {
        const readMoreLink = page.getByRole('link', { name: 'READ MORE' });
        const featuredTab = page.getByRole('link', { name: 'Featured' });
        const latestTab = page.getByRole('link', { name: 'Latest' });
        const readTab = page.getByRole('link', { name: 'Read', exact: true });
        const listenTab = page.getByRole('link', { name: 'Listen' });
        const watchTab = page.getByRole('link', { name: 'Watch' });
        const eventsTab = page.getByRole('link', { name: 'Events' });
        const searchTab = page.getByText('Search', { exact: true });

        await expect(readMoreLink, 'The Watch tab hero should still include a READ MORE link').toBeVisible();
        await expect(featuredTab, 'The Featured tab should remain visible from the Watch view').toBeVisible();
        await expect(latestTab, 'The Latest tab should remain visible from the Watch view').toBeVisible();
        await expect(readTab, 'The Read tab should remain visible from the Watch view').toBeVisible();
        await expect(listenTab, 'The Listen tab should remain visible from the Watch view').toBeVisible();
        await expect(watchTab, 'The Watch tab should remain visible after the page reload').toBeVisible();
        await expect(watchTab.locator('..'), 'The Watch tab should be highlighted after it is selected').toHaveClass(/active/);
        await expect(eventsTab, 'The Events tab should remain visible from the Watch view').toBeVisible();
        await expect(searchTab, 'The Search tab should remain visible from the Watch view').toBeVisible();

        const tabLabelsInOrder = await getInsightTabLabelsInOrder(page);
        expect(tabLabelsInOrder, 'The insight tabs should remain in the expected order after switching to Watch').toEqual(INSIGHT_TAB_ORDER);
    });

    const watchDateLabels = await test.step('Verify watch insight items are shown in descending date order', async () => {
        const dateLabels = await getInsightDateLabels(page);
        expect(dateLabels.length, 'The Watch tab should show date-labelled item metadata').toBeGreaterThan(0);

        const parsedDates = dateLabels.map(parseInsightDateLabel);
        expect(parsedDates.every(timestamp => Number.isFinite(timestamp)), 'Each watch item date label should be parseable').toBe(true);

        for (let index = 0; index < parsedDates.length - 1; index += 1) {
            expect(parsedDates[index], `Watch item date ${dateLabels[index]} should not be older than the next item ${dateLabels[index + 1]}`).toBeGreaterThanOrEqual(parsedDates[index + 1]);
        }

        return dateLabels;
    });

    await test.step('Verify the optional Show more button and footer', async () => {
        const showMoreButton = page.getByRole('button', { name: 'Show more' });
        const showMoreVisible = await showMoreButton.isVisible().catch(() => false);

        if (watchDateLabels.length >= 12 || showMoreVisible) {
            await expect(showMoreButton, 'A Watch listing with additional items should expose the Show more button').toBeVisible();
        } else {
            expect(showMoreVisible, 'The Show more button should not appear when fewer than 12 watch items are shown').toBe(false);
        }

        const footer = page.locator('footer');
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Watch tab page should still show the footer').toBeVisible();
    });
});

test('Insight - Events', async ({ page }) => {
    await test.step('Open the Insight Events tab', async () => {
        await page.goto('/insight', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);

        const eventsTab = page.getByRole('link', { name: 'Events' });
        await expect(eventsTab, 'The insight page should expose the Events tab').toBeVisible();
        await clickWithCookieGuard(page, eventsTab);

        await expect(page, 'Selecting Events should update the URL to the localized events tab route').toHaveURL(/\/insight\?tab=events(?:&scrollToTabs)?$/i);
        await page.waitForLoadState('domcontentloaded');
    });

    await test.step('Verify the hero and highlighted Events tab', async () => {
        const readMoreLink = page.getByRole('link', { name: 'READ MORE' });
        const featuredTab = page.getByRole('link', { name: 'Featured' });
        const latestTab = page.getByRole('link', { name: 'Latest' });
        const readTab = page.getByRole('link', { name: 'Read', exact: true });
        const listenTab = page.getByRole('link', { name: 'Listen' });
        const watchTab = page.getByRole('link', { name: 'Watch' });
        const eventsTab = page.getByRole('link', { name: 'Events' });
        const searchTab = page.getByText('Search', { exact: true });

        await expect(readMoreLink, 'The Events tab hero should still include a READ MORE link').toBeVisible();
        await expect(featuredTab, 'The Featured tab should remain visible from the Events view').toBeVisible();
        await expect(latestTab, 'The Latest tab should remain visible from the Events view').toBeVisible();
        await expect(readTab, 'The Read tab should remain visible from the Events view').toBeVisible();
        await expect(listenTab, 'The Listen tab should remain visible from the Events view').toBeVisible();
        await expect(watchTab, 'The Watch tab should remain visible from the Events view').toBeVisible();
        await expect(eventsTab, 'The Events tab should remain visible after the page reload').toBeVisible();
        await expect(eventsTab.locator('..'), 'The Events tab should be highlighted after it is selected').toHaveClass(/active/);
        await expect(searchTab, 'The Search tab should remain visible from the Events view').toBeVisible();

        const tabLabelsInOrder = await getInsightTabLabelsInOrder(page);
        expect(tabLabelsInOrder, 'The insight tabs should remain in the expected order after switching to Events').toEqual(INSIGHT_TAB_ORDER);
    });

    const eventDateLabels = await test.step('Verify event items are shown in ascending date order', async () => {
        const dateLabels = await getInsightDateLabels(page);
        expect(dateLabels.length, 'The Events tab should show date-labelled item metadata').toBeGreaterThan(0);

        const parsedDates = dateLabels.map(parseInsightDateLabel);
        expect(parsedDates.every(timestamp => Number.isFinite(timestamp)), 'Each event item date label should be parseable').toBe(true);

        for (let index = 0; index < parsedDates.length - 1; index += 1) {
            expect(parsedDates[index], `Event item date ${dateLabels[index]} should not be newer than the next item ${dateLabels[index + 1]}`).toBeLessThanOrEqual(parsedDates[index + 1]);
        }

        return dateLabels;
    });

    await test.step('Verify the optional Show more button and footer', async () => {
        const showMoreButton = page.getByRole('button', { name: 'Show more' });
        const showMoreVisible = await showMoreButton.isVisible().catch(() => false);

        if (eventDateLabels.length >= 12) {
            await expect(showMoreButton, 'A full Events listing should expose the Show more button when additional items are available').toBeVisible();
        } else {
            expect(showMoreVisible, 'The Show more button should not appear when fewer than 12 event items are shown').toBe(false);
        }

        const footer = page.locator('footer');
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Events tab page should still show the footer').toBeVisible();
    });
});

test('Insight - Search', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open the Insight Search tab', async () => {
        await openInsightSearchTab(page);
    });

    await test.step('Verify the hero, highlighted Search tab, and default search controls', async () => {
        const readMoreLink = page.getByRole('link', { name: 'READ MORE' });
        const featuredTab = page.locator('.rowLabel__link').filter({ hasText: 'Featured' }).first();
        const latestTab = page.locator('.rowLabel__link').filter({ hasText: 'Latest' }).first();
        const readTab = page.locator('.rowLabel__link').filter({ hasText: 'Read' }).first();
        const listenTab = page.locator('.rowLabel__link').filter({ hasText: 'Listen' }).first();
        const watchTab = page.locator('.rowLabel__link').filter({ hasText: 'Watch' }).first();
        const eventsTab = page.locator('.rowLabel__link').filter({ hasText: 'Events' }).first();
        const searchTab = page.locator('.rowLabel__link').filter({ hasText: 'Search' }).first();
        const searchArea = page.locator('.filter.filter--articleList').first();

        await expect(readMoreLink, 'The Search tab view should still include the hero READ MORE link').toBeVisible();
        await expect(featuredTab, 'The Featured tab should remain visible from the Search view').toBeVisible();
        await expect(latestTab, 'The Latest tab should remain visible from the Search view').toBeVisible();
        await expect(readTab, 'The Read tab should remain visible from the Search view').toBeVisible();
        await expect(listenTab, 'The Listen tab should remain visible from the Search view').toBeVisible();
        await expect(watchTab, 'The Watch tab should remain visible from the Search view').toBeVisible();
        await expect(eventsTab, 'The Events tab should remain visible from the Search view').toBeVisible();
        await expect(searchTab, 'The Search tab should remain visible after the page reload').toBeVisible();
        await expect(searchTab, 'The Search tab should be highlighted after it is selected').toHaveClass(/active/);
        await expect(searchArea, 'The Search tab should expose the search/filter area for separate option coverage').toBeVisible();
        await assertSearchFilterControls(page);

        const tabLabelsInOrder = await getInsightTabLabelsInOrder(page);
        expect(tabLabelsInOrder, 'The insight tabs should remain in the expected order after switching to Search').toEqual(INSIGHT_TAB_ORDER);
    });

    await test.step('Verify the footer', async () => {
        const footer = page.locator('footer');
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Search tab page should still show the footer').toBeVisible();
    });
});

test('Insight - Search - Filter Using Dropdowns', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Open the Insight Search tab and cache the live dropdown options', async () => {
        await openInsightSearchTab(page);
        await assertSearchFilterControls(page);
    });

    const { practiceChoices, lawChoices } = await getDeterministicSearchCycleChoices(page);
    const dropdownOnlyCycles = [
        {
            label: `Dropdown-only cycle 1: practice ${practiceChoices[0]}`,
            selections: [{ fieldName: 'practice', optionLabel: practiceChoices[0] }],
        },
        {
            label: `Dropdown-only cycle 2: law ${lawChoices[0]}`,
            selections: [{ fieldName: 'applicablelaw', optionLabel: lawChoices[0] }],
        },
        {
            label: `Dropdown-only cycle 3: practice ${practiceChoices[1]}`,
            selections: [{ fieldName: 'practice', optionLabel: practiceChoices[1] }],
        },
        {
            label: `Dropdown-only cycle 4: law ${lawChoices[1]}`,
            selections: [{ fieldName: 'applicablelaw', optionLabel: lawChoices[1] }],
        },
        {
            label: `Dropdown-only cycle 5: practice ${practiceChoices[2]}`,
            selections: [{ fieldName: 'practice', optionLabel: practiceChoices[2] }],
        },
    ];

    for (const cycle of dropdownOnlyCycles) {
        await test.step(cycle.label, async () => {
            await runSearchScenario(page, cycle.label, cycle.selections, '');
            await clearSearchFilters(page);
        });
    }
});

test('Insight - Search - Filter Using Text', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Open the Insight Search tab', async () => {
        await openInsightSearchTab(page);
    });

    for (const term of SEARCH_TEXT_TERMS) {
        await test.step(`Text-only cycle: ${term}`, async () => {
            await runSearchScenario(page, `Text-only cycle: ${term}`, [], term);
            await clearSearchFilters(page);
        });
    }
});

test('Insight - Search - Filter Using Dropdowns and Text', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Open the Insight Search tab and cache the live dropdown options', async () => {
        await openInsightSearchTab(page);
    });

    const { practiceChoices, lawChoices } = await getDeterministicSearchCycleChoices(page);
    const mixedCycles = [
        {
            label: `Mixed cycle 1: ${practiceChoices[0]} plus ${lawChoices[0]} plus ${SEARCH_TEXT_TERMS[0]}`,
            selections: [
                { fieldName: 'practice', optionLabel: practiceChoices[0] },
                { fieldName: 'applicablelaw', optionLabel: lawChoices[0] },
            ],
            searchTerm: SEARCH_TEXT_TERMS[0],
        },
        {
            label: `Mixed cycle 2: ${lawChoices[1]} plus ${practiceChoices[1]} plus ${SEARCH_TEXT_TERMS[1]}`,
            selections: [
                { fieldName: 'applicablelaw', optionLabel: lawChoices[1] },
                { fieldName: 'practice', optionLabel: practiceChoices[1] },
            ],
            searchTerm: SEARCH_TEXT_TERMS[1],
        },
        {
            label: `Mixed cycle 3: ${practiceChoices[2]} plus ${lawChoices[0]} plus ${SEARCH_TEXT_TERMS[2]}`,
            selections: [
                { fieldName: 'practice', optionLabel: practiceChoices[2] },
                { fieldName: 'applicablelaw', optionLabel: lawChoices[0] },
            ],
            searchTerm: SEARCH_TEXT_TERMS[2],
        },
        {
            label: `Mixed cycle 4: ${practiceChoices[1]} plus ${lawChoices[1]} plus ${SEARCH_TEXT_TERMS[3]}`,
            selections: [
                { fieldName: 'practice', optionLabel: practiceChoices[1] },
                { fieldName: 'applicablelaw', optionLabel: lawChoices[1] },
            ],
            searchTerm: SEARCH_TEXT_TERMS[3],
        },
        {
            label: `Mixed cycle 5: ${lawChoices[0]} plus ${practiceChoices[2]} plus ${SEARCH_TEXT_TERMS[4]}`,
            selections: [
                { fieldName: 'applicablelaw', optionLabel: lawChoices[0] },
                { fieldName: 'practice', optionLabel: practiceChoices[2] },
            ],
            searchTerm: SEARCH_TEXT_TERMS[4],
        },
    ];

    for (const cycle of mixedCycles) {
        await test.step(cycle.label, async () => {
            await runSearchScenario(page, cycle.label, cycle.selections, cycle.searchTerm);
            await clearSearchFilters(page);
        });
    }
});

test('Insight - Search - Triggering No Results', async ({ page }) => {
    await test.step('Open the Insight Search tab', async () => {
        await openInsightSearchTab(page);
    });

    await test.step('Force a no-results outcome with a unique search term', async () => {
        await getSearchTextbox(page).fill('zzqvnomatchwithers2026');
        await applySearchFilters(page);
        await expect(getSearchNoResultsMessage(page), 'A deliberately impossible Search term should show the accepted no-results message').toBeVisible();
    });
});

test('Insight - Sample Articles - Keep Their Expected Metadata and Page Elements', async ({ page }) => {
    test.setTimeout(12 * 60 * 1000);

    const traverseInsightSamples = async (samples, scenarioLabel, returnUrlPattern) => {
        for (const sample of samples) {
            await test.step(`${scenarioLabel} sample ${sample.index}: ${sample.title}`, async () => {
                if (sample.requiredVisibleCardCount > 1) {
                    await revealInsightCardsToCount(page, sample.requiredVisibleCardCount, scenarioLabel);
                }

                const visibleCards = await getInsightArticleCards(page);
                const visibleCard = visibleCards[sample.index - 1];
                expect(visibleCard, `${scenarioLabel} should keep the sampled card index ${sample.index} visible before opening ${sample.title}`).toBeTruthy();
                expect(visibleCard.path, `${scenarioLabel} should keep ${sample.title} at the expected card index before opening it`).toBe(sample.path);

                const articleLink = page.locator('.articleCard h3 a[href]').nth(sample.index - 1);

                await expect(articleLink, `${scenarioLabel} should keep the sampled article card visible before opening ${sample.title}`).toBeVisible();
                await expect.poll(async () => normalizeInsightPath(await articleLink.getAttribute('href') || ''), {
                    message: `${scenarioLabel} should keep ${sample.title} linked to the expected Insight article route`,
                    timeout: 5000,
                }).toBe(sample.path);

                if (sample.date) {
                    expect(visibleCard.date, `${scenarioLabel} should keep the sampled card date visible before opening ${sample.title}`).toMatch(new RegExp(`^${escapeRegExp(sample.date)}$`, 'i'));
                }

                await clickWithCookieGuard(page, articleLink);
                await assertInsightArticlePage(page, sample, scenarioLabel);

                await page.goBack({ waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load');
                await dismissCookieOverlayIfPresent(page);
                await expect(page, `${scenarioLabel} should return to the sampled Insight tab after one browser back action`).toHaveURL(returnUrlPattern);
            });
        }
    };

    await test.step('Traverse the Featured Insight hero article', async () => {
        await openInsightLandingPage(page);

        const featuredSample = await getFeaturedInsightSample(page);
        const readMoreLink = page.getByRole('link', { name: 'READ MORE' }).first();
        await expect.poll(async () => normalizeInsightPath(await readMoreLink.getAttribute('href') || ''), {
            message: 'The Featured Insight hero should keep the READ MORE CTA linked to the lead article',
            timeout: 5000,
        }).toBe(featuredSample.path);

        await clickWithCookieGuard(page, readMoreLink);
        await assertInsightArticlePage(page, featuredSample, 'The Featured Insight hero article');

        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'The Featured Insight traversal should return to the base Insight page after one browser back action').toHaveURL(/\/insight$/i);
    });

    const tabbedSamplingPlan = [
        { tabLabel: 'Latest', expectedMinimumCount: 12 },
        { tabLabel: 'Read', expectedMinimumCount: 12 },
        { tabLabel: 'Listen', expectedMinimumCount: 12 },
        { tabLabel: 'Watch', expectedMinimumCount: 12 },
        { tabLabel: 'Events', expectedMinimumCount: 1, sampleIndexes: [0] },
    ];

    for (const plan of tabbedSamplingPlan) {
        await test.step(`Traverse sampled Insight cards from the ${plan.tabLabel} tab`, async () => {
            await openInsightTab(page, plan.tabLabel);

            let cards = await getInsightArticleCards(page);
            expect(cards.length, `The ${plan.tabLabel} tab should expose enough cards for the requested sampling flow`).toBeGreaterThanOrEqual(plan.expectedMinimumCount);

            if (!plan.sampleIndexes) {
                cards = await revealInsightCardsToCount(page, 13, `The ${plan.tabLabel} tab`);
            }

            const sampleIndexes = plan.sampleIndexes || [2, 11, 12];
            const samples = sampleIndexes.map((index) => {
                const card = cards[index];
                expect(card, `The ${plan.tabLabel} tab should expose the sampled card position ${index + 1}`).toBeTruthy();

                return {
                    ...card,
                    requiredVisibleCardCount: Math.max(index + 1, 1),
                };
            });

            await traverseInsightSamples(samples, `The ${plan.tabLabel} tab`, getInsightTabUrlPattern(plan.tabLabel));
        });
    }

    await test.step('Apply only the UK free-text Search filter and traverse the filtered Insight results', async () => {
        await openInsightTab(page, 'Search');

        await getSearchTextbox(page).fill('UK');
        await applySearchFilters(page);

        const noResultsMessage = getSearchNoResultsMessage(page);
        if (await noResultsMessage.isVisible().catch(() => false)) {
            await expect(noResultsMessage, 'The UK free-text Search filter should continue returning filtered Insight results on the live UAT environment').not.toBeVisible();
            return;
        }

        let filteredCards = await getInsightArticleCards(page);
        expect(filteredCards.length, 'The UK free-text Search filter should expose at least the first 12 cards for the requested sampling flow').toBeGreaterThanOrEqual(12);

        filteredCards = await revealInsightCardsToCount(page, 13, 'The filtered Search results');

        const filteredSamples = [filteredCards[0], filteredCards[11], filteredCards[12]].map((card, index) => {
            expect(card, `The filtered Search results should expose the requested sampled card ${index === 0 ? 1 : index === 1 ? 12 : 13}`).toBeTruthy();

            return {
                ...card,
                requiredVisibleCardCount: index === 0 ? 1 : index === 1 ? 12 : 13,
            };
        });

        await traverseInsightSamples(filteredSamples, 'The filtered Search results', /\/insight\?tab=search(?:&.*)?$/i);
    });
});

