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
// Dashboard -> Transactions via the real sidebar link, rather than deep-linking straight to
// /portal/transactions, since that navigation itself is part of what's being verified.
//
// Same shared-session caveat as 02/03/04 applies: this file never switches accounts, so it isn't
// a source of risk, but a fully-parallel local run of the whole suite carries the documented
// residual chance of showing a different account's data than expected (see the shared-session
// note in 02-tfs.dashboard.spec.js). Prefer `npm run test:stable` for a fully reliable run.

// ============================================================================
// Coverage notes - Transactions ("/portal/transactions")
// ============================================================================
// Same History table + Filter panel widget family as Account Details/Invoices, but with its own
// column set (12 columns here vs 8-9 there) and its own 8 filter fields. Two real differences
// from Account Details/Invoices worth remembering:
//   - No personal-details card, and no per-row PDF/Excel download links in an Actions column -
//     only the header's single "Download" button (exports the whole filtered table).
//   - Text filters (Invoice Number, Card Number, Reg Number, Driver Name) are exercised with
//     `pressSequentially(..., { delay })` rather than `fill()`, per Hector's explicit instruction
//     to type "at normal speed as if it would be a person typing" - these fields filter on every
//     keystroke, so this is closer to how a real user would trigger the live narrowing.
//   - Confirmed 2026-09-04: "Cost Center" is blank for every transaction sampled across 5 pages
//     (~50 rows) - like "Type"/"Quantity (Ltrs)" on Account Details, sorting by it can't visibly
//     reorder anything, so it gets a "did it still work" check instead of a "did the data change"
//     one. "Type" and "Odometer" both vary meaningfully here (unlike Account Details), so they DO
//     get real reorder assertions.
//
// **Min/Max Volume - a real markup defect found and documented, but the FILTERING ITSELF WORKS:**
// The page renders TWO "input-field--range" blocks - one labelled "Min Volume", one labelled
// "Max Volume" - but both blocks contain the exact same pair of inputs
// (id="filter-Quantity-min" + id="filter-Quantity-max"), so `#filter-Quantity-min` and
// `#filter-Quantity-max` each match TWO elements in the DOM (duplicate, non-unique ids - the same
// class of bug found on the Site Locator's third-party embed). Confirmed the two same-id elements
// are genuinely mirrors of ONE underlying value (filling the first updates the second instantly),
// not two independent fields - so this spec always targets `.first()`. Despite the confusing
// markup, filtering itself was verified 2026-09-04 to work correctly in BOTH directions: Min
// Volume genuinely narrows to Volume >= the typed value, and Max Volume genuinely narrows to
// Volume <= the typed value (confirmed by reading actual Volume column values and the page-count
// dropping, e.g. 15 pages -> 3 pages at Max=20) - unlike Account Details' Quantity Min/Max, which
// was genuinely broken there because every row shared Quantity=0. Scoped selectors as
// `SELECTORS.minVolumeInput`/`maxVolumeInput` (`.first()` of each duplicate pair) rather than
// working around the duplicate ids some other way, so a future de-duplication fix in the app
// doesn't silently break this spec (`.first()` keeps working whether there's 1 match or 2).
//
// Tests in this file:
//   1. Transactions - Navigating from the Dashboard Sidebar Loads the Page
//   2. Transactions - Header Controls Appear in the Same Order as the Dashboard
//   3. Transactions - Filter Results Panel Is Present (all 8 fields)
//   4. Filters - Invoice Number Updates Results Live As You Type
//   5. Filters - Card Number Updates Results Live As You Type
//   6. Filters - Date After Shows Results On or After That Date
//   7. Filters - Date Before Shows Results On or Before That Date
//   8. Filters - Min Volume Narrows Results to That Volume or Above
//   9. Filters - Max Volume Narrows Results to That Volume or Below
//   10. Filters - Reg Number Updates Results Live As You Type
//   11. Filters - Driver Name Updates Results Live As You Type
//   12. Transactions - History Table Shows Sort and Download Controls
//   13. Transactions - Pagination Navigates Between Pages
//   14. Transactions - Download Button Exports the History as Excel
//   15. Transactions - Sorting By "<field>" Updates the Table (one test per sort field: Date &
//      Time, Invoice Number, Product Description, Driver Name, Reg Number, Site Name, Cost
//      Center, Card Number, Type, Odometer, Volume, Total)
// ============================================================================

