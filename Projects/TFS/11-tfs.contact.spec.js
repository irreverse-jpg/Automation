const { test, expect } = require('@playwright/test');
const { DASHBOARD_PATH } = require('./login-helpers');
const { HEADER_SELECTORS, SIDEBAR_SELECTORS, isSidebarCollapsed, isBeforeInDom } = require('./portal-helpers');
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
// Coverage notes - Contact ("/portal/contact")
// ============================================================================
// **A genuine, confirmed environment difference - the ONLY page in this whole project where QA
// and Live are NOT the same page at all, unlike every other spec built so far:**
//   - On QA, the sidebar's "Contact" link goes to the portal's own authenticated Contact form
//     (identical field family to 09-tfs.additionalservices.spec.js's Enquire panel: First Name,
//     Last Name, Phone, Email, Leave a Message - all but Message required).
//   - On Live, `/portal/contact` genuinely REDIRECTS to `https://www.thefuelstore.co.uk/contact/`
//     - a completely different, UNAUTHENTICATED public marketing page ("Need help? Ask a
//     FUELLER!") with no portal chrome at all (no header/sidebar) and a different marketing-tool
//     form (Microsoft Dynamics/Power Pages-style, field order: First Name, Last Name, Email, Main
//     Phone, Company Name, Subject, Message - all required, confirmed 2026-09-22). This was
//     discovered by chasing down a real `page.waitForURL` timeout on Live (the sidebar click never
//     reaches `/portal/contact` because the browser follows the redirect to `/contact/` first).
//   - This file follows Hector's explicit decision after this was found: keep both journeys in
//     ONE spec, since the sidebar navigation itself is one single "Contact" destination that
//     merely resolves differently per environment - not two separate pages to give separate spec
//     files to. `gotoContact()` accepts either resulting path and every test branches on which one
//     actually loaded, skipping whichever branch doesn't apply this run.
//   - **Per Hector's explicit instruction, the Live/public form is NEVER fully submitted by this
//     spec** - unlike the QA/portal form (a real internal enquiry, already accepted as a
//     known/deliberate side effect in 09-tfs.additionalservices.spec.js/this file's QA path), the
//     Live path is a public marketing-automation form that could trigger real CRM/marketing
//     workflows (data-redirecturl, notification banners for "event" registrations were seen in its
//     markup) with consequences outside this project's control. The Live test therefore only
//     proves the validation stepping works correctly, then stops with Message left blank.
//   - The marketing form's field `id`s are dynamically generated with a timestamp suffix on every
//     page load (e.g. `firstname-1748421125307`) and are NOT stable - every selector for it targets
//     the stable `name` attribute instead (`firstname`, `lastname`, `emailaddress1`,
//     `new_mainphone`, `companyname`, `subject`, `description`). There's also a hidden, NOT
//     required `telephone1` field with no visible label between Main Phone and Company Name in the
//     DOM - not part of the validation sequence a real user would ever hit, so not exercised here.
//
// The QA/portal form's own validation is the same real, native HTML5 `required`-field validation
// already used throughout this project (checked via `validity.valueMissing` +
// `document.activeElement`) - Submit on an empty form moves focus to First Name, then each
// subsequent Submit after filling one field moves to the next required-but-empty one, in order:
// First Name -> Last Name -> Phone -> Email. The Live/public form's own order is different (see
// above) since it's a genuinely different form.
//
// Tests in this file:
//   1. Contact - Navigating from the Dashboard Sidebar Reaches the Expected Destination
//      (branches its title/H1 assertions on whichever page actually loaded)
//   2. Contact - Header Controls Appear in the Same Order as the Dashboard (QA/portal form only -
//      skipped on Live, since the public marketing page has no portal header at all)
//   3. Contact (Portal Form) - Validates Each Field in Order and Submits Successfully (QA only -
//      skipped if the public marketing page loaded instead)
//   4. Contact (Public Marketing Form, Live) - Validates Each Field in Order and Stops Before
//      Message (Live only - skipped if the portal form loaded instead)
// ============================================================================

const CONTACT_PATH = '/portal/contact';
const LIVE_PUBLIC_CONTACT_PATH = '/contact/';
const COUNTER_KEY = 'contact';

const PORTAL_SELECTORS = {
    firstNameInput: '#form-field-first_name',
    lastNameInput: '#form-field-last_name',
    phoneInput: '#form-field-phone',
    emailInput: '#form-field-email',
    messageInput: '#form-field-message',
    submitButton: 'button.form__button',
    successMessage: '.form__success',
};

