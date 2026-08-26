// ============================================================================
// Global auth setup
// ============================================================================
// TFS is login-gated (unlike every other project in this workspace) - even
// the homepage on QA redirects straight to /login. This runs once before the
// whole suite, logs in through the real UI, and saves the resulting session
// (cookies + localStorage) to auth/storageState.json so every test project
// (desktop/tablet/mobile) can reuse it via playwright.config.js's
// `use.storageState` instead of logging in per-test/per-project.
//
// Credentials come from env vars (TFS_QA_EMAIL / TFS_QA_PASSWORD), loaded
// from .env locally (gitignored - see .env.example) or from CI secrets.
// ============================================================================

require('dotenv').config();
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const DEFAULT_BASE_URL = 'https://tfs-qa.hosted.positive.co.uk/';
const STORAGE_STATE_PATH = path.join(__dirname, 'auth', 'storageState.json');

module.exports = async () => {
    const baseURL = process.env.TFS_BASE_URL || DEFAULT_BASE_URL;
    const email = process.env.TFS_QA_EMAIL;
    const password = process.env.TFS_QA_PASSWORD;

    if (!email || !password) {
        throw new Error(
            'TFS_QA_EMAIL and TFS_QA_PASSWORD must be set (via .env locally or CI secrets) to log in before running tests.'
        );
    }

    fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto(new URL('/login', baseURL).toString(), { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('#input-email', email);
    await page.fill('#input-password', password);
    await Promise.all([
        page.waitForURL(/\/portal\//, { timeout: 20000 }),
        page.click('button.login__button'),
    ]);

    await page.context().storageState({ path: STORAGE_STATE_PATH });
    await browser.close();
};
