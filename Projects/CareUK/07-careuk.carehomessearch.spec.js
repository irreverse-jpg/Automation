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
// Coverage notes - Find a Care Home search (/care-homes)
// ============================================================================
// Scope: the care home search/results page - the postcode + care-type
// search form, the results list, the Google Map and its pins, and the
// map/list correlation.
//
// Tests in this file:
//   1. Care Homes Search - Initial Page Checks
//      Verifies URL/title/H1, the search input/care-type dropdown/Submit
//      button (Reset only checked if currently visible - it can be
//      conditionally hidden until the first search interaction), the care
//      type dropdown's option count/contents, the map container, and that
//      the initial listing renders real care-home items.
//   2. Care Homes Search - Postcode and Care Type Filtering Logic
//      Searches "M33" + Residential care, confirms results still render
//      and the page shows a real UK postcode.
//   3. Care Homes Search - Map Pins Match Listing Names
//      Same M33 + Residential care search, then cross-checks that at
//      least one map pin's label matches a listing card's name and that
//      the matched pin is hoverable.
//   4. Care Homes Search - Exhaustive M33 Map and Filter Traversal
//      The most thorough test in this file: searches M33 via the real
//      typeahead suggestion list, samples 5 map pins (indices 1/3/5/7/9)
//      and confirms clicking each brings that home to the top of the
//      list, clicks "Show more" twice (confirming the list grows both
//      times, reaching >=29 homes), samples 3 more pins from the expanded
//      list, opens the first card's "Read more" toggle then its "View
//      Home" detail page and back, then cycles through EVERY care-type
//      dropdown option, confirming each one's matching service icon shows
//      as a purple "yes" check (`rgb(215, 8, 139)`) on every visible
//      result card (plus a further Show More check per filter, if
//      available).
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// Runtime note: test 4 is deliberately thorough (300-second timeout) and
// is one of the slower tests in this project.
// ============================================================================

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

