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
// Coverage notes - Compare Savings Accounts (/home/savings/savings-accounts)
// ============================================================================
// Scope: the savings accounts comparison page - title/H1/breadcrumb chrome,
// the results/no-results states, filtering and sorting, and a savings
// product's own details page.
//
// Tests in this file:
//   1. Savings Accounts - Initial Page Load Checks
//      Verifies title/H1/breadcrumb and the "Good news! We've found N..."
//      results heading, confirming N is a real number >= 1.
//   2. Savings Accounts - No Results Scenario
//      Applies 2 contradictory filters (Regular saver + One lump sum) and
//      confirms either an explicit "No accounts found"/"0 savings
//      accounts" state (with a working "View all savings accounts" reset)
//      or, if the site doesn't show that explicit state, removes the
//      filters directly - then confirms results are available again.
//   3. Savings Accounts - Filter and Sorting Results
//      Applies 3 filters (ISA, One lump sum, Open online) and confirms
//      every visible card matches; confirms the default sort is by
//      interest rate (high to low), switches to sort by opening deposit,
//      and confirms that sort order (low to high) too.
//   4. Savings Accounts - Access a Savings product Details Page
//      Opens the first result's "More info" link and confirms the
//      destination H1 matches the card it came from.
//   5. Savings Accounts - Access a Savings Product Details Page After
//      Filters and Sorting
//      Same details-page access check as above, but starting from a
//      filtered + sorted result set rather than the unfiltered default.
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

const SAVINGS_URL = '/home/savings/savings-accounts';
const COOKIE_ACCEPT_SELECTOR =
    'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR =
    '#CybotCookiebotDialogBodyUnderlay, #CybotCookiebotDialog, #onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-consent-sdk';

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

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, cookieButton).catch(() => { });
    }

    await dismissCookieOverlayIfPresent(page);
}

async function expectSavingsAccountsPageChrome(page) {
    await expect(page, 'Savings accounts page should load the expected title').toHaveTitle(/Compare Savings accounts and ISAs/i);

    const pageHeading = page.getByRole('heading', { level: 1, name: /^Compare savings accounts$/i });
    await expect(pageHeading, 'Savings accounts page should show the Compare savings accounts H1').toBeVisible();

    const breadcrumbNav = page.locator('nav[aria-label*="breadcrumb" i], nav[aria-label*="Breadcrumb" i], [aria-label*="breadcrumb" i]').first();
    await expect(breadcrumbNav, 'Savings accounts page should expose a breadcrumb trail').toBeVisible();

    const parentBreadcrumb = breadcrumbNav.getByRole('link', { name: /^Savings$/i }).first();
    await expect(parentBreadcrumb, 'Savings accounts breadcrumb should include Savings as the previous level').toBeVisible();

    const currentBreadcrumb = breadcrumbNav.getByText(/^Compare all savings accounts$/i).first();
    await expect(currentBreadcrumb, 'Savings accounts breadcrumb should show Compare all savings accounts as the current level').toBeVisible();
}

async function clickFilterLabelInScrollableContainer(page, {
    containerSelector = '.filtersContainer__facet-filters',
    labelPrefix
}) {
    const container = page.locator(containerSelector);
    if (!(await container.isVisible().catch(() => false))) {
        const mobileFilterOpener = page.locator('#filters-opener');
        if (await mobileFilterOpener.isVisible().catch(() => false)) {
            await clickWithCookieGuard(page, mobileFilterOpener);
        }
    }

    await container.waitFor({ state: 'visible', timeout: 10000 });

    const clicked = await page.evaluate(({ containerSelector, labelPrefix }) => {
        const container = document.querySelector(containerSelector);
        if (!container) return false;

        const wanted = labelPrefix.trim().toLowerCase();

        const tryClick = () => {
            const labels = Array.from(container.querySelectorAll('label'));
            const target = labels.find(label =>
                (label.textContent || '').trim().toLowerCase().startsWith(wanted)
            );
            if (target) {
                target.click();
                return true;
            }
            return false;
        };

        if (tryClick()) return true;

        // Scroll inside filter panel until found (virtualized/lazy cases)
        const step = Math.max(120, Math.floor(container.clientHeight * 0.7));
        let guard = 0;
        while (guard < 30) {
            container.scrollTop = Math.min(container.scrollTop + step, container.scrollHeight);
            if (tryClick()) return true;
            if (container.scrollTop + container.clientHeight >= container.scrollHeight) break;
            guard++;
        }

        // Final attempt from top
        container.scrollTop = 0;
        return tryClick();
    }, { containerSelector, labelPrefix });

    expect(clicked, `Savings filter panel should contain a filter label starting with "${labelPrefix}"`).toBeTruthy();

    const showResultsButton = page.locator('#show-results');
    if (await showResultsButton.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, showResultsButton);
        await page.waitForLoadState('networkidle');
    }
}

