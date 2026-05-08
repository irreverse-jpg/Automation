const { test, expect } = require('@playwright/test');

// Cookie Selector (If there is one)
const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR);
    if (await cookieButton.first().isVisible().catch(() => false)) {
        await cookieButton.first().click();
    }
}

async function fillMortgageSearchForm(page, {
    lookingTo,
    propertyValue,
    extraFieldLabel,
    extraFieldValue,
    mortgageLength
}) {
    await page.getByLabel("I'm looking to").selectOption({ label: lookingTo });
    await page.getByLabel('Property value').fill(String(propertyValue));

    const extraField = page.getByLabel(extraFieldLabel);
    await extraField.waitFor({ state: 'visible', timeout: 5000 });
    await extraField.fill(String(extraFieldValue));

    await page.getByLabel('Mortgage length').selectOption({ label: mortgageLength });

    const updateSearchButton = page.getByRole('button', { name: /Update search/i });
    await expect(updateSearchButton, 'Mortgage calculator should expose an Update search button before submitting criteria').toBeVisible();
    await updateSearchButton.click();
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
        } else {
            const filterToggle = page.getByRole('button', { name: /filter by|\(\d+\)\s*filter by/i }).first();
            if (await filterToggle.isVisible().catch(() => false)) {
                await filterToggle.click();
            }
        }
    }

    await container.waitFor({ state: 'visible', timeout: 10000 });

    const clicked = await page.evaluate(({ containerSelector, labelPrefix }) => {
        const container = document.querySelector(containerSelector);
        if (!container) return false;

        // Scroll to ensure lower filters become reachable
        container.scrollTop = container.scrollHeight;

        const wanted = (labelPrefix || '').trim().toLowerCase();
        const labels = Array.from(container.querySelectorAll('label'));
        const target = labels.find(label =>
            (label.textContent || '').trim().toLowerCase().startsWith(wanted)
        );

        if (target) {
            target.click();
            return true;
        }
        return false;
    }, { containerSelector, labelPrefix });

    expect(clicked, `Mortgage filter panel should contain a filter label starting with "${labelPrefix}"`).toBeTruthy();

    // Tablet/mobile flow applies filters via explicit CTA
    const showResultsButton = page.locator('#show-results');
    if (await showResultsButton.isVisible().catch(() => false)) {
        await showResultsButton.click();
        await page.waitForLoadState('networkidle');
    }
}

async function waitForSortResultsEnabled(page) {
    const sortDropdown = page.getByLabel('Sort results by');
    await expect(sortDropdown, 'Mortgage results should expose the Sort results by dropdown').toBeVisible();
    await expect.poll(async () => await sortDropdown.isEnabled(), {
        timeout: 15000,
        intervals: [250, 500, 1000, 2000]
    }).toBe(true);
    return sortDropdown;
}

async function openFiltersIfCollapsed(page) {
    const container = page.locator('.filtersContainer__facet-filters');
    if (!(await container.isVisible().catch(() => false))) {
        const opener = page.locator('#filters-opener');
        if (await opener.isVisible().catch(() => false)) {
            await opener.click();
        }
    }
}

