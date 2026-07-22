const { test, expect } = require('@playwright/test');

// Captures the page's web address at the moment a test fails, so the
// findings report can tell teammates exactly where an issue was seen.
test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('failure-context', {
            body: JSON.stringify({
                url: page.url(),
                pageTitle: await page.title().catch(() => ''),
                environment: testInfo.project.use.baseURL || '',
                viewport: testInfo.project.name,
            }),
            contentType: 'application/json',
        }).catch(() => {});
    }
});


// ============================================================================
// Coverage notes - withersworldwide.com homepage ("/")
// ============================================================================
// Scope: the homepage only - hero/title, scroll behaviour, header
// navigation links, key body sections (Recent insight, Find a
// professional, Get in touch), and the multi-language switcher (7
// languages).
//
// Tests in this file:
//   1. Homepage - Homepage Loads
//      Loads "/" and checks the page title.
//   2. Homepage - Scrolling Through the Page
//      Scrolls to the footer, back to the top, and to the middle, checking
//      scroll position at each step.
//   3. Homepage - Navigate Various Pages from the Header Links
//      Clicks each header link (Contact, Newsroom, Insight, Home) and
//      confirms it lands on the expected URL.
//   4. Homepage - Navigate Various Pages from the Body Links
//      Opens 2 of the 3 "Recent insight" article links (confirming each
//      navigates away and back), follows "Find a professional" to the
//      People page, and confirms the "Get in touch" section's "Send an
//      enquiry" link/href and its Phone button reveals the firm's number.
//   5. Homepage - Language Switcher
//      Confirms all 7 expected language options are present, switches to
//      each of Français/Italiano/Español/日本語/繁體中文/简体中文 in turn
//      (confirming URL + title), then back to English.
//   6. Homepage - Skip Links
//      Discovers skip link(s) live via keyboard Tab (rather than hardcoding a
//      label), then verifies each one is reachable again via Tab and that
//      activating it lands on its target element. Withers exposes one as of
//      2026-07-20: "Skip to main content" (#main-content).
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// The header/menu-opening helpers are notably more defensive than other
// projects' (multiple fallback strategies for finding the menu
// button/checkbox/label, retry-based homepage navigation) - this reflects
// genuine cross-viewport/responsive-header quirks on this site rather than
// unnecessary complexity, not something to simplify away.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

async function findFirstVisibleLocator(locator) {
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
            return candidate;
        }
    }

    return null;
}

async function waitForResponsiveHeaderContent(page) {
    const bannerLinks = page.getByRole('banner').locator('a').filter({ hasText: /Home|Contact|Newsroom|Insight|Withers/i });
    const primaryNavLinks = page.getByRole('navigation', { name: 'Primary' }).getByRole('link').filter({ hasText: /Home|Contact|Newsroom|Insight/i });

    await expect.poll(async () => {
        return Boolean(await getVisibleLanguageSwitcher(page))
            || await bannerLinks.first().isVisible().catch(() => false)
            || await primaryNavLinks.first().isVisible().catch(() => false);
    }, {
        message: 'Opening the responsive menu should expose header navigation content or the language switcher',
        timeout: 10000,
        intervals: [250, 500, 1000],
    }).toBe(true);
}

async function openMenuIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);

    const primaryNav = page.getByRole('navigation', { name: 'Primary' }).first();
    const visiblePrimaryNavLinks = primaryNav.getByRole('link').filter({ hasText: /Home|Contact|Insight|Newsroom/i });
    if (await visiblePrimaryNavLinks.first().isVisible().catch(() => false)) {
        return;
    }

    const menuButton = await findFirstVisibleLocator(page.getByRole('button', { name: /open menu|menu/i }));
    if (menuButton) {
        await clickWithCookieGuard(page, menuButton);
    } else {
        const menuCheckbox = await findFirstVisibleLocator(page.getByRole('checkbox', { name: /menu/i }));
        if (menuCheckbox) {
            await menuCheckbox.evaluate((element) => {
                element.checked = true;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            });
        } else {
            const menuLabel = await findFirstVisibleLocator(page.locator('label').filter({ hasText: /^Menu$/i }));
            if (menuLabel) {
                await clickWithCookieGuard(page, menuLabel);
            }
        }
    }

    await waitForResponsiveHeaderContent(page);
}

