const { test, expect } = require('@playwright/test');
const { DASHBOARD_PATH } = require('./login-helpers');
const { HEADER_SELECTORS, SIDEBAR_SELECTORS, navigateViaSidebar, isBeforeInDom } = require('./portal-helpers');
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

// Relies on the project-wide authenticated storageState (see playwright.config.js /
// global-setup.js) - every test starts by navigating Dashboard -> Account Details via the real
// sidebar link, rather than deep-linking straight to /portal/account-details, since that
// navigation itself is part of what's being verified.
//
// Same shared-session caveat as 02-tfs.dashboard.spec.js applies here too: nothing in this file
// switches accounts, so it isn't at risk itself, but running it concurrently with a dashboard
// spec run that DOES switch accounts could show a different account's data than expected. Not
// worth serializing across files for this - only worth knowing if a "same name as the dropdown"
// assertion ever fails for no obvious reason. Prefer `npm run test:stable` for a fully reliable
// full-suite run.

// ============================================================================
// Coverage notes - Account Details ("/portal/account-details")
// ============================================================================
// Confirmed 2026-09-02: page structure, selectors, copy, and (where noted) quirks are IDENTICAL
// on QA and Live, and across desktop/tablet/mobile (same pattern as the Dashboard - see
// [[project_tfs]]). No environment or viewport branching needed anywhere in this file.
//
// This page is a template for every other menu page (Invoices, Transactions, Payments, ...) -
// same header/sidebar chrome, same Filter Results panel shape, same History table with
// sort/export/pagination (confirmed 2026-09-03 to be the exact same widget on Invoices too -
// same columns, same data). Shared header/sidebar selectors live in portal-helpers.js, and the
// History table/filter mechanics (sort, pagination, date-picker, column reading, currency/date
// parsing) live in history-table-helpers.js (imported here as `TABLE`) - both extracted
// specifically so future page specs (04-tfs.invoices.spec.js onward) reuse them instead of
// re-discovering this chrome/table each time. Only this page's OWN bits stay local: the
// personal-details card and its 4 extra filter fields (Quantity/Total ranges) that Invoices
// doesn't have.
//
// The Filter results panel's date fields are a real react-datepicker component - typing a date
// string into the input and pressing Enter/Escape visually shows the typed text but does NOT
// actually apply the filter; the ONLY way that genuinely applies a date filter is opening the
// calendar and clicking an actual day cell (see pickCalendarDate() in history-table-helpers.js).
// Clearing any filter field (date or text) is a plain `fill('')`, confirmed to correctly restore
// the full unfiltered list.
//
// Tests in this file:
//   1. Account Details - Navigating from the Dashboard Sidebar Loads the Page
//   2. Account Details - Header Controls Appear in the Same Order as the Dashboard
//      Confirms the dropdown, Log out button, and logo are all present AND in the same
//      left-to-right DOM order as the Dashboard (dropdown, then logout, then logo) - checked via
//      DOM position rather than pixel coordinates, so it holds regardless of how each viewport's
//      CSS reflows them.
//   3. Account Details - Personal Details Card Shows Account Info
//      Account name (matches whatever is currently selected in the header dropdown - not
//      hardcoded), address, account number, and the 3 icon rows (person/email/phone) - email
//      and phone both render "—" when not available on a given account, so both patterns accept
//      either a real value or that placeholder.
//   4. Account Details - Filter Results Panel Is Present
//      Presence-only pass (all 8 fields) - tests 5-10 below cover actual filtering behaviour.
//   5. Filters - Document No. Updates Results Live As You Type
//      Types a partial document number; every visible row's Document No. must contain it. The
//      exact match COUNT isn't asserted (a real, live account's exact invoice count/numbering
//      isn't a permanent contract) - only that the results genuinely reflect what was typed.
//   6. Filters - Start Date Shows Results On or After That Date
//      Every visible row's "Date" column must be on/after the picked date.
//   7. Filters - Due Date Shows Results Matching That Exact Date
//      Every visible row's "Due Date" column must equal the picked date exactly.
//   8. Filters - End Date Produces a Broad Result Set
//      Confirmed 2026-09-02: End Date used alone does not actually bound the "Date"/"Due Date"
//      columns to on-or-before that date (a row dated well after the picked End Date still
//      appeared) - this test only asserts what's reliably true (a substantial, non-empty result
//      set), matching the "lots of results" behaviour as observed, without asserting date-range
//      correctness this field doesn't currently deliver on its own.
//   9. Filters - Quantity Range Behaves As Currently Implemented (Known Limitation)
//      Confirmed 2026-09-02: EVERY invoice in this account's entire history has Quantity (Ltrs)
//      = 0 (same finding as the sort-by-Quantity test below) - so Min with any positive value
//      legitimately excludes everything (0 results), and Max with any non-negative value
//      legitimately includes everything (unfiltered). This test documents that exact behaviour
//      as a known limitation of the current data/feature rather than treating it as a defect to
//      chase - per instruction, simply asserted, not investigated further.
//   10. Filters - Total Range Filters Results by Value (Typed and Spinner Input)
//      Every visible row's Total must satisfy the Min/Max constraint, checked both via typing a
//      value directly and via the number input's spinner arrows (ArrowUp/ArrowDown). Row COUNT
//      alone is not proof of filtering here (this account has enough matching invoices to fill
//      a page either way) - the actual Total VALUES are checked against the threshold instead.
//   11. Account Details - History Table Shows Sort and Download Controls
//      Presence-only pass plus the Sort by toggle's open/close behaviour (its chevron gains/
//      loses a `--open` class and `aria-expanded` flips) - does NOT select a sort field or click
//      Download yet (those get their own dedicated tests below).
//   12. Account Details - Pagination Navigates Between Pages
//      First/Previous disabled on page 1, Next/Last disabled on the last page, single-step
//      Next/Previous, and jumping straight to a page number. The numbered page-button list
//      (`.pagination__pages`) is confirmed 2026-09-02 to be DESKTOP-ONLY - it collapses to
//      `display: none` on both tablet and mobile (a deliberate responsive breakpoint, keeping
//      only First/Previous/Next/Last on narrower screens) - so the "jump to page 3" and
//      "ellipsis" checks only run when that element is actually visible.
//   13. Account Details - Download Button Exports the History as Excel
//      Confirms a real `download` event fires with an .xlsx filename - the download is
//      cancelled immediately after, never saved to disk.
//   14. Filters - Actions Column Downloads Invoice as PDF or Excel (Sample of 5 Rows)
//      Each of the first 5 rows' two download links (`<a download>`, not a JS-triggered fetch
//      like the header Download button above) are clicked; a real `download` event with a
//      plausible filename is confirmed, then immediately cancelled - never saved to disk.
//   15. Account Details - Sorting By "<field>" Updates the Table (one test per sort field:
//      Document No., Type, Due Date, Date, Transactions, Quantity (Ltrs), Total, Gross)
//      Selects the field (ascending, the default direction) and confirms the table reloads
//      before reading it (selecting a field or flipping direction re-fetches the table
//      asynchronously - reading immediately can catch it mid-reload as an empty row set), then
//      switches to descending. For 6 of the 8 fields this asserts the row order genuinely
//      changes each time; "Type" and "Quantity (Ltrs)" are confirmed 2026-09-02 to be the exact
//      same value ("SalesInvoice" and "0") across this account's ENTIRE history, so sorting by
//      either cannot visibly reorder anything - those two only assert the table still renders
//      10 valid rows after the interaction, not that the order changed.
// ============================================================================