// The Live public marketing form's field `id`s carry a dynamic per-load timestamp suffix - use the
// stable `name` attribute instead (see this file's header comment).
const PUBLIC_SELECTORS = {
    form: 'form.marketingForm',
    firstNameInput: 'form.marketingForm input[name="firstname"]',
    lastNameInput: 'form.marketingForm input[name="lastname"]',
    emailInput: 'form.marketingForm input[name="emailaddress1"]',
    mainPhoneInput: 'form.marketingForm input[name="new_mainphone"]',
    companyNameInput: 'form.marketingForm input[name="companyname"]',
    subjectInput: 'form.marketingForm input[name="subject"]',
    messageInput: 'form.marketingForm textarea[name="description"]',
    submitButton: 'form.marketingForm button[type="submit"]',
};

// Spells out small numbers (matching Hector's own "Hectorone"/"Hectortwo" example from
// 09-tfs.additionalservices.spec.js) and falls back to the plain numeral past a realistic run
// count.
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
function numberToWord(n) {
    return NUMBER_WORDS[n] || String(n);
}

// Computed once per (file, project) module load - confirmed 2026-09-21 in
// 09-tfs.additionalservices.spec.js that the counter genuinely advances once per project/viewport
// rather than once per whole command (see that file's own coverage notes for the full
// explanation); the same holds here. Only ever consumed by the QA/portal form test, since the Live
// path never reaches a real submission - kept as one shared source of unique data regardless, so
// the values used for partial-fill validation on Live are still obviously-fake and traceable.
const RUN_NUMBER = getCurrentSubmissionNumber(COUNTER_KEY);
const RUN_WORD = numberToWord(RUN_NUMBER);
const CONTACT_DATA = {
    firstName: `Hector${RUN_WORD}`,
    lastName: `Smith${RUN_WORD}`,
    phone: `07738444${String(RUN_NUMBER - 1).padStart(3, '0')}`,
    email: `test${RUN_WORD}@test.com`,
    message: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    companyName: `TestCo${RUN_WORD}`,
    subject: `Automated test enquiry ${RUN_WORD}`,
};

let hasIncrementedCounter = false;
test.afterAll(() => {
    if (!hasIncrementedCounter) {
        incrementSubmissionNumber(COUNTER_KEY);
        hasIncrementedCounter = true;
    }
});

// Unlike every other page in this project, Contact can resolve to one of two entirely different
// destinations depending on environment - this local nav (rather than portal-helpers.js's
// navigateViaSidebar()) accepts either resulting path instead of asserting one fixed one.
async function gotoContact(page) {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    if (await isSidebarCollapsed(page)) {
        await page.click(SIDEBAR_SELECTORS.sidebarToggle);
    }
    await page.click(SIDEBAR_SELECTORS.sidebarNavLink(CONTACT_PATH));
    await page.waitForURL((url) => url.pathname === CONTACT_PATH || url.pathname === LIVE_PUBLIC_CONTACT_PATH, { timeout: 20000 });
    await page.waitForLoadState('load').catch(() => { });
    // The Live public marketing page never reaches true network idle (an always-polling
    // marketing-automation widget keeps at least one request in flight) - confirmed 2026-09-22 a
    // plain `networkidle` wait can hang here, so this budget is short and always caught.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { });
    return new URL(page.url()).pathname === LIVE_PUBLIC_CONTACT_PATH ? 'public' : 'portal';
}

// Asserts Submit/Send moved focus to the next required-but-empty field, via the real,
// engine-agnostic validity API rather than hardcoded browser validation-bubble text (same approach
// as 01-tfs.login.spec.js and 09-tfs.additionalservices.spec.js).
async function expectNextRequiredField(page, submitSelector, fieldSelector, fieldLabel) {
    await page.click(submitSelector);
    const validity = await page.locator(fieldSelector).evaluate((el) => ({
        isFocused: el === document.activeElement,
        valueMissing: el.validity.valueMissing,
        valid: el.validity.valid,
    }));
    expect(validity.isFocused, `Clicking Submit should move focus to the ${fieldLabel} field`).toBe(true);
    expect(validity.valueMissing, `${fieldLabel} field should flag itself as a required, unfilled field`).toBe(true);
    expect(validity.valid, `${fieldLabel} field should be reported as invalid while empty`).toBe(false);
}