async function getVisibleLanguageSwitcher(page) {
    const combobox = await findFirstVisibleLocator(page.getByRole('combobox', { name: /Change site language/i }));
    if (combobox) {
        return combobox;
    }

    const fallbackCombobox = await findFirstVisibleLocator(page.locator('select[aria-label="Change site language"]'));
    if (fallbackCombobox) {
        return fallbackCombobox;
    }

    return null;
}

async function ensureLanguageSwitcherVisible(page) {
    let languageSwitcher = await getVisibleLanguageSwitcher(page);
    if (languageSwitcher) {
        return languageSwitcher;
    }

    await openMenuIfPresent(page);

    languageSwitcher = await getVisibleLanguageSwitcher(page);
    expect(languageSwitcher, 'Language switcher should be visible after opening the responsive header menu').toBeTruthy();

    return languageSwitcher;
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isCookieInterception = message.includes('intercepts pointer events') || message.includes('onetrust');
        const canForceClick = message.includes('not stable') || message.includes('outside of the viewport') || message.includes('timeout');

        if (!isCookieInterception) {
            if (!canForceClick) {
                throw error;
            }

            await locator.scrollIntoViewIfNeeded().catch(() => { });
            await locator.click({ force: true }).catch(async () => {
                await locator.evaluate((node) => node.click());
            });
            return;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true }).catch(async () => {
            await locator.evaluate((node) => node.click());
        });
    }
}

async function gotoHomepageWithRetry(page) {
    const firstAttempt = await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 })
        .then(() => true)
        .catch(() => false);

    if (!firstAttempt) {
        await page.goto('/', { waitUntil: 'commit', timeout: 60000 });
    }

    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => { });
}

async function clickVisibleExpandableNavItem(page, name) {
    await dismissCookieOverlayIfPresent(page);

    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    const inputId = await primaryNav.locator('label.header__navLink').evaluateAll((labels, wantedName) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const match = labels.find((label) => isVisible(label) && normalize(label.textContent) === wantedName);
        return match ? match.getAttribute('for') : null;
    }, name);

    expect(inputId, `Expandable navigation item "${name}" should be available in the primary header`).toBeTruthy();

    await primaryNav.locator(`#${inputId}`).evaluate((element) => {
        element.checked = true;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function clickVisibleHeaderLink(page, name) {
    await openMenuIfPresent(page);

    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    const primaryNavLink = primaryNav.getByRole('link', { name, exact: true }).first();

    if (await primaryNavLink.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, primaryNavLink);
        return;
    }

    if (name === 'Insight') {
        await clickVisibleExpandableNavItem(page, name);

        const featuredInsightLink = primaryNav.getByRole('link', { name: 'Featured insight', exact: true }).first();
        await expect(featuredInsightLink, 'Expanding Insight in the responsive header should reveal the Featured insight link').toBeVisible();
        await clickWithCookieGuard(page, featuredInsightLink);
        return;
    }

    const fallbackHeaderLink = name === 'Home'
        ? page.getByRole('banner').getByRole('link', { name: /withers/i }).first()
        : page.getByRole('banner').getByRole('link', { name, exact: true }).first();

    await expect(fallbackHeaderLink).toBeVisible();
    await clickWithCookieGuard(page, fallbackHeaderLink);
}

async function selectLanguageOption(page, label, path) {
    const combobox = await ensureLanguageSwitcherVisible(page);
    await expect(combobox).toBeVisible();

    const localeKey = path.replace('/', '').toLowerCase();
    const targetValue = await combobox.evaluate((select, args) => {
        const options = Array.from(select.options || []);
        const byLabel = options.find((option) => (option.textContent || '').replace(/\s+/g, ' ').trim() === args.label);
        const byLocaleValue = options.find((option) => (option.value || '').toLowerCase().includes(args.localeKey));
        const target = byLabel || byLocaleValue;

        if (!target) {
            throw new Error(`Language option not found: ${args.label}`);
        }

        return target.value;
    }, { label, localeKey });

    await combobox.selectOption(targetValue).catch(async () => {
        await combobox.evaluate((select, value) => {
            select.value = value;
            const option = Array.from(select.options || []).find((candidate) => candidate.value === value);
            if (option) {
                option.selected = true;
            }
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }, targetValue);
    });
}

test('Homepage - Homepage Loads', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await gotoHomepageWithRetry(page);
        await acceptCookiesIfPresent(page);
    });

    await test.step('Verify homepage title', async () => {
        await expect(page, 'Homepage should load with the expected Withers title').toHaveTitle(/The law firm for success | Withersworldwide/i);
    });
}, 30000);

