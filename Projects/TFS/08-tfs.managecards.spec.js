const { test, expect } = require('@playwright/test');
const { DASHBOARD_PATH } = require('./login-helpers');
const { HEADER_SELECTORS, navigateViaSidebar, isBeforeInDom } = require('./portal-helpers');
const TABLE = require('./history-table-helpers');

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
// Dashboard -> Manage Cards via the real sidebar link. This file doesn't switch accounts, so it
// carries the same (low) shared-session risk as 03/04/06 - see the shared-session note in
// 02-tfs.dashboard.spec.js. Prefer `npm run test:stable` (`--workers=1`) for a fully reliable run.

// ============================================================================
// Coverage notes - Manage Cards ("/portal/manage-cards")
// ============================================================================
// Same History table + Filter panel widget family as every other portal page, with its own
// 9-column layout (Card Number, Card Type, Driver Name, Reg Number, Expires, Last Location, Last
// Used, Status, Cost Center) plus a 10th "Actions" column with per-row Stop Card / Request Pin
// Reminder buttons (there IS a header Download button here too, same as every other page - unlike
// Account Details/Invoices, there are no per-row PDF/Excel download links in Actions, only the
// two card-action buttons). Confirmed 2026-09-18: "Cost Center" is blank for every row sampled -
// same "did it still work" sorting treatment as its counterparts on Transactions/Payments.
//
// **Card Number is a clickable link, not plain text** (`.insights-modal__link`) - clicking it
// opens a details panel (`.details__modal`, inside the shared `[role="dialog"]` modal chrome used
// everywhere on this page) showing the full card record; the panel's own header badge
// (`.details__number`) is asserted to match whichever card number was actually clicked, sampling
// several rows at random (across pages) per Hector's request, closed each time via the modal's
// X (`.modal-close`) before moving to the next.
//
// **Expiry start/end BOTH genuinely work** as "on or after"/"on or before" filters respectively
// (confirmed: picking 01/01/2029 for start and 31/12/2028 for end each correctly bounded the
// Expires column) - the same working pattern already seen on Payments' single Date field and
// Transactions' Date Before/After. Worth a note for future debugging: an early rushed manual check
// of Expiry start (a quick standalone script, not this file's real test) wrongly concluded it had
// NO filtering effect at all - that turned out to be the SCRIPT's own timing bug (reading the
// table before its filtered fetch had actually resolved), not a real product defect, caught only
// once the real test used the same settle-then-read helpers as every other filter test in this
// project. Lesson: a quick ad hoc probe script is not a substitute for the same rigor as the real
// test when concluding something "doesn't work" - confirm with the actual helpers before writing
// it up as a Known Limitation. Building these tests also surfaced a real gap in the shared
// `pickCalendarDate()` helper (used by 03/04/06/07 too): it only ever clicked "Previous month", so
// it could never reach a future target month - true for every date field used so far EXCEPT this
// account's card Expiry dates, which run 2027-2030 (ahead of "today"). Fixed in
// `history-table-helpers.js` to compare actual month/year values and navigate whichever direction
// (Previous/Next) actually gets closer, rather than assuming the target is always in the past.
//
// **Order Card - a real duplicate-value defect found and documented, but not pursued further per
// Hector's instruction to stop at "Next":** the card-type dropdown's underlying `<option value>`
// for "SHELL FLEET" and "SHELL FLEET HYBRID" is the IDENTICAL GUID (confirmed via DOM inspection)
// - the two options are visually distinct in the list, and the browser's native `<select>` handles
// picking either by its displayed label just fine, but if the app reads the submitted VALUE
// (rather than the label) when actually placing an order, selecting "SHELL FLEET HYBRID" could
// silently order a "SHELL FLEET" card instead (or vice versa) - a real risk worth flagging to the
// team, though not verifiable without completing an order, which is explicitly out of scope here.
// This spec selects "SHELL FLEET" (Hector's "SHEL CRT"), clicks Next to confirm the panel changes
// to the driver-details step, then closes via the X without submitting anything.
//
// **Stop Card / Request Pin Reminder - confirmed to have real functionality without completing
// either action**, per Hector's explicit instruction: clicking each opens its own small
// confirmation modal with real, specific copy ("Place card on temporary stop" / "Forgot your
// pin?") and a real primary action button (Confirm / Request) - proving the buttons genuinely do
// something rather than being dead/no-op controls - then each is closed via the X without ever
// clicking Confirm/Request, so no card is actually stopped and no pin reminder is actually sent.
//
// Tests in this file:
//   1. Manage Cards - Navigating from the Dashboard Sidebar Loads the Page
//   2. Manage Cards - Header Controls Appear in the Same Order as the Dashboard
//   3. Manage Cards - Filter Results Panel Is Present (all 8 fields)
//   4. Filters - Card Status Narrows Results
//   5. Filters - Card Number Updates Results Live As You Type
//   6. Filters - Card Type Updates Results Live As You Type
//   7. Filters - Last Location Updates Results Live As You Type
//   8. Filters - Expiry Start Date Shows Results On or After That Date
//   9. Filters - Expiry End Date Shows Results On or Before That Date
//   10. Filters - Registration No. Updates Results Live As You Type
//   11. Filters - Driver Name Updates Results Live As You Type
//   12. Manage Cards - History Table Shows Sort and Download Controls
//   13. Manage Cards - Download Button Exports the History as Excel
//   14. Manage Cards - Pagination Navigates Between Pages
//   15. Manage Cards - Order Card Opens a Card Type Selector and Advances to Card Details
//   16. Manage Cards - Actions Column Buttons Have Real Functionality (Stop Card, Request Pin
//      Reminder) Without Completing Either Action
//   17. Manage Cards - Clicking a Card Number Shows Its Details Panel (Sample of Random Rows)
//   18. Manage Cards - Sorting By "<field>" Updates the Table (one test per sort field: Card
//      Number, Card Type, Driver Name, Reg Number, Expires, Last Location, Last Used, Status,
//      Cost Center)
// ============================================================================

