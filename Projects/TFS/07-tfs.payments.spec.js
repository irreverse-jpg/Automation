const { test, expect } = require('@playwright/test');
const { DASHBOARD_PATH } = require('./login-helpers');
const { HEADER_SELECTORS, navigateViaSidebar, isBeforeInDom, selectAccount } = require('./portal-helpers');
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
// Dashboard -> Payments via the real sidebar link, then switches to "AUCTUS MANAGEMENT GROUP
// LTD" per Hector's explicit instruction, since the default account's payment history is too
// thin to exercise pagination/filtering meaningfully and AUCTUS's isn't (confirmed 14 pages).
//
// Same shared-session caveat as every other spec in this project applies, PLUS this file itself
// switches accounts on EVERY test (unlike 03/04/06, where it's incidental to one test) - see the
// shared-session note in 02-tfs.dashboard.spec.js. Prefer `npm run test:stable` (`--workers=1`)
// for a fully reliable run.
//
// Confirmed 2026-09-18: because every test here leaves the server-side session on a non-default
// account, running this file left that account selected for whichever spec/project happened to
// run next - a real cross-file contamination bug caught by re-running 03/04/06/07 together after
// building this file (several unrelated Transactions filter/sort/pagination tests failed on a
// later project's pass, all traceable to "wrong account still selected" once investigated). Fixed
// with a file-level `afterAll` that switches back to the default account once this file's tests
// finish in a given project - `page`/`context` aren't available in `afterAll` (they're
// test-scoped), so it opens its own short-lived context via the `browser` fixture instead.
const DEFAULT_ACCOUNT_NAME = 'THE FUEL STORE (2ND ACCCOUNT)'; // same value as 02's constant

test.afterAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext({ storageState: testInfo.project.use.storageState, baseURL: testInfo.project.use.baseURL });
    const page = await context.newPage();
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await selectAccount(page, DEFAULT_ACCOUNT_NAME);
    await context.close();
});

// ============================================================================
// Coverage notes - Payments ("/portal/payments")
// ============================================================================
// Same History table + Filter panel widget family as Account Details/Invoices/Transactions, but
// its own small 4-column layout (Date, Type, Status, Total) and 3 filter fields (Status, Date,
// Type). No personal-details card, no per-row PDF/Excel download links - only the header's single
// "Download" button. Confirmed 2026-09-18: "Type" and "Status" are blank for every row on the
// AUCTUS account across all 14 pages sampled - so, like Transactions' "Cost Center", sorting by
// either can't visibly reorder anything (a "did it still work" check instead), and FILTERING by
// either genuinely returns 0 results for any non-blank value typed (confirmed with "Paid" and
// "Card" - both real, sensible values a person might type, both legitimately match nothing since
// the underlying data has nothing in those columns). The "Date" filter (`#filter-PostingDate`, a
// real react-datepicker) is a genuine "on or before" (<=) filter here - confirmed by picking
// 13/03/2024 and getting exactly the 3 rows dated on or before it (21/02, 28/02, 13/03) - a
// cleaner, fully-working equivalent of Invoices' "End Date alone doesn't bound results" quirk.
//
// **Make Payment - confirmed to reflect whichever account is currently selected, per Hector's
// specific ask:** clicking "Make payment" (`.payments__make-payment-btn`) opens a real external
// payment gateway (`thefuelstore.mysecurepay(-int)?.co.uk`, same domain as the Dashboard's Make
// Payment) in a new tab, pre-filled with a "The Fuel Store account number" field
// (`input[name="ReferenceList[0].Value"]` - confirmed duplicated in the DOM, same non-unique-id
// pattern as Transactions' Min/Max Volume and the Site Locator's third-party tabs, so this spec
// always targets `.first()`) that genuinely differs per account - confirmed AUCTUS and HILL HOUSE
// SCHOOL LIMITED show two different 6-digit numbers. The spec asserts the two numbers differ
// rather than hardcoding either literal value, since an account reference number - while more
// stable than live financial data - still isn't something worth pinning a test to. Per Hector's
// explicit instruction, no further testing happens inside the payment gateway itself - both tabs
// are opened only long enough to read the account number field, then closed.
//
// Tests in this file:
//   1. Payments - Navigating from the Dashboard Sidebar Loads the Page
//   2. Payments - Header Controls Appear in the Same Order as the Dashboard
//   3. Payments - Selecting AUCTUS Management Group Ltd Shows a Large Payment History
//   4. Payments - Filter Results Panel Is Present (all 3 fields)
//   5. Filters - Status Returns No Results for a Value Not Present in the Data
//   6. Filters - Type Returns No Results for a Value Not Present in the Data
//   7. Filters - Date Shows Results On or Before That Date
//   8. Payments - History Table Shows Sort and Download Controls
//   9. Payments - Pagination Navigates Between Pages
//   10. Payments - Download Button Exports the History as Excel
//   11. Payments - Make Payment Reflects the Currently Selected Account's Reference Number
//   12. Payments - Sorting By "<field>" Updates the Table (one test per sort field: Date, Type,
//      Status, Total)
// ============================================================================

