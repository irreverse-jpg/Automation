const { test, expect } = require('@playwright/test');
const { DASHBOARD_PATH } = require('./login-helpers');

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

// This whole spec relies on the project-wide authenticated storageState (see
// playwright.config.js / global-setup.js) - no login steps needed, every test opens straight
// at the dashboard.
//
// IMPORTANT - account selection is SERVER-SIDE session state, and it is NOT possible to isolate
// a test from it, even with a fresh login. Confirmed 2026-09-02 by comparing cookies directly:
// logging in with these credentials from a completely separate, unrelated browser context
// (no shared storage at all) produces the exact same `.AspNetCore.Identity.Application`/
// `.AspNetCore.Session` cookie VALUE as any other login. TFS's login issues one canonical,
// per-USER session - not a distinct one per sign-in - so every test using these credentials,
// in any context, in any project, in any spec file, is unavoidably the SAME server-side session.
// (An earlier attempt at fixing this by logging the account-switching tests into their own
// "isolated" context did not work, for exactly this reason - reverted.)
//
// Practical consequence: "Switching Accounts..." and "Selecting Different Accounts..." below
// mutate account selection for every other test currently relying on the default account,
// including ones in OTHER spec files (confirmed 2026-09-02: caused
// 03-tfs.accountdetails.spec.js to read "DAVETESTING2"/"AUCTUS MANAGEMENT GROUP LTD" instead of
// the default mid-run). `test.describe.configure({ mode: 'serial' })` below only protects tests
// within the SAME project's run of THIS file - desktop/tablet/mobile still run as separate
// workers against the identical shared session, and other spec files run as their own workers
// too, so a residual cross-file/cross-project race is unavoidable with only one set of
// credentials to test with.
//
// CI is NOT at risk (playwright.config.js sets `workers: 1`, so nothing ever runs concurrently
// there). For a fully reliable LOCAL run of the full suite, use `npx playwright test
// --workers=1`. A fully-parallel local run (the default) can occasionally show an unrelated
// test reading the wrong account for no obvious reason - re-run before treating that as a real
// defect, and prefer `--workers=1` when reliability matters more than speed.
test.describe.configure({ mode: 'serial' });

// Confirmed 2026-09-22: a genuine, reproducible bug in the account-switching tests' own
// restore-to-default step - during a full 11-spec regression run, the account dropdown toggle
// stayed genuinely DISABLED (the app's own loading-state indicator, not a Playwright actionability
// false start) for the full 30s test timeout on mobile-chromium specifically, so
// selectAccount(page, DEFAULT_ACCOUNT_NAME) never completed and the account was left on
// "JAMAL SARFRAZ" (one of the 5 accounts this test cycles through) for the rest of the run. That
// single failure cascaded into 37 further failures across 03/04/06 on that same project (wrong
// account = wrong personal details, wrong filter/sort results, wrong pagination) - a real,
// high-blast-radius risk given this file's account-switching tests run FIRST in file order. Fixed
// with the same safety-net pattern already used in 07-tfs.payments.spec.js: a file-level
// `afterAll` that makes its own attempt to restore the default account regardless of whether the
// in-test restore succeeded - `page`/`context` aren't available in `afterAll` (they're
// test-scoped), so it opens its own short-lived context via the `browser` fixture instead. This is
// a genuine defect in the app itself (a control shouldn't stay disabled indefinitely) as much as a
// test-robustness gap - documented here rather than silently worked around, in case it's worth
// raising with the team if it keeps recurring.
test.afterAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext({ storageState: testInfo.project.use.storageState, baseURL: testInfo.project.use.baseURL });
    const page = await context.newPage();
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await selectAccount(page, DEFAULT_ACCOUNT_NAME).catch(() => { });
    await context.close();
});