const MANAGE_CARDS_PATH = '/portal/manage-cards';

// Page-specific selectors only - shared History table/filter-panel mechanics come from TABLE
// (history-table-helpers.js).
const SELECTORS = {
    ...TABLE.SELECTORS,
    filterPanel: '.filter-panel',
    statusSelect: '#filter-Status',
    cardNumberInput: '#filter-ExternalTokenRef',
    cardTypeInput: '#filter-CardType',
    lastLocationInput: '#filter-LastLocation',
    expiryStartInput: '#filter-Expires_start',
    expiryEndInput: '#filter-Expires_end',
    regNumberInput: '#filter-regNumber',
    driverNameInput: '#filter-driverName',
    orderCardButton: 'button:has-text("Order Card")',
    modal: '[role="dialog"]',
    modalClose: '.modal-close',
    orderCardTypeSelect: '#order-card-type',
    orderCardNextButton: '[role="dialog"] button:has-text("Next")',
    cardNumberLink: '.insights-modal__link',
    detailsModal: '.details__modal',
    detailsNumber: '.details__number',
    stopCardButton: '.data-table__action-btn--stop-card',
    requestPinReminderButton: '.data-table__action-btn--request-pin-reminder',
};

const FILTER_FIELD_IDS = [
    'filter-Status',
    'filter-ExternalTokenRef',
    'filter-CardType',
    'filter-LastLocation',
    'filter-Expires_start',
    'filter-Expires_end',
    'filter-regNumber',
    'filter-driverName',
];

const SORT_FIELDS = ['Card Number', 'Card Type', 'Driver Name', 'Reg Number', 'Expires', 'Last Location', 'Last Used', 'Status', 'Cost Center'];
const FIELDS_WITH_NO_VISIBLE_REORDER = ['Cost Center'];

const COLUMN_INDEX = {
    cardNumber: 0,
    cardType: 1,
    driverName: 2,
    regNumber: 3,
    expires: 4,
    lastLocation: 5,
};