const ACCOUNT_DETAILS_PATH = '/portal/account-details';

// Page-specific selectors only - shared History table/filter-panel mechanics come from TABLE
// (history-table-helpers.js).
const SELECTORS = {
    ...TABLE.SELECTORS,
    accountName: '.account-info-card__header h2',
    accountAddress: '.account-info-card__address',
    accountNumber: '.account-info-card__number',
    detailRowValue: '.account-info-card__row span:nth-child(2)',
    filterPanel: '.filter-panel',
    documentNoInput: '#filter-ExternalDocumentRef',
    dueDateInput: '#filter-DueDate',
    startDateInput: '#filter-DocumentDate_start',
    endDateInput: '#filter-DocumentDate_end',
    quantityMinInput: '#filter-Quantity-min',
    quantityMaxInput: '#filter-Quantity-max',
    totalMinInput: '#filter-Total-min',
    totalMaxInput: '#filter-Total-max',
};

const FILTER_FIELD_IDS = [
    'filter-ExternalDocumentRef',
    'filter-DueDate',
    'filter-Quantity-min',
    'filter-Quantity-max',
    'filter-DocumentDate_start',
    'filter-DocumentDate_end',
    'filter-Total-min',
    'filter-Total-max',
];

const AVAILABLE_OR_PLACEHOLDER = /^(—|\S.*\S|\S)$/; // any non-empty value or the "—" placeholder