// ============================================================================
// Coverage notes - the portal Dashboard ("/portal/")
// ============================================================================
// Confirmed 2026-09-01. The header, sidebar, and card/chart markup is IDENTICAL across
// desktop/tablet/mobile - there is no separate mobile layout to special-case, only CSS
// positioning differs, and the sidebar's default state (expanded on desktop, collapsed on
// tablet/mobile - both confirmed) is read live rather than assumed, so every test here runs
// unmodified on all 3 device projects.
//
// Two confirmed QA vs Live differences, both handled without branching in the tests below:
//   - Make Payment's gateway domain is `mysecurepay-int.co.uk` on QA vs `mysecurepay.co.uk` on
//     Live (an "-int"/internal suffix) - matched with a regex that accepts either.
//   - Clicking the header logo goes to the domain root on both, but the root itself differs:
//     QA's root re-serves the Dashboard (its portal lives at the domain root), Live's root is
//     the public marketing homepage (its portal is a subsection under /portal). Only the URL is
//     asserted, not page content, so this doesn't need branching either.
//
// Tests in this file:
//   1. Dashboard - Loads After Login With Header Controls Visible
//      URL/title/H1, plus the account dropdown (preselected "THE FUEL STORE (2ND ACCCOUNT)"),
//      Log out button, and logo are all present.
//   2. Dashboard - Logo Links Back to the Base URL
//   3. Dashboard - Account Dropdown Lists Accounts With the Current One Selected
//      Opens the dropdown, confirms all 10 known accounts are listed (confirmed 2026-09-01 -
//      the same 10 real test accounts exist on both QA and Live) and the one matching the
//      header label is marked `.dropdown__item--selected`.
//   4. Dashboard - Switching Accounts Updates the Selected Account and Chart Data
//      Switches to "DAVETESTING2" (a real, always-present test account confirmed identical on
//      QA and Live), confirms the header label and selected-item highlight both update, and
//      confirms the documented "blank" data behaviour for this account - the Month to Date
//      chart reads £0.00 for every sampled point. Restores the default account afterwards (see
//      the shared-session note above).
//   5. Dashboard - Selecting Different Accounts Updates the Summary Cards and Charts
//      Cycles through 5 of the 10 accounts (starting and ending on the default, so it's
//      self-restoring), confirming the 6 summary cards genuinely update for each account and
//      that the Monthly Spend & Usage chart re-renders a valid tooltip each time. Compares the
//      full 6-card fingerprint (not just balance alone) against the previous account rather than
//      hardcoding exact figures, since these are live financial values that drift over time -
//      confirmed 2026-09-02 that a single card (balance) can coincidentally collide between two
//      accounts by the time this runs later, even though a one-off survey found all 10 balances
//      unique at that moment; comparing the whole set makes an all-6-coincidentally-equal false
//      failure vanishingly unlikely. The chart's tooltip VALUE is deliberately not compared
//      account-to-account - several sampled accounts are low-activity enough to genuinely read
//      £0.00 for the same early months as each other (confirmed 2026-09-01), so an inequality
//      assertion there would fail on perfectly correct behaviour.
//   6. Dashboard - Sidebar Menu Can Be Collapsed and Expanded via the Hamburger Toggle
//      Reads whatever the current state actually is rather than assuming expanded/collapsed,
//      so it works whether the sidebar started expanded (desktop) or collapsed (tablet/mobile).
//   7. Dashboard - Six Summary Cards Are Shown With a Hover State
//      Confirms all 6 cards, in order, with a plausible value for their kind (currency/Ltrs/
//      count - values are live account data and change over time, so exact amounts are never
//      asserted), a genuine hover state (a real computed box-shadow/transform change, not just
//      a CSS class check), and the "+ Make Payment" control inside the balance card.
//   8. Dashboard - Make Payment Opens the Payment Gateway in a New Tab
//   9. Dashboard - Charts Show Data When Hovered
//      Both charts (Month to Date Spend & Usage, Monthly Spend & Usage) are Recharts bar
//      charts - hovering/moving over a bar reveals a tooltip. Confirms the tooltip's label
//      matches the chart's own axis (a plain day number for Month to Date, a 3-letter month
//      abbreviation for Monthly) and its value line matches a real currency amount.
//   10. Dashboard - Charts Can Switch Between Total (£) and Quantity (Ltrs) Views
//      Both charts default to the "total (£)" tab; clicking "quantity (ltrs)" changes the
//      active tab and the tooltip's value line switches from a "£" amount to a "Ltrs" amount.
//
// Two flakiness sources found and fixed while building this file (both explained inline at
// their fix site) - worth knowing before touching chart or popup interactions here again:
//   - A conditional "pending transactions" alert above the charts can still be mounting or
//     unmounting (its own async check) after the page's "load" event fires, shifting the charts
//     ~176px - reading element positions too early sends the mouse to stale coordinates. Fixed
//     by waiting for network idle in gotoDashboard()/selectAccount() before measuring anything.
//   - page.waitForURL()'s predicate receives a URL object, not a string - comparing it to a
//     string directly (`url !== 'about:blank'`) is always true regardless of the real URL. Use
//     `url.href` (see the Make Payment test).
// ============================================================================