async function gotoManageCards(page) {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await navigateViaSidebar(page, MANAGE_CARDS_PATH, MANAGE_CARDS_PATH);
    await expect(page.locator('h1'), 'Manage Cards should show its "Manage Cards" heading').toHaveText('Manage Cards');
    // Same class of bug fixed in 06-tfs.transactions.spec.js's gotoTransactions() - the table's
    // own data fetch is a separate async step after navigation, so reading a column immediately
    // can intermittently catch it before the first row has actually rendered.
    await expect(page.locator(SELECTORS.tableRow).first(), 'History table should have rows after loading Manage Cards').toBeVisible();
}

// This page's text filters occasionally need longer than TABLE.waitForFilterToSettle()'s fixed
// 400ms+networkidle wait to actually apply - confirmed 2026-09-18 that reading immediately after
// can intermittently see a stale 0-row result for a filter value that's genuinely present in the
// data (seen on both Card Number and Driver Name, on different runs). Polls up to a few extra
// seconds rather than assuming a fixed wait is always enough, without weakening the tests that
// deliberately expect zero results (Status/Type "no results" tests don't use this).
async function waitForNonEmptyFilterResult(page, columnIndex) {
    await expect.poll(async () => {
        await TABLE.waitForFilterToSettle(page);
        return (await TABLE.readColumn(page, columnIndex)).length;
    }, { message: 'Filtered results should stop being empty once the filter has actually applied', timeout: 5000 }).toBeGreaterThan(0);
    return TABLE.readColumn(page, columnIndex);
}

async function readCardNumbers(page) {
    await expect(page.locator(SELECTORS.tableRow).first(), 'History table should have rows after a sort/reload').toBeVisible();
    return TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
}

test('Manage Cards - Navigating from the Dashboard Sidebar Loads the Page', async ({ page, baseURL }) => {
    await gotoManageCards(page);
    await expect(page, 'Manage Cards should load at /portal/manage-cards').toHaveURL(new URL(MANAGE_CARDS_PATH, baseURL).toString());
    await expect(page, 'Manage Cards should load with the expected title').toHaveTitle('Manage Cards');
});

test('Manage Cards - Header Controls Appear in the Same Order as the Dashboard', async ({ page }) => {
    await gotoManageCards(page);

    await test.step('Dropdown, Log out, and logo are all visible', async () => {
        await expect(page.locator(HEADER_SELECTORS.accountDropdownToggle), 'Account dropdown should be visible').toBeVisible();
        await expect(page.getByRole('button', { name: 'Log out' }), 'Log out button should be visible').toBeVisible();
        await expect(page.locator(HEADER_SELECTORS.logo), 'Logo should be visible').toBeVisible();
    });

    await test.step('Dropdown appears before Log out, which appears before the logo', async () => {
        const dropdownBeforeLogout = await isBeforeInDom(page, HEADER_SELECTORS.accountDropdownToggle, HEADER_SELECTORS.logoutButton);
        expect(dropdownBeforeLogout, 'Account dropdown should appear before the Log out button in the header').toBe(true);

        const logoutBeforeLogo = await isBeforeInDom(page, HEADER_SELECTORS.logoutButton, HEADER_SELECTORS.logo);
        expect(logoutBeforeLogo, 'Log out button should appear before the logo in the header').toBe(true);
    });
});

test('Manage Cards - Filter Results Panel Is Present', async ({ page }) => {
    await gotoManageCards(page);

    await expect(page.locator(SELECTORS.filterPanel), 'Filter Results panel should be visible').toBeVisible();
    await expect(page.getByRole('heading', { name: 'Filter results' }), 'Filter Results heading should be visible').toBeVisible();

    for (const fieldId of FILTER_FIELD_IDS) {
        await expect(page.locator(`#${fieldId}`), `Filter field "#${fieldId}" should be present`).toBeAttached();
    }
});