test('Mortgages - Verify Calculator is Present', async ({ page }) => {
    await test.step('Open the mortgage products page', async () => {
        await page.goto('/mortgages/mortgage-products', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    await test.step('Verify the mortgage calculator heading', async () => {
        const calculatorHeading = page.getByRole('heading', { name: 'Search our mortgage deals' });
        await expect(calculatorHeading, 'Mortgage products page should show the Search our mortgage deals heading').toBeVisible();
    });
});

test('Mortgages - No Results Scenario', async ({ page }) => {
    await test.step('Open the mortgage products page', async () => {
        await page.goto('/mortgages/mortgage-products', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    await test.step('Submit mortgage criteria that should return no results', async () => {
        await page.getByLabel("I'm looking to").selectOption({ label: 'Buy my first home' });

        const propertyValueField = page.getByLabel('Property value');
        await propertyValueField.fill('0');

        const depositField = page.getByLabel('Deposit');
        await depositField.waitFor({ state: 'visible', timeout: 5000 });
        await depositField.fill('5000000');

        await page.getByLabel('Mortgage length').selectOption({ label: '25 years' });

        const updateSearchButton = page.getByRole('button', { name: /Update search/i });
        await expect(updateSearchButton, 'Mortgage calculator should expose Update search before submitting impossible criteria').toBeVisible();
        await updateSearchButton.click();
    });

    await test.step('Verify the no-results mortgage state', async () => {
        const noResultsMessage = page.getByRole('heading', { name: 'No results found' });
        await expect(noResultsMessage, 'Impossible mortgage criteria should show the No results found heading').toBeVisible();
    });
});

test('Mortgages - Buy my first home scenario', async ({ page }) => {
    await test.step('Open the mortgage products page', async () => {
        await page.goto('/mortgages/mortgage-products', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    await test.step('Submit first-home mortgage criteria', async () => {
        await page.getByLabel("I'm looking to").selectOption({ label: 'Buy my first home' });

        const propertyValueField = page.getByLabel('Property value');
        await propertyValueField.fill('250000');

        const depositField = page.getByLabel('Deposit');
        await depositField.waitFor({ state: 'visible', timeout: 5000 });
        await depositField.fill('30000');

        await page.getByLabel('Mortgage length').selectOption({ label: '25 years' });

        const updateSearchButton = page.getByRole('button', { name: /Update search/i });
        await expect(updateSearchButton, 'Mortgage calculator should expose Update search for the first home scenario').toBeVisible();
        await updateSearchButton.click();
    });

    await test.step('Verify the first-home mortgage results', async () => {
        await expect(page.getByText(/Results for:.*£?250,?000\s*home/i), 'First home scenario should show results for a £250,000 home').toBeVisible();
    });
});

test('Mortgages - Remortgage scenario', async ({ page }) => {
    await test.step('Open the mortgage products page', async () => {
        await page.goto('/mortgages/mortgage-products', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    await test.step('Submit remortgage criteria', async () => {
        await page.getByLabel("I'm looking to").selectOption({ label: 'Remortgage' });

        const propertyValueField = page.getByLabel('Property value');
        await propertyValueField.fill('400000');

        const mortgageLeftField = page.getByLabel('Mortgage amount left');
        await mortgageLeftField.waitFor({ state: 'visible', timeout: 5000 });
        await mortgageLeftField.fill('120000');

        await page.getByLabel('Mortgage length').selectOption({ label: '30 years' });

        const updateSearchButton = page.getByRole('button', { name: /Update search/i });
        await expect(updateSearchButton, 'Mortgage calculator should expose Update search for the remortgage scenario').toBeVisible();
        await updateSearchButton.click();
    });

    await test.step('Verify the remortgage results', async () => {
        await expect(page.getByText(/Results for:.*£?400,?000\s*home/i), 'Remortgage scenario should show results for a £400,000 home').toBeVisible();
    });
});

test('Mortgages - Move home scenario', async ({ page }) => {
    await test.step('Open the mortgage products page', async () => {
        await page.goto('/mortgages/mortgage-products', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    await test.step('Submit move-home mortgage criteria', async () => {
        await page.getByLabel("I'm looking to").selectOption({ label: 'Move home' });

        const propertyValueField = page.getByLabel('Property value');
        await propertyValueField.fill('600000');

        const depositField = page.getByLabel('Deposit');
        await depositField.waitFor({ state: 'visible', timeout: 5000 });
        await depositField.fill('50000');

        await page.getByLabel('Mortgage length').selectOption({ label: '35 years' });

        const updateSearchButton = page.getByRole('button', { name: /Update search/i });
        await expect(updateSearchButton, 'Mortgage calculator should expose Update search for the move home scenario').toBeVisible();
        await updateSearchButton.click();
    });

    await test.step('Verify the move-home results', async () => {
        await expect(page.getByText(/Results for:\s*buying a £600,000 home/i), 'Move home scenario should show results for buying a £600,000 home').toBeVisible();
    });
});

/*
Please note, the folowing 3 test cases down below fail in Live because it is not able to find any results
*/

test('Mortgages - Filter and Sorting Results', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open the mortgage products page and run the base search', async () => {
        await page.goto('/mortgages/mortgage-products', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);

        await fillMortgageSearchForm(page, {
            lookingTo: 'Buy my first home',
            propertyValue: 250000,
            extraFieldLabel: 'Deposit',
            extraFieldValue: 30000,
            mortgageLength: '25 years'
        });

        await expect(page.getByText(/Results for:\s*buying a £250,000 home/i), 'Mortgage search should show results for buying a £250,000 home').toBeVisible();
    });

    await test.step('Apply mortgage filters', async () => {
        await clickFilterLabelInScrollableContainer(page, {
            containerSelector: '.filtersContainer__facet-filters',
            labelPrefix: 'Fixed'
        });
        await clickFilterLabelInScrollableContainer(page, {
            containerSelector: '.filtersContainer__facet-filters',
            labelPrefix: '2 years'
        });
        await clickFilterLabelInScrollableContainer(page, {
            containerSelector: '.filtersContainer__facet-filters',
            labelPrefix: 'Only show deals with no product fee'
        });

        await page.waitForLoadState('load');
    });

    const sortDropdown = await test.step('Wait for the mortgage sort dropdown', async () => {
        return await waitForSortResultsEnabled(page);
    });

    // Robust result cards locator with APRC-based fallbacks
    const resultItems = page.locator(
        [
            '[data-testid="mortgage-result"]',
            '.mortgage-result',
            '.product-card',
            'article:has-text("Cost for comparison (APRC)")',
            'li:has-text("Cost for comparison (APRC)")',
            'div:has-text("Cost for comparison (APRC)")'
        ].join(', ')
    );

    // Wait until at least one result exists
    await test.step('Verify filtered mortgage results remain visible', async () => {
        await expect.poll(async () => await resultItems.count(), {
            timeout: 15000,
            intervals: [500, 1000, 2000]
        }, 'Filtered mortgage results should still contain at least one visible result card').toBeGreaterThan(0);
    });

    // Read APRC in visual card order
    const readAprcValues = async () => {
        return await resultItems.evaluateAll((cards) => {
            const isVisible = (el) => {
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
            };

            const values = [];
            for (const card of cards) {
                if (!isVisible(card)) continue;
                const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
                const m = text.match(/Cost for comparison\s*\(APRC\)\s*([0-9]+(?:\.[0-9]+)?)%/i);
                if (m) values.push(parseFloat(m[1]));
            }
            return values;
        });
    };

    // Read Monthly repayments values in VISUAL order (top -> bottom)
    const readMonthlyRepaymentValues = async () => {
        return await page.evaluate(() => {
            const isVisible = (el) => {
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
            };

            const parseMonthly = (text) => {
                const clean = (text || '').replace(/\s+/g, ' ').trim();
                const m = clean.match(/Monthly repayments\s*\*?\s*£\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
                return m ? parseFloat(m[1].replace(/,/g, '')) : null;
            };

            // Primary: parse from known result card selectors
            let cards = Array.from(
                document.querySelectorAll('[data-testid="mortgage-result"], .mortgage-result, .product-card')
            ).filter(isVisible);

            // Fallback: any visible block containing "Monthly repayments*"
            if (!cards.length) {
                cards = Array.from(document.querySelectorAll('article, li, div'))
                    .filter(el => isVisible(el) && /Monthly repayments\s*\*/i.test(el.textContent || ''));
            }

            const rows = [];
            for (const card of cards) {
                const value = parseMonthly(card.textContent || '');
                if (Number.isFinite(value)) {
                    const rect = card.getBoundingClientRect();
                    rows.push({ top: rect.top + window.scrollY, value });
                }
            }

            // Sort by visual position and return numbers
            rows.sort((a, b) => a.top - b.top);
            return rows.map(r => r.value);
        });
    };

    // Change sort to Lowest/Lower repayment
    const repaymentOptions = await sortDropdown.locator('option').allTextContents();
    const repaymentLabel =
        repaymentOptions.find(t => /lowest repayment/i.test(t)) ||
        repaymentOptions.find(t => /lower repayment/i.test(t));

    await test.step('Sort mortgage results by lowest repayment', async () => {
        expect(repaymentLabel, 'Mortgage sort dropdown should offer a lowest repayment option').toBeTruthy();
        await sortDropdown.selectOption({ label: repaymentLabel.trim() });
        await expect(sortDropdown.locator('option:checked'), 'Mortgage results should reflect the selected lowest repayment sort option').toHaveText(new RegExp(repaymentLabel.trim(), 'i'));
        await page.waitForLoadState('networkidle');
    });

    // Use provided locator pattern: "£1,406.72 Monthly repayments*" (amount varies)
    const monthlyRepaymentRows = page.getByText(
        /£\s*[0-9,]+(?:\.[0-9]{2})?\s*Monthly repayments\*/i
    );

    // Assert repayments sorted low -> high (allow equal values)
    await test.step('Verify monthly repayments are sorted low to high', async () => {
        await expect.poll(async () => {
            const values = await monthlyRepaymentRows.evaluateAll((els) => {
                const isVisible = (el) => {
                    const s = window.getComputedStyle(el);
                    return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
                };

                const rows = [];
                for (const el of els) {
                    if (!isVisible(el)) continue;
                    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    const m = txt.match(/£\s*([0-9,]+(?:\.[0-9]{2})?)\s*Monthly repayments\*/i);
                    if (!m) continue;

                    const value = parseFloat(m[1].replace(/,/g, ''));
                    const rect = el.getBoundingClientRect();
                    rows.push({ top: rect.top + window.scrollY, value });
                }

                rows.sort((a, b) => a.top - b.top);
                return rows.map(r => r.value);
            });

            if (values.length < 2) return false;
            return values.every((v, i) => i === 0 || v >= values[i - 1]);
        }, {
            timeout: 45000,
            intervals: [500, 1000, 2000, 3000, 5000]
        }).toBe(true);
    });

    await test.step('Clear all mortgage filters', async () => {
        await openFiltersIfCollapsed(page);
        const clearAllButton = page.getByRole('button', { name: 'Clear all' });
        await expect(clearAllButton, 'Mortgage filters should expose a Clear all button after filters are applied').toBeVisible();
        await clearAllButton.click();
        await page.waitForLoadState('networkidle');

        await expect(page.getByRole('checkbox', { name: /^Fixed/i }), 'Fixed filter should be unchecked after clearing all filters').not.toBeChecked();
        await expect(page.getByRole('checkbox', { name: /^2 years/i }), '2 years filter should be unchecked after clearing all filters').not.toBeChecked();
        await expect(page.getByRole('checkbox', { name: /^Only show deals with no product fee/i }), 'No product fee filter should be unchecked after clearing all filters').not.toBeChecked();
    });
});

test('Mortgages - Access and Navigate a Mortgage Product Details Page', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open mortgage results for a first-home search', async () => {
        await page.goto('/mortgages/mortgage-products', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await fillMortgageSearchForm(page, {
            lookingTo: 'Buy my first home',
            propertyValue: 250000,
            extraFieldLabel: 'Deposit',
            extraFieldValue: 30000,
            mortgageLength: '25 years'
        });
    });

    let firstProductName;
    const productH1 = page.getByRole('heading', { level: 1 });
    const firstProductCard = page.locator('main li').filter({ has: page.getByRole('link', { name: /See full details/i }) }).first();
    await test.step('Open the first mortgage product details page', async () => {
        await expect(firstProductCard, 'Mortgage results should contain a product card with a See full details link').toBeVisible();

        firstProductName = (await firstProductCard.getByRole('heading', { level: 2 }).innerText()).trim();

        const firstProductDetailsLink = firstProductCard.getByRole('link', { name: /See full details/i });
        await expect(firstProductDetailsLink, 'The first mortgage result should expose a See full details link').toBeVisible();
        await firstProductDetailsLink.click();
        await page.waitForLoadState('networkidle');

        await expect(productH1, 'Mortgage product details page should show an H1 heading').toBeVisible();
        await expect(productH1, 'Mortgage product details H1 should match the selected result card title').toHaveText(firstProductName);
    });

    const sectionPills = [
        'Is this deal right for me?',
        'Key features',
        'Detailed information',
        'How to apply'
    ];

    for (const pillName of sectionPills) {
        await test.step(`Open the ${pillName} section pill`, async () => {
            const pillLink = page.getByRole('link', { name: pillName });
            await expect(pillLink, `Mortgage product details should show the ${pillName} section pill`).toBeVisible();

            const href = await pillLink.getAttribute('href');
            const previousHash = new URL(page.url()).hash;

            await pillLink.click();

            await expect.poll(() => new URL(page.url()).hash, {
                timeout: 10000,
                intervals: [250, 500, 1000]
            }).not.toBe(previousHash);

            if (href && href.startsWith('#')) {
                await expect.poll(() => new URL(page.url()).hash, {
                    timeout: 10000,
                    intervals: [250, 500, 1000]
                }).toBe(href);

                const targetSection = page.locator(href);
                await expect(targetSection, `Mortgage product details should reveal the ${pillName} target section`).toBeVisible();
            }
        });
    }

    // Detailed information accordions: Expand each one sequentially
    const detailedInfoAccordionButtons = [
        page.getByRole('button', { name: /1\s*What happens at the end of my deal\?/i }),
        page.getByRole('button', { name: /2\s*What does a typical mortgage example look like\?/i }),
        page.getByRole('button', { name: /(?:3\s*)?What fees and charges are there\?/i }),
        page.getByRole('button', { name: /(?:4\s*)?Additional information/i })
    ];

    await test.step('Expand and collapse the detailed information accordions', async () => {
        for (const accordionButton of detailedInfoAccordionButtons) {
            await expect(accordionButton, 'Mortgage detailed information accordion button should be visible before expanding').toBeVisible();
            await accordionButton.scrollIntoViewIfNeeded();
            await accordionButton.click();
        }

        for (const accordionButton of detailedInfoAccordionButtons) {
            await expect(accordionButton, 'Mortgage detailed information accordion button should remain visible before collapsing').toBeVisible();
            await accordionButton.scrollIntoViewIfNeeded();
            await accordionButton.click();
        }
    });

    await test.step('Navigate to the mortgage enquiry form and back', async () => {
        const makeAnEnquiryCta = page.locator('#section-mortgage').getByRole('link', { name: 'Make an enquiry' });
        await expect(makeAnEnquiryCta, 'Mortgage product details should show the Make an enquiry CTA').toBeVisible();
        await makeAnEnquiryCta.click();

        await expect(page, 'Make an enquiry CTA should navigate to the mortgage enquiry form').toHaveURL(/\/home\/mortgages\/mortgage-enquiry-form/i);
        await expect(page.getByRole('heading', { name: /Mortgage enquiry form/i }), 'Mortgage enquiry form page should show its heading after navigation from product details').toBeVisible();

        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle');
        await expect(productH1, 'Going back from the enquiry form should return to the mortgage product details page').toBeVisible();
        await expect(productH1, 'Returned mortgage product details page should preserve the selected product heading').toHaveText(firstProductName);
    });
});

test('Mortgages - Access a Mortgage Product Details Page After Filters and Sorting', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open filtered and sorted mortgage results', async () => {
        await page.goto('/mortgages/mortgage-products', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await fillMortgageSearchForm(page, {
            lookingTo: 'Buy my first home',
            propertyValue: 250000,
            extraFieldLabel: 'Deposit',
            extraFieldValue: 30000,
            mortgageLength: '25 years'
        });

        await clickFilterLabelInScrollableContainer(page, {
            containerSelector: '.filtersContainer__facet-filters',
            labelPrefix: 'Fixed'
        });
        await page.waitForLoadState('networkidle');

        const sortDropdown = await waitForSortResultsEnabled(page);
        const repaymentOptions = await sortDropdown.locator('option').allTextContents();
        const repaymentLabel = repaymentOptions.find(t => /lowest repayment/i.test(t));
        expect(repaymentLabel, 'Mortgage results should offer a lowest repayment sort option after filtering').toBeTruthy();

        await sortDropdown.selectOption({ label: repaymentLabel.trim() });
        await expect(sortDropdown.locator('option:checked'), 'Mortgage results should show the selected lowest repayment sort option').toHaveText(new RegExp(repaymentLabel.trim(), 'i'));
        await page.waitForLoadState('networkidle');
    });

    await test.step('Open a filtered mortgage product details page', async () => {
        const firstProductCard = page.locator('main li').filter({ has: page.getByRole('link', { name: /See full details/i }) }).first();
        await expect(firstProductCard, 'Filtered mortgage results should still contain a product card with a See full details link').toBeVisible();

        const firstProductName = (await firstProductCard.getByRole('heading', { level: 2 }).innerText()).trim();
        const firstProductDetailsLink = firstProductCard.getByRole('link', { name: /See full details/i });
        await expect(firstProductDetailsLink, 'Filtered mortgage result should expose a See full details link').toBeVisible();
        await firstProductDetailsLink.click();
        await page.waitForLoadState('networkidle');

        const productH1 = page.getByRole('heading', { level: 1 });
        await expect(productH1, 'Mortgage product details page should show an H1 after opening a filtered result').toBeVisible();
        await expect(productH1, 'Mortgage product details H1 should match the selected filtered result card title').toHaveText(firstProductName);
    });
});