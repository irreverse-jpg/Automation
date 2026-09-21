const { expect } = require('@playwright/test');

// Shared selectors/helpers for the "History" data table + "Filter results" panel pattern used
// on Account Details AND Invoices (confirmed 2026-09-03 to be byte-for-byte the same widget -
// same columns, same sort options, same pagination, same per-row PDF/Excel download links, same
// underlying invoice data) - and expected to recur on Transactions/Payments too. Extracted here
// so those future page specs don't have to re-derive this logic, and a fix only needs to happen
// once. See 03-tfs.accountdetails.spec.js for the original discovery notes (reflow/timing quirks,
// react-datepicker behaviour, etc.) - this file only holds the mechanics, not the narrative.

const SELECTORS = {
    dataTable: '.data-table',
    sortDropdown: '.data-table__sort-dropdown',
    sortToggle: '.data-table__sort-dropdown .dropdown__toggle',
    sortToggleText: '.data-table__sort-dropdown .dropdown__toggle-text',
    sortChevron: '.data-table__sort-dropdown .dropdown__chevron',
    sortItem: '.data-table__sort-dropdown .dropdown__item',
    sortDescendingButton: '.data-table__sort-dropdown button[aria-label="Descending"]',
    sortAscendingButton: '.data-table__sort-dropdown button[aria-label="Ascending"]',
    exportButton: '.data-table__export-button',
    tableRow: '.data-table__tbody .data-table__tr',
    pagination: '.pagination',
    paginationInfo: '.pagination__info',
    paginationPages: '.pagination__pages',
    paginationDots: '.pagination__dots',
    firstPageButton: 'button[aria-label="First page"]',
    prevPageButton: 'button[aria-label="Previous page"]',
    nextPageButton: 'button[aria-label="Next page"]',
    lastPageButton: 'button[aria-label="Last page"]',
    pageButton: (n) => `button[aria-label="Page ${n}"]`,
    datepickerMonth: '.datepicker-header__month',
    datepickerPrevMonth: 'button[aria-label="Previous month"]',
    datepickerNextMonth: 'button[aria-label="Next month"]',
    datepickerDay: '.react-datepicker__day:not(.react-datepicker__day--outside-month)',
    pdfDownloadLink: 'a[aria-label="Download Invoice as PDF"]',
    excelDownloadLink: 'a[aria-label="Download Invoice Transactions as Excel"]',
};

const SORT_FIELDS = ['Document No.', 'Type', 'Due Date', 'Date', 'Transactions', 'Quantity (Ltrs)', 'Total', 'Gross'];

// "Type" and "Quantity (Ltrs)" are confirmed 2026-09-02/03 to be the SAME value ("SalesInvoice"
// and "0" respectively) across this account's ENTIRE invoice history, on both the Account
// Details and Invoices tables (same underlying data) - sorting/filtering by either genuinely
// cannot change/narrow the visible rows.
const FIELDS_WITH_NO_VISIBLE_REORDER = ['Type', 'Quantity (Ltrs)'];

const COLUMN_INDEX = {
    documentNo: 0,
    dueDate: 2,
    date: 3,
    total: 6,
};

const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

async function openSortDropdown(page) {
    const toggle = page.locator(SELECTORS.sortToggle);
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
        await toggle.click();
    }
    await expect(toggle, 'Sort dropdown should report itself as open').toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(SELECTORS.sortChevron), 'Sort chevron should show its "open" state').toHaveClass(/dropdown__chevron--open/);
}

async function readDocumentNumbers(page) {
    // Selecting a sort field or flipping direction re-fetches the table - reading immediately
    // can catch it mid-reload (an empty row set), so wait for rows to actually be present first.
    await expect(page.locator(SELECTORS.tableRow).first(), 'History table should have rows after a sort/reload').toBeVisible();
    return readColumn(page, COLUMN_INDEX.documentNo);
}

async function readColumn(page, columnIndex) {
    return page.evaluate(({ rowSelector, columnIndex }) => {
        return Array.from(document.querySelectorAll(rowSelector)).map((row) => row.querySelectorAll('td')[columnIndex]?.textContent.trim() || '');
    }, { rowSelector: SELECTORS.tableRow, columnIndex });
}

async function waitForFilterToSettle(page) {
    // Filter fields re-fetch the table live as you type/pick - give the debounce + request a
    // moment, then wait for network activity to actually finish before reading results.
    await page.waitForTimeout(400);
    await page.waitForLoadState('networkidle').catch(() => { });
}

function parseUkDate(value) {
    const [day, month, year] = value.split('/').map((part) => Number(part.trim()));
    return new Date(year, month - 1, day);
}

function parseCurrency(value) {
    return Number(value.replace(/[£,]/g, ''));
}

// The date fields are a real react-datepicker calendar - typing text into the input visually
// updates it but does NOT apply the filter (confirmed 2026-09-02). Only clicking an actual day
// cell in the opened calendar genuinely applies it.
async function pickCalendarDate(page, fieldSelector, day, month, year) {
    await page.click(fieldSelector);
    const targetLabel = `${MONTH_NAMES[month - 1]} ${year}`;

    // Navigates by comparing actual month/year values (not a blind one-directional click loop) -
    // confirmed 2026-09-18 while building 08-tfs.managecards.spec.js that a Previous-month-only
    // loop can never reach a FUTURE target month (Manage Cards' card Expiry dates run 2027-2030,
    // ahead of "today" - unlike every other date field used with this helper so far, which was in
    // the past). Also confirmed 2026-09-18 with 07-tfs.payments.spec.js that a fixed guard count
    // isn't safe either: it silently settles on the wrong month once exhausted, picking a real day
    // there instead of failing loudly. This version clicks the correct direction and keeps going
    // until the label matches, with a guard generous enough (120) to cover many years either way -
    // a genuinely bad target label still fails fast via the day-cell locator not matching.
    for (let guard = 0; guard < 120; guard++) {
        const currentLabel = await page.locator(SELECTORS.datepickerMonth).textContent();
        if (currentLabel.includes(targetLabel)) break;
        const [currentMonthName, currentYearText] = currentLabel.trim().split(/\s+/);
        const currentIndex = Number(currentYearText) * 12 + MONTH_NAMES.indexOf(currentMonthName);
        const targetIndex = year * 12 + (month - 1);
        await page.click(currentIndex > targetIndex ? SELECTORS.datepickerPrevMonth : SELECTORS.datepickerNextMonth);
        await page.waitForTimeout(100);
    }

    await page.locator(SELECTORS.datepickerDay, { hasText: new RegExp(`^${day}$`) }).click();
    await waitForFilterToSettle(page);
}

async function clearFilter(page, fieldSelector) {
    await page.fill(fieldSelector, '');
    await waitForFilterToSettle(page);
}

module.exports = {
    SELECTORS,
    SORT_FIELDS,
    FIELDS_WITH_NO_VISIBLE_REORDER,
    COLUMN_INDEX,
    openSortDropdown,
    readDocumentNumbers,
    readColumn,
    waitForFilterToSettle,
    parseUkDate,
    parseCurrency,
    pickCalendarDate,
    clearFilter,
};