const SELECTORS = {
    accountDropdownToggle: '.dropdown__toggle',
    accountDropdownToggleText: '.dropdown__toggle-text',
    accountDropdownItem: '.dropdown__item',
    accountDropdownSelectedItem: '.dropdown__item--selected',
    logoutButton: 'button.logout',
    logo: 'a.logo',
    sidebar: 'aside.sidebar',
    sidebarToggle: '.sidebar__toggle',
    sidebarNavLabel: '.sidebar__navLabel',
    statusCard: '.card.card--status',
    makePaymentButton: 'button.card__action',
};

const DEFAULT_ACCOUNT_NAME = 'THE FUEL STORE (2ND ACCCOUNT)';
const BLANK_DATA_ACCOUNT_NAME = 'DAVETESTING2';

// The dropdown's full account list - confirmed 2026-09-01 to be exactly these 10, identical on
// both QA and Live (same underlying test accounts on both environments).
const ALL_ACCOUNT_NAMES = [
    'FOSTER PROPERTY MAINTENANCE',
    DEFAULT_ACCOUNT_NAME,
    'AUCTUS MANAGEMENT GROUP LTD',
    BLANK_DATA_ACCOUNT_NAME,
    'DAV TESTING TEL AGAIN',
    'HILL HOUSE SCHOOL LIMITED',
    'M P L GROUNDWORK & BUILDING LTD',
    'A & S PLANT CONSTRUCTION AND LAND DRAINAGE LTD',
    'JAMAL SARFRAZ',
    'ABDUL HAYE HAYE',
];

// A sample of 5 accounts (out of the 10) confirmed to each carry a genuinely distinct "balance
// on account" figure - used to verify switching accounts actually changes the dashboard's data,
// not just its label. Starts and ends on the default account so the test is self-restoring.
const ACCOUNT_SAMPLE_FOR_DATA_CHECK = [
    DEFAULT_ACCOUNT_NAME,
    'FOSTER PROPERTY MAINTENANCE',
    'AUCTUS MANAGEMENT GROUP LTD',
    'HILL HOUSE SCHOOL LIMITED',
    'JAMAL SARFRAZ',
    DEFAULT_ACCOUNT_NAME,
];

// Balance can legitimately go negative (an overdrawn/credit account) - confirmed 2026-09-01 on
// the default account itself ("-£12.03") - so its pattern allows an optional leading "-". Spend
// figures represent actual transaction totals and are not expected to go negative.
const EXPECTED_CARDS = [
    { label: 'total spend this week', valuePattern: /^£[\d,]+\.\d{2}$/ },
    { label: 'litres of diesel this week', valuePattern: /^[\d,.]+\s*Ltrs$/i },
    { label: 'last four weeks spend', valuePattern: /^£[\d,]+\.\d{2}$/ },
    { label: 'active fuel cards', valuePattern: /^\d+$/ },
    { label: 'cards on order', valuePattern: /^\d+$/ },
    { label: 'balance on account', valuePattern: /^-?£[\d,]+\.\d{2}$/ },
];

const CHARTS = [
    { id: '#monthToDateChart', name: 'Month to Date Spend & Usage', labelPattern: /^\d{1,2}$/ },
    { id: '#monthlyChart', name: 'Monthly Spend & Usage', labelPattern: /^[A-Z][a-z]{2}$/ },
];

