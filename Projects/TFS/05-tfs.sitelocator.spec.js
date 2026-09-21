const { test, expect } = require('@playwright/test');
const { DASHBOARD_PATH } = require('./login-helpers');
const { HEADER_SELECTORS, navigateViaSidebar, isBeforeInDom } = require('./portal-helpers');

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

// Relies on the project-wide authenticated storageState - every test starts by navigating
// Dashboard -> Site Locator via the real sidebar link.
//
// Same shared-session caveat as 02/03/04 applies: this file never switches accounts, so it isn't
// a source of risk, but a fully-parallel local run of the whole suite carries the documented
// residual chance of showing a different account's data than expected (see the shared-session
// note in 02-tfs.dashboard.spec.js). Prefer `npm run test:stable` for a fully reliable run.

// ============================================================================
// Coverage notes - Site Locator ("/portal/site-locator")
// ============================================================================
// Confirmed 2026-09-04: unlike every other portal page so far, this one is NOT TFS's own app -
// the entire page body is a single iframe embedding a completely separate third-party site,
// `https://stationfinder.co.uk/station-finder-embed/` (a Google Maps-based fuel station finder
// widget). Every selector below targets content INSIDE that iframe, accessed via its real Frame
// object (`elementHandle.contentFrame()`, not `page.frameLocator()`) so both `.locator()` and
// `.evaluate()`/`.mouse` gestures work uniformly against it.
//
// That third-party site shows its OWN cookie-consent banner (unrelated to TFS's own site, which
// has none) - confirmed to appear on every fresh test run since storageState.json never visits
// stationfinder.co.uk during login, so every test's Accept click is genuine, not a no-op.
// acceptStationFinderCookies() handles this defensively (no-op if it doesn't appear) per
// instruction to "click Accept whenever you see it, whichever page it's on".
//
// The finder form has two tabs - only tab1 ("Find your nearest fuel station") is covered here;
// tab2 ("Find fuel stations along your journey", a From/To route search) is out of scope. Both
// tabs share duplicate `id`s on their inputs/checkboxes (a real markup quality issue on the
// third-party site, confirmed 2026-09-04: e.g. `#network_nearby` appears once per tab), so every
// selector below is scoped under `#tab1` to avoid Playwright strict-mode violations.
//
// Two real, confirmed timing/behaviour quirks worth knowing before extending this file:
//   - Card Type checkboxes update the result list LIVE (no Search click needed) - confirmed by
//     watching the count actually drop after each individual checkbox click. Range and
//     Facilities checkboxes do NOT update live - they only take effect on the next Search click.
//   - The result count takes a few seconds to settle after any action that does update it (up to
//     ~5s observed for the initial unfiltered search, which found 1375 stations within the
//     default 50-mile range of Manchester before any narrowing - a real number for a dense UK
//     fuel network, not a bug). waitForResultsToSettle() polls until two consecutive reads agree
//     instead of using a fixed sleep.
// ============================================================================

const SITE_LOCATOR_PATH = '/portal/site-locator';

const SELECTORS = {
    iframe: 'iframe[src*="stationfinder"]',
    cookieAcceptButton: 'button:has-text("Accept")',
    locationInput: '#location_address',
    suggestionItem: '.pac-container .pac-item',
    rangeSelect: '#range',
    searchButton: '#tab1 #submit_nearby',
    cardTypeList: '#tab1 .cardtype-checkbox',
    facilitiesList: '#tab1 .facilities-checkbox',
    siteListToggle: '.sitelist-btn-map',
    siteListWrapper: '.sitelist-wrapper',
    siteListItems: '#data_near_by > li',
    map: '#map',
    infoWindow: '.gm-style-iw-d',
    zoomHint: 'text=Use ctrl + scroll to zoom the map',
};

const LOCATION_QUERY = 'Manchester, UK';
const CARD_TYPES_TO_SELECT = ['Advantage Card', 'Shell Card', 'The Fuel Store Card'];
const FACILITY_TO_SELECT = 'AdBlue';
// Confirmed 2026-09-04 with this exact combination (Manchester, UK / 5 Miles / Advantage+Shell+
// The Fuel Store Card / AdBlue). This is live, third-party station data - if the real station
// network around this location changes over time, this number may need revisiting.
const EXPECTED_NARROWED_RESULT_COUNT = 11;

async function gotoSiteLocator(page) {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await navigateViaSidebar(page, SITE_LOCATOR_PATH, SITE_LOCATOR_PATH);
    await expect(page.locator('h1'), 'Site Locator should show its "Site Locator" heading').toHaveText('Site Locator');
}