test('Contact - Navigating from the Dashboard Sidebar Reaches the Expected Destination', async ({ page, baseURL }) => {
    const destination = await gotoContact(page);

    if (destination === 'portal') {
        await test.step('QA/portal: loads the authenticated Contact form', async () => {
            await expect(page, 'Contact should load at /portal/contact').toHaveURL(new URL(CONTACT_PATH, baseURL).toString());
            await expect(page.locator('h1'), 'Contact should show its "Contact" heading').toHaveText('Contact');
            // Confirmed 2026-09-22: unlike Dashboard/FAQs, the portal Contact page's title has no
            // "| The Fuel Store" suffix.
            await expect(page, 'Contact should load with the expected title').toHaveTitle('Contact');
        });
    } else {
        await test.step('Live: redirects to the public marketing Contact page', async () => {
            await expect(page, 'Live should redirect to the public /contact/ page').toHaveURL(new URL(LIVE_PUBLIC_CONTACT_PATH, baseURL).toString());
            await expect(page.locator('h1'), 'Public Contact page should show its own heading').toHaveText(/Need help\? Ask a FUELLER!/);
            await expect(page, 'Public Contact page should load with its own title').toHaveTitle('Contact | Speak to The Fuel Store team today');
        });
    }
});

test('Contact - Header Controls Appear in the Same Order as the Dashboard', async ({ page }) => {
    const destination = await gotoContact(page);
    test.skip(destination !== 'portal', 'Only the QA/portal Contact form has the portal header - the Live public marketing page has no portal chrome at all.');

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

test('Contact (Portal Form) - Validates Each Field in Order and Submits Successfully', async ({ page }) => {
    const destination = await gotoContact(page);
    test.skip(destination !== 'portal', 'The portal Contact form did not load this run - Live redirects to the public marketing page instead (see the other Contact test for that path).');

    await test.step('All fields should start blank', async () => {
        await expect(page.locator(PORTAL_SELECTORS.firstNameInput), 'First Name should start blank').toHaveValue('');
        await expect(page.locator(PORTAL_SELECTORS.lastNameInput), 'Last Name should start blank').toHaveValue('');
        await expect(page.locator(PORTAL_SELECTORS.phoneInput), 'Phone should start blank').toHaveValue('');
        await expect(page.locator(PORTAL_SELECTORS.emailInput), 'Email should start blank').toHaveValue('');
        await expect(page.locator(PORTAL_SELECTORS.messageInput), 'Leave a Message should start blank').toHaveValue('');
    });

    await test.step('Submit with everything blank moves focus to First Name', async () => {
        await page.click(PORTAL_SELECTORS.submitButton);
        const validity = await page.locator(PORTAL_SELECTORS.firstNameInput).evaluate((el) => ({
            isFocused: el === document.activeElement,
            valueMissing: el.validity.valueMissing,
        }));
        expect(validity.isFocused, 'Clicking Submit with an empty form should move focus to First Name').toBe(true);
        expect(validity.valueMissing, 'First Name field should flag itself as a required, unfilled field').toBe(true);
    });

    await test.step('Filling First Name moves validation to Last Name', async () => {
        await page.fill(PORTAL_SELECTORS.firstNameInput, CONTACT_DATA.firstName);
        await expectNextRequiredField(page, PORTAL_SELECTORS.submitButton, PORTAL_SELECTORS.lastNameInput, 'Last Name');
    });

    await test.step('Filling Last Name moves validation to Phone', async () => {
        await page.fill(PORTAL_SELECTORS.lastNameInput, CONTACT_DATA.lastName);
        await expectNextRequiredField(page, PORTAL_SELECTORS.submitButton, PORTAL_SELECTORS.phoneInput, 'Phone');
    });

    await test.step('Filling Phone moves validation to Email', async () => {
        await page.fill(PORTAL_SELECTORS.phoneInput, CONTACT_DATA.phone);
        await expectNextRequiredField(page, PORTAL_SELECTORS.submitButton, PORTAL_SELECTORS.emailInput, 'Email');
    });

    await test.step('Filling Email and Leave a Message, then Submit, sends the form successfully', async () => {
        // Per Hector's specific instruction for this spec - unlike 09-tfs.additionalservices.spec.js,
        // which deliberately left Message blank to flag it as an optional-field gap - here Message
        // is filled in too, so this proves a genuinely fully-filled submission succeeds.
        await page.fill(PORTAL_SELECTORS.emailInput, CONTACT_DATA.email);
        await page.fill(PORTAL_SELECTORS.messageInput, CONTACT_DATA.message);
        await page.click(PORTAL_SELECTORS.submitButton);
    });

    await test.step('A real success message should appear', async () => {
        await expect(page.locator(PORTAL_SELECTORS.successMessage), 'A success message should confirm the enquiry was sent').toBeVisible();
        await expect(page.locator(PORTAL_SELECTORS.successMessage), 'Success message should have the expected wording').toHaveText('Your message has been sent successfully.');
    });
});

test('Contact (Public Marketing Form, Live) - Validates Each Field in Order and Stops Before Message', async ({ page }) => {
    const destination = await gotoContact(page);
    test.skip(destination !== 'public', 'The Live public marketing Contact form did not load this run - QA loads the portal\'s own form instead (see the other Contact test for that path).');

    await test.step('Submit with everything blank moves focus to First Name', async () => {
        await page.click(PUBLIC_SELECTORS.submitButton);
        const validity = await page.locator(PUBLIC_SELECTORS.firstNameInput).evaluate((el) => ({
            isFocused: el === document.activeElement,
            valueMissing: el.validity.valueMissing,
        }));
        expect(validity.isFocused, 'Clicking Submit with an empty form should move focus to First Name').toBe(true);
        expect(validity.valueMissing, 'First Name field should flag itself as a required, unfilled field').toBe(true);
    });

    await test.step('Filling First Name moves validation to Last Name', async () => {
        await page.fill(PUBLIC_SELECTORS.firstNameInput, CONTACT_DATA.firstName);
        await expectNextRequiredField(page, PUBLIC_SELECTORS.submitButton, PUBLIC_SELECTORS.lastNameInput, 'Last Name');
    });

    await test.step('Filling Last Name moves validation to Email', async () => {
        await page.fill(PUBLIC_SELECTORS.lastNameInput, CONTACT_DATA.lastName);
        await expectNextRequiredField(page, PUBLIC_SELECTORS.submitButton, PUBLIC_SELECTORS.emailInput, 'Email');
    });

    await test.step('Filling Email moves validation to Main Phone', async () => {
        await page.fill(PUBLIC_SELECTORS.emailInput, CONTACT_DATA.email);
        await expectNextRequiredField(page, PUBLIC_SELECTORS.submitButton, PUBLIC_SELECTORS.mainPhoneInput, 'Main Phone');
    });

    await test.step('Filling Main Phone moves validation to Company Name', async () => {
        await page.fill(PUBLIC_SELECTORS.mainPhoneInput, CONTACT_DATA.phone);
        await expectNextRequiredField(page, PUBLIC_SELECTORS.submitButton, PUBLIC_SELECTORS.companyNameInput, 'Company Name');
    });

    await test.step('Filling Company Name moves validation to Subject', async () => {
        await page.fill(PUBLIC_SELECTORS.companyNameInput, CONTACT_DATA.companyName);
        await expectNextRequiredField(page, PUBLIC_SELECTORS.submitButton, PUBLIC_SELECTORS.subjectInput, 'Subject');
    });

    await test.step('Filling Subject moves validation to Message - stop here, per instruction, without submitting', async () => {
        await page.fill(PUBLIC_SELECTORS.subjectInput, CONTACT_DATA.subject);
        // Per Hector's explicit instruction, this public marketing form is never actually
        // submitted - unlike the QA/portal form (a known, accepted real internal enquiry), a real
        // submission here would reach a live marketing-automation/CRM workflow outside this
        // project's control. Confirm the validation reaches Message, then stop with it blank.
        await page.click(PUBLIC_SELECTORS.submitButton);
        const validity = await page.locator(PUBLIC_SELECTORS.messageInput).evaluate((el) => ({
            isFocused: el === document.activeElement,
            valueMissing: el.validity.valueMissing,
        }));
        expect(validity.isFocused, 'Clicking Submit should move focus to Message, the last required field').toBe(true);
        expect(validity.valueMissing, 'Message field should flag itself as a required, unfilled field').toBe(true);
        await expect(page.locator(PUBLIC_SELECTORS.messageInput), 'Message should be left blank, per instruction').toHaveValue('');
    });
});