async function gotoDashboard(page) {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await expect(page.locator('h1'), 'Dashboard should show its "Dashboard" heading').toHaveText('Dashboard');
    // The account dropdown briefly shows a "Select account" placeholder (~200ms) before its
    // real label loads - wait it out here so every test below reads the settled value.
    await expect(page.locator(SELECTORS.accountDropdownToggleText), 'Account dropdown should resolve past its loading placeholder').not.toHaveText('Select account');
    // A conditional "pending transactions" alert above the charts (shown/hidden per account via
    // its own async check, /api/v1/actor/is-prepay) can still be mounting or unmounting after
    // the page's "load" event fires, shifting the charts below it by ~176px mid-test - confirmed
    // 2026-09-01 as the cause of intermittent chart-hover failures (a bounding box read during
    // that window looks locally "stable" but isn't the final position). Waiting for network idle
    // here ensures that check has resolved before any test measures element positions.
    await page.waitForLoadState('networkidle').catch(() => { });
}

async function isSidebarCollapsed(page) {
    const classAttr = await page.locator(SELECTORS.sidebar).getAttribute('class');
    return (classAttr || '').split(/\s+/).includes('collapsed');
}

async function selectAccount(page, accountName) {
    await page.click(SELECTORS.accountDropdownToggle);
    await page.locator(SELECTORS.accountDropdownItem, { hasText: accountName }).click();
    await expect(page.locator(SELECTORS.accountDropdownToggleText), `Header label should update to "${accountName}"`).toHaveText(accountName);
    // Same conditional alert reflow race as gotoDashboard() - switching accounts re-triggers its
    // async check for the new account.
    await page.waitForLoadState('networkidle').catch(() => { });
}

async function boundingBoxWhenStable(locator) {
    // A conditional widget above the charts (a "pending transactions" alert, shown/hidden per
    // account type) can mount/unmount just after the page loads or after switching accounts,
    // shifting everything below it down - reading the box once, too early, sends the mouse to
    // stale coordinates that later belong to empty space. Read it twice, a beat apart, and
    // retry until two consecutive reads agree.
    let previous = null;
    for (let attempt = 0; attempt < 10; attempt++) {
        const current = await locator.boundingBox();
        if (previous && current && previous.y === current.y && previous.x === current.x) {
            return current;
        }
        previous = current;
        await locator.page().waitForTimeout(150);
    }
    return previous;
}

async function isTooltipVisible(tooltip) {
    return expect(tooltip).toHaveCSS('visibility', 'visible', { timeout: 600 }).then(() => true).catch(() => false);
}

async function readTooltip(tooltip) {
    const lines = (await tooltip.innerText()).split('\n').map((line) => line.trim()).filter(Boolean);
    return { label: lines[0], value: lines[lines.length - 1] };
}

// The Month to Date chart's x-axis is sparse (real day-of-month numbers, e.g. 1, 2, 3 ... 29,
// 31 - not every integer), so a single fixed x fraction can land in a gap between bars with
// nothing to hover, which reads as "no tooltip" rather than a real defect. Scans across the
// chart until it lands on an actual bar instead of trusting one fixed point.
async function sampleChartTooltips(page, chart, { count = 1, fy = 0.6 } = {}) {
    const wrapper = chart.locator('.recharts-wrapper');
    // Coordinates from boundingBox() are only meaningful once the element is actually within the
    // viewport - both charts sit well below the fold on tablet/mobile, so without this the mouse
    // move silently lands outside the visible area and the tooltip never appears.
    await wrapper.scrollIntoViewIfNeeded();
    const box = await boundingBoxWhenStable(wrapper);
    const tooltip = chart.locator('.recharts-tooltip-wrapper');
    const samples = [];

    for (let i = 1; i <= 19 && samples.length < count; i++) {
        const fx = i / 20;
        await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
        if (!(await isTooltipVisible(tooltip))) continue;
        samples.push({ fx, ...(await readTooltip(tooltip)) });
    }

    if (samples.length < count) {
        throw new Error(`Chart tooltip only appeared at ${samples.length}/${count} sampled point(s) across the chart`);
    }
    return samples;
}