const TRANSACTIONS_PATH = '/portal/transactions';

// Page-specific selectors only - shared History table/filter-panel mechanics come from TABLE
// (history-table-helpers.js).
const SELECTORS = {
    ...TABLE.SELECTORS,
    filterPanel: '.filter-panel',
    invoiceNumberInput: '#filter-ExternalDocumentRef',
    cardNumberInput: '#filter-ExternalTokenRef',
    dateAfterInput: '#filter-SalesDateTime_start',
    dateBeforeInput: '#filter-SalesDateTime_end',
    minVolumeInput: '#filter-Quantity-min >> nth=0',
    maxVolumeInput: '#filter-Quantity-max >> nth=0',
    regNumberInput: '#filter-Vrn',
    driverNameInput: '#filter-Driver',
};

const FILTER_FIELD_IDS = [
    'filter-ExternalDocumentRef',
    'filter-ExternalTokenRef',
    'filter-SalesDateTime_start',
    'filter-SalesDateTime_end',
    'filter-Quantity-min',
    'filter-Quantity-max',
    'filter-Vrn',
    'filter-Driver',
];

// Confirmed 2026-09-04, this account's Transactions data - 12 columns, its own set (distinct
// from Account Details/Invoices).
const SORT_FIELDS = ['Date & Time', 'Invoice Number', 'Product Description', 'Driver Name', 'Reg Number', 'Site Name', 'Cost Center', 'Card Number', 'Type', 'Odometer', 'Volume', 'Total'];
const FIELDS_WITH_NO_VISIBLE_REORDER = ['Cost Center'];

const COLUMN_INDEX = {
    dateTime: 0,
    invoiceNumber: 1,
    driverName: 3,
    regNumber: 4,
    cardNumber: 7,
    volume: 10,
};

// Selecting a sort field or flipping direction re-fetches the table - reading immediately can
// catch it mid-reload (an empty row set), confirmed 2026-09-04 while building this spec
// (intermittent 0-row / unchanged-order failures on every field, not just genuinely-blank
// "Cost Center" - a manual re-check showed 10 rows present within ~1s every time). Fixed the
// same way TABLE.readDocumentNumbers() does it: wait for a row to actually be visible first.
async function readInvoiceNumbers(page) {
    await expect(page.locator(SELECTORS.tableRow).first(), 'History table should have rows after a sort/reload').toBeVisible();
    return TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
}

async function gotoTransactions(page) {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await navigateViaSidebar(page, TRANSACTIONS_PATH, TRANSACTIONS_PATH);
    await expect(page.locator('h1'), 'Transactions should show its "Transactions" heading').toHaveText('Transactions');
    // The table's own data fetch is a separate async step after navigation "load"/networkidle -
    // confirmed 2026-09-18 that reading a column immediately after gotoTransactions() can
    // intermittently catch the table before its first row has actually rendered (an empty-string
    // cell, read as "" rather than 0 rows), surfacing as a misleading "should be able to read a
    // sample X" failure. Same class of bug as readInvoiceNumbers()'s wait, just needed here too
    // since almost every filter test's very first read is this "baseline, expected non-empty"
    // read right after navigation.
    await expect(page.locator(SELECTORS.tableRow).first(), 'History table should have rows after loading Transactions').toBeVisible();
}

// Types like a real person rather than setting the whole value in one go, per Hector's explicit
// instruction - these filters narrow the table live on every keystroke.
async function typeSlowly(page, selector, text) {
    await page.locator(selector).pressSequentially(text, { delay: 80 });
}

test('Transactions - Navigating from the Dashboard Sidebar Loads the Page', async ({ page, baseURL }) => {
    await gotoTransactions(page);
    await expect(page, 'Transactions should load at /portal/transactions').toHaveURL(new URL(TRANSACTIONS_PATH, baseURL).toString());
    await expect(page, 'Transactions should load with the expected title').toHaveTitle('Transactions');
});