async function gotoAccountDetails(page) {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await navigateViaSidebar(page, ACCOUNT_DETAILS_PATH, ACCOUNT_DETAILS_PATH);
    await expect(page.locator('h1'), 'Account Details should show its "Account Details" heading').toHaveText('Account Details');
}

test('Account Details - Navigating from the Dashboard Sidebar Loads the Page', async ({ page, baseURL }) => {
    await gotoAccountDetails(page);
    await expect(page, 'Account Details should load at /portal/account-details').toHaveURL(new URL(ACCOUNT_DETAILS_PATH, baseURL).toString());
    await expect(page, 'Account Details should load with the expected title').toHaveTitle('Account Details');
});

test('Account Details - Header Controls Appear in the Same Order as the Dashboard', async ({ page }) => {
    await gotoAccountDetails(page);

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

test('Account Details - Personal Details Card Shows Account Info', async ({ page }) => {
    await gotoAccountDetails(page);
    const selectedAccountName = await page.locator(HEADER_SELECTORS.accountDropdownToggleText).textContent();

    await test.step('Account name matches the header dropdown selection', async () => {
        await expect(page.locator(SELECTORS.accountName), 'Account name on the card should match the header dropdown selection').toHaveText(selectedAccountName);
    });

    await test.step('Address and account number are shown', async () => {
        const address = (await page.locator(SELECTORS.accountAddress).textContent()).trim();
        expect(address.length, 'Account address should be a non-empty value').toBeGreaterThan(0);

        const number = (await page.locator(SELECTORS.accountNumber).textContent()).trim();
        expect(number, 'Account number should start with "#"').toMatch(/^#/);
    });

    await test.step('Person, email, and phone rows are shown (or "—" where not available)', async () => {
        const values = await page.locator(SELECTORS.detailRowValue).allTextContents();
        expect(values, 'Personal details card should show 3 rows (person/email/phone)').toHaveLength(3);
        for (const value of values) {
            expect(value.trim(), 'Each detail row should show a real value or the "—" placeholder').toMatch(AVAILABLE_OR_PLACEHOLDER);
        }
    });
});

test('Account Details - Filter Results Panel Is Present', async ({ page }) => {
    await gotoAccountDetails(page);

    await expect(page.locator(SELECTORS.filterPanel), 'Filter Results panel should be visible').toBeVisible();
    await expect(page.getByRole('heading', { name: 'Filter results' }), 'Filter Results heading should be visible').toBeVisible();

    for (const fieldId of FILTER_FIELD_IDS) {
        await expect(page.locator(`#${fieldId}`), `Filter field "#${fieldId}" should be present`).toBeAttached();
    }
});

test('Filters - Document No. Updates Results Live As You Type', async ({ page }) => {
    await gotoAccountDetails(page);
    const defaultDocumentNumbers = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);

    await test.step('Type a partial document number', async () => {
        await page.fill(SELECTORS.documentNoInput, 'IN101');
        await TABLE.waitForFilterToSettle(page);
    });

    await test.step('Every visible result should match what was typed', async () => {
        const documentNumbers = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);
        expect(documentNumbers.length, 'Filtering by "IN101" should return at least one result').toBeGreaterThan(0);
        for (const documentNo of documentNumbers) {
            expect(documentNo, `"${documentNo}" should contain the typed "IN101"`).toContain('IN101');
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.documentNoInput);
        const restored = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);
        expect(restored, 'Clearing Document No. should restore the original unfiltered list').toEqual(defaultDocumentNumbers);
    });
});

