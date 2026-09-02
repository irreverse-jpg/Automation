const { test, expect } = require('@playwright/test');
const { LOGIN_PATH, DASHBOARD_PATH, AUTH_ERROR_MESSAGE, SELECTORS, submitLogin } = require('./login-helpers');

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

// Every other spec in this project relies on playwright.config.js's `use.storageState`, which
// starts every test already logged in (see global-setup.js). This file tests the login form
// itself, so it deliberately opts OUT of that for every test here - starting from a clean,
// unauthenticated session is the whole point.
test.use({ storageState: { cookies: [], origins: [] } });

// ============================================================================
// Coverage notes - the login form ("/portal/login") and logging out
// ============================================================================
// Confirmed 2026-08-26: behaviour, error copy, selectors, and the logout control are IDENTICAL
// on QA and Live - no environment-specific handling was needed anywhere in this file. See
// login-helpers.js for the shared path/selector constants used here and by global-setup.js.
//
// Tests in this file:
//   1. Login - Page Loads with Email, Password, Forgot Password Link, and Login Button
//      Confirms the form itself is reachable and usable: Email/Password fields are visible
//      and accept text, "Forgot your password?" link is visible, Login button is visible.
//   2. Login - Empty Form Shows a Validation Error for the Email Field
//   3. Login - Missing Password Shows a Validation Error for the Password Field
//      Both of these are native HTML5 `required`-attribute validation (confirmed via each
//      input's `validity`/`validationMessage` - Chromium's "Please fill out this field.") -
//      there is no custom app-level error banner for an empty field, only for a rejected
//      login attempt (see next two tests). The form never submits in either case.
//   4. Login - Invalid Email Shows an Authentication Error
//   5. Login - Invalid Password Shows an Authentication Error
//      Both show the same app-level error, `div.form__error` reading "Authentication failed.
//      Please check your credentials" - confirmed identical wording for either a wrong email
//      or a wrong password (the app doesn't reveal which field was wrong).
//   6. Login - Valid Credentials Log In to the Dashboard
//      Confirms the real credentials land on /portal/ with an "H1 Dashboard" heading.
//   7. Login - Logging Out Returns to the Login Page
//      Logs in, then uses the sidebar's "Log out" button (a power icon, no visible label -
//      identified via its accessible name) and confirms it lands back on the login form.
// ============================================================================

const VALID_EMAIL = process.env.TFS_EMAIL || 'dan.hemmings@moderncitizens.com';
const VALID_PASSWORD = process.env.TFS_PASSWORD || 'BrandPotential123';
const INVALID_EMAIL = 'dann.hemmings@moderncitizens.com';
const INVALID_PASSWORD = 'BrandPotential1234';

function buildExpectedUrl(baseURL, path) {
    return new URL(path, baseURL).toString();
}

