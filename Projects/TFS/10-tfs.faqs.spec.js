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

// ============================================================================
// Coverage notes - FAQs ("/portal/faq")
// ============================================================================
// A static content page (no History table here, same family as 09-tfs.additionalservices.spec.js)
// listing 12 standard Bootstrap accordion items (`.accordion-item`/`.accordion-button`). Confirmed
// 2026-09-21: FAQs and Dashboard are the only two pages in this portal whose <title> also carries
// the "| The Fuel Store" suffix ("FAQs | The Fuel Store") - every other page's title so far has
// been just its own name (e.g. "Invoices", "Payments") with no suffix. While auditing this, found
// `02-tfs.dashboard.spec.js` was the one existing spec in this project missing a `toHaveTitle()`
// check entirely (every other page spec already had one) - added it there too
// ("Dashboard | The Fuel Store"), per Hector's instruction to backfill this on any prior spec that
// didn't already have it.
//
// The chevron Hector describes is a pure CSS artifact (likely a rotated `::after` pseudo-element
// on `.accordion-button`, standard Bootstrap accordion styling) - there's no actual `<svg>`/icon
// element in the DOM to inspect, so its state is verified the same way Bootstrap itself tracks it:
// the button's own `aria-expanded` attribute (and the presence/absence of its `collapsed` CSS
// class). Confirmed genuinely single-open-at-a-time: clicking any collapsed item's button expands
// it and automatically collapses whichever OTHER item was open, matching Hector's description
// exactly - verified after each click that exactly one button reports `aria-expanded="true"` and
// every other one reports `"false"`. Going top to bottom exercises this mutual-exclusivity for
// every adjacent pair. After the last item, there's no "next" click to auto-collapse it, so the
// test explicitly clicks it a second time to close it again and leave the page in its original
// all-collapsed state, per Hector's instruction.
//
// Tests in this file:
//   1. FAQs - Navigating from the Dashboard Sidebar Loads the Page
//   2. FAQs - Header Controls Appear in the Same Order as the Dashboard
//   3. FAQs - Accordions Expand One at a Time, Top to Bottom, and Collapse Automatically
// ============================================================================

const FAQS_PATH = '/portal/faq';

const SELECTORS = {
    accordionItem: '.accordion-item',
    accordionButton: '.accordion-button',
};

async function gotoFaqs(page) {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await navigateViaSidebar(page, FAQS_PATH, FAQS_PATH);
    await expect(page.locator('h1'), 'FAQs should show its "FAQs" heading').toHaveText('FAQs');
}

async function readExpandedStates(page) {
    return page.evaluate((buttonSelector) => {
        return Array.from(document.querySelectorAll(buttonSelector)).map((button) => button.getAttribute('aria-expanded') === 'true');
    }, SELECTORS.accordionButton);
}

test('FAQs - Navigating from the Dashboard Sidebar Loads the Page', async ({ page, baseURL }) => {
    await gotoFaqs(page);
    await expect(page, 'FAQs should load at /portal/faq').toHaveURL(new URL(FAQS_PATH, baseURL).toString());
    // Confirmed 2026-09-21: FAQs and Dashboard are the only two pages whose title carries the
    // "| The Fuel Store" suffix - every other page's title is just its own name.
    await expect(page, 'FAQs should load with the expected title').toHaveTitle('FAQs | The Fuel Store');
});

test('FAQs - Header Controls Appear in the Same Order as the Dashboard', async ({ page }) => {
    await gotoFaqs(page);

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

test('FAQs - Accordions Expand One at a Time, Top to Bottom, and Collapse Automatically', async ({ page }) => {
    await gotoFaqs(page);
    const buttons = page.locator(SELECTORS.accordionButton);
    const itemCount = await page.locator(SELECTORS.accordionItem).count();
    expect(itemCount, 'FAQs should have accordion items to expand').toBeGreaterThan(0);

    await test.step('All accordions should start collapsed', async () => {
        const initialStates = await readExpandedStates(page);
        expect(initialStates.every((isExpanded) => !isExpanded), 'Every accordion should start collapsed').toBe(true);
    });

    for (let index = 0; index < itemCount; index++) {
        await test.step(`Expanding item ${index + 1} of ${itemCount} collapses whichever other item was open`, async () => {
            await buttons.nth(index).click();

            const states = await readExpandedStates(page);
            expect(states[index], `Item ${index + 1} should report itself as expanded`).toBe(true);

            const otherStates = states.filter((_, otherIndex) => otherIndex !== index);
            expect(otherStates.every((isExpanded) => !isExpanded), `Every other accordion should be collapsed while item ${index + 1} is open`).toBe(true);
        });
    }

    await test.step('Collapsing the last item manually returns the page to fully collapsed', async () => {
        await buttons.nth(itemCount - 1).click();
        const finalStates = await readExpandedStates(page);
        expect(finalStates.every((isExpanded) => !isExpanded), 'Every accordion should be collapsed again after closing the last one').toBe(true);
    });
});
