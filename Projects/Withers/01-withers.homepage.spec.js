const { test, expect } = require('@playwright/test');

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click();
    }

    await dismissCookieOverlayIfPresent(page);
}

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (!(await cookieOverlay.isVisible().catch(() => false))) {
        return;
    }

    const acceptAllButton = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept all cookies")').first();
    if (await acceptAllButton.isVisible().catch(() => false)) {
        await acceptAllButton.click();
        await expect(cookieOverlay).not.toBeVisible();
        return;
    }

    const closeButton = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button[aria-label="Close"]').first();
    if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click();
    } else {
        await page.keyboard.press('Escape').catch(() => { });
    }

    await expect(cookieOverlay).not.toBeVisible();
}

async function openMenuIfPresent(page) {
    const openMenuButton = page.getByRole('button', { name: /open menu|menu/i });
    if (await openMenuButton.first().isVisible().catch(() => false)) {
        await openMenuButton.first().click();
    }
}

async function ensureLanguageSwitcherVisible(page) {
    const combobox = page.getByRole('combobox', { name: /Change site language/i }).first();
    const fallbackCombobox = page.locator('select[aria-label="Change site language"]').first();

    if (await combobox.isVisible().catch(() => false)) {
        return combobox;
    }

    if (await fallbackCombobox.isVisible().catch(() => false)) {
        return fallbackCombobox;
    }

    await openMenuIfPresent(page);

    if (await combobox.isVisible().catch(() => false)) {
        return combobox;
    }

    if (await fallbackCombobox.isVisible().catch(() => false)) {
        return fallbackCombobox;
    }

    await expect(fallbackCombobox).toBeVisible();
    return fallbackCombobox;
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isCookieInterception = message.includes('intercepts pointer events') || message.includes('onetrust');

        if (!isCookieInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click();
    }
}

async function clickVisibleHeaderLink(page, name) {
    await dismissCookieOverlayIfPresent(page);
    const headerLink = page.getByRole('banner').locator('a:visible').filter({ hasText: name }).first();
    await expect(headerLink).toBeVisible();
    await clickWithCookieGuard(page, headerLink);
}

async function selectLanguageOption(page, label, path) {
    const combobox = page.getByRole('combobox', { name: /Change site language/i }).first();
    await expect(combobox).toBeVisible();

    const localeKey = path.replace('/', '').toLowerCase();
    await combobox.evaluate((select, args) => {
        const options = Array.from(select.options || []);
        const byLabel = options.find((option) => option.textContent.trim() === args.label);
        const byLocaleValue = options.find((option) => (option.value || '').toLowerCase().includes(args.localeKey));
        const target = byLabel || byLocaleValue;

        if (!target) {
            throw new Error(`Language option not found: ${args.label}`);
        }

        select.value = target.value;
        target.selected = true;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }, { label, localeKey });
}

test('Homepage - Homepage loads', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/');
        await page.waitForLoadState('load');
        await acceptCookiesIfPresent(page);
    });

    await test.step('Verify homepage title', async () => {
        await expect(page, 'Homepage should load with the expected Withers title').toHaveTitle(/The law firm for success | Withersworldwide/i);
    });
}, 30000);

test('Homepage - Scrolling through the Page', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/');
        await page.waitForLoadState('load');
        await acceptCookiesIfPresent(page);
    });

    await test.step('Scroll to the footer', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(page.locator('footer'), 'Scrolling to the bottom should reveal the footer').toBeVisible();
    });

    await test.step('Scroll back to the top', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect
            .poll(() => page.evaluate(() => Math.round(window.scrollY)), {
                message: 'Scrolling back to the top should reset the vertical position to 0',
            })
            .toBe(0);
    });

    await test.step('Scroll to the middle of the page', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await expect
            .poll(() => page.evaluate(() => Math.round(window.scrollY)), {
                message: 'Scrolling to the middle should move the page away from the top position',
            })
            .toBeGreaterThan(0);
    });
}, 30000);