async function getStationFinderFrame(page) {
    const iframeElement = await page.waitForSelector(SELECTORS.iframe, { timeout: 20000 });
    const frame = await iframeElement.contentFrame();
    // The embed's own script needs a moment after the iframe "loads" to actually render the
    // finder form (confirmed 2026-09-04 - the raw iframe fires load before its JS has run).
    await frame.locator('#location_address').waitFor({ state: 'visible', timeout: 20000 });
    return frame;
}

async function acceptStationFinderCookiesIfPresent(frame) {
    const acceptButton = frame.locator(SELECTORS.cookieAcceptButton).first();
    const appeared = await acceptButton.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (appeared) {
        await acceptButton.click();
    }
}

async function selectSuggestedLocation(frame, query) {
    await frame.locator(SELECTORS.locationInput).click();
    await frame.locator(SELECTORS.locationInput).type(query, { delay: 60 });
    await frame.locator(SELECTORS.suggestionItem).first().waitFor({ state: 'visible', timeout: 10000 });
    await frame.locator(SELECTORS.suggestionItem).first().click();
}

async function waitForResultsToSettle(frame, { minCount = 1, maxWaitMs = 10000 } = {}) {
    let previous = null;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        const current = await frame.locator(SELECTORS.siteListItems).count();
        if (current === previous && current >= minCount) return current;
        previous = current;
        await frame.page().waitForTimeout(400);
    }
    return previous;
}

async function selectCardType(frame, label) {
    await frame.locator(SELECTORS.cardTypeList).locator('li', { hasText: label }).locator('label.checkbox-container').click();
}

async function selectFacility(frame, label) {
    await frame.locator(SELECTORS.facilitiesList).locator('li', { hasText: label }).locator('label.checkbox-container').click();
}

test('Site Locator - Navigating from the Dashboard Sidebar Loads the Page', async ({ page, baseURL }) => {
    await gotoSiteLocator(page);
    await expect(page, 'Site Locator should load at /portal/site-locator').toHaveURL(new URL(SITE_LOCATOR_PATH, baseURL).toString());
    await expect(page, 'Site Locator should load with the expected title').toHaveTitle('Site Locator');

    await test.step('Header controls are still present, in the usual order', async () => {
        await expect(page.locator(HEADER_SELECTORS.accountDropdownToggle), 'Account dropdown should be visible').toBeVisible();
        await expect(page.getByRole('button', { name: 'Log out' }), 'Log out button should be visible').toBeVisible();
        await expect(page.locator(HEADER_SELECTORS.logo), 'Logo should be visible').toBeVisible();
        const dropdownBeforeLogout = await isBeforeInDom(page, HEADER_SELECTORS.accountDropdownToggle, HEADER_SELECTORS.logoutButton);
        expect(dropdownBeforeLogout, 'Account dropdown should appear before the Log out button in the header').toBe(true);
    });

    await test.step('The station finder iframe loads', async () => {
        const frame = await getStationFinderFrame(page);
        await expect(frame.locator(SELECTORS.locationInput), 'Location field should be visible inside the embedded finder').toBeVisible();
    });
});

test('Site Locator - Validation Requires a Location Before Searching', async ({ page }) => {
    await gotoSiteLocator(page);
    const frame = await getStationFinderFrame(page);
    await acceptStationFinderCookiesIfPresent(frame);

    const dialogMessage = await new Promise((resolve) => {
        page.once('dialog', async (dialog) => {
            resolve(dialog.message());
            await dialog.dismiss();
        });
        frame.locator(SELECTORS.searchButton).click();
    });

    expect(dialogMessage, 'Searching with no location should prompt to enter one').toBe('Please enter location');
});

test('Site Locator - Location Field Suggests and Selects a Place', async ({ page }) => {
    await gotoSiteLocator(page);
    const frame = await getStationFinderFrame(page);
    await acceptStationFinderCookiesIfPresent(frame);

    await test.step('Typing shows live suggestions', async () => {
        await frame.locator(SELECTORS.locationInput).click();
        await frame.locator(SELECTORS.locationInput).type(LOCATION_QUERY, { delay: 60 });
        await expect(frame.locator(SELECTORS.suggestionItem).first(), 'A location suggestion should appear while typing').toBeVisible();
        const suggestionCount = await frame.locator(SELECTORS.suggestionItem).count();
        expect(suggestionCount, 'More than one suggestion should be offered for a common place name').toBeGreaterThan(1);
    });

    await test.step('Selecting a suggestion fills the field', async () => {
        await frame.locator(SELECTORS.suggestionItem).first().click();
        await expect(frame.locator(SELECTORS.locationInput), 'Location field should be filled with the selected suggestion').toHaveValue(LOCATION_QUERY);
    });
});