test('Dashboard - Loads After Login With Header Controls Visible', async ({ page, baseURL }) => {
    await test.step('Open the dashboard', async () => {
        await gotoDashboard(page);
        await expect(page, 'Dashboard should load at /portal/').toHaveURL(new URL(DASHBOARD_PATH, baseURL).toString());
        // Confirmed 2026-09-21: Dashboard and FAQs are the only two pages in this portal whose
        // <title> also carries the "| The Fuel Store" suffix - every other page's title is just
        // its own name (e.g. "Invoices", "Payments"). Not environment-specific.
        await expect(page, 'Dashboard should load with the expected title').toHaveTitle('Dashboard | The Fuel Store');
    });

    await test.step('Account dropdown shows the default account preselected', async () => {
        await expect(page.locator(SELECTORS.accountDropdownToggleText), 'Account dropdown should preselect the default account').toHaveText(DEFAULT_ACCOUNT_NAME);
    });

    await test.step('Log out control is visible', async () => {
        await expect(page.getByRole('button', { name: 'Log out' }), 'Log out button (power icon) should be visible').toBeVisible();
    });

    await test.step('Logo is visible', async () => {
        await expect(page.locator(SELECTORS.logo), 'Fuel Store logo should be visible').toBeVisible();
    });
});

test('Dashboard - Logo Links Back to the Base URL', async ({ page, baseURL }) => {
    await gotoDashboard(page);

    await test.step('Click the logo', async () => {
        await page.click(SELECTORS.logo);
    });

    await test.step('Should navigate to the domain root', async () => {
        await expect(page, 'Logo should link back to the base URL').toHaveURL(new URL('/', baseURL).toString());
    });
});

test('Dashboard - Account Dropdown Lists Accounts With the Current One Selected', async ({ page }) => {
    await gotoDashboard(page);
    const currentAccount = await page.locator(SELECTORS.accountDropdownToggleText).textContent();

    await test.step('Open the dropdown', async () => {
        await expect(page.locator(SELECTORS.accountDropdownToggle), 'Dropdown should start closed').toHaveAttribute('aria-expanded', 'false');
        await page.click(SELECTORS.accountDropdownToggle);
        await expect(page.locator(SELECTORS.accountDropdownToggle), 'Dropdown should report itself as open').toHaveAttribute('aria-expanded', 'true');
    });

    await test.step('All 10 accounts should be listed', async () => {
        const names = (await page.locator(SELECTORS.accountDropdownItem).allTextContents()).map((name) => name.trim());
        expect(names, 'Account dropdown should list all 10 known accounts').toEqual(expect.arrayContaining(ALL_ACCOUNT_NAMES));
        expect(names, 'Account dropdown should list exactly 10 accounts').toHaveLength(10);
    });

    await test.step('Current account should be marked as selected', async () => {
        await expect(page.locator(SELECTORS.accountDropdownSelectedItem), 'Currently active account should be highlighted as selected').toHaveText(currentAccount);
    });
});

test('Dashboard - Switching Accounts Updates the Selected Account and Chart Data', async ({ page }) => {
    await gotoDashboard(page);

    await test.step(`Switch to "${BLANK_DATA_ACCOUNT_NAME}"`, async () => {
        await selectAccount(page, BLANK_DATA_ACCOUNT_NAME);
    });

    await test.step('Newly selected account should be marked as selected when reopening the dropdown', async () => {
        await page.click(SELECTORS.accountDropdownToggle);
        await expect(page.locator(SELECTORS.accountDropdownSelectedItem), `"${BLANK_DATA_ACCOUNT_NAME}" should be highlighted as the selected account`).toHaveText(BLANK_DATA_ACCOUNT_NAME);
        await page.click(SELECTORS.accountDropdownToggle);
    });

    await test.step('Month to Date chart should show no spend for this account', async () => {
        const chart = page.locator('#monthToDateChart');
        const samples = await sampleChartTooltips(page, chart, { count: 3 });
        for (const { value } of samples) {
            expect(value, `"${BLANK_DATA_ACCOUNT_NAME}" should show £0.00 spend across the Month to Date chart`).toBe('Total (£) : £0.00');
        }
    });

    await test.step('Restore the default account', async () => {
        await selectAccount(page, DEFAULT_ACCOUNT_NAME);
    });
});

