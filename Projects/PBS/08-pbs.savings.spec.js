const { test, expect } = require('@playwright/test');

const SAVINGS_URL = '/home/savings/savings-accounts';
const COOKIE_ACCEPT_SELECTOR =
    'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click();
    }
}

async function clickFilterLabelInScrollableContainer(page, {
    containerSelector = '.filtersContainer__facet-filters',
    labelPrefix
}) {
    const container = page.locator(containerSelector);
    if (!(await container.isVisible().catch(() => false))) {
        const mobileFilterOpener = page.locator('#filters-opener');
        if (await mobileFilterOpener.isVisible().catch(() => false)) {
            await mobileFilterOpener.click();
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
        await showResultsButton.click();
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

test('Savings Accounts - Verify Calculator is Present', async ({ page }) => {
    await test.step('Open the savings accounts page', async () => {
        await page.goto(SAVINGS_URL, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
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
            await viewAllCta.click();
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
    });

    await test.step('Open the first savings product details page', async () => {
        const firstMoreInfoLink = page.locator('main').getByRole('link', { name: /More info/i }).first();
        await expect(firstMoreInfoLink, 'Savings results should expose a More info link for the first visible product').toBeVisible();

        const firstProductName = await firstMoreInfoLink.evaluate((linkEl) => {
            const card = linkEl.closest('li, article, .product-card, .savings-result, [data-testid="savings-result"]');
            const heading = card?.querySelector('h2, h3');
            return (heading?.textContent || '').replace(/\s+/g, ' ').trim();
        });

        await firstMoreInfoLink.click();
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

        await firstMoreInfoLink.click();
        await page.waitForLoadState('networkidle');

        const productH1 = page.getByRole('heading', { level: 1 });
        await expect(productH1, 'Filtered savings product details page should show an H1 heading').toBeVisible();
        const normalizedExpectedName = firstProductName.replace(/^\d+\s+/, '').trim();
        await expect(productH1, 'Filtered savings product details H1 should match the selected result card title').toContainText(normalizedExpectedName);
    });
});