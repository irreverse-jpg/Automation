const { defineConfig, devices } = require('@playwright/test');

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
        Change the baseURL manually to run the desired environment.
        For QA: https://w-qa.hosted.positive.co.uk/en-gb
        For Live: https://www.withersworldwide.com/en-gb
        */
        baseURL: process.env.WITHERS_BASE_URL || 'https://w-uat.hosted.positive.co.uk/en-gb',
    },
});