test('Dashboard - Selecting Different Accounts Updates the Summary Cards and Charts', async ({ page }) => {
    // This test cycles 5 accounts, each a real network round-trip - confirmed 2026-09-22 the
    // default 30s budget is genuinely tight even in the healthy case (22-25s observed) and can be
    // exceeded outright if the account dropdown's own disabled-while-loading state runs long on a
    // given account switch (see the file-level `afterAll` safety-net above for why a single
    // exceeded timeout here previously cascaded into many unrelated failures downstream).
    test.setTimeout(60000);
    await gotoDashboard(page);

    let previousFingerprint = null;

    for (const accountName of ACCOUNT_SAMPLE_FOR_DATA_CHECK) {
        await test.step(`Switch to "${accountName}"`, async () => {
            await selectAccount(page, accountName);

            const balance = (await page
                .locator(SELECTORS.statusCard)
                .filter({ hasText: 'balance on account' })
                .locator('.card__value')
                .textContent()).trim();
            expect(balance, `"${accountName}" should show a valid balance figure`).toMatch(/^-?£[\d,]+\.\d{2}$/);

            // Compare ALL 6 card values together, not just balance alone - balances are live
            // financial data that drifts over time (confirmed 2026-09-02: a balance that was
            // unique in an earlier survey can coincidentally match another account's by the
            // time this runs later), so a single-figure fingerprint isn't permanently
            // reliable. Two different accounts having their entire 6-value card set collide
            // simultaneously is vanishingly unlikely, making this a much more durable check.
            const fingerprint = await page.locator(SELECTORS.statusCard).locator('.card__value').allTextContents();
            if (previousFingerprint !== null) {
                expect(fingerprint, `Switching to "${accountName}" should show different card data than the previous account`).not.toEqual(previousFingerprint);
            }
            previousFingerprint = fingerprint;

            // The Monthly chart itself is NOT compared value-for-value against the previous
            // account: several of the sampled accounts are low-activity and genuinely read
            // £0.00 across most/all of the same early months (confirmed 2026-09-01, e.g. "HILL
            // HOUSE SCHOOL LIMITED" and "JAMAL SARFRAZ" both showed 4 consecutive £0.00 months) -
            // asserting inequality there would be asserting something that isn't actually true
            // of the app. Confirming the chart re-renders a genuinely valid, freshly-fetched
            // tooltip for the new account is the meaningful, reliable check here.
            const [{ value }] = await sampleChartTooltips(page, page.locator('#monthlyChart'));
            expect(value, `"${accountName}"'s Monthly Spend & Usage chart should show a valid amount`).toMatch(/^Total \(£\) : £[\d,]+\.\d{2}$/);
        });
    }

    await test.step('Restore the default account', async () => {
        await selectAccount(page, DEFAULT_ACCOUNT_NAME);
    });
});

test('Dashboard - Sidebar Menu Can Be Collapsed and Expanded via the Hamburger Toggle', async ({ page }) => {
    await gotoDashboard(page);
    const initiallyCollapsed = await isSidebarCollapsed(page);
    const dashboardLabel = page.locator(SELECTORS.sidebarNavLabel, { hasText: 'Dashboard' });

    await test.step('Clicking the toggle should flip the sidebar state', async () => {
        await page.click(SELECTORS.sidebarToggle);
        await expect.poll(() => isSidebarCollapsed(page), {
            message: 'Clicking the hamburger toggle should flip the sidebar between expanded/collapsed',
        }).toBe(!initiallyCollapsed);

        if (await isSidebarCollapsed(page)) {
            await expect(dashboardLabel, 'Nav labels should be hidden while the sidebar is collapsed').toBeHidden();
        } else {
            await expect(dashboardLabel, 'Nav labels should be visible while the sidebar is expanded').toBeVisible();
        }
    });

    await test.step('Clicking it again should flip it back', async () => {
        await page.click(SELECTORS.sidebarToggle);
        await expect.poll(() => isSidebarCollapsed(page), {
            message: 'Clicking the hamburger toggle a second time should restore the original state',
        }).toBe(initiallyCollapsed);
    });
});

