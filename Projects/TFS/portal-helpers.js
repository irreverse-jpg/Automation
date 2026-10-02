const { expect } = require('@playwright/test');

// Shared selectors/helpers for the header + sidebar chrome common to every page inside the
// portal ("/portal/*") - confirmed 2026-09-02 identical markup/behaviour across every portal
// page (Dashboard, Account Details, ...) and across desktop/tablet/mobile (only CSS positioning
// differs between viewports, never the DOM itself - see 02-tfs.dashboard.spec.js
// for the original confirmation on the Dashboard). New page specs (03+) should import from here
// rather than redefining these selectors - 02-tfs.dashboard.spec.js predates this file and keeps
// its own copies rather than being refactored, to avoid touching already-verified test code.

// Scoped under ".header" - pages with their own dropdown (e.g. Account Details' "Sort by")
// would otherwise strict-mode-violate on the bare, unscoped class names.
const HEADER_SELECTORS = {
    accountDropdownToggle: '.header .dropdown__toggle',
    accountDropdownToggleText: '.header .dropdown__toggle-text',
    accountDropdownItem: '.header .dropdown__item',
    accountDropdownSelectedItem: '.header .dropdown__item--selected',
    logoutButton: 'button.logout',
    logo: 'a.logo',
};

const SIDEBAR_SELECTORS = {
    sidebar: 'aside.sidebar',
    sidebarToggle: '.sidebar__toggle',
    sidebarNavLabel: '.sidebar__navLabel',
    sidebarNavLink: (href) => `a.sidebar__navLink[href="${href}"]`,
};

async function isSidebarCollapsed(page) {
    const classAttr = await page.locator(SIDEBAR_SELECTORS.sidebar).getAttribute('class');
    return (classAttr || '').split(/\s+/).includes('collapsed');
}

// Navigates from wherever the page currently is to another portal page via its sidebar link -
// opens the sidebar first if it's currently collapsed (tablet/mobile default), since the nav
// links aren't clickable while hidden behind the hamburger toggle.
async function navigateViaSidebar(page, href, expectedPath) {
    if (await isSidebarCollapsed(page)) {
        await page.click(SIDEBAR_SELECTORS.sidebarToggle);
    }
    await page.click(SIDEBAR_SELECTORS.sidebarNavLink(href));
    await page.waitForURL((url) => url.pathname === expectedPath, { timeout: 20000 });
    await page.waitForLoadState('load').catch(() => { });
    await page.waitForLoadState('networkidle').catch(() => { });
}

// True if `selectorA`'s element appears before `selectorB`'s in the DOM - a layout-independent
// way to check "position" (dropdown, then logout, then logo) that holds regardless of how
// responsive CSS reflows/wraps them visually per viewport.
async function isBeforeInDom(page, selectorA, selectorB) {
    return page.evaluate(([selA, selB]) => {
        const a = document.querySelector(selA);
        const b = document.querySelector(selB);
        if (!a || !b) return null;
        return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, [selectorA, selectorB]);
}

// Switches the header's account dropdown to a different account - extracted here 2026-09-18
// while building 07-tfs.payments.spec.js, since 02-tfs.dashboard.spec.js already has its own
// (identical) copy - a genuine 2nd real occurrence, not a hypothetical future one (same pattern
// as history-table-helpers.js's extraction). 02-tfs.dashboard.spec.js keeps its own copy rather
// than being refactored, to avoid touching already-verified test code. Waits for network idle
// after switching, same as navigateViaSidebar() - switching accounts can retrigger a page's own
// async widgets (e.g. Dashboard's conditional "pending transactions" alert), which can still be
// reflowing the page after the click resolves.
async function selectAccount(page, accountName) {
    await page.click(HEADER_SELECTORS.accountDropdownToggle);
    await page.locator(HEADER_SELECTORS.accountDropdownItem, { hasText: accountName }).click();
    await expect(page.locator(HEADER_SELECTORS.accountDropdownToggleText), `Header label should update to "${accountName}"`).toHaveText(accountName);
    await page.waitForLoadState('networkidle').catch(() => { });
}

module.exports = { HEADER_SELECTORS, SIDEBAR_SELECTORS, isSidebarCollapsed, navigateViaSidebar, isBeforeInDom, selectAccount };