const PAYMENTS_PATH = '/portal/payments';
const LARGE_HISTORY_ACCOUNT = 'AUCTUS MANAGEMENT GROUP LTD';
const SECOND_ACCOUNT = 'HILL HOUSE SCHOOL LIMITED';

// Page-specific selectors only - shared History table/filter-panel mechanics come from TABLE
// (history-table-helpers.js).
const SELECTORS = {
    ...TABLE.SELECTORS,
    filterPanel: '.filter-panel',
    statusInput: '#filter-Status',
    dateInput: '#filter-PostingDate',
    typeInput: '#filter-Type',
    makePaymentButton: '.payments__make-payment-btn',
    // Confirmed duplicated in the payment gateway's DOM (non-unique id/name, same class of bug
    // as Transactions' Min/Max Volume) - always target the first occurrence.
    gatewayAccountNumberInput: 'input[name="ReferenceList[0].Value"] >> nth=0',
};

const FILTER_FIELD_IDS = ['filter-Status', 'filter-PostingDate', 'filter-Type'];

const SORT_FIELDS = ['Date', 'Type', 'Status', 'Total'];
const FIELDS_WITH_NO_VISIBLE_REORDER = ['Type', 'Status'];
// The table's own default (un-sorted) view happens to already be Date-ascending - confirmed
// 2026-09-18 (intermittently reproducible depending on the account's current data) that
// re-selecting "Date" ascending from the sort dropdown can therefore legitimately produce the
// EXACT SAME row order as the default view, which isn't proof the control does nothing - it's
// proof the control correctly reproduces what's already showing. Skip the "ascending differs from
// default" check for this field only; the "descending differs from ascending" check right after it
// still proves the control has a real effect.
const FIELDS_MATCHING_DEFAULT_ORDER = ['Date'];

const COLUMN_INDEX = {
    date: 0,
    type: 1,
    status: 2,
    total: 3,
};

async function gotoPayments(page) {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await navigateViaSidebar(page, PAYMENTS_PATH, PAYMENTS_PATH);
    await expect(page.locator('h1'), 'Payments should show its "Payments" heading').toHaveText('Payments');
    await selectAccount(page, LARGE_HISTORY_ACCOUNT);
}

// Selecting a sort field or flipping direction re-fetches the table - reading immediately can
// catch it mid-reload (an empty row set), same class of bug documented in
// 06-tfs.transactions.spec.js. Wait for a row to actually be visible before reading.
async function readDates(page) {
    await expect(page.locator(SELECTORS.tableRow).first(), 'History table should have rows after a sort/reload').toBeVisible();
    return TABLE.readColumn(page, COLUMN_INDEX.date);
}

test('Payments - Navigating from the Dashboard Sidebar Loads the Page', async ({ page, baseURL }) => {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await navigateViaSidebar(page, PAYMENTS_PATH, PAYMENTS_PATH);
    await expect(page, 'Payments should load at /portal/payments').toHaveURL(new URL(PAYMENTS_PATH, baseURL).toString());
    await expect(page, 'Payments should load with the expected title').toHaveTitle('Payments');
});