async function gotoLogin(page) {
    await page.goto(LOGIN_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await expect(page.locator(SELECTORS.emailInput), 'Login form should be visible after opening the login page').toBeVisible();
}

test('Login - Page Loads with Email, Password, Forgot Password Link, and Login Button', async ({ page, baseURL }) => {
    await test.step('Open the login page', async () => {
        await gotoLogin(page);
        await expect(page, 'Login page should load at /portal/login').toHaveURL(buildExpectedUrl(baseURL, LOGIN_PATH));
        await expect(page, 'Login page should load with the expected title').toHaveTitle(/Login/i);
    });

    await test.step('Email field is visible and can be filled', async () => {
        const emailInput = page.locator(SELECTORS.emailInput);
        await expect(emailInput, 'Email field should be visible').toBeVisible();
        await emailInput.fill('example@thefuelstore.co.uk');
        await expect(emailInput, 'Email field should accept typed text').toHaveValue('example@thefuelstore.co.uk');
    });

    await test.step('Password field is visible and can be filled', async () => {
        const passwordInput = page.locator(SELECTORS.passwordInput);
        await expect(passwordInput, 'Password field should be visible').toBeVisible();
        await passwordInput.fill('temporary-value');
        await expect(passwordInput, 'Password field should accept typed text').toHaveValue('temporary-value');
    });

    await test.step('Forgot password link is visible', async () => {
        await expect(page.locator(SELECTORS.forgotPasswordLink), 'Forgot password link should be visible').toBeVisible();
        await expect(page.locator(SELECTORS.forgotPasswordLink), 'Forgot password link should read "Forgot your password?"').toHaveText('Forgot your password?');
    });

    await test.step('Login button is visible', async () => {
        await expect(page.locator(SELECTORS.loginButton), 'Login button should be visible').toBeVisible();
        await expect(page.locator(SELECTORS.loginButton), 'Login button should read "Login"').toHaveText('Login');
    });
});

test('Login - Empty Form Shows a Validation Error for the Email Field', async ({ page, baseURL }) => {
    await gotoLogin(page);

    await test.step('Click Login with both fields empty', async () => {
        await page.click(SELECTORS.loginButton);
    });

    await test.step('Email field should report itself as required and unfilled', async () => {
        const validity = await page.locator(SELECTORS.emailInput).evaluate((el) => ({
            valid: el.validity.valid,
            valueMissing: el.validity.valueMissing,
        }));
        expect(validity.valueMissing, 'Email field should flag itself as a required, unfilled field').toBe(true);
        expect(validity.valid, 'Email field should be reported as invalid while empty').toBe(false);
    });

    await test.step('Form should not have submitted', async () => {
        await expect(page, 'Login page should not navigate away when the form fails native validation').toHaveURL(buildExpectedUrl(baseURL, LOGIN_PATH));
    });
});

test('Login - Missing Password Shows a Validation Error for the Password Field', async ({ page, baseURL }) => {
    await gotoLogin(page);

    await test.step('Fill only the Email field, then click Login', async () => {
        await page.fill(SELECTORS.emailInput, VALID_EMAIL);
        await page.click(SELECTORS.loginButton);
    });

    await test.step('Password field should report itself as required and unfilled', async () => {
        const validity = await page.locator(SELECTORS.passwordInput).evaluate((el) => ({
            valid: el.validity.valid,
            valueMissing: el.validity.valueMissing,
        }));
        expect(validity.valueMissing, 'Password field should flag itself as a required, unfilled field').toBe(true);
        expect(validity.valid, 'Password field should be reported as invalid while empty').toBe(false);
    });

    await test.step('Form should not have submitted', async () => {
        await expect(page, 'Login page should not navigate away when the form fails native validation').toHaveURL(buildExpectedUrl(baseURL, LOGIN_PATH));
    });
});

test('Login - Invalid Email Shows an Authentication Error', async ({ page, baseURL }) => {
    await gotoLogin(page);

    await test.step('Submit an unrecognised email with the correct password', async () => {
        await submitLogin(page, INVALID_EMAIL, VALID_PASSWORD);
    });

    await test.step('Authentication error should be shown', async () => {
        await expect(page.locator('.form__error'), `Login should show "${AUTH_ERROR_MESSAGE}" for an unrecognised email`).toHaveText(AUTH_ERROR_MESSAGE);
    });

    await test.step('Should remain on the login page', async () => {
        await expect(page, 'A rejected login should not navigate away from the login page').toHaveURL(buildExpectedUrl(baseURL, LOGIN_PATH));
    });
});

test('Login - Invalid Password Shows an Authentication Error', async ({ page, baseURL }) => {
    await gotoLogin(page);

    await test.step('Submit the correct email with an incorrect password', async () => {
        await submitLogin(page, VALID_EMAIL, INVALID_PASSWORD);
    });

    await test.step('Authentication error should be shown', async () => {
        await expect(page.locator('.form__error'), `Login should show "${AUTH_ERROR_MESSAGE}" for an incorrect password`).toHaveText(AUTH_ERROR_MESSAGE);
    });

    await test.step('Should remain on the login page', async () => {
        await expect(page, 'A rejected login should not navigate away from the login page').toHaveURL(buildExpectedUrl(baseURL, LOGIN_PATH));
    });
});

test('Login - Valid Credentials Log In to the Dashboard', async ({ page, baseURL }) => {
    await gotoLogin(page);

    await test.step('Submit the correct email and password', async () => {
        await Promise.all([
            page.waitForURL((url) => new URL(url).pathname === DASHBOARD_PATH, { timeout: 20000 }),
            submitLogin(page, VALID_EMAIL, VALID_PASSWORD),
        ]);
    });

    await test.step('Dashboard should be shown', async () => {
        await expect(page, 'Successful login should land on the portal dashboard').toHaveURL(buildExpectedUrl(baseURL, DASHBOARD_PATH));
        await expect(page.locator('h1'), 'Dashboard page should show an "Dashboard" heading').toHaveText('Dashboard');
    });
});

test('Login - Logging Out Returns to the Login Page', async ({ page, baseURL }) => {
    await test.step('Log in with valid credentials', async () => {
        await gotoLogin(page);
        await Promise.all([
            page.waitForURL((url) => new URL(url).pathname === DASHBOARD_PATH, { timeout: 20000 }),
            submitLogin(page, VALID_EMAIL, VALID_PASSWORD),
        ]);
        await expect(page.locator('h1'), 'Should be on the Dashboard before testing logout').toHaveText('Dashboard');
    });

    await test.step('Click the Log out button', async () => {
        const logoutButton = page.getByRole('button', { name: 'Log out' });
        await expect(logoutButton, 'Log out button (power icon) should be visible on the dashboard').toBeVisible();
        await Promise.all([
            page.waitForURL((url) => new URL(url).pathname === LOGIN_PATH, { timeout: 20000 }),
            logoutButton.click(),
        ]);
    });

    await test.step('Should be back on the login page', async () => {
        await expect(page, 'Logging out should return to the login page').toHaveURL(buildExpectedUrl(baseURL, LOGIN_PATH));
        await expect(page.locator(SELECTORS.emailInput), 'Login form should be visible again after logging out').toBeVisible();
    });
});
