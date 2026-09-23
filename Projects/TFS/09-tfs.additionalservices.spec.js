const { test, expect } = require('@playwright/test');
const { DASHBOARD_PATH, isLiveEnvironment } = require('./login-helpers');
const { HEADER_SELECTORS, navigateViaSidebar, isBeforeInDom } = require('./portal-helpers');
const { getCurrentSubmissionNumber, incrementSubmissionNumber } = require('./submissionCounter');

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
// Coverage notes - Additional Services ("/portal/additional-services")
// ============================================================================
// A static content page (no History table/filter panel here) listing 4 promotional service
// panels, each a `<article class="promo-panel">` - confirmed 2026-09-21 the SAME "Enquire" form
// widget is reused unchanged across all 4 (identical fields/ids/behaviour), the only thing that
// differs per service is the pre-filled REGARDING value. FuelConnect is the only one of the 4 with
// an additional "Log In" link (opens `https://app.thefuelstore.co.uk/#/login;next=%2Fstatus` in a
// new tab - confirmed this is always the Live FuelConnect app, regardless of which TFS environment
// - QA or Live - the link was clicked from, since FuelConnect itself is a separate product with no
// "QA" version). Confirmed 2026-09-21: service order (FuelConnect, Clean Air Partnership (CAP),
// FraudGuard, AdBlue) and all of the above is identical on QA and Live - no environment-specific
// branching needed anywhere in this file.
//
// **IMPORTANT - this spec creates a REAL enquiry submission, but ONLY on QA:** a real "Send" with
// valid data genuinely posts to the app's live enquiry-handling endpoint and would reach TFS's
// Customer Support Team's real inbox/CRM - there is no "cancel" equivalent for a form POST the way
// there is for a download. **Confirmed 2026-09-23, per Hector's explicit instruction, that Live
// must NEVER receive a real, completed, successful submission from this spec** - this had NOT been
// implemented when this file was first built (it submitted for real on both QA and Live, run
// 2026-09-21) and was fixed retroactively. On Live, the final step now fills Email (the last
// required field) and confirms the form has become genuinely submittable (native `checkValidity()`
// on the whole form returns `true`), then closes the panel via X WITHOUT ever clicking Send - this
// still proves the enquiry would succeed if sent, without actually sending it. On QA, the existing
// real-submission behaviour is unchanged and remains an accepted, documented side effect - every
// field uses unique, clearly-fake, rotating test data (via the shared `submissionCounter.js`,
// already built for exactly this kind of case) rather than static/repeated values, so real support
// staff looking at these can identify them as automated test traffic at a glance (e.g. "Hectorone
// Smithone", phone starting 07738444, `testN@test.com`). All 4 services WITHIN THE SAME PROJECT (viewport)
// share one submission number, per Hector's explicit instruction - confirmed 2026-09-21 the
// counter genuinely advances once per PROJECT, not once per whole `npx playwright test` command:
// Playwright reloads this file's module fresh for each (file, project) pairing even under
// `--workers=1`, so the module-level guard below resets per project. A single 3-project run of
// this file therefore uses 3 consecutive numbers (e.g. desktop=N, tablet=N+1, mobile=N+2) rather
// than one shared number across all 3 viewports - still fully unique data per submission and
// consistent with the spirit of the instruction (no two submissions share identical values), just
// at viewport granularity rather than whole-invocation granularity.
//
// **A real, if minor, UX gap found and documented, per Hector's explicit instruction to flag it
// without pursuing further:** the MESSAGE field has no `required` attribute, unlike every other
// field - a real user (or this spec) can submit a "successful" enquiry with a name, phone, and
// email but literally no message at all, which seems like an easy way to receive an unhelpfully
// empty support request. Not treated as a hard failure, just documented.
//
// Validation is real, native HTML5 `required`-field validation (checked via `validity.valueMissing`
// and `document.activeElement`, not hardcoded browser message text - same engine-agnostic approach
// as `01-tfs.login.spec.js`) - clicking Send with the form empty moves focus to the FIRST invalid
// field (First Name), and each subsequent Send after filling one field moves focus to the next
// required-but-empty one, in the exact order Hector described: First Name -> Last Name -> Phone ->
// Email. Message is never required, so a Send with all 4 required fields filled succeeds
// immediately regardless of whether Message has anything in it.
//
// Tests in this file:
//   1. Additional Services - Navigating from the Dashboard Sidebar Loads the Page
//   2. Additional Services - Header Controls Appear in the Same Order as the Dashboard
//   3. Additional Services - The Four Services Appear in the Same Order (FuelConnect, Clean Air
//      Partnership (CAP), FraudGuard, AdBlue)
//   4. FuelConnect - Log In Opens the FuelConnect App in a New Tab
//   5. "<service>" - Enquire Panel Prefills Regarding, Validates, and Submits Successfully (QA)
//      or Confirms the Form Is Submittable Without Sending It (Live) - one test per service:
//      FuelConnect, Clean Air Partnership (CAP), FraudGuard, AdBlue
// ============================================================================