test('Filters - Start Date Shows Results On or After That Date', async ({ page }) => {
    await gotoAccountDetails(page);
    const defaultDocumentNumbers = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);
    const startDate = new Date(2026, 7, 3); // 03/08/2026

    await test.step('Pick a start date', async () => {
        await TABLE.pickCalendarDate(page, SELECTORS.startDateInput, 3, 8, 2026);
    });

    await test.step('Every visible result should be dated on or after the start date', async () => {
        const dates = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.date);
        expect(dates.length, 'Filtering by start date 03/08/2026 should return at least one result').toBeGreaterThan(0);
        for (const dateText of dates) {
            expect(TABLE.parseUkDate(dateText).getTime(), `Row dated "${dateText}" should be on or after 03/08/2026`).toBeGreaterThanOrEqual(startDate.getTime());
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.startDateInput);
        const restored = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);
        expect(restored, 'Clearing Start Date should restore the original unfiltered list').toEqual(defaultDocumentNumbers);
    });
});

test('Filters - Due Date Shows Results Matching That Exact Date', async ({ page }) => {
    await gotoAccountDetails(page);
    const defaultDocumentNumbers = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);

    await test.step('Pick a due date', async () => {
        await TABLE.pickCalendarDate(page, SELECTORS.dueDateInput, 11, 8, 2026);
    });

    await test.step('Every visible result should have exactly that due date', async () => {
        const dueDates = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.dueDate);
        expect(dueDates.length, 'Filtering by due date 11/08/2026 should return at least one result').toBeGreaterThan(0);
        for (const dueDate of dueDates) {
            expect(dueDate, `Row's Due Date should be exactly "11/08/2026"`).toBe('11/08/2026');
        }
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.dueDateInput);
        const restored = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);
        expect(restored, 'Clearing Due Date should restore the original unfiltered list').toEqual(defaultDocumentNumbers);
    });
});

test('Filters - End Date Produces a Broad Result Set', async ({ page }) => {
    await gotoAccountDetails(page);
    const defaultDocumentNumbers = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);

    await test.step('Pick an end date', async () => {
        await TABLE.pickCalendarDate(page, SELECTORS.endDateInput, 17, 8, 2026);
    });

    await test.step('A broad, non-empty result set should be shown', async () => {
        const documentNumbers = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);
        expect(documentNumbers.length, 'Filtering by end date 17/08/2026 should show a substantial number of results ("lots")').toBeGreaterThanOrEqual(5);
    });

    await test.step('Clearing the field restores the full list', async () => {
        await TABLE.clearFilter(page, SELECTORS.endDateInput);
        const restored = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);
        expect(restored, 'Clearing End Date should restore the original unfiltered list').toEqual(defaultDocumentNumbers);
    });
});

test('Filters - Quantity Range Behaves As Currently Implemented (Known Limitation)', async ({ page }) => {
    await gotoAccountDetails(page);
    const defaultDocumentNumbers = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);

    await test.step('Quantity Min with any value returns zero results', async () => {
        // Every invoice in this account's history has Quantity (Ltrs) = 0 (confirmed
        // 2026-09-02, same finding as the sort-by-Quantity test below) - a Min greater than 0
        // legitimately excludes everything under the current data/feature state.
        await page.fill(SELECTORS.quantityMinInput, '1');
        await TABLE.waitForFilterToSettle(page);
        await expect(page.locator(SELECTORS.tableRow), 'Quantity Min filter should currently return zero results').toHaveCount(0);
        await TABLE.clearFilter(page, SELECTORS.quantityMinInput);
    });

    await test.step('Quantity Max ignores its value and always shows the same results', async () => {
        await page.fill(SELECTORS.quantityMaxInput, '5');
        await TABLE.waitForFilterToSettle(page);
        const withSmallMax = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);

        await page.fill(SELECTORS.quantityMaxInput, '9999');
        await TABLE.waitForFilterToSettle(page);
        const withLargeMax = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);

        expect(withLargeMax, 'Quantity Max should currently produce the same results regardless of the value entered').toEqual(withSmallMax);
        expect(withLargeMax, 'Quantity Max should currently leave the list unfiltered').toEqual(defaultDocumentNumbers);

        await TABLE.clearFilter(page, SELECTORS.quantityMaxInput);
    });
});

