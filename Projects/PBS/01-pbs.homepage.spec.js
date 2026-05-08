const { test, expect } = require('@playwright/test');

// Cookie Selector (If there is one)
const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR);
    if (await cookieButton.first().isVisible().catch(() => false)) {
        await cookieButton.first().click();
    }
}

async function openMenuIfPresent(page) {
    const openMenuButton = page.getByRole('button', { name: 'Open menu' });
    if (await openMenuButton.isVisible().catch(() => false)) {
        await openMenuButton.click();
    }
}

async function clickVisibleHeaderLink(page, name) {
    const headerLink = page.getByRole('banner').locator('a:visible').filter({ hasText: name }).first();
    await expect(headerLink).toBeVisible();
    await headerLink.click();
}

test('Homepage - Homepage Loads', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    await test.step('Verify homepage title', async () => {
        await expect(page, 'Homepage should load with the expected Principality title').toHaveTitle(/Mortgages and Savings Made Simple/);
    });
}, 30000);

test('Homepage - Scrolling through the Page', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    await test.step('Scroll to footer', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(page.locator('footer'), 'Scrolling to the bottom should reveal the footer').toBeVisible();
    });

    await test.step('Scroll back to top', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.getByRole('heading', { level: 1 }), 'Scrolling back to the top should reveal the main page heading').toBeVisible();
    });

    await test.step('Scroll to middle of page', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await expect
            .poll(() => page.evaluate(() => Math.round(window.scrollY)), {
                message: 'Scrolling to the middle should move the page away from the top position',
            })
            .toBeGreaterThan(0);
    });
}, 30000);

test('Homepage - Navigate Various Pages from the Header Links', async ({ page, baseURL }) => {
    await test.step('Open homepage and header navigation', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    const headerTargets = [
        { name: 'Find a branch', url: `${baseURL}home/contact-us/branch-finder` },
        { name: 'Contact us', url: `${baseURL}home/contact-us` },
        { name: 'Intermediaries', url: `${baseURL}intermediaries` },
        { name: 'Commercial', url: `${baseURL}commercial` },
    ];

    for (const target of headerTargets) {
        await test.step(`Navigate from header to ${target.name}`, async () => {
            await openMenuIfPresent(page);
            await clickVisibleHeaderLink(page, target.name);
            await expect(page, `Header link ${target.name} should navigate to ${target.url}`).toHaveURL(target.url);
        });
    }
}, 30000);

test('Homepage - Navigate Various Pages from the Body Links', async ({ page, baseURL }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    const expectedIsaPath = 'home/savings/browse-isas';
    const expectedIsaLabel = /View Cash ISAs/i;

    await test.step('Open the main savings CTA', async () => {
        const isaCta = page.locator(`main a[href='/${expectedIsaPath}']:visible`).filter({ hasText: expectedIsaLabel }).first();
        await expect(isaCta, 'Homepage should show the main savings CTA').toBeVisible();
        await expect(isaCta, 'Main savings CTA should have the expected label').toHaveText(expectedIsaLabel);
        await isaCta.click();
        await expect(page, 'Main savings CTA should navigate to the expected ISA page').toHaveURL(`${baseURL}${expectedIsaPath}`);
        await expect(page, 'ISA page should load an ISA-related title').toHaveTitle(/ISA|ISAs|Principality/i);

        await page.goBack();
        await expect(page, 'Going back from the ISA page should restore the homepage URL').toHaveURL(baseURL);
    });

    const bodyLinks = [
        { text: 'Visit savings home', url: `${baseURL}home/savings`, title: /Savings accounts and ISAs  | Principality/ },
        { text: 'All savings guides', url: `${baseURL}home/savings/savings-guides`, title: /Learn more about saving | Principality/ },
        { text: 'Find your local branch', url: `${baseURL}home/contact-us/branch-finder`, title: /Find Your Nearest Branch | Principality/ },
    ];

    for (const linkTarget of bodyLinks) {
        await test.step(`Open body link ${linkTarget.text}`, async () => {
            await page.click(`text=${linkTarget.text}`);
            await expect(page, `Body link ${linkTarget.text} should navigate to ${linkTarget.url}`).toHaveURL(linkTarget.url);
            await expect(page, `Page opened from ${linkTarget.text} should load the expected title`).toHaveTitle(linkTarget.title);
            await page.goBack();
            await expect(page, `Going back from ${linkTarget.text} should restore the homepage URL`).toHaveURL(baseURL);
        });
    }
});

test('Homepage - Language Switcher', async ({ page, baseURL }) => {
    await test.step('Open homepage and language switcher', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    await test.step('Switch language to Welsh', async () => {
        const welshLanguageLink = page.locator('#header-main').getByRole('link', { name: 'Cymraeg' });
        await expect(welshLanguageLink, 'Header should show the Cymraeg language option').toBeVisible();
        await welshLanguageLink.click();
        await expect(page, 'Switching to Welsh should navigate to the Welsh homepage').toHaveURL(/\/cy\/?$/);
        await expect(page, 'Welsh homepage should load the expected title').toHaveTitle(/Ffrydiau a Chynigion | Principality/);
    });

    await test.step('Switch language back to English', async () => {
        await openMenuIfPresent(page);
        const englishLanguageLink = page.locator('#header-main').getByRole('link', { name: /English|Saesneg/i }).first();
        await expect(englishLanguageLink, 'Header should show the English or Saesneg language option on the Welsh homepage').toBeVisible();
        await englishLanguageLink.click();
        await expect(page, 'Switching back to English should restore the base URL').toHaveURL(baseURL);
        await expect(page, 'English homepage should restore the expected title').toHaveTitle(/Mortgages and Savings Made Simple/);
    });
}, 30000);
