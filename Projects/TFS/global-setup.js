// ============================================================================
// Global auth setup
// ============================================================================
// TFS is login-gated (unlike every other project in this workspace) - even
// the homepage redirects straight to a login page on both environments. This
// runs once before the whole suite, logs in through the real UI, and saves
// the resulting session (cookies + localStorage) to auth/storageState.json
// so every test project (desktop/tablet/mobile) can reuse it via
// playwright.config.js's `use.storageState` instead of logging in
// per-test/per-project.
//
// /portal/login (see login-helpers.js) works as a stable login route on both
// QA and Live, both share the same login form, and both land on /portal/
// after a successful login. Confirmed 2026-08-26.
//
// Credentials come from env vars (TFS_EMAIL / TFS_PASSWORD) - the same
// credentials work on both QA and Live - loaded from .env locally
// (gitignored - see .env.example) or from CI secrets.
// ============================================================================

require('dotenv').config();
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { LOGIN_PATH, DASHBOARD_PATH, submitLogin } = require('./login-helpers');

const DEFAULT_BASE_URL = 'https://tfs-qa.hosted.positive.co.uk/';
const STORAGE_STATE_PATH = path.join(__dirname, 'auth', 'storageState.json');

async function expectAuthenticated(page) {
    const title = await page.title();
    if (!/dashboard/i.test(title)) {
        throw new Error(`Login did not reach the portal dashboard - landed on "${title}" (${page.url()}) instead.`);
    }
}

module.exports = async () => {
    const baseURL = process.env.TFS_BASE_URL || DEFAULT_BASE_URL;
    const email = process.env.TFS_EMAIL;
    const password = process.env.TFS_PASSWORD;

    if (!email || !password) {
        throw new Error(
            'TFS_EMAIL and TFS_PASSWORD must be set (via .env locally or CI secrets) to log in before running tests.'
        );
    }

    fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto(new URL(LOGIN_PATH, baseURL).toString(), { waitUntil: 'networkidle', timeout: 30000 });
    await Promise.all([
        // Match the exact dashboard pathname, not a substring - /portal/login (this very page)
        // also contains "/portal/" as a substring, so a loose regex would resolve instantly,
        // before the login actually completes, and save a session with no auth cookies.
        page.waitForURL((url) => new URL(url).pathname === DASHBOARD_PATH, { timeout: 20000 }),
        submitLogin(page, email, password),
    ]);

    // Confirm the auth cookie actually landed before saving - the redirect alone isn't proof
    // the session is authenticated (e.g. a slow Cloudflare challenge could still be resolving).
    await page.waitForLoadState('networkidle').catch(() => {});
    await expectAuthenticated(page);

    await page.context().storageState({ path: STORAGE_STATE_PATH });
    await browser.close();
};