test('Filters - Total Range Filters Results by Value (Typed and Spinner Input)', async ({ page }) => {
    await gotoAccountDetails(page);
    const defaultDocumentNumbers = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo);

    await test.step('Typing a Total Min value filters results at or above it', async () => {
        await page.fill(SELECTORS.totalMinInput, '100');
        await TABLE.waitForFilterToSettle(page);
        const totals = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.total);
        expect(totals.length, 'Filtering by Total Min 100 should return at least one result').toBeGreaterThan(0);
        for (const total of totals) {
            expect(TABLE.parseCurrency(total), `Row total "${total}" should be at least £100`).toBeGreaterThanOrEqual(100);
        }
        await TABLE.clearFilter(page, SELECTORS.totalMinInput);
        expect(await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo), 'Clearing Total Min should restore the unfiltered list').toEqual(defaultDocumentNumbers);
    });

    await test.step('Typing a Total Max value filters results at or below it', async () => {
        await page.fill(SELECTORS.totalMaxInput, '100');
        await TABLE.waitForFilterToSettle(page);
        const totals = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.total);
        expect(totals.length, 'Filtering by Total Max 100 should return at least one result').toBeGreaterThan(0);
        for (const total of totals) {
            expect(TABLE.parseCurrency(total), `Row total "${total}" should be at most £100`).toBeLessThanOrEqual(100);
        }
        await TABLE.clearFilter(page, SELECTORS.totalMaxInput);
        expect(await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo), 'Clearing Total Max should restore the unfiltered list').toEqual(defaultDocumentNumbers);
    });

    await test.step('The spinner arrows increment/decrement Total Min, and results follow', async () => {
        await page.locator(SELECTORS.totalMinInput).focus();
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await TABLE.waitForFilterToSettle(page);
        const value = await page.locator(SELECTORS.totalMinInput).inputValue();
        expect(Number(value), 'Pressing the up arrow twice from empty should set Total Min to 2').toBe(2);

        const totals = await TABLE.readColumn(page, TABLE.COLUMN_INDEX.total);
        for (const total of totals) {
            expect(TABLE.parseCurrency(total), `Row total "${total}" should be at least £${value} after using the spinner`).toBeGreaterThanOrEqual(Number(value));
        }

        await page.keyboard.press('ArrowDown');
        await TABLE.waitForFilterToSettle(page);
        expect(await page.locator(SELECTORS.totalMinInput).inputValue(), 'Pressing the down arrow should decrement Total Min back to 1').toBe('1');

        await TABLE.clearFilter(page, SELECTORS.totalMinInput);
        expect(await TABLE.readColumn(page, TABLE.COLUMN_INDEX.documentNo), 'Clearing Total Min should restore the unfiltered list').toEqual(defaultDocumentNumbers);
    });
});

test('Account Details - History Table Shows Sort and Download Controls', async ({ page }) => {
    await gotoAccountDetails(page);

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
        await expect(page.locator(SELECTORS.sortItem), 'Sort options should be listed').toHaveCount(TABLE.SORT_FIELDS.length);
    });

    await test.step('Clicking the toggle again collapses it back', async () => {
        await page.click(SELECTORS.sortToggle);

        await expect(page.locator(SELECTORS.sortToggle), 'Sort dropdown should report itself as closed again').toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator(SELECTORS.sortChevron), 'Sort chevron should flip back to its closed state').not.toHaveClass(/dropdown__chevron--open/);
    });
});

