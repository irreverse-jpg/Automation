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
// Dashboard -> Invoices via the real sidebar link, rather than deep-linking straight to
// /portal/invoices, since that navigation itself is part of what's being verified.
//
// Same shared-session caveat as 02/03 applies: this file never switches accounts, so it isn't a
// source of risk, but a fully-parallel local run of the whole suite carries the documented
// residual chance of showing a different account's data than expected (see the shared-session
// note in 02-tfs.dashboard.spec.js). Prefer `npm run test:stable` for a fully reliable run.

// ============================================================================
// Coverage notes - Invoices ("/portal/invoices")
// ============================================================================
// Confirmed 2026-09-03: this page is the SAME History table widget as Account Details
// (03-tfs.accountdetails.spec.js) - identical columns, identical sort options, identical
// pagination, identical per-row PDF/Excel download links, and even the SAME underlying invoice
// data (same accounts, same rows). The only real differences from Account Details:
//   - No personal-details card (this page has no account-info-card at all).
//   - The Filter Results panel has only 4 fields here, not 8: Document No., Due Date, Start
//     Date, End Date - there is no Quantity or Total range filter on this page.
// Everything else (sort/pagination/download mechanics, the react-datepicker gotcha, the "Type"/
// "Quantity (Ltrs)" homogeneity finding, the live-data page-count volatility) comes straight from
// history-table-helpers.js - see 03-tfs.accountdetails.spec.js's header comment for the original
// discovery notes behind each of those, not repeated here.
//
// Tests in this file:
//   1. Invoices - Navigating from the Dashboard Sidebar Loads the Page
//   2. Invoices - Header Controls Appear in the Same Order as the Dashboard
//   3. Invoices - Filter Results Panel Is Present (all 4 fields)
//   4. Filters - Document No. Updates Results Live As You Type
//   5. Filters - Start Date Shows Results On or After That Date
//   6. Filters - Due Date Shows Results Matching That Exact Date
//   7. Filters - End Date Produces a Broad Result Set
//   8. Invoices - History Table Shows Sort and Download Controls
//   9. Invoices - Pagination Navigates Between Pages
//   10. Invoices - Download Button Exports the History as Excel
//   11. Filters - Actions Column Downloads Invoice as PDF or Excel (Sample of 5 Rows)
//   12. Invoices - Sorting By "<field>" Updates the Table (one test per sort field: Document No.,
//      Type, Due Date, Date, Transactions, Quantity (Ltrs), Total, Gross)
// ============================================================================

const INVOICES_PATH = '/portal/invoices';

// Page-specific selectors only - shared History table/filter-panel mechanics come from TABLE
// (history-table-helpers.js).
const SELECTORS = {
    ...TABLE.SELECTORS,
    filterPanel: '.filter-panel',
    documentNoInput: '#filter-ExternalDocumentRef',
    dueDateInput: '#filter-DueDate',
    startDateInput: '#filter-DocumentDate_start',
    endDateInput: '#filter-DocumentDate_end',
};

const FILTER_FIELD_IDS = ['filter-ExternalDocumentRef', 'filter-DueDate', 'filter-DocumentDate_start', 'filter-DocumentDate_end'];

async function gotoInvoices(page) {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await navigateViaSidebar(page, INVOICES_PATH, INVOICES_PATH);
    await expect(page.locator('h1'), 'Invoices should show its "Invoices" heading').toHaveText('Invoices');
}

test('Invoices - Navigating from the Dashboard Sidebar Loads the Page', async ({ page, baseURL }) => {
    await gotoInvoices(page);
    await expect(page, 'Invoices should load at /portal/invoices').toHaveURL(new URL(INVOICES_PATH, baseURL).toString());
    await expect(page, 'Invoices should load with the expected title').toHaveTitle('Invoices');
});

test('Invoices - Header Controls Appear in the Same Order as the Dashboard', async ({ page }) => {
    await gotoInvoices(page);

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

test('Invoices - Filter Results Panel Is Present', async ({ page }) => {
    await gotoInvoices(page);

    await expect(page.locator(SELECTORS.filterPanel), 'Filter Results panel should be visible').toBeVisible();
    await expect(page.getByRole('heading', { name: 'Filter results' }), 'Filter Results heading should be visible').toBeVisible();

    for (const fieldId of FILTER_FIELD_IDS) {
        await expect(page.locator(`#${fieldId}`), `Filter field "#${fieldId}" should be present`).toBeAttached();
    }
});

test('Filters - Document No. Updates Results Live As You Type', async ({ page }) => {
    await gotoInvoices(page);
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
    await gotoInvoices(page);
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
    await gotoInvoices(page);
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
    await gotoInvoices(page);
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

test('Invoices - History Table Shows Sort and Download Controls', async ({ page }) => {
    await gotoInvoices(page);

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

test('Invoices - Pagination Navigates Between Pages', async ({ page }) => {
    await gotoInvoices(page);
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

    // The numbered page-button list is only shown on desktop - confirmed on Account Details
    // 2026-09-02 it collapses to `display: none` on both tablet and mobile (a deliberate
    // responsive breakpoint, keeping only First/Previous/Next/Last on narrower screens), and the
    // same holds true here (same widget) - so these two checks are desktop-only.
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
        // real, live account with ongoing invoice activity, confirmed on Account Details
        // 2026-09-02 to occasionally change its page count even within the ~10s span of one test
        // run. Asserting "Page N of N" (self-consistent right now) is reliable; asserting
        // against an already-stale snapshot from earlier in the same test is not.
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

test('Invoices - Download Button Exports the History as Excel', async ({ page }) => {
    await gotoInvoices(page);

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
    await gotoInvoices(page);
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

    test(`Invoices - Sorting By "${field}" Updates the Table`, async ({ page }) => {
        await gotoInvoices(page);
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
