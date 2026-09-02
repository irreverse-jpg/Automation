const { defineConfig, devices } = require('@playwright/test');

const DEFAULT_BASE_URL = 'https://pbs-qa2.hosted.positive.co.uk/';

module.exports = defineConfig({
    testDir: './',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
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
            use: { ...devices['iPad Pro 11'] },
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
        storageState: undefined,
        /*
        Change DEFAULT_BASE_URL above when you want to switch the main PBS environment.
        Examples:
        - QA: https://pbs-qa.hosted.positive.co.uk/
        - QA2: https://pbs-qa2.hosted.positive.co.uk/
        - UAT2: https://pbs-uat2.hosted.positive.co.uk/
        - Live: https://www.principality.co.uk/

        PBS_BASE_URL still overrides this value when you need a one-off run from the terminal.
        */
        baseURL: process.env.PBS_BASE_URL || DEFAULT_BASE_URL,
    },

});