test('Site Locator - Searching Without Extra Filters Shows Results', async ({ page }) => {
    await gotoSiteLocator(page);
    const frame = await getStationFinderFrame(page);
    await acceptStationFinderCookiesIfPresent(frame);

    await selectSuggestedLocation(frame, LOCATION_QUERY);
    await frame.locator(SELECTORS.searchButton).click();

    const resultCount = await waitForResultsToSettle(frame);
    expect(resultCount, 'Searching a real location with no other filters should return results').toBeGreaterThan(0);
});

test('Site Locator - Narrowing By Range, Card Types, and Facilities Updates Results', async ({ page }) => {
    // This test calls waitForResultsToSettle() 6 times in sequence (unfiltered, Range, 3 Card
    // Types, Facility, final Search), each of which can legitimately take several seconds on
    // this third-party site - comfortably exceeds the default 30s test timeout even though each
    // individual step is healthy.
    test.setTimeout(90000);
    await gotoSiteLocator(page);
    const frame = await getStationFinderFrame(page);
    await acceptStationFinderCookiesIfPresent(frame);

    await selectSuggestedLocation(frame, LOCATION_QUERY);
    await frame.locator(SELECTORS.searchButton).click();
    const unfilteredCount = await waitForResultsToSettle(frame);

    await test.step('Range does not update live (only takes effect on Search)', async () => {
        await frame.locator(SELECTORS.rangeSelect).selectOption({ label: '5 Miles' });
        const countAfterRange = await waitForResultsToSettle(frame);
        expect(countAfterRange, 'Changing Range alone should not narrow results until Search is clicked again').toBe(unfilteredCount);
    });

    let previousCount = unfilteredCount;
    for (const cardType of CARD_TYPES_TO_SELECT) {
        await test.step(`Selecting Card Type "${cardType}" updates results live`, async () => {
            await selectCardType(frame, cardType);
            const countNow = await waitForResultsToSettle(frame);
            expect(countNow, `Selecting "${cardType}" should change the live result count`).not.toBe(previousCount);
            previousCount = countNow;
        });
    }

    await test.step(`Selecting Facility "${FACILITY_TO_SELECT}" does not update live`, async () => {
        await selectFacility(frame, FACILITY_TO_SELECT);
        const countNow = await waitForResultsToSettle(frame);
        expect(countNow, 'Selecting a facility alone should not change results until Search is clicked again').toBe(previousCount);
    });

    await test.step('Clicking Search applies Range + Facilities together with the live Card Type selection', async () => {
        await frame.locator(SELECTORS.searchButton).click();
        const finalCount = await waitForResultsToSettle(frame);
        expect(finalCount, `Applying all filters together should show ${EXPECTED_NARROWED_RESULT_COUNT} results`).toBe(EXPECTED_NARROWED_RESULT_COUNT);
    });
});

test('Site Locator - Map Supports Dragging to Pan and Ctrl+Scroll to Zoom', async ({ page }) => {
    await gotoSiteLocator(page);
    const frame = await getStationFinderFrame(page);
    await acceptStationFinderCookiesIfPresent(frame);

    await selectSuggestedLocation(frame, LOCATION_QUERY);
    await frame.locator(SELECTORS.searchButton).click();
    await waitForResultsToSettle(frame);

    const map = frame.locator(SELECTORS.map);
    // The map is a fixed 700px tall, which combined with the filter panel above it exceeds the
    // default 720px desktop viewport height - without scrolling it into view first, the
    // "center" coordinate computed from boundingBox() can land off-screen, so mouse gestures
    // silently miss the map entirely (confirmed 2026-09-04 as the cause of the drag gesture
    // never registering).
    await map.scrollIntoViewIfNeeded();
    const mapBox = await map.boundingBox();

    await test.step('Dragging the map pans it (the view visibly changes)', async () => {
        // Google Maps needs a genuine "hold, then move in stages" gesture to register a drag -
        // confirmed 2026-09-04 that a single instant mouse.move from down to up (even with
        // `steps`) is NOT recognised as a drag at all (the map never pans). A brief pause after
        // mousedown, plus movement broken into a couple of stages with their own pauses, is what
        // works - but even that is occasionally not picked up on the first attempt (a real,
        // physical-feeling gesture against a third-party map's own event handling), so this
        // retries the gesture a few times rather than failing on one missed attempt.
        let panned = false;
        for (let attempt = 0; attempt < 3 && !panned; attempt++) {
            const before = await map.screenshot();
            await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
            await page.mouse.down();
            await page.waitForTimeout(150);
            await page.mouse.move(mapBox.x + mapBox.width / 2 - 100, mapBox.y + mapBox.height / 2 - 60, { steps: 10 });
            await page.waitForTimeout(150);
            await page.mouse.move(mapBox.x + mapBox.width / 2 - 250, mapBox.y + mapBox.height / 2 - 150, { steps: 10 });
            await page.waitForTimeout(150);
            await page.mouse.up();
            await page.waitForTimeout(600);
            const after = await map.screenshot();
            panned = !before.equals(after);
        }
        expect(panned, 'Dragging the map should visibly change what it displays').toBe(true);
    });

    await test.step('A plain scroll over the map does not zoom it - it shows the ctrl+scroll hint instead', async () => {
        await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
        await page.mouse.wheel(0, -300);
        await expect(frame.locator(SELECTORS.zoomHint), 'Scrolling without Ctrl should show the "Use ctrl + scroll to zoom" hint').toBeVisible();
    });

    await test.step('Ctrl+scroll actually zooms the map', async () => {
        const before = await map.screenshot();
        await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -300);
        await page.mouse.wheel(0, -300);
        await page.keyboard.up('Control');
        await page.waitForTimeout(600);
        const after = await map.screenshot();
        expect(before.equals(after), 'Ctrl+scroll should visibly zoom the map').toBe(false);
    });
});

