const { defineConfig, devices } = require('@playwright/test');

const DEFAULT_BASE_URL = 'https://lords-uat2.hosted.positive.co.uk/';

module.exports = defineConfig({
    testDir: './',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    projects: [
        {
            name: 'desktop-chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'tablet-chromium',
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
        storageState: undefined,
        /*
        Change DEFAULT_BASE_URL below when you want to switch the main MCC environment.
        Examples:
        - UAT2: https://lords-uat2.hosted.positive.co.uk/
        - Live: https://www.lords.org/

        MCC_BASE_URL still overrides this value when you need a one-off run from the terminal.
        */
        baseURL: process.env.MCC_BASE_URL || DEFAULT_BASE_URL,
    },
});