test('Homepage - Navigate various pages from the header links', async ({ page, baseURL }) => {
    await test.step('Open homepage and header navigation', async () => {
        await page.goto('/');
        await page.waitForLoadState('load');
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    const headerTargets = [
        { name: 'Contact', url: `${baseURL}/contact-us` },
        { name: 'Newsroom', url: `${baseURL}/insight/newsroom` },
        { name: 'Insight', url: `${baseURL}/insight` },
        { name: 'Home', url: baseURL },
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
        await page.goto('/');
        await page.waitForLoadState('load');
        await acceptCookiesIfPresent(page);
    });

    const recentInsightHeading = page.getByRole('heading', { name: /Recent insight/i });
    const findProfessionalHeading = page.getByRole('heading', { name: /Find a professional/i });
    const getInTouchHeading = page.getByRole('heading', { name: /Get in touch/i });

    await test.step('Validate recent insight links', async () => {
        await expect(recentInsightHeading, 'Homepage should show the Recent insight section heading').toBeVisible();

        const recentInsightSection = recentInsightHeading.locator('xpath=ancestor::section[1]');
        const recentInsightLinks = recentInsightSection.locator('a:visible[href*="/insight/"]');
        await expect(recentInsightLinks, 'Recent insight section should expose three visible insight links').toHaveCount(3);

        for (const index of [0, 2]) {
            await test.step(`Open recent insight link at position ${index + 1}`, async () => {
                const link = recentInsightLinks.nth(index);
                await expect(link, `Recent insight link ${index + 1} should be visible before clicking`).toBeVisible();
                await clickWithCookieGuard(page, link);
                await expect(page, `Recent insight link ${index + 1} should navigate away from the homepage`).not.toHaveURL(baseURL);
                await page.goBack();
                await page.waitForLoadState('load');
                await dismissCookieOverlayIfPresent(page);
                await expect(page, 'Returning from a recent insight page should restore the homepage URL').toHaveURL(baseURL);
                await expect(recentInsightHeading, 'Homepage should still show the Recent insight section after navigating back').toBeVisible();
            });
        }
    });

    await test.step('Validate Find a professional link', async () => {
        await expect(findProfessionalHeading, 'Homepage should show the Find a professional section heading').toBeVisible();

        const findProfessionalLink = page.getByRole('link', { name: 'Find a professional' });
        await expect(findProfessionalLink, 'Find a professional link should be visible before clicking').toBeVisible();
        await clickWithCookieGuard(page, findProfessionalLink);
        await expect(page, 'Find a professional link should navigate to the people page').toHaveURL(`${baseURL}/people`);
        await expect(page, 'People page should load with the expected title').toHaveTitle(/Find the right lawyer for you \| People \| Withersworldwide/i);

        await page.goBack();
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Going back from the people page should restore the homepage URL').toHaveURL(baseURL);
        await expect(findProfessionalHeading, 'Homepage should still show the Find a professional section after navigating back').toBeVisible();
    });

    await test.step('Validate Get in touch links', async () => {
        await expect(getInTouchHeading, 'Homepage should show the Get in touch section heading').toBeVisible();

        const getInTouchSection = page
            .locator('#main-content')
            .locator('div, section')
            .filter({ has: getInTouchHeading })
            .first();

        const sendEnquiryLink = getInTouchSection.getByRole('link', { name: 'Send an enquiry' });
        await expect(sendEnquiryLink, 'Get in touch section should show the Send an enquiry link').toBeVisible();
        await clickWithCookieGuard(page, sendEnquiryLink);
        await expect(page, 'Send an enquiry should navigate to the contact page').toHaveURL(`${baseURL}/contact-us`);

        await page.goBack();
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Going back from contact us should restore the homepage URL').toHaveURL(baseURL);
        await expect(getInTouchHeading, 'Homepage should still show the Get in touch section after navigating back').toBeVisible();

        const phoneButton = getInTouchSection.getByRole('button', { name: 'Phone' });
        await expect(phoneButton, 'Get in touch section should show the Phone button').toBeVisible();
        await clickWithCookieGuard(page, phoneButton);
        await expect(getInTouchSection.getByText('+44 20 7597 6000', { exact: false }), 'Opening the phone drawer should reveal the Withers phone number').toBeVisible();
    });
});

test('Homepage - Language Switcher', async ({ page, baseURL }) => {
    const expectedLanguages = ['English', 'Français', 'Italiano', 'Español', '日本語', '繁體中文', '简体中文'];
    const host = new URL(baseURL).origin;
    const languageTargets = [
        { label: 'Français', path: '/fr-fr', titlePattern: /Le cabinet d’avocats de vos succès \| Withersworldwide/i },
        { label: 'Italiano', path: '/it-it', titlePattern: /Lo studio legale per il successo \| Withersworldwide/i },
        { label: 'Español', path: '/es-es', titlePattern: /El estudio jurídico para asegurarse el éxito \| Withers/i },
        { label: '日本語', path: '/ja-jp', titlePattern: /Withers/i },
        { label: '繁體中文', path: '/zh-hk', titlePattern: /Withers/i },
        { label: '简体中文', path: '/zh-cn', titlePattern: /Withers/i },
    ];

    await test.step('Open homepage and language switcher', async () => {
        await page.goto('/');
        await page.waitForLoadState('load');
        await acceptCookiesIfPresent(page);
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Homepage should start on the English Withers URL').toHaveURL(baseURL);
        await expect(page, 'Homepage should start with the English Withers title').toHaveTitle(/The law firm for success \| Withersworldwide/i);
    });

    const languageSwitcher = await ensureLanguageSwitcherVisible(page);

    await test.step('Verify all expected language options are available', async () => {
        const options = languageSwitcher.locator('option');
        const optionCount = await options.count();
        expect(optionCount, 'Language switcher should expose at least seven language options').toBeGreaterThanOrEqual(7);

        const optionTexts = await options.allTextContents();
        const normalizedOptions = optionTexts.map((text) => text.trim());
        for (const language of expectedLanguages) {
            expect(normalizedOptions, `Language switcher should include ${language}`).toContain(language);
        }
    });

    for (const target of languageTargets) {
        await test.step(`Switch language to ${target.label}`, async () => {
            await selectLanguageOption(page, target.label, target.path);
            await page.waitForLoadState('load');
            await dismissCookieOverlayIfPresent(page);
            await page.waitForURL(`${host}${target.path}`);
            await expect(page, `${target.label} should navigate to ${host}${target.path}`).toHaveURL(`${host}${target.path}`);
            await expect(page, `${target.label} page should load the expected title`).toHaveTitle(target.titlePattern);
        });
    }

    await test.step('Switch language back to English', async () => {
        await selectLanguageOption(page, 'English', '/en-gb');
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Returning to English should restore the original homepage URL').toHaveURL(baseURL);
        await expect(page, 'Returning to English should restore the original homepage title').toHaveTitle(/The law firm for success \| Withersworldwide/i);
    });
});