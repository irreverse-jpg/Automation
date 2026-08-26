require('dotenv').config();
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const DEFAULT_BASE_URL = 'https://tfs-qa.hosted.positive.co.uk/';
const STORAGE_STATE_PATH = path.join(__dirname, 'auth', 'storageState.json');

module.exports = defineConfig({
    testDir: './',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    // TFS is login-gated (QA redirects "/" straight to "/login") - globalSetup logs in once via
    // the real UI and every project below reuses that session through storageState. See
    // global-setup.js for details.
    globalSetup: require.resolve('./global-setup.js'),
    reporter: [
        ['html'],
        ['./reporters/findings-reporter.js'],
    ],
    projects: [
        {
            name: 'desktop-chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'tablet-webkit',
            use: {
                ...devices['iPad Pro 11'],
                browserName: 'chromium',
            },
        },
        {
            name: 'mobile-chromium',
            use: { ...devices['Pixel 7'] },
        },
    ],
    use: {
        trace: 'on-first-retry',
        actionTimeout: 15000,
        navigationTimeout: 30000,
        storageState: STORAGE_STATE_PATH,
        /*
        Change DEFAULT_BASE_URL above when you want to switch the main TFS environment.
        Examples:
        - QA: https://tfs-qa.hosted.positive.co.uk/
        - Live: https://www.thefuelstore.co.uk/

        TFS_BASE_URL still overrides this value when you need a one-off run from the terminal.
        Note: Live is the public marketing site and is NOT login-gated the way QA is - the
        storageState above is only meaningful when pointed at an environment with the same
        login-gated portal (QA and any future staging/UAT environment of the portal itself).
        */
        baseURL: process.env.TFS_BASE_URL || DEFAULT_BASE_URL,
    },
});