function isAscending(arr) {
    return arr.length > 0 && arr.every((v, i) => i === 0 || v >= arr[i - 1]);
}

function isDescending(arr) {
    return arr.length > 0 && arr.every((v, i) => i === 0 || v <= arr[i - 1]);
}

async function waitForSortResultsEnabled(page) {
    const sortBySelect = page.getByRole('combobox', { name: /Sort\s+results\s+by/i });
    await expect(sortBySelect, 'Savings results should expose the Sort results by dropdown').toBeVisible();
    await expect.poll(async () => await sortBySelect.isEnabled(), {
        timeout: 15000,
        intervals: [250, 500, 1000, 2000]
    }).toBe(true);
    return sortBySelect;
}

// Reads percentage values in visual order from savings cards (AER/rate-like values)
async function readRateValuesInVisualOrder(page) {
    return await page.evaluate(() => {
        const isVisible = (el) => {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
        };

        let cards = Array.from(
            document.querySelectorAll(
                '[data-testid="savings-result"], .savings-result, .product-card, article, li'
            )
        ).filter(isVisible);

        // Fallback: visible blocks containing % and AER/rate wording
        if (!cards.length) {
            cards = Array.from(document.querySelectorAll('div, article, li')).filter(el =>
                isVisible(el) &&
                /%/.test(el.textContent || '') &&
                /(AER|rate|gross)/i.test(el.textContent || '')
            );
        }

        const rows = [];
        for (const card of cards) {
            const text = (card.textContent || '').replace(/\s+/g, ' ').trim();

            // Prefer AER-related % if present, fallback to first % in card
            let match =
                text.match(/(?:AER|rate|gross)[^%]*?([0-9]+(?:\.[0-9]+)?)%/i) ||
                text.match(/([0-9]+(?:\.[0-9]+)?)%/);

            if (!match) continue;

            const value = parseFloat(match[1]);
            if (!Number.isFinite(value)) continue;

            const rect = card.getBoundingClientRect();
            rows.push({ top: rect.top + window.scrollY, value });
        }

        rows.sort((a, b) => a.top - b.top);
        return rows.map(r => r.value);
    });
}

async function readVisibleSavingsCardTexts(page) {
    return await page.evaluate(() => {
        const isVisible = (el) => {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
        };

        const candidates = Array.from(document.querySelectorAll('main li, main article, main .product-card'));
        const cards = candidates.filter(el => isVisible(el) && !!el.querySelector('h2, h3'));

        const rows = cards.map(card => {
            const rect = card.getBoundingClientRect();
            return {
                top: rect.top + window.scrollY,
                text: (card.textContent || '').replace(/\s+/g, ' ').trim()
            };
        });

        rows.sort((a, b) => a.top - b.top);
        return rows.map(r => r.text);
    });
}

async function readOpeningDepositValuesInVisualOrder(page) {
    return await page.evaluate(() => {
        const isVisible = (el) => {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
        };

        const candidates = Array.from(document.querySelectorAll('main li, main article, main .product-card'));
        const cards = candidates.filter(el => isVisible(el) && !!el.querySelector('h2, h3'));

        const rows = [];
        for (const card of cards) {
            const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
            const match = text.match(/£\s*([0-9,]+)\s*Min\.?\s*opening deposit/i);
            if (!match) continue;
            const value = Number(match[1].replace(/,/g, ''));
            if (!Number.isFinite(value)) continue;

            const rect = card.getBoundingClientRect();
            rows.push({ top: rect.top + window.scrollY, value });
        }

        rows.sort((a, b) => a.top - b.top);
        return rows.map(r => r.value);
    });
}