test('Payments - Header Controls Appear in the Same Order as the Dashboard', async ({ page }) => {
    await gotoPayments(page);

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

test('Payments - Selecting AUCTUS Management Group Ltd Shows a Large Payment History', async ({ page }) => {
    await gotoPayments(page);

    await expect(page.locator(HEADER_SELECTORS.accountDropdownToggleText), 'Header should show the selected account').toHaveText(LARGE_HISTORY_ACCOUNT);

    const paginationText = await page.locator(SELECTORS.paginationInfo).textContent();
    const totalPages = Number(paginationText.match(/of\s+(\d+)/)?.[1]);
    expect(totalPages, 'AUCTUS Management Group Ltd should have a large, multi-page payment history').toBeGreaterThan(5);
});

test('Payments - Filter Results Panel Is Present', async ({ page }) => {
    await gotoPayments(page);

    await expect(page.locator(SELECTORS.filterPanel), 'Filter Results panel should be visible').toBeVisible();
    await expect(page.getByRole('heading', { name: 'Filter results' }), 'Filter Results heading should be visible').toBeVisible();

    for (const fieldId of FILTER_FIELD_IDS) {
        await expect(page.locator(`#${fieldId}`), `Filter field "#${fieldId}" should be present`).toBeAttached();
    }
});

test('Filters - Status Returns No Results for a Value Not Present in the Data', async ({ page }) => {
    await gotoPayments(page);

    await test.step('Type a plausible status that this account never has', async () => {
        await page.locator(SELECTORS.statusInput).pressSequentially('Paid', { delay: 80 });
        await TABLE.waitForFilterToSettle(page);
    });

    await test.step('No results should be shown, since Status is blank for every payment on this account', async () => {
        const dates = await TABLE.readColumn(page, COLUMN_INDEX.date);
        expect(dates, 'Filtering Status by "Paid" should return no results (Status is blank on every row)').toHaveLength(0);
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.statusInput);
        await expect(page.locator(SELECTORS.tableRow).first(), 'Clearing Status should restore the unfiltered list').toBeVisible();
    });
});

test('Filters - Type Returns No Results for a Value Not Present in the Data', async ({ page }) => {
    await gotoPayments(page);

    await test.step('Type a plausible payment type that this account never has', async () => {
        await page.locator(SELECTORS.typeInput).pressSequentially('Card', { delay: 80 });
        await TABLE.waitForFilterToSettle(page);
    });

    await test.step('No results should be shown, since Type is blank for every payment on this account', async () => {
        const dates = await TABLE.readColumn(page, COLUMN_INDEX.date);
        expect(dates, 'Filtering Type by "Card" should return no results (Type is blank on every row)').toHaveLength(0);
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.typeInput);
        await expect(page.locator(SELECTORS.tableRow).first(), 'Clearing Type should restore the unfiltered list').toBeVisible();
    });
});

test('Filters - Date Shows Results On or Before That Date', async ({ page }) => {
    await gotoPayments(page);
    const cutoff = new Date(2024, 2, 13); // 13/03/2024

    await test.step('Pick a date', async () => {
        await TABLE.pickCalendarDate(page, SELECTORS.dateInput, 13, 3, 2024);
    });

    await test.step('Every visible result should be dated on or before that date', async () => {
        const dates = await TABLE.readColumn(page, COLUMN_INDEX.date);
        expect(dates.length, 'Filtering by 13/03/2024 should return at least one result').toBeGreaterThan(0);
        for (const dateText of dates) {
            expect(TABLE.parseUkDate(dateText).getTime(), `Row dated "${dateText}" should be on or before 13/03/2024`).toBeLessThanOrEqual(cutoff.getTime());
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.dateInput);
        const paginationText = await page.locator(SELECTORS.paginationInfo).textContent();
        expect(paginationText, 'Clearing Date should restore the full, multi-page payment history').toMatch(/Page 1 of ([2-9]|\d{2,})/);
    });
});