const ADDITIONAL_SERVICES_PATH = '/portal/additional-services';
const COUNTER_KEY = 'additionalServices';

const SERVICES = [
    { name: 'FuelConnect', hasLogin: true },
    { name: 'Clean Air Partnership (CAP)', hasLogin: false },
    { name: 'FraudGuard', hasLogin: false },
    { name: 'AdBlue', hasLogin: false },
];

const SELECTORS = {
    panel: 'article.promo-panel',
    modal: '[role="dialog"]',
    modalClose: '.modal-close',
    successMessage: '.form__success',
    firstNameInput: '#form-field-first_name',
    lastNameInput: '#form-field-last_name',
    phoneInput: '#form-field-phone',
    emailInput: '#form-field-email',
    regardingInput: '#form-field-regarding',
    messageInput: '#form-field-message',
    sendButton: 'button.form__button',
};

// Spells out small numbers (matching Hector's own "Hectorone"/"Hectortwo" example) and falls back
// to the plain numeral once past a realistic run count.
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
function numberToWord(n) {
    return NUMBER_WORDS[n] || String(n);
}

// All 4 services within the SAME project (viewport) share this SAME data - per Hector's explicit
// instruction. Computed once per (file, project) module load (confirmed 2026-09-21: Playwright
// reloads the module fresh per project even under `--workers=1`, so a 3-project run of this file
// uses 3 consecutive numbers, one per viewport - see this file's header comment for the full
// explanation).
const RUN_NUMBER = getCurrentSubmissionNumber(COUNTER_KEY);
const RUN_WORD = numberToWord(RUN_NUMBER);
const ENQUIRY_DATA = {
    firstName: `Hector${RUN_WORD}`,
    lastName: `Smith${RUN_WORD}`,
    phone: `07738444${String(RUN_NUMBER - 1).padStart(3, '0')}`,
    email: `test${RUN_WORD}@test.com`,
};

let hasIncrementedCounter = false;
test.afterAll(() => {
    if (!hasIncrementedCounter) {
        incrementSubmissionNumber(COUNTER_KEY);
        hasIncrementedCounter = true;
    }
});

async function gotoAdditionalServices(page) {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await navigateViaSidebar(page, ADDITIONAL_SERVICES_PATH, ADDITIONAL_SERVICES_PATH);
    await expect(page.locator('h1'), 'Additional Services should show its "Additional Services" heading').toHaveText('Additional Services');
}

// Asserts Send moved focus to the next required-but-empty field, via the real, engine-agnostic
// validity API rather than hardcoded browser validation-bubble text (same approach as
// 01-tfs.login.spec.js).
async function expectNextRequiredField(page, fieldSelector, fieldLabel) {
    await page.click(SELECTORS.sendButton);
    const validity = await page.locator(fieldSelector).evaluate((el) => ({
        isFocused: el === document.activeElement,
        valueMissing: el.validity.valueMissing,
        valid: el.validity.valid,
    }));
    expect(validity.isFocused, `Clicking Send should move focus to the ${fieldLabel} field`).toBe(true);
    expect(validity.valueMissing, `${fieldLabel} field should flag itself as a required, unfilled field`).toBe(true);
    expect(validity.valid, `${fieldLabel} field should be reported as invalid while empty`).toBe(false);
}

test('Additional Services - Navigating from the Dashboard Sidebar Loads the Page', async ({ page, baseURL }) => {
    await gotoAdditionalServices(page);
    await expect(page, 'Additional Services should load at /portal/additional-services').toHaveURL(new URL(ADDITIONAL_SERVICES_PATH, baseURL).toString());
    await expect(page, 'Additional Services should load with the expected title').toHaveTitle('Additional Services');
});

