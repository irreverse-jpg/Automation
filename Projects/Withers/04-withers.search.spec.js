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
// Coverage notes - withersworldwide.com site search (/search)
// ============================================================================
// Scope: the dedicated search page and its 4 results tabs (All, Experience,
// People, Insight/Other).
//
// Tests in this file:
//   1. Search - Empty Query
//      Submits an empty search and confirms it lands on the "type=all"
//      results URL with zero result items.
//   2. Search - With and Without Results
//      Searches a nonsense term ("0 results match your search") then
//      "practices" (non-zero results summary), confirming the URL/heading
//      each time.
//   3. Search - Navigate Through Results
//      Searches "practices", then opens each of the Experience/People/
//      Insight/Other tabs in turn, confirming the URL/heading/results
//      count for each, then drills into that tab's first result card
//      (confirming a real H1 or non-empty title on the destination) and
//      back to the same tab.
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

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
        const canRetryWithDomClick = message.includes('intercepts pointer events')
            || message.includes('not stable')
            || message.includes('timeout');

        if (isCookieInterception) {
            await dismissCookieOverlayIfPresent(page);
        }

        if (!isCookieInterception && !canRetryWithDomClick) {
            throw error;
        }

        await locator.scrollIntoViewIfNeeded().catch(() => { });

        try {
            await locator.click({ force: true });
        } catch {
            await locator.evaluate((node) => node.click());
        }
    }
}

async function findFirstVisibleLocator(locator) {
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
            return candidate;
        }
    }

    return null;
}

async function openSearchPage(page) {
    const firstAttempt = await page.goto('/search', { waitUntil: 'domcontentloaded', timeout: 60000 })
        .then(() => true)
        .catch(() => false);

    if (!firstAttempt) {
        await page.goto('/search', { waitUntil: 'commit', timeout: 60000 });
    }

    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => { });
    await acceptCookiesIfPresent(page);
}

async function getFirstSearchResultHref(page, tabType) {
    return page.locator('a[href]').evaluateAll((nodes, currentTabType) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (node) => {
            const style = window.getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
        };

        const candidates = nodes
            .filter(isVisible)
            .map((node) => ({
                href: node.getAttribute('href') || '',
                text: normalize(node.textContent),
                className: String(node.className || ''),
                parentClassName: node.parentElement ? String(node.parentElement.className || '') : '',
            }));

        if (currentTabType === 'experience' || currentTabType === 'other') {
            const featureCard = candidates.find((item) => item.className.includes('featurePanel__card'));
            return featureCard ? featureCard.href : null;
        }

        if (currentTabType === 'people') {
            const personCard = candidates.find((item) => item.className.includes('personRow__cardLink'));
            return personCard ? personCard.href : null;
        }

        if (currentTabType === 'insights') {
            const insightCard = candidates.find((item) => {
                const href = item.href.toLowerCase();
                const classes = `${item.className} ${item.parentClassName}`.toLowerCase();

                if (!href.startsWith('/en-gb/insight/')) {
                    return false;
                }

                if (href === '/en-gb/insight' || href === '/en-gb/insight/newsroom') {
                    return false;
                }

                if (classes.includes('header__') || classes.includes('footer__')) {
                    return false;
                }

                return Boolean(item.text);
            });

            return insightCard ? insightCard.href : null;
        }

        return null;
    }, tabType);
}

async function openFirstSearchResultAndReturn(page, tab) {
    const firstResultHref = await getFirstSearchResultHref(page, tab.type);
    expect(firstResultHref, `${tab.name} tab should expose a clickable first result card`).toBeTruthy();

    const resultLink = await findFirstVisibleLocator(page.locator(`a[href="${firstResultHref}"]`));
    expect(resultLink, `${tab.name} tab should expose the first result link before drilldown`).toBeTruthy();
    await expect(resultLink, `${tab.name} tab should expose the first result link before drilldown`).toBeVisible();

    const destinationUrl = new URL(firstResultHref, page.url()).toString();
    const destinationPathname = new URL(destinationUrl).pathname;

    await resultLink.scrollIntoViewIfNeeded().catch(() => { });

    await resultLink.evaluate((node) => node.click()).catch(() => { });

    const navigatedOnDomClick = await page.waitForURL((currentUrl) => {
        try {
            return new URL(currentUrl).pathname === destinationPathname;
        } catch {
            return false;
        }
    }, { waitUntil: 'domcontentloaded', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

    if (!navigatedOnDomClick) {
        const retryLink = await findFirstVisibleLocator(page.locator(`a[href="${firstResultHref}"]`));
        if (retryLink) {
            await clickWithCookieGuard(page, retryLink);
            await page.waitForURL((currentUrl) => {
                try {
                    return new URL(currentUrl).pathname === destinationPathname;
                } catch {
                    return false;
                }
            }, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } else {
            await page.goto(destinationUrl, { waitUntil: 'domcontentloaded' });
        }
    }

    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);

    const heading = page.getByRole('heading', { level: 1 }).first();
    await expect(heading, `${tab.name} first result page should expose a visible H1`).toBeVisible();
    const headingHasText = await heading.innerText().then((text) => Boolean(String(text || '').trim())).catch(() => false);
    if (!headingHasText) {
        await expect(page, `${tab.name} first result page should expose a non-empty document title when the H1 is empty`).toHaveTitle(/\S+/);
    }

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);
    await expect(page, `${tab.name} drilldown should return to the same results tab after going back`).toHaveURL(new RegExp(`/search\\?term=practices&type=${tab.type}#filter$`));
}

test('Search - Empty Query', async ({ page }) => {
    await test.step('Open search page', async () => {
        await openSearchPage(page);
    });

    await test.step('Submit empty search and verify empty results state', async () => {
        await clickWithCookieGuard(page, page.locator('button[type="submit"]'));
        await expect(page, 'Empty search should redirect to the filter results URL').toHaveURL(/\/search\?term=&type=all#filter$/);
        await expect(page.getByRole('heading', { name: 'Search' }), 'Search results page should show the Search heading').toHaveText('Search');
        await expect(page.locator('.search-results .result-item'), 'Empty search should not list any result items').toHaveCount(0);
    });
}, 30000);

test('Search - With and Without Results', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open search page', async () => {
        await openSearchPage(page);
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
        await openSearchPage(page);
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
            await openFirstSearchResultAndReturn(page, tab);
        });
    }
}, 60000);