test('Filters - Card Status Narrows Results', async ({ page }) => {
    await gotoManageCards(page);
    const defaultCardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);

    await test.step('Select "Active" from the Card Status dropdown', async () => {
        await page.selectOption(SELECTORS.statusSelect, { label: 'Active' });
        await TABLE.waitForFilterToSettle(page);
    });

    await test.step('Every visible result should be Active', async () => {
        // Same class of "reading right after a filter reload" race documented elsewhere in this
        // project - wait for a row to actually be present before reading.
        await expect(page.locator(SELECTORS.tableRow).first(), 'History table should have rows after filtering by "Active"').toBeVisible();
        const rows = await page.evaluate((rowSelector) => Array.from(document.querySelectorAll(rowSelector)).map((row) => row.querySelector('.data-table__status-cell')?.getAttribute('title')), SELECTORS.tableRow);
        expect(rows.length, 'Filtering by "Active" should return at least one result').toBeGreaterThan(0);
        for (const status of rows) {
            expect(status, `Row's status should be "Active"`).toBe('Active');
        }
    });

    await test.step('Selecting "Any" restores the full list', async () => {
        await page.selectOption(SELECTORS.statusSelect, { label: 'Any' });
        await TABLE.waitForFilterToSettle(page);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
        expect(restored, 'Selecting "Any" should restore the original unfiltered list').toEqual(defaultCardNumbers);
    });
});