test('Additional Services - Header Controls Appear in the Same Order as the Dashboard', async ({ page }) => {
    await gotoAdditionalServices(page);

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

test('Additional Services - The Four Services Appear in the Same Order', async ({ page }) => {
    await gotoAdditionalServices(page);

    const panelTitles = await page.evaluate((panelSelector) => {
        return Array.from(document.querySelectorAll(panelSelector)).map((panel) => panel.querySelector('h2')?.textContent.trim());
    }, SELECTORS.panel);

    expect(panelTitles, 'The 4 services should appear in the confirmed order, identical across environments').toEqual(SERVICES.map((service) => service.name));
});

test('FuelConnect - Log In Opens the FuelConnect App in a New Tab', async ({ page, context }) => {
    await gotoAdditionalServices(page);
    const fuelConnectPanel = page.locator(SELECTORS.panel).filter({ hasText: 'FuelConnect' }).first();

    const popup = await test.step('Click Log In', async () => {
        const popupPromise = context.waitForEvent('page', { timeout: 10000 });
        await fuelConnectPanel.getByRole('link', { name: 'Log In' }).click();
        return popupPromise;
    });

    await test.step('New tab should open the FuelConnect app', async () => {
        // The link's own href just loads the app's bare root - the SPA's client-side router then
        // redirects to the "#/login;next=%2Fstatus" hash route a moment after that initial load
        // resolves (confirmed 2026-09-21: reading `popup.url()` right after the page stops being
        // "about:blank" can still catch the pre-redirect root URL). Wait for the actual hash route
        // rather than just "not blank" - same URL-object-not-string gotcha as
        // 02-tfs.dashboard.spec.js applies to the predicate here too.
        await popup.waitForURL((url) => url.href.includes('#/login'), { timeout: 20000 });
        // Confirmed 2026-09-21: FuelConnect is always this one Live app, regardless of which TFS
        // environment (QA or Live) the link was clicked from - not environment-specific.
        expect(popup.url(), 'Log In should open the FuelConnect app login page').toBe('https://app.thefuelstore.co.uk/#/login;next=%2Fstatus');
    });

    await popup.close();
});

for (const service of SERVICES) {
    test(`"${service.name}" - Enquire Panel Prefills Regarding and Submits Successfully`, async ({ page, baseURL }) => {
        const onLive = isLiveEnvironment(baseURL);
        await gotoAdditionalServices(page);
        const panel = page.locator(SELECTORS.panel).filter({ hasText: service.name }).first();

        await test.step('Click Enquire and confirm the panel expands with Regarding prefilled', async () => {
            await panel.getByRole('button', { name: 'Enquire' }).click();
            await expect(page.locator(SELECTORS.modal), 'Enquire panel should open').toBeVisible();
            await expect(page.locator(SELECTORS.regardingInput), `Regarding should be prefilled with "${service.name}"`).toHaveValue(service.name);
            await expect(page.locator(SELECTORS.firstNameInput), 'First Name should start blank').toHaveValue('');
            await expect(page.locator(SELECTORS.lastNameInput), 'Last Name should start blank').toHaveValue('');
            await expect(page.locator(SELECTORS.phoneInput), 'Phone should start blank').toHaveValue('');
            await expect(page.locator(SELECTORS.emailInput), 'Email should start blank').toHaveValue('');
        });

        await test.step('Send with everything blank moves focus to First Name', async () => {
            await page.click(SELECTORS.sendButton);
            const validity = await page.locator(SELECTORS.firstNameInput).evaluate((el) => ({
                isFocused: el === document.activeElement,
                valueMissing: el.validity.valueMissing,
            }));
            expect(validity.isFocused, 'Clicking Send with an empty form should move focus to First Name').toBe(true);
            expect(validity.valueMissing, 'First Name field should flag itself as a required, unfilled field').toBe(true);
        });

        await test.step('Filling First Name moves validation to Last Name', async () => {
            await page.fill(SELECTORS.firstNameInput, ENQUIRY_DATA.firstName);
            await expectNextRequiredField(page, SELECTORS.lastNameInput, 'Last Name');
        });

        await test.step('Filling Last Name moves validation to Phone', async () => {
            await page.fill(SELECTORS.lastNameInput, ENQUIRY_DATA.lastName);
            await expectNextRequiredField(page, SELECTORS.phoneInput, 'Phone');
        });

        await test.step('Filling Phone moves validation to Email', async () => {
            await page.fill(SELECTORS.phoneInput, ENQUIRY_DATA.phone);
            await expectNextRequiredField(page, SELECTORS.emailInput, 'Email');
        });

        await test.step('Filling Email completes the required fields, even with Message left blank', async () => {
            await page.fill(SELECTORS.emailInput, ENQUIRY_DATA.email);
            // Message is deliberately left blank here - confirmed 2026-09-21 it has no `required`
            // attribute, unlike every other field, so a real enquiry can be sent with no message
            // content at all. Documented as a UX gap in this file's header comment, not chased
            // further per Hector's instruction.
            await expect(page.locator(SELECTORS.messageInput), 'Message should start blank').toHaveValue('');
        });

        if (onLive) {
            await test.step('Live: confirm the form would submit successfully, WITHOUT actually sending it', async () => {
                // Per Hector's explicit instruction, Live must never receive a real, completed
                // submission from this spec. `checkValidity()` reports whether the browser's own
                // native validation considers every required field satisfied - true proof the form
                // is ready to submit, without triggering the real POST that clicking Send would.
                const formIsValid = await page.locator(SELECTORS.emailInput).evaluate((el) => el.closest('form').checkValidity());
                expect(formIsValid, 'The form should be genuinely submittable once all required fields are filled').toBe(true);
            });
        } else {
            await test.step('QA: clicking Send submits the enquiry for real', async () => {
                await page.click(SELECTORS.sendButton);
            });

            await test.step('A real success message should appear', async () => {
                await expect(page.locator(SELECTORS.successMessage), 'A success message should confirm the enquiry was sent').toBeVisible();
                await expect(page.locator(SELECTORS.successMessage), 'Success message should have the expected wording').toHaveText('Your message has been sent successfully.');
            });
        }

        await test.step('Closing via X ends the journey', async () => {
            await page.click(SELECTORS.modalClose);
            await expect(page.locator(SELECTORS.modal), 'Enquire panel should close').toHaveCount(0);
        });
    });
}
