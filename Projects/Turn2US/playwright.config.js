const { defineConfig, devices } = require('@playwright/test');

const DEFAULT_BASE_URL = 'https://staging.turn2us.org.uk/';

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
        Change DEFAULT_BASE_URL above when you want to switch the main Turn2us environment.
        Most spec work is done against Staging, since it's the closest match to Live's content -
        Live carries some extra content/menu items and a few differently-named menu options that
        Staging doesn't (to be reconciled per-spec as coverage is built out).

        Examples:
        - Staging: https://staging.turn2us.org.uk/
        - UAT: https://t2u-uat.hosted.positive.co.uk/
        - Live: https://www.turn2us.org.uk/

        TURN2US_BASE_URL still overrides this value when you need a one-off run from the terminal.
        */
        baseURL: process.env.TURN2US_BASE_URL || DEFAULT_BASE_URL,
    },
});
