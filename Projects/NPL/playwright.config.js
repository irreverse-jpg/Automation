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
        /*
        Change the baseURL manually to run the desired environment.
        For UAT: https://npl-uat-kx13.hosted.positive.co.uk
        For Live: https://www.npl.co.uk
        */
        baseURL: process.env.NPL_BASE_URL || 'https://npl-uat-kx13.hosted.positive.co.uk',
    },
});
