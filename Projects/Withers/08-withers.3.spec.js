const { test, expect } = require('@playwright/test');

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click();
    }
}

test('Savings Accounts - Savings section link is visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);

    const savingsLink = page.getByRole('link', { name: /saving|isa/i }).first();
    await expect(savingsLink).toBeVisible();
}, 30000);