test('Dashboard - Six Summary Cards Are Shown With a Hover State', async ({ page }) => {
    await gotoDashboard(page);
    const cards = page.locator(SELECTORS.statusCard);
    await expect(cards, 'Dashboard should show exactly 6 summary cards').toHaveCount(6);

    for (let i = 0; i < EXPECTED_CARDS.length; i++) {
        const expected = EXPECTED_CARDS[i];
        const card = cards.nth(i);

        await test.step(`Card ${i + 1}: "${expected.label}"`, async () => {
            await expect(card.locator('.card__label'), `Card ${i + 1} should be "${expected.label}"`).toHaveText(new RegExp(`^${expected.label}$`, 'i'));

            const value = (await card.locator('.card__value').textContent()).trim();
            expect(value, `Card "${expected.label}" should show a value matching its expected format`).toMatch(expected.valuePattern);

            const before = await card.evaluate((el) => getComputedStyle(el).boxShadow);
            await card.hover();
            const after = await card.evaluate((el) => getComputedStyle(el).boxShadow);
            expect(after, `Hovering the "${expected.label}" card should visibly change its appearance`).not.toBe(before);
            await page.mouse.move(0, 0);
        });
    }

    await test.step('Balance card shows a Make Payment control', async () => {
        const balanceCard = cards.filter({ hasText: 'balance on account' });
        await expect(balanceCard.locator(SELECTORS.makePaymentButton), 'Balance card should show a "+ Make Payment" control').toHaveText('+ Make Payment');
    });
});

test('Dashboard - Make Payment Opens the Payment Gateway in a New Tab', async ({ page, context }) => {
    await gotoDashboard(page);

    const popup = await test.step('Click Make Payment', async () => {
        const popupPromise = context.waitForEvent('page', { timeout: 10000 });
        await page.click(SELECTORS.makePaymentButton);
        return popupPromise;
    });

    await test.step('New tab should open the payment gateway', async () => {
        // waitForURL's predicate receives a URL object, not a string - comparing it directly to
        // a string is always true (different types), which resolves instantly before the popup
        // has actually navigated. Compare .href instead.
        await popup.waitForURL((url) => url.href !== 'about:blank', { timeout: 20000 });
        // QA's gateway domain has an "-int" (internal) suffix that Live's doesn't - confirmed
        // 2026-09-01 - so both are accepted rather than hardcoding one environment's domain.
        expect(popup.url(), 'Make Payment should open the fuel store payment gateway').toMatch(/^https:\/\/thefuelstore\.mysecurepay(-int)?\.co\.uk\//);
    });

    await popup.close();
});

for (const chartInfo of CHARTS) {
    test(`Dashboard - "${chartInfo.name}" Chart Shows Data When Hovered`, async ({ page }) => {
        await gotoDashboard(page);
        const chart = page.locator(chartInfo.id);
        await expect(chart, `"${chartInfo.name}" chart should be visible`).toBeVisible();

        await test.step('Tooltip should show a matching label and a currency value', async () => {
            const [{ label, value }] = await sampleChartTooltips(page, chart);
            expect(label, `"${chartInfo.name}" tooltip label should match its axis`).toMatch(chartInfo.labelPattern);
            expect(value, `"${chartInfo.name}" tooltip should show a "Total (£)" amount by default`).toMatch(/^Total \(£\) : £[\d,]+\.\d{2}$/);
        });
    });

    test(`Dashboard - "${chartInfo.name}" Chart Can Switch Between Total (£) and Quantity (Ltrs) Views`, async ({ page }) => {
        await gotoDashboard(page);
        const chart = page.locator(chartInfo.id);

        await test.step('Default tab should be "total (£)"', async () => {
            await expect(chart.locator('.chart__tab--active'), 'Chart should default to the "total (£)" view').toHaveText('total (£)');
        });

        await test.step('Switch to "quantity (ltrs)"', async () => {
            await chart.locator('.chart__tab', { hasText: 'quantity' }).click();
            await expect(chart.locator('.chart__tab--active'), 'Active tab should switch to "quantity (ltrs)"').toHaveText('quantity (ltrs)');
        });

        await test.step('Tooltip should now show a Ltrs value', async () => {
            const [{ label, value }] = await sampleChartTooltips(page, chart);
            expect(label, `"${chartInfo.name}" tooltip label should still match its axis`).toMatch(chartInfo.labelPattern);
            expect(value, `"${chartInfo.name}" tooltip should show a "Quantity (Ltrs)" amount after switching tabs`).toMatch(/^Quantity \(Ltrs\) : [\d,]+\.\d{2} Ltrs$/i);
        });
    });
}
