const { defineConfig, devices } = require('@playwright/test');

const DEFAULT_BASE_URL = 'https://qa-rsccorp-fa30c0.xperience-sites.com/';

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
        Change DEFAULT_BASE_URL above when you want to switch the main RSC environment.
        Examples:
        - QA: https://qa-rsccorp-fa30c0.xperience-sites.com/
        - Live: https://www.rsc.org/

        RSC_BASE_URL still overrides this value when you need a one-off run from the terminal.
        */
        baseURL: process.env.RSC_BASE_URL || DEFAULT_BASE_URL,
    },
});