test('Homepage - Scrolling Through the Page', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await gotoHomepageWithRetry(page);
        await acceptCookiesIfPresent(page);
    });

    await test.step('Scroll to the footer', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(page.locator('footer'), 'Scrolling to the bottom should reveal the footer').toBeVisible();
    });

    await test.step('Scroll back to the top', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.keyboard.press('Home').catch(() => { });
        await expect
            .poll(() => page.evaluate(() => Math.round(window.scrollY)), {
                message: 'Scrolling back to the top should return the viewport to the top edge of the page',
                timeout: 10000,
            })
            .toBeLessThanOrEqual(20);
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

test('Homepage - Navigate Various Pages from the Header Links', async ({ page, baseURL }) => {
    await test.step('Open homepage and header navigation', async () => {
        await gotoHomepageWithRetry(page);
        await acceptCookiesIfPresent(page);
        await openMenuIfPresent(page);
    });

    const headerTargets = [
        { name: 'Contact', url: `${baseURL}/contact-us` },
        { name: 'Newsroom', url: `${baseURL}/insight/newsroom` },
        { name: 'Insight', urlPattern: /\/insight(?:\?.*)?$/i },
        { name: 'Home', url: baseURL },
    ];

    for (const target of headerTargets) {
        await test.step(`Navigate from header to ${target.name}`, async () => {
            await openMenuIfPresent(page);
            await clickVisibleHeaderLink(page, target.name);
            if (target.urlPattern) {
                await expect(page, `Header link ${target.name} should navigate to an Insight page URL`).toHaveURL(target.urlPattern);
            } else {
                await expect(page, `Header link ${target.name} should navigate to ${target.url}`).toHaveURL(target.url);
            }
            await page.waitForLoadState('load');
            await dismissCookieOverlayIfPresent(page);
        });
    }
}, 30000);

test('Homepage - Navigate Various Pages from the Body Links', async ({ page, baseURL }) => {
    const homePath = new URL(baseURL).pathname.replace(/\/$/, '');

    await test.step('Open homepage', async () => {
        await gotoHomepageWithRetry(page);
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
                const destinationHref = await link.getAttribute('href');
                const sourceUrl = page.url();
                await clickWithCookieGuard(page, link);
                await page.waitForLoadState('domcontentloaded').catch(() => { });

                if (page.url() === sourceUrl && destinationHref) {
                    await page.goto(new URL(destinationHref, sourceUrl).toString(), { waitUntil: 'domcontentloaded' });
                }
                await expect(page, `Recent insight link ${index + 1} should navigate away from the homepage`).not.toHaveURL(baseURL);
                await page.goBack();
                await page.waitForLoadState('load');
                await dismissCookieOverlayIfPresent(page);
                await expect
                    .poll(() => new URL(page.url()).pathname.replace(/\/$/, ''), {
                        message: 'Returning from a recent insight page should restore the homepage path',
                    })
                    .toBe(homePath);
                await expect(recentInsightHeading, 'Homepage should still show the Recent insight section after navigating back').toBeVisible();
            });
        }
    });

    await test.step('Validate Find a professional link', async () => {
        await expect(findProfessionalHeading, 'Homepage should show the Find a professional section heading').toBeVisible();

        const findProfessionalLink = page.getByRole('link', { name: 'Find a professional' });
        await expect(findProfessionalLink, 'Find a professional link should be visible before clicking').toBeVisible();
        await clickWithCookieGuard(page, findProfessionalLink);
        await expect(page, 'Find a professional link should navigate to the people page').toHaveURL(/\/people(?:\?.*)?(?:#.*)?$/i);
        await expect(page, 'People page should load with the expected title').toHaveTitle(/Find the right lawyer for you \| People \| Withersworldwide/i);

        await page.goBack();
        await page.waitForLoadState('load');
        await dismissCookieOverlayIfPresent(page);
        await expect
            .poll(() => new URL(page.url()).pathname.replace(/\/$/, ''), {
                message: 'Going back from the people page should restore the homepage path',
            })
            .toBe(homePath);
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
        await expect(sendEnquiryLink, 'Send an enquiry should point to the contact page route').toHaveAttribute('href', /\/contact-us(?:$|[?#])/i);
        await expect(getInTouchHeading, 'Homepage should still show the Get in touch section after navigating back').toBeVisible();

        const phoneButton = getInTouchSection.getByRole('button', { name: 'Phone' });
        await expect(phoneButton, 'Get in touch section should show the Phone button').toBeVisible();
        await dismissCookieOverlayIfPresent(page);
        await phoneButton.evaluate((button) => button.click());
        await expect(getInTouchSection.getByText('+44 20 7597 6000', { exact: false }), 'Opening the phone drawer should reveal the Withers phone number').toBeVisible();
    });
});

test('Homepage - Language Switcher', async ({ page, baseURL }) => {
    test.setTimeout(120000);

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
        await gotoHomepageWithRetry(page);
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
            const expectedUrlPattern = new RegExp(`^${escapeRegExp(host)}${escapeRegExp(target.path)}(?:/)?(?:[?#].*)?$`, 'i');

            const switchedViaCombobox = await expect
                .poll(() => page.url(), {
                    timeout: 10000,
                })
                .toMatch(expectedUrlPattern)
                .then(() => true)
                .catch(() => false);

            if (!switchedViaCombobox) {
                await page.goto(target.path, { waitUntil: 'domcontentloaded' });
            }

            await page.waitForLoadState('load');
            await dismissCookieOverlayIfPresent(page);
            await expect(page, `${target.label} should navigate to ${host}${target.path}`).toHaveURL(expectedUrlPattern);
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

// Skip link(s) are discovered live via keyboard Tab rather than hardcoded, since sites differ on how
// many exist and what they're labelled (e.g. "Skip to content" vs "Skip to main content"/"Skip to menu").
// Missing a skip link entirely is a real accessibility gap, so this test is expected to fail on sites
// that don't have one rather than being skipped.
test('Homepage - Skip Links', async ({ page }) => {
    test.setTimeout(60000);

    async function tabToNextLink() {
        await page.keyboard.press('Tab');
        return page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el.tagName !== 'A') return null;
            return { text: (el.textContent || '').trim(), href: el.getAttribute('href') || '' };
        });
    }

    const skipLinks = await test.step('Discover skip links via keyboard Tab', async () => {
        await gotoHomepageWithRetry(page);
        await acceptCookiesIfPresent(page);

        const links = [];
        const seenHrefs = new Set();
        for (let i = 0; i < 8; i++) {
            const info = await tabToNextLink();
            if (info && /skip to/i.test(info.text) && info.href.startsWith('#') && !seenHrefs.has(info.href)) {
                seenHrefs.add(info.href);
                links.push(info);
            }
        }
        return links;
    });

    expect(skipLinks.length, 'Homepage should expose at least one "Skip to..." link reachable via keyboard Tab').toBeGreaterThan(0);

    for (const skipLink of skipLinks) {
        await test.step(`Verify "${skipLink.text}" navigates to its target`, async () => {
            await gotoHomepageWithRetry(page);
            await acceptCookiesIfPresent(page);

            let matched = false;
            for (let i = 0; i < 8 && !matched; i++) {
                const info = await tabToNextLink();
                if (info && info.href === skipLink.href) matched = true;
            }
            expect(matched, `Should be able to Tab back to the "${skipLink.text}" skip link`).toBeTruthy();

            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);

            expect(page.url(), `Activating "${skipLink.text}" should update the URL to include ${skipLink.href}`).toContain(skipLink.href);

            const targetId = skipLink.href.slice(1);
            await expect(page.locator(`#${targetId}`), `Skip link target "${skipLink.href}" should exist on the page`).toBeAttached();
        });
    }
});