test('Payments - History Table Shows Sort and Download Controls', async ({ page }) => {
    await gotoPayments(page);

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

test('Payments - Pagination Navigates Between Pages', async ({ page }) => {
    await gotoPayments(page);
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

    // The numbered page-button list is only shown on desktop - confirmed on every other History
    // table page in this project, same widget here.
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

test('Payments - Download Button Exports the History as Excel', async ({ page }) => {
    await gotoPayments(page);

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

test('Payments - Make Payment Reflects the Currently Selected Account\'s Reference Number', async ({ page, context }) => {
    await gotoPayments(page);

    const auctusAccountNumber = await test.step(`Click "Make payment" while ${LARGE_HISTORY_ACCOUNT} is selected`, async () => {
        const popupPromise = context.waitForEvent('page', { timeout: 10000 });
        await page.click(SELECTORS.makePaymentButton);
        const popup = await popupPromise;
        // waitForURL's predicate receives a URL object, not a string (see 02-tfs.dashboard.spec.js).
        await popup.waitForURL((url) => url.href !== 'about:blank', { timeout: 20000 });
        expect(popup.url(), 'Make payment should open the fuel store payment gateway').toMatch(/^https:\/\/thefuelstore\.mysecurepay(-int)?\.co\.uk\//);
        const accountNumber = await popup.locator(SELECTORS.gatewayAccountNumberInput).inputValue();
        expect(accountNumber, 'The Fuel Store account number should be pre-filled on the payment gateway').toBeTruthy();
        // Per Hector's instruction, no further testing inside the gateway itself.
        await popup.close();
        return accountNumber;
    });

    const hillHouseAccountNumber = await test.step(`Switch to ${SECOND_ACCOUNT} and click "Make payment" again`, async () => {
        await selectAccount(page, SECOND_ACCOUNT);
        const popupPromise = context.waitForEvent('page', { timeout: 10000 });
        await page.click(SELECTORS.makePaymentButton);
        const popup = await popupPromise;
        await popup.waitForURL((url) => url.href !== 'about:blank', { timeout: 20000 });
        const accountNumber = await popup.locator(SELECTORS.gatewayAccountNumberInput).inputValue();
        expect(accountNumber, 'The Fuel Store account number should be pre-filled on the payment gateway').toBeTruthy();
        await popup.close();
        return accountNumber;
    });

    expect(hillHouseAccountNumber, `The Fuel Store account number should differ between "${LARGE_HISTORY_ACCOUNT}" and "${SECOND_ACCOUNT}"`).not.toBe(auctusAccountNumber);

    // Restore the default account immediately - the account selection is server-side, shared
    // state (see the header comment), so leaving it on SECOND_ACCOUNT would otherwise leak into
    // whichever spec/project runs next.
    await selectAccount(page, DEFAULT_ACCOUNT_NAME);
});

for (const field of SORT_FIELDS) {
    const expectReorder = !FIELDS_WITH_NO_VISIBLE_REORDER.includes(field);

    test(`Payments - Sorting By "${field}" Updates the Table`, async ({ page }) => {
        await gotoPayments(page);
        const defaultOrder = await readDates(page);

        await test.step(`Select "${field}" from the sort options`, async () => {
            await TABLE.openSortDropdown(page);
            await page.locator(SELECTORS.sortDropdown).getByRole('button', { name: field, exact: true }).click();
            await expect(page.locator(SELECTORS.sortToggleText), `Sort toggle should read "Sort by: ${field}"`).toHaveText(`Sort by: ${field}`);
        });

        const ascendingOrder = await readDates(page);
        if (expectReorder && !FIELDS_MATCHING_DEFAULT_ORDER.includes(field)) {
            expect(ascendingOrder, `Sorting by "${field}" should change the table's row order from the default view`).not.toEqual(defaultOrder);
        } else if (!expectReorder) {
            expect(ascendingOrder, `Table should still show 10 rows after sorting by "${field}"`).toHaveLength(10);
        }

        await test.step('Switch the direction to descending', async () => {
            await TABLE.openSortDropdown(page);
            await page.click(SELECTORS.sortDescendingButton);
        });

        const descendingOrder = await readDates(page);
        if (expectReorder) {
            expect(descendingOrder, `Switching "${field}" to descending should change the row order again`).not.toEqual(ascendingOrder);
        } else {
            expect(descendingOrder, `Table should still show 10 rows after switching "${field}" to descending`).toHaveLength(10);
        }
    });
}