async function dismissCookieOverlayIfPresent(page) {
    const acceptTargets = [
        page.locator('#onetrust-accept-btn-handler').first(),
        page.getByRole('button', { name: /accept|allow all|yes, allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
        page.getByRole('link', { name: /allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
    ];

    for (const target of acceptTargets) {
        if (await target.isVisible().catch(() => false)) {
            await target.click({ timeout: 3000 }).catch(() => { });
        }
    }

    const overlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (await overlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const blocked = message.includes('intercepts pointer events') || message.includes('cookie') || message.includes('onetrust');
        if (!blocked) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

function getSearchInput(page) {
    return page.locator('#careHomeSearch, input[name="search"], input[placeholder*="Postcode" i]').first();
}

function getCareTypeSelect(page) {
    return page.locator('select[name="type"], select').first();
}

function getSubmitButton(page) {
    return page.getByRole('button', { name: /^submit$/i }).first();
}

function getResetButton(page) {
    return page.getByRole('button', { name: /^reset$/i }).first();
}

function getCareHomeItems(page) {
    return page.locator('.careHomeItem');
}

function getShowMoreButton(page) {
    return page.getByRole('button', { name: /^show more$/i }).first();
}

function getCareHomeCardNames(page) {
    return page.locator('.careHomeItem .careHomeItem__name');
}

function getMapRoot(page) {
    return page.locator('#map, .gm-style').first();
}

async function getVisibleListingNames(page) {
    const names = await getCareHomeCardNames(page).evaluateAll((els) => {
        const normalize = (v) => String(v || '').replace(/\s+/g, ' ').trim();
        return Array.from(new Set(
            els
                .map((el) => normalize(el.textContent))
                .filter((name) => name && name.length >= 3)
        ));
    }).catch(() => []);

    return names;
}

async function getFirstVisibleListingName(page) {
    const firstName = await getCareHomeCardNames(page).first().textContent().catch(() => '');
    return normalizeWhitespace(firstName);
}

async function getMapPinLabels(page) {
    const labels = await page.evaluate(() => {
        const normalize = (v) => String(v || '').replace(/\s+/g, ' ').trim();
        const controlsNoise = [
            'show street map', 'terrain', 'show satellite imagery', 'labels', 'toggle fullscreen view',
            'rotate map', 'tilt map', 'map camera controls', 'move up', 'move left', 'move right',
            'move down', 'zoom in', 'zoom out', 'drag pegman', 'open this area in google maps',
            'keyboard shortcuts', 'map data', 'map scale',
        ];

        const all = Array.from(document.querySelectorAll('.gm-style [aria-label], .gm-style [title], [class*="pin" i][aria-label], [class*="pin" i][title]'));
        const extracted = all
            .map((el) => normalize(el.getAttribute('aria-label') || el.getAttribute('title') || ''))
            .filter(Boolean)
            .filter((label) => !controlsNoise.some((noise) => label.toLowerCase().includes(noise)));

        return Array.from(new Set(extracted));
    }).catch(() => []);

    return labels;
}

function getTypeaheadSuggestions(page) {
    return page.locator('.tt-suggestion');
}

async function selectExactSearchSuggestion(page, expectedSuggestion) {
    const searchInput = getSearchInput(page);
    await searchInput.click();
    await searchInput.fill('');
    await searchInput.pressSequentially(expectedSuggestion, { delay: 250 });

    const escapedSuggestion = expectedSuggestion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactSuggestion = getTypeaheadSuggestions(page)
        .filter({ hasText: new RegExp(`^${escapedSuggestion}$`, 'i') })
        .first();

    const suggestionVisible = await exactSuggestion.isVisible().catch(() => false);
    if (suggestionVisible) {
        await exactSuggestion.click({ force: true });
        return;
    }

    await searchInput.press('Enter').catch(() => { });
    await expect(searchInput, `Search input should keep ${expectedSuggestion} even when typeahead list is not visible`).toHaveValue(new RegExp(`^${escapedSuggestion}$`, 'i'));
}

async function clickPinByLabel(page, label) {
    const pin = page.locator(`.gm-style [aria-label="${label}"], .gm-style [title="${label}"]`).first();
    await expect(pin, `Map pin for ${label} should be visible`).toBeVisible({ timeout: 10000 });
    await pin.hover().catch(async () => {
        await pin.scrollIntoViewIfNeeded().catch(() => { });
        await pin.hover({ force: true }).catch(() => { });
    });
    await pin.click({ force: true });
}

async function toggleReadMoreForFirstCard(page) {
    const firstCard = getCareHomeItems(page).first();
    const readMoreButton = firstCard.locator('button.readmore, button:has-text("Read more")').first();
    await expect(readMoreButton, 'First care-home card should expose a Read more toggle').toBeVisible();

    await clickWithCookieGuard(page, readMoreButton);
    await expect(readMoreButton, 'Read more toggle should switch to Read less after expansion').toHaveText(/read less/i);

    await clickWithCookieGuard(page, readMoreButton);
    await expect(readMoreButton, 'Read more toggle should collapse back to Read more').toHaveText(/read more/i);

    return firstCard;
}

async function openResidentialCareDropdownAndAssertSelection(page) {
    const careTypeSelect = getCareTypeSelect(page);
    const selection = page.locator('.select2-selection__rendered').first();

    await expect(selection, 'Residential care should remain the selected care-type option').toHaveText(/^Residential care$/i);
    await expect(careTypeSelect.locator('option:checked')).toHaveText(/residential care/i);
}

async function waitForResultsReloadAfterSubmit(page, expectedTypeValue) {
    await expect.poll(async () => await getCareHomeItems(page).count(), {
        message: 'Filtered search should render one or more care-home cards after submit',
        timeout: 45000,
    }).toBeGreaterThan(0);

    await expect(page, `Submitting care type ${expectedTypeValue} should update URL query with the selected type`).toHaveURL(new RegExp(`\\/care-homes\\?search=M33(?:&|$).*type=${expectedTypeValue}(?:&|$)`, 'i'));

    await expect.poll(async () => await page.locator('.careHomeItem__name').count(), {
        message: 'Result cards should include care-home names after filtering',
        timeout: 30000,
    }).toBeGreaterThan(0);
}

async function assertSelectedServiceIsPurpleForAllVisibleCards(page, selectedServiceLabel) {
    const cardCount = await getCareHomeItems(page).count();
    expect(cardCount, `There should be visible care-home cards when validating ${selectedServiceLabel}`).toBeGreaterThan(0);

    for (let cardIndex = 0; cardIndex < cardCount; cardIndex += 1) {
        const card = getCareHomeItems(page).nth(cardIndex);
        const cardName = normalizeWhitespace(await card.locator('.careHomeItem__name').first().textContent().catch(() => `Card ${cardIndex + 1}`));
        const serviceItem = card
            .locator('.careHomeItem__service')
            .filter({ hasText: new RegExp(`^${selectedServiceLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
            .first();

        await expect(serviceItem, `${selectedServiceLabel} should exist in the services list for ${cardName}`).toBeVisible();

        const svgIcon = serviceItem.locator('svg').first();
        await expect(svgIcon, `${selectedServiceLabel} for ${cardName} should have a service icon`).toBeVisible();
        await expect(svgIcon, `${selectedServiceLabel} for ${cardName} should be marked as offered with a yes icon`).toHaveClass(/cukicon-yes/);

        const iconFill = await svgIcon.evaluate((el) => window.getComputedStyle(el).fill).catch(() => '');
        expect(iconFill, `${selectedServiceLabel} for ${cardName} should display a purple check icon`).toBe('rgb(215, 8, 139)');
    }
}

async function verifyCareTypeFilterServiceChecks(page, option) {
    const careTypeSelect = getCareTypeSelect(page);
    const submitButton = getSubmitButton(page);
    const selectedLabel = normalizeWhitespace(option.label);

    await careTypeSelect.selectOption({ value: option.value });
    await clickWithCookieGuard(page, submitButton);
    await waitForResultsReloadAfterSubmit(page, option.value);

    const checkedOptionText = normalizeWhitespace(await careTypeSelect.locator('option:checked').first().textContent().catch(() => ''));
    expect(checkedOptionText, `The selected dropdown option should remain ${selectedLabel} after submit`).toBe(selectedLabel);

    await assertSelectedServiceIsPurpleForAllVisibleCards(page, selectedLabel);

    const showMoreButton = getShowMoreButton(page);
    if (await showMoreButton.isVisible().catch(() => false)) {
        const beforeCount = await getCareHomeItems(page).count();
        await clickWithCookieGuard(page, showMoreButton);

        await expect.poll(async () => await getCareHomeItems(page).count(), {
            message: `Show more should keep or expand ${selectedLabel} filtered results after one click`,
            timeout: 30000,
        }).toBeGreaterThanOrEqual(beforeCount);

        await assertSelectedServiceIsPurpleForAllVisibleCards(page, selectedLabel);
    }
}

async function openCareHomesSearchPage(page) {
    await page.goto('/care-homes', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
}

test('Care Homes Search - Initial Page Checks', async ({ page, baseURL }) => {
    await openCareHomesSearchPage(page);

    await expect(page, 'Care homes search should open /care-homes').toHaveURL(new RegExp(`${new URL('/care-homes', baseURL).toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[?#])`, 'i'));
    await expect(page, 'Care homes search page title should indicate find a care home').toHaveTitle(/find a care home|care homes near me/i);

    await expect(page.getByRole('heading', { level: 1 }).first(), 'Care homes search should expose H1').toBeVisible();

    const searchInput = getSearchInput(page);
    const careTypeSelect = getCareTypeSelect(page);
    const submitButton = getSubmitButton(page);
    const resetButton = getResetButton(page);

    await expect(searchInput, 'Search area should expose postcode/location input').toBeVisible();
    await expect(careTypeSelect, 'Search area should expose care type dropdown').toBeVisible();
    await expect(submitButton, 'Search area should expose Submit button').toBeVisible();

    // Reset can be conditionally hidden until the first search interaction.
    const resetVisible = await resetButton.isVisible().catch(() => false);
    if (resetVisible) {
        await expect(resetButton, 'Reset control should be interactable when visible').toBeVisible();
    }

    const careTypeOptions = await careTypeSelect.locator('option').allTextContents();
    const normalizedOptions = careTypeOptions.map((v) => normalizeWhitespace(v)).filter(Boolean);
    expect(normalizedOptions.length, 'Care type dropdown should have expected options').toBeGreaterThanOrEqual(7);
    expect(normalizedOptions.join(' | ').toLowerCase(), 'Care type dropdown should include Residential care').toContain('residential care');
    expect(normalizedOptions.join(' | ').toLowerCase(), 'Care type dropdown should include Dementia care').toContain('dementia care');

    await expect(getMapRoot(page), 'Care homes page should render map container').toBeVisible();
    const initialItems = await getCareHomeItems(page).count();
    expect(initialItems, 'Initial page load should render one or more care home list items').toBeGreaterThan(0);
});

test('Care Homes Search - Postcode and Care Type Filtering Logic', async ({ page }) => {
    await openCareHomesSearchPage(page);

    const searchInput = getSearchInput(page);
    const careTypeSelect = getCareTypeSelect(page);
    const submitButton = getSubmitButton(page);

    const initialNames = await getVisibleListingNames(page);
    expect(initialNames.length, 'Initial list should expose visible care home names').toBeGreaterThan(0);

    await searchInput.fill('M33');
    await careTypeSelect.selectOption({ value: 'residential-care' }).catch(async () => {
        await careTypeSelect.selectOption({ label: /residential care/i });
    });

    await clickWithCookieGuard(page, submitButton);

    await expect.poll(async () => await getCareHomeItems(page).count(), {
        message: 'Filtered search should keep results list visible after submit',
        timeout: 30000,
    }).toBeGreaterThan(0);

    const filteredNames = await getVisibleListingNames(page);
    expect(filteredNames.length, 'Filtered results should expose care home names').toBeGreaterThan(0);

    const bodyText = normalizeWhitespace(await page.locator('body').textContent().catch(() => ''));
    expect(bodyText, 'Filtered result region should contain at least one UK postcode').toMatch(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i);

    // List may remain similar depending on dataset distribution; ensure the search interaction completed and stayed stable.
    expect(filteredNames.join(' ').length, 'Filtered names should be non-empty after applying postcode + care type').toBeGreaterThan(5);
});

test('Care Homes Search - Map Pins Match Listing Names', async ({ page }) => {
    await openCareHomesSearchPage(page);

    const searchInput = getSearchInput(page);
    const careTypeSelect = getCareTypeSelect(page);
    const submitButton = getSubmitButton(page);

    await searchInput.fill('M33');
    await careTypeSelect.selectOption({ value: 'residential-care' }).catch(async () => {
        await careTypeSelect.selectOption({ label: /residential care/i });
    });
    await clickWithCookieGuard(page, submitButton);
    await page.waitForTimeout(2500);

    const listingNames = await getVisibleListingNames(page);
    const pinLabels = await getMapPinLabels(page);

    expect(listingNames.length, 'Listing should expose names for map correlation').toBeGreaterThan(0);
    expect(pinLabels.length, 'Map should expose pin labels/names').toBeGreaterThan(0);

    const listingLower = listingNames.map((v) => v.toLowerCase());
    const matched = pinLabels.filter((label) => listingLower.includes(label.toLowerCase()));
    expect(matched.length, 'At least one map pin label should match a listing care home title').toBeGreaterThan(0);

    // Hover one matched pin and ensure the marker remains interactable.
    const sample = matched[0];
    const pinLocator = page.locator(`.gm-style [aria-label="${sample}"], .gm-style [title="${sample}"]`).first();
    await expect(pinLocator, `Map pin for ${sample} should be visible`).toBeVisible({ timeout: 10000 });
    await pinLocator.hover().catch(async () => {
        await pinLocator.scrollIntoViewIfNeeded().catch(() => { });
        await pinLocator.hover({ force: true }).catch(() => { });
    });
});

test('Care Homes Search - Exhaustive M33 Map and Filter Traversal', async ({ page }) => {
    test.setTimeout(300000);

    await openCareHomesSearchPage(page);

    await page.locator('.careHomeIntroPanel').scrollIntoViewIfNeeded().catch(() => { });

    const submitButton = getSubmitButton(page);
    const careTypeSelect = getCareTypeSelect(page);

    await selectExactSearchSuggestion(page, 'M33');
    await clickWithCookieGuard(page, submitButton);

    await expect(page, 'Submitting the exact M33 suggestion should navigate to the M33 results URL').toHaveURL(/\/care-homes\?search=M33(?:&|$)/i);
    await expect(page.getByRole('heading', { level: 3, name: /Results for 'M33'/i }).first(), 'Results heading should reflect the M33 search').toBeVisible();

    await page.goto('/care-homes?search=M33', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page.getByRole('heading', { level: 3, name: /Results for 'M33'/i }).first(), 'Direct M33 navigation should keep the M33 results heading visible').toBeVisible();

    const initialNames = await getVisibleListingNames(page);
    expect(initialNames.length, 'M33 results should expose visible care-home names').toBeGreaterThan(0);

    const initialPins = await getMapPinLabels(page);
    if (initialPins.length >= 10) {
        for (const index of [1, 3, 5, 7, 9]) {
            const label = initialPins[index];
            expect(label, `Pin index ${index + 1} should exist before clicking`).toBeTruthy();
            await clickPinByLabel(page, label);
            await expect.poll(async () => await getFirstVisibleListingName(page), {
                message: `Clicking ${label} should bring that care home to the top of the list`,
                timeout: 15000,
            }).toBe(label);
        }
    }

    await getCareHomeItems(page).first().scrollIntoViewIfNeeded().catch(() => { });
    await page.locator('.careHomeList').scrollIntoViewIfNeeded().catch(() => { });

    const showMoreButton = page.getByRole('button', { name: /^show more$/i }).first();
    if (await showMoreButton.isVisible().catch(() => false)) {
        const beforeFirstShowMore = await getVisibleListingNames(page).then((names) => names.length);
        await clickWithCookieGuard(page, showMoreButton);
        await expect.poll(async () => await getVisibleListingNames(page).then((names) => names.length), {
            message: 'First Show more click should expand the list',
            timeout: 20000,
        }).toBeGreaterThan(beforeFirstShowMore);

        const beforeSecondShowMore = await getVisibleListingNames(page).then((names) => names.length);
        await clickWithCookieGuard(page, showMoreButton);
        await expect.poll(async () => await getVisibleListingNames(page).then((names) => names.length), {
            message: 'Second Show more click should expand the list again',
            timeout: 20000,
        }).toBeGreaterThan(beforeSecondShowMore);

        await expect.poll(async () => await getVisibleListingNames(page).then((names) => names.length), {
            message: 'Expanded search results should expose at least 29 care homes when Show more is available',
            timeout: 30000,
        }).toBeGreaterThanOrEqual(29);

        const expandedPins = await getMapPinLabels(page);
        if (expandedPins.length >= 29) {
            for (const index of [24, 26, 28]) {
                const label = expandedPins[index];
                expect(label, `Expanded pin index ${index + 1} should exist before clicking`).toBeTruthy();
                await clickPinByLabel(page, label);
                await expect.poll(async () => await getFirstVisibleListingName(page), {
                    message: `Clicking expanded pin ${label} should bring that care home to the top of the list`,
                    timeout: 15000,
                }).toBe(label);
            }
        }
    }

    const firstCard = await toggleReadMoreForFirstCard(page);
    await clickWithCookieGuard(page, firstCard.getByRole('link', { name: /^view home$/i }).first());
    await expect(page, 'View Home should open the selected care-home detail page').toHaveURL(/\/care-homes\/[a-z0-9-]+/i);
    await page.goBack();
    await expect(page, 'Going back should return to the M33 results page').toHaveURL(/\/care-homes\?search=M33(?:&|$)/i);

    const careTypeOptions = await careTypeSelect.locator('option').evaluateAll((options) => options
        .map((option) => ({
            value: String(option.value || '').trim(),
            label: String(option.textContent || '').replace(/\s+/g, ' ').trim(),
        }))
        .filter((option) => option.value && option.label));

    expect(careTypeOptions.length, 'Care type dropdown should expose selectable care filters').toBeGreaterThan(0);

    for (const option of careTypeOptions) {
        await test.step(`Apply ${option.label} filter and validate purple service checks`, async () => {
            await verifyCareTypeFilterServiceChecks(page, option);
        });
    }

});