test('Site Locator - Clicking a Result Shows Its Info Window and Matches the Site List', async ({ page }) => {
    // Applies the full filter combination (several settle-waits) then clicks up to 3 results in
    // turn - comfortably exceeds the default 30s test timeout even when everything is healthy.
    test.setTimeout(90000);
    await gotoSiteLocator(page);
    const frame = await getStationFinderFrame(page);
    await acceptStationFinderCookiesIfPresent(frame);

    await selectSuggestedLocation(frame, LOCATION_QUERY);
    await frame.locator(SELECTORS.searchButton).click();
    for (const cardType of CARD_TYPES_TO_SELECT) {
        await selectCardType(frame, cardType);
    }
    await selectFacility(frame, FACILITY_TO_SELECT);
    await frame.locator(SELECTORS.rangeSelect).selectOption({ label: '5 Miles' });
    await frame.locator(SELECTORS.searchButton).click();
    const resultCount = await waitForResultsToSettle(frame);

    await frame.locator(SELECTORS.siteListToggle).click();
    await expect(frame.locator(SELECTORS.siteListWrapper).first(), 'Site List panel should open').toHaveClass(/open/);

    const sampleSize = Math.min(3, resultCount);
    for (let i = 0; i < sampleSize; i++) {
        const listItem = frame.locator(SELECTORS.siteListItems).nth(i);
        const expectedName = (await listItem.locator('h5').textContent()).trim();
        const expectedAddress = (await listItem.locator('p').first().textContent()).trim();

        await test.step(`Result ${i + 1} ("${expectedName}"): clicking it opens a matching info window`, async () => {
            await listItem.locator('h5 a').click();
            const infoWindow = frame.locator(SELECTORS.infoWindow).first();
            await expect(infoWindow, 'Info window should appear after clicking a result').toBeVisible();
            const infoWindowText = await infoWindow.innerText();
            expect(infoWindowText, `Info window should show the same name as the list ("${expectedName}")`).toContain(expectedName);
            expect(infoWindowText, `Info window should show the same address as the list ("${expectedAddress}")`).toContain(expectedAddress);
        });
    }
});

test('Site Locator - Site List Panel Expands and Collapses', async ({ page }) => {
    await gotoSiteLocator(page);
    const frame = await getStationFinderFrame(page);
    await acceptStationFinderCookiesIfPresent(frame);

    await selectSuggestedLocation(frame, LOCATION_QUERY);
    await frame.locator(SELECTORS.searchButton).click();
    await waitForResultsToSettle(frame);

    await test.step('Clicking Site List expands it', async () => {
        await expect(frame.locator(SELECTORS.siteListWrapper).first(), 'Site List panel should start collapsed').not.toHaveClass(/open/);
        await frame.locator(SELECTORS.siteListToggle).click();
        await expect(frame.locator(SELECTORS.siteListWrapper).first(), 'Site List panel should open').toHaveClass(/open/);
        await expect(frame.locator(SELECTORS.siteListItems).first(), 'Result items should be visible once expanded').toBeVisible();
    });

    await test.step('Clicking it again collapses it back', async () => {
        await frame.locator(SELECTORS.siteListToggle).click();
        await expect(frame.locator(SELECTORS.siteListWrapper).first(), 'Site List panel should collapse again').not.toHaveClass(/open/);
    });
});