test('Account Details - Pagination Navigates Between Pages', async ({ page }) => {
    await gotoAccountDetails(page);
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

    // The numbered page-button list is only shown on desktop - confirmed 2026-09-02 it collapses
    // to `display: none` on both tablet and mobile (a deliberate responsive breakpoint, keeping
    // only First/Previous/Next/Last on narrower screens), so these two checks are desktop-only.
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
        // Re-read the total rather than trusting the `totalPages` captured earlier - this is a
        // real, live account with ongoing invoice activity, confirmed 2026-09-02 to occasionally
        // change its page count (17 -> 14) even within the ~10s span of one test run. Asserting
        // "Page N of N" (self-consistent right now) is reliable; asserting against an
        // already-stale snapshot from earlier in the same test is not.
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

test('Account Details - Download Button Exports the History as Excel', async ({ page }) => {
    await gotoAccountDetails(page);

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

test('Filters - Actions Column Downloads Invoice as PDF or Excel (Sample of 5 Rows)', async ({ page }) => {
    await gotoAccountDetails(page);
    const rows = page.locator(SELECTORS.tableRow);
    const sampleSize = Math.min(5, await rows.count());
    expect(sampleSize, 'History table should have at least 5 rows to sample').toBeGreaterThan(0);

    for (let i = 0; i < sampleSize; i++) {
        const row = rows.nth(i);
        const documentNo = (await row.locator('td').first().textContent()).trim();

        await test.step(`Row ${i + 1} ("${documentNo}"): Download as PDF`, async () => {
            const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
            await row.locator(SELECTORS.pdfDownloadLink).click();
            const download = await downloadPromise;
            expect(download.suggestedFilename(), `Row ${i + 1} PDF download should offer a .pdf file`).toMatch(/\.pdf$/i);
            await download.cancel().catch(() => { });
        });

        await test.step(`Row ${i + 1} ("${documentNo}"): Download as Excel`, async () => {
            const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
            await row.locator(SELECTORS.excelDownloadLink).click();
            const download = await downloadPromise;
            expect(download.suggestedFilename(), `Row ${i + 1} Excel download should offer a .xlsx file`).toMatch(/\.xlsx$/i);
            await download.cancel().catch(() => { });
        });
    }
});

for (const field of TABLE.SORT_FIELDS) {
    const expectReorder = !TABLE.FIELDS_WITH_NO_VISIBLE_REORDER.includes(field);

    test(`Account Details - Sorting By "${field}" Updates the Table`, async ({ page }) => {
        await gotoAccountDetails(page);
        const defaultOrder = await TABLE.readDocumentNumbers(page);

        await test.step(`Select "${field}" from the sort options`, async () => {
            await TABLE.openSortDropdown(page);
            // "Date" is a substring of "Due Date" - hasText would match both, so match the
            // option's accessible name exactly instead.
            await page.locator(SELECTORS.sortDropdown).getByRole('button', { name: field, exact: true }).click();
            await expect(page.locator(SELECTORS.sortToggleText), `Sort toggle should read "Sort by: ${field}"`).toHaveText(`Sort by: ${field}`);
        });

        const ascendingOrder = await TABLE.readDocumentNumbers(page);
        if (expectReorder) {
            expect(ascendingOrder, `Sorting by "${field}" should change the table's row order from the default view`).not.toEqual(defaultOrder);
        } else {
            expect(ascendingOrder, `Table should still show 10 rows after sorting by "${field}"`).toHaveLength(10);
        }

        await test.step('Switch the direction to descending', async () => {
            await TABLE.openSortDropdown(page);
            await page.click(SELECTORS.sortDescendingButton);
        });

        const descendingOrder = await TABLE.readDocumentNumbers(page);
        if (expectReorder) {
            expect(descendingOrder, `Switching "${field}" to descending should change the row order again`).not.toEqual(ascendingOrder);
        } else {
            expect(descendingOrder, `Table should still show 10 rows after switching "${field}" to descending`).toHaveLength(10);
        }
    });
}
