const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({ headless: false }); // headless: false so we can see what's happening
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('https://pbs-qa2.hosted.positive.co.uk/home/contact-us/branch-finder', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Accept cookies
    const cookieButton = await page.$('#onetrust-accept-btn-handler');
    if (cookieButton) { await cookieButton.click(); await page.waitForTimeout(1000); }

    // --- Check what's visible right after page load ---
    const searchBoxVisible = await page.locator('#search-branch').isVisible().catch(() => false);
    console.log('#search-branch visible on load:', searchBoxVisible);

    const updateSearchVisible = await page.getByRole('button', { name: /Update search/i }).isVisible().catch(() => false);
    console.log('"Update search" button visible on load:', updateSearchVisible);

    // --- Simulate what the test does: click "Update search" if present ---
    if (updateSearchVisible) {
        console.log('Clicking "Update search" button...');
        await page.getByRole('button', { name: /Update search/i }).click();
        await page.waitForTimeout(1000);
        console.log('#search-branch visible after "Update search" click:', await page.locator('#search-branch').isVisible().catch(() => false));
    }

    // --- Fill and submit ---
    const searchBox = page.locator('#search-branch');
    const isNowVisible = await searchBox.isVisible().catch(() => false);
    console.log('#search-branch visible before fill:', isNowVisible);

    if (isNowVisible) {
        // Dump the form structure
        const formInfo = await page.evaluate(() => {
            const input = document.querySelector('#search-branch');
            if (!input) return 'NO INPUT FOUND';
            const form = input.closest('form');
            return {
                inputValue: input.value,
                inputType: input.type,
                formId: form ? form.id : null,
                formAction: form ? form.action : null,
                submitButtons: form ? Array.from(form.querySelectorAll('button, input[type=submit]')).map(b => ({
                    tag: b.tagName, type: b.type, ariaLabel: b.getAttribute('aria-label'), visible: b.offsetParent !== null
                })) : []
            };
        });
        console.log('Form info:', JSON.stringify(formInfo, null, 2));

        await searchBox.fill('Cardiff');
        console.log('Filled Cardiff. Now trying submit button click...');

        // Try clicking submit button inside main
        const mainSubmit = page.locator('main').locator('button[aria-label="Submit search"]');
        const mainSubmitVisible = await mainSubmit.isVisible().catch(() => false);
        console.log('main button[aria-label="Submit search"] visible:', mainSubmitVisible);

        if (mainSubmitVisible) {
            await mainSubmit.click();
            console.log('Clicked submit button');
        } else {
            console.log('Submit button not visible in main — pressing Enter on input');
            await searchBox.press('Enter');
        }

        await page.waitForTimeout(5000);
    } else {
        console.log('ERROR: #search-branch still not visible. Cannot search.');
    }

    // --- Check results ---
    const viewLinks = await page.locator('a:has-text("View branch details")').count();
    console.log('"View branch details" links found:', viewLinks);

    const heading = await page.locator('h2').first().textContent().catch(() => 'none');
    console.log('H2 heading:', heading);

    await page.screenshot({ path: 'branch-finder-after-search.png' });
    console.log('Screenshot saved: branch-finder-after-search.png');

    await page.waitForTimeout(3000); // keep browser open briefly to inspect
    await browser.close();
})();