test('Filters - Card Number Updates Results Live As You Type', async ({ page }) => {
    await gotoManageCards(page);
    const defaultCardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
    const sampleCardNumber = defaultCardNumbers[0].slice(0, 8);

    await test.step(`Type "${sampleCardNumber}"`, async () => {
        await page.fill(SELECTORS.cardNumberInput, sampleCardNumber);
    });

    await test.step('Every visible result should match what was typed', async () => {
        const cardNumbers = await waitForNonEmptyFilterResult(page, COLUMN_INDEX.cardNumber);
        for (const cardNumber of cardNumbers) {
            expect(cardNumber, `"${cardNumber}" should contain the typed "${sampleCardNumber}"`).toContain(sampleCardNumber);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.cardNumberInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
        expect(restored, 'Clearing Card Number should restore the original unfiltered list').toEqual(defaultCardNumbers);
    });
});

test('Filters - Card Type Updates Results Live As You Type', async ({ page }) => {
    await gotoManageCards(page);
    const defaultCardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
    const sampleCardType = (await TABLE.readColumn(page, COLUMN_INDEX.cardType)).find((value) => value);
    expect(sampleCardType, 'Should be able to read a sample card type from the table').toBeTruthy();

    await test.step(`Type "${sampleCardType}"`, async () => {
        await page.fill(SELECTORS.cardTypeInput, sampleCardType);
    });

    await test.step('Every visible result should match what was typed', async () => {
        const cardTypes = await waitForNonEmptyFilterResult(page, COLUMN_INDEX.cardType);
        for (const cardType of cardTypes) {
            expect(cardType, `"${cardType}" should contain the typed "${sampleCardType}"`).toContain(sampleCardType);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.cardTypeInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
        expect(restored, 'Clearing Card Type should restore the original unfiltered list').toEqual(defaultCardNumbers);
    });
});

test('Filters - Last Location Updates Results Live As You Type', async ({ page }) => {
    await gotoManageCards(page);
    const defaultCardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
    const lastLocations = await TABLE.readColumn(page, COLUMN_INDEX.lastLocation);
    const sampleLocation = lastLocations.find((value) => value);
    expect(sampleLocation, 'Should be able to read a sample Last Location from the table').toBeTruthy();

    await test.step(`Type "${sampleLocation}"`, async () => {
        await page.fill(SELECTORS.lastLocationInput, sampleLocation);
    });

    await test.step('Every visible result should match what was typed', async () => {
        const locations = await waitForNonEmptyFilterResult(page, COLUMN_INDEX.lastLocation);
        for (const location of locations) {
            expect(location, `"${location}" should contain the typed "${sampleLocation}"`).toContain(sampleLocation);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.lastLocationInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
        expect(restored, 'Clearing Last Location should restore the original unfiltered list').toEqual(defaultCardNumbers);
    });
});

test('Filters - Expiry Start Date Shows Results On or After That Date', async ({ page }) => {
    await gotoManageCards(page);
    const defaultCardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
    const cutoff = new Date(2029, 0, 1); // 01/01/2029

    // Confirmed 2026-09-18: this genuinely works as an "on or after" filter - an EARLIER, rushed
    // manual check (a plain script, not this helper) had wrongly concluded it had no effect at
    // all, which turned out to be that script's own timing bug (reading the table before its
    // filtered fetch had resolved), not a real product defect. Picking a real mid-range date here
    // (rather than the account's exact latest expiry, which genuinely did shift between two
    // earlier runs of this test) keeps the assertion robust against this being live data.
    await test.step('Pick an expiry start date', async () => {
        await TABLE.pickCalendarDate(page, SELECTORS.expiryStartInput, 1, 1, 2029);
    });

    await test.step('Every visible result should expire on or after that date', async () => {
        const expiries = await TABLE.readColumn(page, COLUMN_INDEX.expires);
        expect(expiries.length, 'Filtering by expiry start 01/01/2029 should return at least one result').toBeGreaterThan(0);
        for (const expiryText of expiries) {
            const datePart = expiryText.split(',')[0].trim();
            expect(TABLE.parseUkDate(datePart).getTime(), `Row expiring "${expiryText}" should be on or after 01/01/2029`).toBeGreaterThanOrEqual(cutoff.getTime());
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.expiryStartInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
        expect(restored, 'Clearing Expiry start should restore the original unfiltered list').toEqual(defaultCardNumbers);
    });
});

test('Filters - Expiry End Date Shows Results On or Before That Date', async ({ page }) => {
    await gotoManageCards(page);
    const defaultCardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
    const cutoff = new Date(2028, 11, 31); // 31/12/2028

    await test.step('Pick an expiry end date', async () => {
        await TABLE.pickCalendarDate(page, SELECTORS.expiryEndInput, 31, 12, 2028);
    });

    await test.step('Every visible result should expire on or before that date', async () => {
        const expiries = await TABLE.readColumn(page, COLUMN_INDEX.expires);
        expect(expiries.length, 'Filtering by expiry end 31/12/2028 should return at least one result').toBeGreaterThan(0);
        for (const expiryText of expiries) {
            const datePart = expiryText.split(',')[0].trim();
            expect(TABLE.parseUkDate(datePart).getTime(), `Row expiring "${expiryText}" should be on or before 31/12/2028`).toBeLessThanOrEqual(cutoff.getTime());
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.expiryEndInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
        expect(restored, 'Clearing Expiry end should restore the original unfiltered list').toEqual(defaultCardNumbers);
    });
});

test('Filters - Registration No. Updates Results Live As You Type', async ({ page }) => {
    await gotoManageCards(page);
    const defaultCardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
    const regNumbers = await TABLE.readColumn(page, COLUMN_INDEX.regNumber);
    const sampleRegNumber = regNumbers.find((value) => value);
    expect(sampleRegNumber, 'Should be able to read a sample reg number from the table').toBeTruthy();

    await test.step(`Type "${sampleRegNumber}"`, async () => {
        await page.fill(SELECTORS.regNumberInput, sampleRegNumber);
    });

    await test.step('Every visible result should match what was typed', async () => {
        const filteredRegNumbers = await waitForNonEmptyFilterResult(page, COLUMN_INDEX.regNumber);
        for (const regNumber of filteredRegNumbers) {
            expect(regNumber, `"${regNumber}" should contain the typed "${sampleRegNumber}"`).toContain(sampleRegNumber);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.regNumberInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
        expect(restored, 'Clearing Registration No. should restore the original unfiltered list').toEqual(defaultCardNumbers);
    });
});

test('Filters - Driver Name Updates Results Live As You Type', async ({ page }) => {
    await gotoManageCards(page);
    const defaultCardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
    const driverNames = await TABLE.readColumn(page, COLUMN_INDEX.driverName);
    const sampleDriverName = driverNames.find((value) => value);
    expect(sampleDriverName, 'Should be able to read a sample driver name from the table').toBeTruthy();

    await test.step(`Type "${sampleDriverName}"`, async () => {
        await page.fill(SELECTORS.driverNameInput, sampleDriverName);
    });

    await test.step('Every visible result should match what was typed', async () => {
        const filteredDriverNames = await waitForNonEmptyFilterResult(page, COLUMN_INDEX.driverName);
        for (const driverName of filteredDriverNames) {
            expect(driverName, `"${driverName}" should contain the typed "${sampleDriverName}"`).toContain(sampleDriverName);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.driverNameInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
        expect(restored, 'Clearing Driver Name should restore the original unfiltered list').toEqual(defaultCardNumbers);
    });
});

test('Manage Cards - History Table Shows Sort and Download Controls', async ({ page }) => {
    await gotoManageCards(page);

    await test.step('Sort by toggle, Download button, and table are visible', async () => {
        await expect(page.getByRole('heading', { name: 'History' }), 'History heading should be visible').toBeVisible();
        await expect(page.locator(SELECTORS.sortToggle), 'Sort by toggle should be visible').toBeVisible();
        await expect(page.locator(SELECTORS.exportButton), 'Download button should be visible').toBeVisible();
        await expect(page.locator(SELECTORS.dataTable), 'History table should be visible').toBeVisible();
    });

    await test.step('Opening the sort dropdown flips the chevron open', async () => {
        await expect(page.locator(SELECTORS.sortToggle), 'Sort dropdown should start closed').toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator(SELECTORS.sortChevron), 'Sort chevron should start in its closed state').not.toHaveClass(/dropdown__chevron--open/);

        await page.click(SELECTORS.sortToggle);

        await expect(page.locator(SELECTORS.sortToggle), 'Sort dropdown should report itself as open').toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator(SELECTORS.sortChevron), 'Sort chevron should flip to its open state').toHaveClass(/dropdown__chevron--open/);
        await expect(page.locator(SELECTORS.sortItem), 'Sort options should be listed').toHaveCount(SORT_FIELDS.length);
    });

    await test.step('Clicking the toggle again collapses it back', async () => {
        await page.click(SELECTORS.sortToggle);

        await expect(page.locator(SELECTORS.sortToggle), 'Sort dropdown should report itself as closed again').toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator(SELECTORS.sortChevron), 'Sort chevron should flip back to its closed state').not.toHaveClass(/dropdown__chevron--open/);
    });
});

test('Manage Cards - Download Button Exports the History as Excel', async ({ page }) => {
    await gotoManageCards(page);

    const download = await test.step('Click the Download button', async () => {
        const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
        await page.click(SELECTORS.exportButton);
        return downloadPromise;
    });

    await test.step('A real .xlsx download should be offered', async () => {
        expect(download.suggestedFilename(), 'Download should offer an Excel (.xlsx) file').toMatch(/\.xlsx$/i);
    });

    // Never actually save the file - just prove the export works, then discard it.
    await download.cancel().catch(() => { });
});

test('Manage Cards - Pagination Navigates Between Pages', async ({ page }) => {
    await gotoManageCards(page);
    await expect(page.locator(SELECTORS.pagination), 'Pagination should be visible').toBeVisible();

    await test.step('First and Previous are disabled on page 1', async () => {
        await expect(page.locator(SELECTORS.paginationInfo), 'Should start on page 1').toContainText('Page 1 of');
        await expect(page.locator(SELECTORS.firstPageButton), 'First page button should be disabled on page 1').toBeDisabled();
        await expect(page.locator(SELECTORS.prevPageButton), 'Previous page button should be disabled on page 1').toBeDisabled();
    });

    const totalPagesText = await page.locator(SELECTORS.paginationInfo).textContent();
    const totalPages = Number(totalPagesText.match(/of\s+(\d+)/)?.[1]);

    if (totalPages > 1) {
        await test.step('Next moves forward one page at a time', async () => {
            await page.click(SELECTORS.nextPageButton);
            await expect(page.locator(SELECTORS.paginationInfo), 'Clicking Next should move to page 2').toContainText('Page 2 of');
        });

        await test.step('Previous moves back one page at a time', async () => {
            await page.click(SELECTORS.prevPageButton);
            await expect(page.locator(SELECTORS.paginationInfo), 'Clicking Previous should move back to page 1').toContainText('Page 1 of');
        });

        await test.step('Last page disables Next/Last, and First page returns to the start', async () => {
            await page.click(SELECTORS.lastPageButton);
            await expect.poll(async () => {
                const currentInfo = await page.locator(SELECTORS.paginationInfo).textContent();
                const [, currentPage, currentTotal] = currentInfo.match(/Page\s+(\d+)\s+of\s+(\d+)/) || [];
                return currentPage === currentTotal;
            }, { message: 'Clicking Last page should land on the current final page ("Page N of N")' }).toBe(true);
            await expect(page.locator(SELECTORS.nextPageButton), 'Next page button should be disabled on the last page').toBeDisabled();

            await page.click(SELECTORS.firstPageButton);
            await expect(page.locator(SELECTORS.paginationInfo), 'Clicking First page should return to page 1').toContainText('Page 1 of');
        });
    }
});

test('Manage Cards - Order Card Opens a Card Type Selector and Advances to Card Details', async ({ page }) => {
    await gotoManageCards(page);

    await test.step('Click "Order Card" and select "SHELL FLEET"', async () => {
        await page.click(SELECTORS.orderCardButton);
        await expect(page.locator(SELECTORS.modal), 'Order Card modal should open').toBeVisible();
        await expect(page.getByText('Please select the card you want to order'), 'Modal should ask which card to order').toBeVisible();
        // The modal is a Bootstrap `.fade` dialog - confirmed 2026-09-18 that selecting an option
        // immediately can intermittently miss on mobile-chromium while the modal is still
        // completing its fade-in transition. A brief pause is more reliable than racing it.
        await page.waitForTimeout(400);
        await page.selectOption(SELECTORS.orderCardTypeSelect, { label: 'SHELL FLEET' });
    });

    await test.step('Clicking Next advances to the card details step', async () => {
        await page.click(SELECTORS.orderCardNextButton);
        await expect(page.getByRole('heading', { name: 'Order a new card' }), 'Modal should advance to the "Order a new card" details step').toBeVisible();
        await expect(page.locator('#order-card-driverName'), 'Driver Name field should be present').toBeVisible();
        await expect(page.locator('#order-card-pin'), 'Pin field should be present').toBeVisible();
        await expect(page.locator('#order-card-grading'), 'Grading field should be present').toBeVisible();
    });

    await test.step('Closing via X ends the journey without submitting anything', async () => {
        await page.click(SELECTORS.modalClose);
        await expect(page.locator(SELECTORS.modal), 'Order Card modal should close').toHaveCount(0);
    });
});

test('Manage Cards - Actions Column Buttons Have Real Functionality Without Completing Either Action', async ({ page }) => {
    await gotoManageCards(page);

    await test.step('Stop Card opens a real confirmation, then is closed without confirming', async () => {
        await page.locator(SELECTORS.stopCardButton).first().click();
        const modal = page.locator(SELECTORS.modal);
        await expect(modal, 'Stop Card should open a confirmation modal').toBeVisible();
        await expect(page.getByText('Place card on temporary stop'), 'Modal should show the real Stop Card confirmation copy').toBeVisible();
        // getByRole's `name` is a case-insensitive SUBSTRING match by default - every row's own
        // "Request pin reminder" action button would also match an unscoped "Confirm"/"Request"
        // look-up if either word happened to appear as a substring elsewhere, so scope to the
        // modal and require an exact match (confirmed 2026-09-18 this was a real strict-mode
        // violation for "Request", matching all 10 row buttons plus the real modal button).
        await expect(modal.getByRole('button', { name: 'Confirm', exact: true }), 'Modal should offer a real Confirm action').toBeVisible();
        await page.click(SELECTORS.modalClose);
        await expect(modal, 'Confirmation modal should close').toHaveCount(0);
        // The modal's own element leaves the DOM before its Bootstrap `.fade` backdrop finishes
        // fading out - confirmed 2026-09-18 that clicking straight into the next action button on
        // mobile-chromium can silently miss (or land on the fading backdrop) without this pause.
        await page.waitForTimeout(400);
    });

    await test.step('Request Pin Reminder opens a real confirmation, then is closed without requesting', async () => {
        await page.locator(SELECTORS.requestPinReminderButton).first().click();
        const modal = page.locator(SELECTORS.modal);
        await expect(modal, 'Request Pin Reminder should open a confirmation modal').toBeVisible();
        await expect(page.getByText('Forgot your pin?'), 'Modal should show the real Request Pin Reminder confirmation copy').toBeVisible();
        await expect(modal.getByRole('button', { name: 'Request', exact: true }), 'Modal should offer a real Request action').toBeVisible();
        await page.click(SELECTORS.modalClose);
        await expect(modal, 'Confirmation modal should close').toHaveCount(0);
    });
});

test('Manage Cards - Clicking a Card Number Shows Its Details Panel (Sample of Random Rows)', async ({ page }) => {
    await gotoManageCards(page);
    const cardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
    // A random sample, per Hector's "go through by clicking randomly some of these card numbers".
    const sampleSize = Math.min(4, cardNumbers.length);
    const sampledIndexes = [...cardNumbers.keys()].sort(() => Math.random() - 0.5).slice(0, sampleSize);

    for (const index of sampledIndexes) {
        const cardNumber = cardNumbers[index];

        await test.step(`Click card number "${cardNumber}" and verify its details panel`, async () => {
            await page.locator(SELECTORS.cardNumberLink).nth(index).click();
            const detailsPanel = page.locator(SELECTORS.detailsModal);
            await expect(detailsPanel, 'Card details panel should open').toBeVisible();
            await expect(page.locator(SELECTORS.detailsNumber), `Details panel should show the clicked card number "${cardNumber}"`).toHaveText(cardNumber);
            // "Card Number"/"Card Type" also appear as a filter label and a table column header
            // elsewhere on the page - scope to the details panel itself to avoid a strict-mode
            // violation (confirmed 2026-09-18).
            await expect(detailsPanel.getByText('Card Number', { exact: true }), 'Details panel should have a "Card Number" field').toBeVisible();
            await expect(detailsPanel.getByText('Card Type', { exact: true }), 'Details panel should have a "Card Type" field').toBeVisible();
            await expect(detailsPanel.getByText('Card Status', { exact: true }), 'Details panel should have a "Card Status" field').toBeVisible();

            await page.click(SELECTORS.modalClose);
            await expect(page.locator(SELECTORS.modal), 'Details panel should close').toHaveCount(0);
        });
    }
});

for (const field of SORT_FIELDS) {
    const expectReorder = !FIELDS_WITH_NO_VISIBLE_REORDER.includes(field);

    test(`Manage Cards - Sorting By "${field}" Updates the Table`, async ({ page }) => {
        await gotoManageCards(page);
        const defaultOrder = await readCardNumbers(page);

        await test.step(`Select "${field}" from the sort options`, async () => {
            await TABLE.openSortDropdown(page);
            await page.locator(SELECTORS.sortDropdown).getByRole('button', { name: field, exact: true }).click();
            await expect(page.locator(SELECTORS.sortToggleText), `Sort toggle should read "Sort by: ${field}"`).toHaveText(`Sort by: ${field}`);
        });

        const ascendingOrder = await readCardNumbers(page);
        if (expectReorder) {
            expect(ascendingOrder, `Sorting by "${field}" should change the table's row order from the default view`).not.toEqual(defaultOrder);
        } else {
            expect(ascendingOrder.length, `Table should still show rows after sorting by "${field}"`).toBeGreaterThan(0);
        }

        await test.step('Switch the direction to descending', async () => {
            await TABLE.openSortDropdown(page);
            await page.click(SELECTORS.sortDescendingButton);
        });

        const descendingOrder = await readCardNumbers(page);
        if (expectReorder) {
            expect(descendingOrder, `Switching "${field}" to descending should change the row order again`).not.toEqual(ascendingOrder);
        } else {
            expect(descendingOrder.length, `Table should still show rows after switching "${field}" to descending`).toBeGreaterThan(0);
        }
    });
}