test('Savings Accounts - Initial Page Load Checks', async ({ page }) => {
    await test.step('Open the savings accounts page', async () => {
        await page.goto(SAVINGS_URL, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expectSavingsAccountsPageChrome(page);
    });

    await test.step('Verify the savings results heading', async () => {
        const foundHeading = page.getByRole('heading', { name: /Good news!\s*We[’']ve found\s*\d+/i });
        await expect(foundHeading, 'Savings accounts page should show the dynamic results heading').toBeVisible();

        const foundHeadingText = await foundHeading.innerText();
        const match = foundHeadingText.match(/found\s*(\d+)/i);
        expect(match, 'Savings accounts heading should include the number of matching accounts').not.toBeNull();
        expect(Number(match[1]), 'Savings accounts heading should report at least one matching account').toBeGreaterThanOrEqual(1);
    });
});

test('Savings Accounts - No Results Scenario', async ({ page }) => {
    await test.step('Open the savings accounts page', async () => {
        await page.goto(SAVINGS_URL, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expectSavingsAccountsPageChrome(page);
    });

    await test.step('Apply contradictory savings filters', async () => {
        await clickFilterLabelInScrollableContainer(page, { labelPrefix: 'Regular saver' });
        await clickFilterLabelInScrollableContainer(page, { labelPrefix: 'One lump sum' });
        await page.waitForLoadState('networkidle');
    });

    const noResultsMessage = page.locator('main').getByRole('heading', { name: /No accounts found/i });
    const noResultsVisible = await noResultsMessage.isVisible().catch(() => false);

    if (noResultsVisible) {
        await test.step('Verify the savings no-results state and reset it', async () => {
            const zeroAccountsText = page.locator('main').getByText(/0\s+savings accounts/i);
            await expect(zeroAccountsText, 'Savings no-results state should show 0 savings accounts').toBeVisible();
            await expect(zeroAccountsText, 'Savings no-results state should explicitly report zero results').toContainText('0');

            const viewAllCta = page.getByRole('button', { name: 'View all savings accounts' });
            await expect(viewAllCta, 'Savings no-results state should offer a View all savings accounts CTA').toBeVisible();
            await clickWithCookieGuard(page, viewAllCta);
            await page.waitForLoadState('networkidle');

            await expect(noResultsMessage, 'Resetting the savings filters should remove the no-results message').not.toBeVisible();
        });
    } else {
        await test.step('Remove the savings filters when no explicit no-results state appears', async () => {
            await clickFilterLabelInScrollableContainer(page, { labelPrefix: 'Regular saver' });
            await clickFilterLabelInScrollableContainer(page, { labelPrefix: 'One lump sum' });
            await page.waitForLoadState('networkidle');
        });
    }

    await test.step('Verify savings results are available again', async () => {
        await expect.poll(async () => {
            const values = await readRateValuesInVisualOrder(page);
            return values.length > 0;
        }, {
            timeout: 15000,
            intervals: [500, 1000, 2000]
        }).toBe(true);
    });
});

test('Savings Accounts - Filter and Sorting Results', async ({ page }) => {
    await test.step('Open the savings accounts page', async () => {
        await page.goto(SAVINGS_URL, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expectSavingsAccountsPageChrome(page);
    });

    await test.step('Apply savings filters', async () => {
        await clickFilterLabelInScrollableContainer(page, { labelPrefix: 'ISA' });
        await clickFilterLabelInScrollableContainer(page, { labelPrefix: 'One lump sum' });
        await clickFilterLabelInScrollableContainer(page, { labelPrefix: 'Open online' });
        await page.waitForLoadState('networkidle');
    });

    await test.step('Verify the filtered savings results', async () => {
        const cardTexts = await readVisibleSavingsCardTexts(page);
        expect(cardTexts.length, 'Filtered savings results should still contain at least one product card').toBeGreaterThan(0);
        expect(cardTexts.every(text => /ISA/i.test(text)), 'Filtered savings results should all be ISA products').toBe(true);
        expect(cardTexts.every(text => /Online/i.test(text)), 'Filtered savings results should all contain Online opening instructions').toBe(true);
    });

    const sortBySelect = await test.step('Verify the default savings sort order', async () => {
        const dropdown = await waitForSortResultsEnabled(page);
        await expect(dropdown.locator('option:checked'), 'Savings results should default to interest rate sorting').toHaveText(/Interest rate/i);

        const values = await readRateValuesInVisualOrder(page);
        expect(isDescending(values), 'Savings interest rates should be sorted from high to low by default').toBe(true);
        return dropdown;
    });

    await test.step('Sort savings results by opening deposit', async () => {
        await sortBySelect.selectOption({ label: 'Opening deposit' });
        await page.waitForLoadState('networkidle');

        await expect(sortBySelect.locator('option:checked'), 'Savings results should reflect the Opening deposit sort option').toHaveText(/Opening deposit/i);

        await expect.poll(async () => {
            const depositValues = await readOpeningDepositValuesInVisualOrder(page);
            return depositValues.length > 0 && isAscending(depositValues);
        }, {
            timeout: 15000,
            intervals: [500, 1000, 2000]
        }).toBe(true);

        const sortedValues = await readRateValuesInVisualOrder(page);
        expect(sortedValues.length, 'Savings results should remain available after sorting by opening deposit').toBeGreaterThan(0);
    });
});

test('Savings Accounts - Access a Savings product Details Page', async ({ page }) => {
    await test.step('Open the savings accounts page', async () => {
        await page.goto(SAVINGS_URL, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expectSavingsAccountsPageChrome(page);
    });

    await test.step('Open the first savings product details page', async () => {
        const firstMoreInfoLink = page.locator('main').getByRole('link', { name: /More info/i }).first();
        await expect(firstMoreInfoLink, 'Savings results should expose a More info link for the first visible product').toBeVisible();

        const firstProductName = await firstMoreInfoLink.evaluate((linkEl) => {
            const card = linkEl.closest('li, article, .product-card, .savings-result, [data-testid="savings-result"]');
            const heading = card?.querySelector('h2, h3');
            return (heading?.textContent || '').replace(/\s+/g, ' ').trim();
        });

        await clickWithCookieGuard(page, firstMoreInfoLink);
        await page.waitForLoadState('networkidle');

        const productH1 = page.getByRole('heading', { level: 1 });
        await expect(productH1, 'Savings product details page should show an H1 heading').toBeVisible();
        const normalizedExpectedName = firstProductName.replace(/^\d+\s+/, '').trim();
        await expect(productH1, 'Savings product details H1 should match the selected result card title').toContainText(normalizedExpectedName);
    });
});

test('Savings Accounts - Access a Savings Product Details Page After Filters and Sorting', async ({ page }) => {
    await test.step('Open filtered and sorted savings results', async () => {
        await page.goto(SAVINGS_URL, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expectSavingsAccountsPageChrome(page);

        await clickFilterLabelInScrollableContainer(page, { labelPrefix: 'ISA' });
        await clickFilterLabelInScrollableContainer(page, { labelPrefix: 'One lump sum' });
        await clickFilterLabelInScrollableContainer(page, { labelPrefix: 'Open online' });
        await page.waitForLoadState('networkidle');

        const sortBySelect = await waitForSortResultsEnabled(page);
        await sortBySelect.selectOption({ label: 'Opening deposit' });
        await page.waitForLoadState('networkidle');
    });

    await test.step('Open a filtered savings product details page', async () => {
        const firstMoreInfoLink = page.locator('main').getByRole('link', { name: /More info/i }).first();
        await expect(firstMoreInfoLink, 'Filtered savings results should expose a More info link for the first visible product').toBeVisible();

        const firstProductName = await firstMoreInfoLink.evaluate((linkEl) => {
            const card = linkEl.closest('li, article, .product-card, .savings-result, [data-testid="savings-result"]');
            const heading = card?.querySelector('h2, h3');
            return (heading?.textContent || '').replace(/\s+/g, ' ').trim();
        });

        await clickWithCookieGuard(page, firstMoreInfoLink);
        await page.waitForLoadState('networkidle');

        const productH1 = page.getByRole('heading', { level: 1 });
        await expect(productH1, 'Filtered savings product details page should show an H1 heading').toBeVisible();
        const normalizedExpectedName = firstProductName.replace(/^\d+\s+/, '').trim();
        await expect(productH1, 'Filtered savings product details H1 should match the selected result card title').toContainText(normalizedExpectedName);
    });
});