test('Transactions - Header Controls Appear in the Same Order as the Dashboard', async ({ page }) => {
    await gotoTransactions(page);

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

test('Transactions - Filter Results Panel Is Present', async ({ page }) => {
    await gotoTransactions(page);

    await expect(page.locator(SELECTORS.filterPanel), 'Filter Results panel should be visible').toBeVisible();
    await expect(page.getByRole('heading', { name: 'Filter results' }), 'Filter Results heading should be visible').toBeVisible();

    for (const fieldId of FILTER_FIELD_IDS) {
        await expect(page.locator(`#${fieldId}`).first(), `Filter field "#${fieldId}" should be present`).toBeAttached();
    }
});

test('Filters - Invoice Number Updates Results Live As You Type', async ({ page }) => {
    await gotoTransactions(page);
    const defaultInvoiceNumbers = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
    // Confirmed 2026-09-18: don't assume row 0 is the non-blank one - this is live data and which
    // row sorts first can legitimately have a blank value in some column (see Driver Name below).
    const sampleInvoiceNumber = defaultInvoiceNumbers.find((value) => value);
    expect(sampleInvoiceNumber, 'Should be able to read a sample invoice number from the table').toBeTruthy();

    await test.step(`Type "${sampleInvoiceNumber}" one character at a time`, async () => {
        await typeSlowly(page, SELECTORS.invoiceNumberInput, sampleInvoiceNumber);
        await TABLE.waitForFilterToSettle(page);
    });

    await test.step('Every visible result should match what was typed', async () => {
        const invoiceNumbers = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
        expect(invoiceNumbers.length, `Filtering by "${sampleInvoiceNumber}" should return at least one result`).toBeGreaterThan(0);
        for (const invoiceNumber of invoiceNumbers) {
            expect(invoiceNumber, `"${invoiceNumber}" should contain the typed "${sampleInvoiceNumber}"`).toContain(sampleInvoiceNumber);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.invoiceNumberInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
        expect(restored, 'Clearing Invoice Number should restore the original unfiltered list').toEqual(defaultInvoiceNumbers);
    });
});

test('Filters - Card Number Updates Results Live As You Type', async ({ page }) => {
    await gotoTransactions(page);
    const defaultInvoiceNumbers = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
    const cardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
    // Same "don't assume row 0" fix as Invoice Number/Driver Name/Reg Number above.
    const sampleCardNumber = cardNumbers.find((value) => value);
    expect(sampleCardNumber, 'Should be able to read a sample card number from the table').toBeTruthy();

    await test.step(`Type "${sampleCardNumber}" one character at a time`, async () => {
        await typeSlowly(page, SELECTORS.cardNumberInput, sampleCardNumber);
        await TABLE.waitForFilterToSettle(page);
    });

    await test.step('Every visible result should match what was typed', async () => {
        const filteredCardNumbers = await TABLE.readColumn(page, COLUMN_INDEX.cardNumber);
        expect(filteredCardNumbers.length, `Filtering by "${sampleCardNumber}" should return at least one result`).toBeGreaterThan(0);
        for (const cardNumber of filteredCardNumbers) {
            expect(cardNumber, `"${cardNumber}" should contain the typed "${sampleCardNumber}"`).toContain(sampleCardNumber);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.cardNumberInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
        expect(restored, 'Clearing Card Number should restore the original unfiltered list').toEqual(defaultInvoiceNumbers);
    });
});

test('Filters - Date After Shows Results On or After That Date', async ({ page }) => {
    await gotoTransactions(page);
    const defaultInvoiceNumbers = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
    const dateAfter = new Date(2026, 7, 16); // 16/08/2026

    await test.step('Pick a "Date After"', async () => {
        await TABLE.pickCalendarDate(page, SELECTORS.dateAfterInput, 16, 8, 2026);
    });

    await test.step('Every visible result should be dated on or after that date', async () => {
        const dateTimes = await TABLE.readColumn(page, COLUMN_INDEX.dateTime);
        expect(dateTimes.length, 'Filtering by Date After 16/08/2026 should return at least one result').toBeGreaterThan(0);
        for (const dateTimeText of dateTimes) {
            const datePart = dateTimeText.split(',')[0].trim();
            expect(TABLE.parseUkDate(datePart).getTime(), `Row dated "${dateTimeText}" should be on or after 16/08/2026`).toBeGreaterThanOrEqual(dateAfter.getTime());
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.dateAfterInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
        expect(restored, 'Clearing Date After should restore the original unfiltered list').toEqual(defaultInvoiceNumbers);
    });
});

test('Filters - Date Before Shows Results On or Before That Date', async ({ page }) => {
    await gotoTransactions(page);
    const defaultInvoiceNumbers = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
    const dateBefore = new Date(2026, 7, 22); // 22/08/2026

    await test.step('Pick a "Date Before"', async () => {
        await TABLE.pickCalendarDate(page, SELECTORS.dateBeforeInput, 22, 8, 2026);
    });

    await test.step('Every visible result should be dated on or before that date', async () => {
        const dateTimes = await TABLE.readColumn(page, COLUMN_INDEX.dateTime);
        expect(dateTimes.length, 'Filtering by Date Before 22/08/2026 should return at least one result').toBeGreaterThan(0);
        for (const dateTimeText of dateTimes) {
            const datePart = dateTimeText.split(',')[0].trim();
            expect(TABLE.parseUkDate(datePart).getTime(), `Row dated "${dateTimeText}" should be on or before 22/08/2026`).toBeLessThanOrEqual(dateBefore.getTime());
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.dateBeforeInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
        expect(restored, 'Clearing Date Before should restore the original unfiltered list').toEqual(defaultInvoiceNumbers);
    });
});

test('Filters - Min Volume Narrows Results to That Volume or Above', async ({ page }) => {
    await gotoTransactions(page);
    const defaultInvoiceNumbers = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);

    await test.step('Type 50 into Min Volume', async () => {
        await page.fill(SELECTORS.minVolumeInput, '50');
        await TABLE.waitForFilterToSettle(page);
    });

    await test.step('Every visible result should have a Volume of 50 or more', async () => {
        const volumes = await TABLE.readColumn(page, COLUMN_INDEX.volume);
        expect(volumes.length, 'Filtering by Min Volume 50 should return at least one result').toBeGreaterThan(0);
        for (const volumeText of volumes) {
            expect(TABLE.parseCurrency(volumeText), `Row with Volume "${volumeText}" should be 50 or more`).toBeGreaterThanOrEqual(50);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.minVolumeInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
        expect(restored, 'Clearing Min Volume should restore the original unfiltered list').toEqual(defaultInvoiceNumbers);
    });
});

test('Filters - Max Volume Narrows Results to That Volume or Below', async ({ page }) => {
    await gotoTransactions(page);
    const defaultInvoiceNumbers = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);

    await test.step('Type 70 into Max Volume', async () => {
        await page.fill(SELECTORS.maxVolumeInput, '70');
        await TABLE.waitForFilterToSettle(page);
    });

    await test.step('Every visible result should have a Volume of 70 or less', async () => {
        const volumes = await TABLE.readColumn(page, COLUMN_INDEX.volume);
        expect(volumes.length, 'Filtering by Max Volume 70 should return at least one result').toBeGreaterThan(0);
        for (const volumeText of volumes) {
            expect(TABLE.parseCurrency(volumeText), `Row with Volume "${volumeText}" should be 70 or less`).toBeLessThanOrEqual(70);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.maxVolumeInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
        expect(restored, 'Clearing Max Volume should restore the original unfiltered list').toEqual(defaultInvoiceNumbers);
    });
});

test('Filters - Reg Number Updates Results Live As You Type', async ({ page }) => {
    await gotoTransactions(page);
    const defaultInvoiceNumbers = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
    const regNumbers = await TABLE.readColumn(page, COLUMN_INDEX.regNumber);
    // Same "don't assume row 0" fix as Invoice Number/Driver Name above.
    const sampleRegNumber = regNumbers.find((value) => value);
    expect(sampleRegNumber, 'Should be able to read a sample reg number from the table').toBeTruthy();

    await test.step(`Type "${sampleRegNumber}" one character at a time`, async () => {
        await typeSlowly(page, SELECTORS.regNumberInput, sampleRegNumber);
        await TABLE.waitForFilterToSettle(page);
    });

    await test.step('Every visible result should match what was typed', async () => {
        const filteredRegNumbers = await TABLE.readColumn(page, COLUMN_INDEX.regNumber);
        expect(filteredRegNumbers.length, `Filtering by "${sampleRegNumber}" should return at least one result`).toBeGreaterThan(0);
        for (const regNumber of filteredRegNumbers) {
            expect(regNumber, `"${regNumber}" should contain the typed "${sampleRegNumber}"`).toContain(sampleRegNumber);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.regNumberInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
        expect(restored, 'Clearing Reg Number should restore the original unfiltered list').toEqual(defaultInvoiceNumbers);
    });
});

test('Filters - Driver Name Updates Results Live As You Type', async ({ page }) => {
    await gotoTransactions(page);
    const defaultInvoiceNumbers = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
    const driverNames = await TABLE.readColumn(page, COLUMN_INDEX.driverName);
    // Confirmed 2026-09-18: row 0's Driver Name can legitimately be blank on this live account
    // (not every transaction row has a driver assigned) - find the first non-blank value instead
    // of assuming index 0. Same fix applied to the Invoice Number test above and to
    // 08-tfs.managecards.spec.js's equivalent filter tests.
    const sampleDriverName = driverNames.find((value) => value);
    expect(sampleDriverName, 'Should be able to read a sample driver name from the table').toBeTruthy();

    await test.step(`Type "${sampleDriverName}" one character at a time`, async () => {
        await typeSlowly(page, SELECTORS.driverNameInput, sampleDriverName);
        await TABLE.waitForFilterToSettle(page);
    });

    await test.step('Every visible result should match what was typed', async () => {
        const filteredDriverNames = await TABLE.readColumn(page, COLUMN_INDEX.driverName);
        expect(filteredDriverNames.length, `Filtering by "${sampleDriverName}" should return at least one result`).toBeGreaterThan(0);
        for (const driverName of filteredDriverNames) {
            expect(driverName, `"${driverName}" should contain the typed "${sampleDriverName}"`).toContain(sampleDriverName);
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.driverNameInput);
        const restored = await TABLE.readColumn(page, COLUMN_INDEX.invoiceNumber);
        expect(restored, 'Clearing Driver Name should restore the original unfiltered list').toEqual(defaultInvoiceNumbers);
    });
});

test('Transactions - History Table Shows Sort and Download Controls', async ({ page }) => {
    await gotoTransactions(page);

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

test('Transactions - Pagination Navigates Between Pages', async ({ page }) => {
    await gotoTransactions(page);
    await expect(page.locator(SELECTORS.pagination), 'Pagination should be visible').toBeVisible();

    await test.step('First and Previous are disabled on page 1', async () => {
        await expect(page.locator(SELECTORS.paginationInfo), 'Should start on page 1').toContainText('Page 1 of');
        await expect(page.locator(SELECTORS.firstPageButton), 'First page button should be disabled on page 1').toBeDisabled();
        await expect(page.locator(SELECTORS.prevPageButton), 'Previous page button should be disabled on page 1').toBeDisabled();
        await expect(page.locator(SELECTORS.nextPageButton), 'Next page button should be enabled on page 1').toBeEnabled();
        await expect(page.locator(SELECTORS.lastPageButton), 'Last page button should be enabled on page 1').toBeEnabled();
    });

    const totalPagesText = await page.locator(SELECTORS.paginationInfo).textContent();
    const totalPages = Number(totalPagesText.match(/of\s+(\d+)/)?.[1]);
    expect(totalPages, 'Should be able to read the total page count').toBeGreaterThan(1);

    await test.step('Next moves forward one page at a time', async () => {
        await page.click(SELECTORS.nextPageButton);
        await expect(page.locator(SELECTORS.paginationInfo), 'Clicking Next should move to page 2').toContainText('Page 2 of');
    });

    await test.step('Previous moves back one page at a time', async () => {
        await page.click(SELECTORS.prevPageButton);
        await expect(page.locator(SELECTORS.paginationInfo), 'Clicking Previous should move back to page 1').toContainText('Page 1 of');
    });

    // The numbered page-button list is only shown on desktop - confirmed on Account
    // Details/Invoices, same widget here.
    const pageNumbersVisible = await page.locator(SELECTORS.paginationPages).isVisible();

    if (pageNumbersVisible) {
        await test.step('Jumping directly to a page number works', async () => {
            await page.click(SELECTORS.pageButton(3));
            await expect(page.locator(SELECTORS.paginationInfo), 'Clicking page 3 should move to page 3').toContainText('Page 3 of');
            await expect(page.locator(SELECTORS.pageButton(3)), 'Page 3 should be marked as the active page').toHaveAttribute('aria-current', 'page');
        });

        await test.step('Ellipsis is shown between the visible page numbers and the last page', async () => {
            await expect(page.locator(SELECTORS.paginationDots).first(), 'An ellipsis should separate the nearby pages from the last page').toBeVisible();
        });
    }

    await test.step('Last page disables Next and Last, and enables First/Previous', async () => {
        await page.click(SELECTORS.lastPageButton);
        // Re-read the total rather than trusting the `totalPages` captured earlier - this is
        // real, live transaction data (see the Account Details/Invoices note on page-count
        // volatility). Asserting "Page N of N" (self-consistent right now) is reliable.
        await expect.poll(async () => {
            const currentInfo = await page.locator(SELECTORS.paginationInfo).textContent();
            const [, currentPage, currentTotal] = currentInfo.match(/Page\s+(\d+)\s+of\s+(\d+)/) || [];
            return currentPage === currentTotal;
        }, { message: 'Clicking Last page should land on the current final page ("Page N of N")' }).toBe(true);
        await expect(page.locator(SELECTORS.nextPageButton), 'Next page button should be disabled on the last page').toBeDisabled();
        await expect(page.locator(SELECTORS.lastPageButton), 'Last page button should be disabled on the last page').toBeDisabled();
        await expect(page.locator(SELECTORS.firstPageButton), 'First page button should be enabled on the last page').toBeEnabled();
        await expect(page.locator(SELECTORS.prevPageButton), 'Previous page button should be enabled on the last page').toBeEnabled();
    });

    await test.step('First page returns to the start', async () => {
        await page.click(SELECTORS.firstPageButton);
        await expect(page.locator(SELECTORS.paginationInfo), 'Clicking First page should return to page 1').toContainText('Page 1 of');
    });
});

test('Transactions - Download Button Exports the History as Excel', async ({ page }) => {
    await gotoTransactions(page);

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

for (const field of SORT_FIELDS) {
    const expectReorder = !FIELDS_WITH_NO_VISIBLE_REORDER.includes(field);

    test(`Transactions - Sorting By "${field}" Updates the Table`, async ({ page }) => {
        await gotoTransactions(page);
        const defaultOrder = await readInvoiceNumbers(page);

        await test.step(`Select "${field}" from the sort options`, async () => {
            await TABLE.openSortDropdown(page);
            await page.locator(SELECTORS.sortDropdown).getByRole('button', { name: field, exact: true }).click();
            await expect(page.locator(SELECTORS.sortToggleText), `Sort toggle should read "Sort by: ${field}"`).toHaveText(`Sort by: ${field}`);
        });

        const ascendingOrder = await readInvoiceNumbers(page);
        if (expectReorder) {
            expect(ascendingOrder, `Sorting by "${field}" should change the table's row order from the default view`).not.toEqual(defaultOrder);
        } else {
            expect(ascendingOrder, `Table should still show 10 rows after sorting by "${field}"`).toHaveLength(10);
        }

        await test.step('Switch the direction to descending', async () => {
            await TABLE.openSortDropdown(page);
            await page.click(SELECTORS.sortDescendingButton);
        });

        const descendingOrder = await readInvoiceNumbers(page);
        if (expectReorder) {
            expect(descendingOrder, `Switching "${field}" to descending should change the row order again`).not.toEqual(ascendingOrder);
        } else {
            expect(descendingOrder, `Table should still show 10 rows after switching "${field}" to descending`).toHaveLength(10);
        }
    });
}
