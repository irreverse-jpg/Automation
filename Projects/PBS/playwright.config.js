const { defineConfig, devices } = require('@playwright/test');

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
        For QA: https://pbs-qa.hosted.positive.co.uk/
        For QA2: https://pbs-qa2.hosted.positive.co.uk/
        For UAT2: https://pbs-uat2.hosted.positive.co.uk/
        For Live: https://www.principality.co.uk/
        */
        baseURL: 'https://pbs-qa2.hosted.positive.co.uk/',
    },

});