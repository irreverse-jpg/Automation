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
// Coverage notes - Where Do I Start (/where-do-i-start) + About Our Care
// Support Team (Request a Callback form)
// ============================================================================
// Scope: the "Where Do I Start" hub page (reached via the real menu, not a
// direct URL) and its "About our care support team" destination page,
// which hosts a real Request a Callback form.
//
// Tests in this file (10 total):
//   1. Where Do I Start - Initial Page Checks
//      Navigates via the menu (Where do I start second-level item),
//      checks title/H1/breadcrumb semantics, follows the hero "Find a care
//      home" CTA to /care-homes and back, checks the "Get in touch"
//      section's "About our care support team" CTA and the "Help and
//      advice" section's "Read more" CTA, then exercises the FAQ
//      accordion (confirms collapsed-by-default, then expands each one by
//      one confirming the previous auto-collapses), and finishes with the
//      TOP button + footer.
//   2-9. Eight generated "Traversal" tests (one per traversalScenarios
//      entry: Do I Need Care, What is a Care Home, Choosing a Care Home,
//      Booking a Viewing, Moving In, Support at a Stressful Time, What
//      Affects Cost, What Does a Good Care Home Look Like) - each opens
//      the destination directly and checks any video/FAQ-accordion/news-
//      panel/nearest-home-search modules present, then the TOP control.
//   10. Where Do I Start - Get in Touch Request a Callback Form Traversal
//      On the "About our care support team" page: title/H1/breadcrumb,
//      the hero "FIND A CARE HOME" button + back, any video module on the
//      page, a "nearest care home" search (M33 + Residential care), the
//      TOP control, then the Request a Callback form's full 3-journey
//      shape (empty-submission browser validation, progressive per-field
//      validation clearing, then a REAL submission gated on manually
//      solving Google reCAPTCHA).
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================
const { getCurrentSubmissionNumber, incrementSubmissionNumber } = require('./submissionCounter');

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function numberToWord(n) {
    const words = [
        'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
    ];
    return n < words.length ? words[n] : `Num${n}`;
}

function careSupportTeamDiscussionText() {
    const sourceText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
    return sourceText.slice(0, 200);
}

async function isRecaptchaSolved(page) {
    const tokenHasValue = await page.evaluate(() => {
        const token = document.querySelector('textarea[name="g-recaptcha-response"], #g-recaptcha-response');
        return Boolean(token && token.value && token.value.trim().length > 0);
    });

    if (tokenHasValue) {
        return true;
    }

    const recaptchaAnchor = page.frameLocator('iframe[title*="reCAPTCHA" i]').locator('#recaptcha-anchor').first();
    const anchorVisible = await recaptchaAnchor.isVisible().catch(() => false);

    if (anchorVisible) {
        const ariaChecked = await recaptchaAnchor.getAttribute('aria-checked').catch(() => null);
        if (ariaChecked === 'true') {
            return true;
        }
    }

    const recaptchaFrame = page.frames().find((frame) => /recaptcha/i.test(frame.url()));
    if (!recaptchaFrame) {
        return false;
    }

    const frameChecked = await recaptchaFrame
        .locator('#recaptcha-anchor')
        .getAttribute('aria-checked')
        .catch(() => null);

    return frameChecked === 'true';
}

async function waitForManualRecaptchaAndEnabledSubmit(page, submitButton, options = {}) {
    const normalizedOptions = typeof options === 'number' ? { timeoutMs: options } : options;
    const timeoutMs = normalizedOptions.timeoutMs ?? 300000;
    const successMessageRegex = normalizedOptions.successMessageRegex ?? null;

    await expect(submitButton, 'Form submit button should be visible before manual reCAPTCHA check').toBeVisible({ timeout: 30000 });
    await submitButton.scrollIntoViewIfNeeded().catch(() => { });
    await page.bringToFront().catch(() => { });

    console.log('Manual action required: please tick the reCAPTCHA checkbox. Test will continue automatically once solved and submit is enabled.');

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        await acceptCookiesIfPresent(page);

        const [recaptchaSolved, submitEnabled, successAlreadyVisible] = await Promise.all([
            isRecaptchaSolved(page),
            submitButton.isEnabled().catch(() => false),
            successMessageRegex
                ? page.getByText(successMessageRegex, { exact: false }).first().isVisible().catch(() => false)
                : Promise.resolve(false),
        ]);

        if (successAlreadyVisible) {
            console.log('Success message is already visible; treating manual submission as complete.');
            return { alreadySubmitted: true };
        }

        if (recaptchaSolved && submitEnabled) {
            console.log('reCAPTCHA solved and submit button enabled. Continuing.');
            return { alreadySubmitted: false };
        }

        await page.waitForTimeout(400);
    }

    throw new Error('Timed out waiting for manual reCAPTCHA completion and enabled submit button on About our care support team form.');
}

async function dismissCookieOverlayIfPresent(page) {
    const acceptTargets = [
        page.locator('#onetrust-accept-btn-handler').first(),
        page.getByRole('button', { name: /accept|allow all|yes, allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
        page.getByRole('link', { name: /allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
    ];

    for (const candidate of acceptTargets) {
        if (await candidate.isVisible().catch(() => false)) {
            await candidate.click({ timeout: 3000 }).catch(() => { });
        }
    }

    const overlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (await overlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }
}

async function acceptCookiesIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const blockedByOverlay = message.includes('intercepts pointer events') || message.includes('cookie') || message.includes('onetrust');

        if (!blockedByOverlay) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

async function openMenuIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);

    const openDrawer = page.locator('.navigation.navigation--open .rootlevel').first();
    if (await openDrawer.isVisible().catch(() => false)) {
        return;
    }

    const navIcon = page.locator('.navicon').first();
    await expect(navIcon, 'The CareUK hamburger menu icon should be visible').toBeVisible();
    await clickWithCookieGuard(page, navIcon);

    await expect(page.locator('.navigation.navigation--open .rootlevel').first(), 'The navigation drawer should open after clicking the menu icon').toBeVisible();
}

async function clickRootLevelItem(page, rootName) {
    await openMenuIfPresent(page);

    const result = await page.evaluate((wantedRoot) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => normalize(node.textContent))
            .join(' ')
            .trim();

        const rootItems = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li'));
        const root = rootItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedRoot);
        if (!root) {
            return { clicked: false };
        }

        const trigger = root.querySelector(':scope > a[href]') || root;
        trigger.click();

        return {
            clicked: true,
            hasSublevel: root.classList.contains('hasSublevel'),
        };
    }, rootName);

    expect(result.clicked, `Root-level menu item "${rootName}" should be clickable`).toBeTruthy();
}

async function clickSecondLevelItem(page, rootName, childName) {
    await openMenuIfPresent(page);

    const result = await page.evaluate(({ wantedRoot, wantedChild }) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => normalize(node.textContent))
            .join(' ')
            .trim();

        const rootItems = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li.hasSublevel'));
        const root = rootItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedRoot);
        if (!root) {
            return { clicked: false, reason: 'root-not-found' };
        }

        const childItems = Array.from(root.querySelectorAll(':scope > .sublevelOne > ul > li'));
        const child = childItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedChild);
        if (!child) {
            return { clicked: false, reason: 'child-not-found' };
        }

        const trigger = child.querySelector(':scope > a[href]') || child;
        trigger.click();

        return { clicked: true };
    }, { wantedRoot: rootName, wantedChild: childName });

    expect(result.clicked, `Second-level menu item "${childName}" under "${rootName}" should be clickable`).toBeTruthy();
}

async function openWhereDoIStartFromMenu(page, baseURL) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'The Where do I start flow should begin at the CareUK homepage').toHaveURL(new URL('/', baseURL).toString());

    await clickRootLevelItem(page, 'Where do I start?');

    await expect.poll(async () => page.evaluate(() => {
        const panel = document.querySelector('.navigation .rootlevel > ul > li.hasSublevel > .sublevelOne');
        if (!panel) {
            return false;
        }

        const style = window.getComputedStyle(panel);
        return style.display !== 'none' && style.visibility !== 'hidden' && panel.getClientRects().length > 0;
    }), {
        message: 'Where do I start? root menu should reveal second-level navigation',
    }).toBe(true);

    await clickSecondLevelItem(page, 'Where do I start?', 'Where do I start?');

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'Second-level Where do I start? navigation should open the canonical page').toHaveURL(new RegExp(`${new URL('/where-do-i-start', baseURL).toString()}(?:$|[?#])`, 'i'));
}

async function openWhereDoIStartPage(page, baseURL) {
    await page.goto('/where-do-i-start', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'Where do I start checks should run from the canonical page URL').toHaveURL(new RegExp(`${new URL('/where-do-i-start', baseURL).toString()}(?:$|[?#])`, 'i'));
}

async function getVisibleContentLink(page, href, textPattern) {
    const candidates = page.locator(`a[href="${href}"]`);
    const count = await candidates.count();

    for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        const isVisible = await candidate.isVisible().catch(() => false);
        if (!isVisible) {
            continue;
        }

        const text = normalizeWhitespace(await candidate.textContent().catch(() => ''));
        if (!textPattern.test(text)) {
            continue;
        }

        const inGlobalChrome = await candidate.evaluate((element) => Boolean(element.closest('header, footer, .navigation, .breadcrumbs, #onetrust-consent-sdk, #onetrust-pc-sdk'))).catch(() => true);
        if (inGlobalChrome) {
            continue;
        }

        return candidate;
    }

    return null;
}

async function openWhereDoIStartSubpage(page, baseURL, route) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, `Expected to open ${route}`).toHaveURL(new RegExp(`${new URL(route, baseURL).toString()}(?:$|[?#])`, 'i'));
}

async function selectExactSearchSuggestion(page, query) {
    const suggestion = page.locator('.tt-suggestion, [role="option"]').filter({ hasText: new RegExp(`^${escapeRegExp(query)}$`, 'i') }).first();
    if (await suggestion.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, suggestion);
        return;
    }

    const containsSuggestion = page.locator('.tt-suggestion, [role="option"]').filter({ hasText: new RegExp(escapeRegExp(query), 'i') }).first();
    if (await containsSuggestion.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, containsSuggestion);
    }
}

async function verifyVideoModuleIfPresent(page) {
    const videoFrame = page.locator('iframe[src*="youtube" i], iframe[src*="vimeo" i]').first();
    if (await videoFrame.isVisible().catch(() => false)) {
        const src = await videoFrame.getAttribute('src');
        expect(src || '', 'Embedded video iframe should point to YouTube or Vimeo').toMatch(/youtube|vimeo/i);
        return;
    }

    const playTrigger = page.locator('button, a').filter({ hasText: /play/i }).first();
    if (!await playTrigger.isVisible().catch(() => false)) {
        return;
    }

    await playTrigger.scrollIntoViewIfNeeded().catch(() => { });
    await clickWithCookieGuard(page, playTrigger);

    await expect.poll(async () => {
        const frame = page.locator('iframe[src*="youtube" i], iframe[src*="vimeo" i]').first();
        if (!await frame.isVisible().catch(() => false)) {
            return '';
        }
        return (await frame.getAttribute('src').catch(() => '')) || '';
    }, {
        message: 'Video module should hydrate to a visible YouTube/Vimeo iframe after play',
        timeout: 10000,
    }).toMatch(/youtube|vimeo/i);
}

async function getGenericAccordionSnapshot(page) {
    return page.evaluate(() => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const buttons = Array.from(document.querySelectorAll('.accordion-button.titleLink')).filter((button) => isVisible(button));
        return buttons.map((button) => {
            const targetSelector = button.getAttribute('data-bs-target') || '';
            const panel = targetSelector ? document.querySelector(targetSelector) : null;
            const panelShown = Boolean(panel && panel.classList.contains('show'));
            return {
                text: normalize(button.textContent),
                expanded: panelShown || !button.classList.contains('collapsed'),
                collapsedClass: button.classList.contains('collapsed'),
            };
        });
    });
}

async function clickGenericAccordionByIndex(page, index) {
    const clicked = await page.evaluate((targetIndex) => {
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };
        const buttons = Array.from(document.querySelectorAll('.accordion-button.titleLink')).filter((button) => isVisible(button));
        const target = buttons[targetIndex];

        if (!target) {
            return false;
        }

        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        target.click();
        return true;
    }, index);

    expect(clicked, `Accordion item at index ${index} should be clickable`).toBe(true);
}

async function verifyAccordionModuleIfPresent(page) {
    const snapshot = await getGenericAccordionSnapshot(page);
    if (snapshot.length === 0) {
        return;
    }

    await clickGenericAccordionByIndex(page, 0);
    await expect.poll(async () => {
        const current = await getGenericAccordionSnapshot(page);
        return current[0]?.expanded;
    }, {
        message: 'First accordion item should expand after click',
        timeout: 10000,
    }).toBe(true);

    if (snapshot.length > 1) {
        await clickGenericAccordionByIndex(page, 1);
        await expect.poll(async () => {
            const current = await getGenericAccordionSnapshot(page);
            return current.some((item) => item.expanded);
        }, {
            message: 'After interacting with a second accordion item, at least one item should remain expanded',
            timeout: 10000,
        }).toBe(true);
    }
}

async function verifyNewsPanelIfPresent(page, baseURL, route) {
    const allTiles = page.locator('a.article__tile');
    const tileCount = await allTiles.count();
    if (tileCount === 0) {
        return;
    }

    const featuredTiles = page.locator('.newsPanel__main a.article__tile');
    await expect(featuredTiles.first(), 'News panel should expose a featured main tile').toBeVisible();

    const listedTiles = page.locator('.newsPanel__newsItems a.article__tile');
    await expect.poll(async () => listedTiles.count(), {
        message: 'News panel should expose list tiles beside/below the featured tile',
        timeout: 10000,
    }).toBeGreaterThanOrEqual(1);

    const visibleBefore = await allTiles.filter({ visible: true }).count();
    const showMore = page.locator('a.button.button__secondary--hollow, a').filter({ hasText: /^show more$/i }).first();

    if (await showMore.isVisible().catch(() => false)) {
        await showMore.scrollIntoViewIfNeeded().catch(() => { });
        await clickWithCookieGuard(page, showMore);

        await expect.poll(async () => allTiles.filter({ visible: true }).count(), {
            message: 'Show more should keep or increase the number of visible article cards',
            timeout: 10000,
        }).toBeGreaterThanOrEqual(visibleBefore);
    }

    const candidate = allTiles.filter({ visible: true }).first();
    await expect(candidate, 'At least one news/help article tile should be visible').toBeVisible();

    const href = await candidate.getAttribute('href');
    expect(href, 'Article tile should include an href target').toBeTruthy();

    const expectedTitle = normalizeWhitespace(await candidate.locator('.article__title, h3, h4').first().textContent().catch(() => ''));

    await clickWithCookieGuard(page, candidate);
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);

    await expect(page, 'Article click should navigate to a help/advice destination URL').toHaveURL(new RegExp(escapeRegExp(new URL(href, baseURL).toString()), 'i'));

    const h1 = page.getByRole('heading', { level: 1 }).first();
    await expect(h1, 'Article page should render an H1 heading').toBeVisible();
    if (expectedTitle) {
        const shortExpected = expectedTitle.split(' ').slice(0, 4).join(' ');
        const actualH1 = normalizeWhitespace(await h1.textContent().catch(() => ''));
        const title = await page.title();
        expect(`${actualH1} ${title}`, 'Article destination H1/title should align with the clicked tile title').toMatch(new RegExp(escapeRegExp(shortExpected), 'i'));
    }

    await openWhereDoIStartSubpage(page, baseURL, route);
}

async function verifyNearestHomeModuleIfPresent(page, baseURL, route) {
    const nearestHeading = page.getByRole('heading', { name: /your nearest care home/i }).first();
    if (!await nearestHeading.isVisible().catch(() => false)) {
        return;
    }

    await nearestHeading.scrollIntoViewIfNeeded().catch(() => { });

    const nearestSection = page.locator('.nearestHome, .nearestHome__wrapper').first();
    const searchInput = nearestSection.locator('input#careHomeSearch, input[name="search"], input[placeholder*="postcode" i]').first();
    await expect(searchInput, 'Nearest care home section should expose postcode search input').toBeVisible();

    await searchInput.click();
    await searchInput.fill('');
    await searchInput.pressSequentially('M33', { delay: 120 });
    await selectExactSearchSuggestion(page, 'M33');

    const careTypeSelect = nearestSection.locator('select[name="type"], select.form-select').first();
    await expect(careTypeSelect, 'Nearest care home section should expose care type dropdown').toBeVisible();
    await careTypeSelect.selectOption({ value: 'residential-care' }).catch(async () => {
        await careTypeSelect.selectOption({ label: 'Residential care' });
    });

    const submitButton = nearestSection.getByRole('button', { name: /^submit$/i }).first();
    await expect(submitButton, 'Nearest care home section should expose submit button').toBeVisible();
    await clickWithCookieGuard(page, submitButton);

    await expect.poll(async () => {
        const bodyText = await page.locator('body').textContent().catch(() => '');
        return /oakfield croft/i.test(bodyText || '');
    }, {
        message: 'Searching nearest care home with M33 and Residential care should return Oakfield Croft',
        timeout: 15000,
    }).toBe(true);

    const viewThisHome = page.locator('a[href*="/care-homes/"]').filter({ hasText: /view this home|view home/i }).first();
    await expect(viewThisHome, 'Nearest care home result should expose a VIEW THIS HOME action').toBeVisible();
    await clickWithCookieGuard(page, viewThisHome);

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'VIEW THIS HOME should navigate to Oakfield Croft').toHaveURL(new RegExp(`${new URL('/care-homes/oakfield-croft-sale', baseURL).toString()}(?:$|[?#])`, 'i'));

    await openWhereDoIStartSubpage(page, baseURL, route);
}

async function verifyTopControlIfPresent(page) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const footer = page.getByRole('contentinfo').first();
    await expect(footer, 'Footer should be visible while validating TOP control').toBeVisible();

    const topControl = page.locator('.footer__scrolltop a, .footer__scrolltop button').first()
        .or(page.locator('a, button').filter({ hasText: /^top$/i }).first());

    if (!await topControl.isVisible().catch(() => false)) {
        return;
    }

    await clickWithCookieGuard(page, topControl);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), {
        message: 'TOP control should return the viewport to the top',
        timeout: 10000,
    }).toBeLessThanOrEqual(10);
}

async function getFaqSnapshot(page) {
    return page.evaluate(() => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const faqHeading = Array.from(document.querySelectorAll('h3')).find((heading) => normalize(heading.textContent).toLowerCase() === 'faqs' && isVisible(heading));
        const faqContainer = faqHeading?.closest('.container') || faqHeading?.parentElement || document;
        const buttons = Array.from(faqContainer.querySelectorAll('.accordion-button.titleLink')).filter((button) => isVisible(button));

        return buttons.map((button) => {
            const icon = button.querySelector('svg.cukicon-add');
            const targetSelector = button.getAttribute('data-bs-target') || '';
            const panel = targetSelector ? document.querySelector(targetSelector) : null;
            const panelShown = Boolean(panel && panel.classList.contains('show'));
            const collapsedClass = button.classList.contains('collapsed');
            return {
                text: normalize(button.textContent),
                expanded: panelShown || !collapsedClass,
                collapsedClass,
                iconTransform: icon ? window.getComputedStyle(icon).transform : 'none',
            };
        });
    });
}

async function clickFaqByIndex(page, index) {
    const clicked = await page.evaluate((targetIndex) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };
        const isExpanded = (button) => {
            const targetSelector = button.getAttribute('data-bs-target') || '';
            const panel = targetSelector ? document.querySelector(targetSelector) : null;
            return Boolean(panel && panel.classList.contains('show')) || !button.classList.contains('collapsed');
        };

        const faqHeading = Array.from(document.querySelectorAll('h3')).find((heading) => normalize(heading.textContent).toLowerCase() === 'faqs' && isVisible(heading));
        const faqContainer = faqHeading?.closest('.container') || faqHeading?.parentElement || document;
        const buttons = Array.from(faqContainer.querySelectorAll('.accordion-button.titleLink')).filter((button) => isVisible(button));
        const target = buttons[targetIndex];

        if (!target) {
            return false;
        }

        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        target.click();

        if (!isExpanded(target)) {
            const targetSelector = target.getAttribute('data-bs-target') || '';
            const panel = targetSelector ? document.querySelector(targetSelector) : null;

            if (panel && window.bootstrap?.Collapse?.getOrCreateInstance) {
                const accordion = panel.closest('.accordion');
                if (accordion) {
                    const shownPanels = Array.from(accordion.querySelectorAll('.accordion-collapse.show'));
                    for (const shownPanel of shownPanels) {
                        if (shownPanel === panel) {
                            continue;
                        }

                        window.bootstrap.Collapse.getOrCreateInstance(shownPanel, { toggle: false }).hide();
                    }
                }

                window.bootstrap.Collapse.getOrCreateInstance(panel, { toggle: false }).show();
            } else if (panel) {
                panel.classList.add('show');
                target.classList.remove('collapsed');
                target.setAttribute('aria-expanded', 'true');
            }
        }

        return true;
    }, index);

    expect(clicked, `FAQ item at index ${index} should be clickable`).toBe(true);
}

test('Where Do I Start - Initial Page Checks', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Open homepage, expand menu, and navigate via Where do I start second-level item', async () => {
        await openWhereDoIStartFromMenu(page, baseURL);
    });

    await test.step('Verify page title, H1 and breadcrumb semantics', async () => {
        await expect(page, 'Where do I start page should expose the expected title').toHaveTitle(/Where do I start\?/i);
        await expect(page.getByRole('heading', { level: 1, name: /^Where do I start\?$/i }).first(), 'Where do I start page should expose a matching H1').toBeVisible();

        const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
        await expect(breadcrumb, 'Where do I start page should expose a breadcrumb nav in the DOM').toHaveCount(1);

        const homeIconLink = breadcrumb.locator('a.home-icon[href="/"]').first();
        await expect(homeIconLink, 'Breadcrumb should start with the home icon link').toHaveCount(1);

        const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
        await expect(currentItem, 'Breadcrumb current item should be present').toHaveCount(1);
        await expect(currentItem, 'Breadcrumb current item should read Where do I start?').toHaveText(/where do i start\?/i);

        const breadcrumbItems = breadcrumb.locator('.breadcrumb-item');
        await expect(breadcrumbItems, 'Breadcrumb should represent Home / Where do I start? as two trail items').toHaveCount(2);
    });

    await test.step('Verify hero Find a care home CTA navigates to /care-homes', async () => {
        const heroFindCareHome = page.locator('.hero a[href="/care-homes"], [class*="hero"] a[href="/care-homes"]').filter({ hasText: /find a care home/i }).first();
        await expect(heroFindCareHome, 'The page hero should expose Find a care home').toBeVisible();

        await clickWithCookieGuard(page, heroFindCareHome);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Hero Find a care home CTA should navigate to /care-homes').toHaveURL(new RegExp(`${new URL('/care-homes', baseURL).toString()}(?:$|[?#])`, 'i'));
    });

    await test.step('Return to Where do I start page for CTA and FAQ checks', async () => {
        await openWhereDoIStartPage(page, baseURL);
    });

    const primaryReadMoreCards = [
        { heading: 'Do I need care', href: '/where-do-i-start/do-i-need-care' },
        { heading: 'What is a care home?', href: '/where-do-i-start/what-is-a-care-home' },
        { heading: 'Choosing a care home', href: '/where-do-i-start/choosing-a-care-home' },
        { heading: 'Booking a viewing', href: '/where-do-i-start/booking-a-viewing' },
        { heading: 'Moving in', href: '/where-do-i-start/moving-in' },
        { heading: 'Support at a stressful time', href: '/where-do-i-start/support-at-a-stressful-time' },
        { heading: 'What affects cost', href: '/where-do-i-start/what-affects-cost' },
    ];

    for (const card of primaryReadMoreCards) {
        await test.step(`Verify ${card.heading} with Read more -> ${card.href}`, async () => {
            const heading = page.getByRole('heading', { level: 4, name: new RegExp(`^${card.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).first();
            await heading.scrollIntoViewIfNeeded().catch(() => { });
            await expect(heading, `${card.heading} H4 should be visible`).toBeVisible();

            const readMore = await getVisibleContentLink(page, card.href, /^read more$/i);
            expect(readMore, `${card.heading} section should expose a visible Read more CTA with ${card.href}`).toBeTruthy();
            await expect(readMore, `${card.heading} Read more should target ${card.href}`).toHaveAttribute('href', card.href);
        });
    }

    await test.step('Verify Get in touch section and About our care support team CTA', async () => {
        const getInTouchHeading = page.getByRole('heading', { level: 3, name: /^Get in touch$/i }).first();
        await getInTouchHeading.scrollIntoViewIfNeeded().catch(() => { });
        await expect(getInTouchHeading, 'Get in touch H3 should be visible').toBeVisible();

        const aboutTeamCta = await getVisibleContentLink(page, '/where-do-i-start/about-our-care-support-team', /about our care support team/i);
        expect(aboutTeamCta, 'Get in touch section should expose ABOUT OUR CARE SUPPORT TEAM CTA').toBeTruthy();
        await expect(aboutTeamCta, 'ABOUT OUR CARE SUPPORT TEAM CTA should target /where-do-i-start/about-our-care-support-team').toHaveAttribute('href', '/where-do-i-start/about-our-care-support-team');
    });

    await test.step('Verify Help and advice section and Read more CTA', async () => {
        const helpAdviceHeading = page.getByRole('heading', { level: 4, name: /^Help and advice$/i }).first();
        await helpAdviceHeading.scrollIntoViewIfNeeded().catch(() => { });
        await expect(helpAdviceHeading, 'Help and advice H4 should be visible').toBeVisible();

        const helpAdviceCta = await getVisibleContentLink(page, '/help-advice', /^read more$/i);
        expect(helpAdviceCta, 'Help and advice section should expose a Read more CTA to /help-advice').toBeTruthy();
        await expect(helpAdviceCta, 'Help and advice Read more should target /help-advice').toHaveAttribute('href', '/help-advice');
    });

    await test.step('Verify FAQs heading and accordion collapsed default state', async () => {
        const faqHeading = page.getByRole('heading', { level: 3, name: /^FAQs$/i }).first();
        await faqHeading.scrollIntoViewIfNeeded().catch(() => { });
        await expect(faqHeading, 'FAQs heading should be visible').toBeVisible();

        const snapshot = await getFaqSnapshot(page);
        expect(snapshot.length, 'FAQs should expose accordion items to validate').toBeGreaterThan(0);

        const initiallyExpandedIndexes = snapshot
            .map((item, index) => (item.expanded ? index : -1))
            .filter((index) => index >= 0);

        expect(initiallyExpandedIndexes.length, 'FAQ accordion should start with no more than one open item').toBeLessThanOrEqual(1);

        for (let index = 0; index < snapshot.length; index += 1) {
            const button = snapshot[index];
            const isInitiallyExpanded = initiallyExpandedIndexes.includes(index);

            if (isInitiallyExpanded) {
                expect(button.collapsedClass, `Initially expanded FAQ item ${index + 1} should not carry collapsed class`).toBe(false);
                expect(button.iconTransform, `Initially expanded FAQ item ${index + 1} should display X icon state`).not.toBe('none');
                continue;
            }

            expect(button.expanded, `FAQ item ${index + 1} should be collapsed before traversal checks`).toBe(false);
            expect(button.collapsedClass, `FAQ item ${index + 1} should carry collapsed class before traversal checks`).toBe(true);
            expect(button.iconTransform, `FAQ item ${index + 1} should show plus icon state while collapsed`).toBe('none');
        }
    });

    await test.step('Expand each FAQ one by one and ensure previous collapses', async () => {
        const initialSnapshot = await getFaqSnapshot(page);
        const count = initialSnapshot.length;

        for (let activeIndex = 0; activeIndex < count; activeIndex += 1) {
            await dismissCookieOverlayIfPresent(page);
            await clickFaqByIndex(page, activeIndex);

            await expect.poll(async () => {
                const snapshot = await getFaqSnapshot(page);
                return snapshot[activeIndex]?.expanded;
            }, {
                message: `FAQ item ${activeIndex + 1} should expand when selected`,
                timeout: 10000,
            }).toBe(true);

            const snapshot = await getFaqSnapshot(page);
            expect(snapshot[activeIndex].collapsedClass, `Expanded FAQ item ${activeIndex + 1} should not have collapsed class`).toBe(false);
            expect(snapshot[activeIndex].iconTransform, `Expanded FAQ item ${activeIndex + 1} should switch icon from plus to X state`).not.toBe('none');
        }
    });

    await test.step('Verify TOP button scroll behavior and footer visibility', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

        const footer = page.getByRole('contentinfo').first();
        await expect(footer, 'Footer should be visible at the bottom of the page').toBeVisible();

        const topButton = page.locator('a, button').filter({ hasText: /^top$/i }).first();
        if (await topButton.isVisible().catch(() => false)) {
            await clickWithCookieGuard(page, topButton);
            await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), {
                message: 'Clicking TOP should return the viewport to the top of the page',
                timeout: 10000,
            }).toBeLessThanOrEqual(10);
        }
    });
}, 180000);

const traversalScenarios = [
    {
        name: 'Where Do I Start - Do I Need Care Traversal',
        route: '/where-do-i-start/do-i-need-care',
    },
    {
        name: 'Where Do I Start - What is a Care Home Traversal',
        route: '/where-do-i-start/what-is-a-care-home',
    },
    {
        name: 'Where Do I Start - Choosing a Care Home Traversal',
        route: '/where-do-i-start/choosing-a-care-home',
    },
    {
        name: 'Where Do I Start - Booking a Viewing Traversal',
        route: '/where-do-i-start/booking-a-viewing',
    },
    {
        name: 'Where Do I Start - Moving In Traversal',
        route: '/where-do-i-start/moving-in',
    },
    {
        name: 'Where Do I Start - Support at a Stressful Time Traversal',
        route: '/where-do-i-start/support-at-a-stressful-time',
    },
    {
        name: 'Where Do I Start - What Affects Cost Traversal',
        route: '/where-do-i-start/what-affects-cost',
    },
    {
        name: 'Where Do I Start - What Does a Good Care Home Look Like Traversal',
        route: '/where-do-i-start/what-does-a-good-care-home-look-like',
    },
];

for (const scenario of traversalScenarios) {
    test(scenario.name, async ({ page, baseURL }) => {
        test.setTimeout(120000);

        await openWhereDoIStartSubpage(page, baseURL, scenario.route);
        await verifyVideoModuleIfPresent(page);
        await verifyAccordionModuleIfPresent(page);
        await verifyNewsPanelIfPresent(page, baseURL, scenario.route);
        await verifyNearestHomeModuleIfPresent(page, baseURL, scenario.route);
        await verifyTopControlIfPresent(page);
    }, 120000);
}

test('Where Do I Start - Get in Touch Request a Callback Form Traversal', async ({ page, baseURL }) => {
    test.setTimeout(600000);

    const route = '/where-do-i-start/about-our-care-support-team';
    const submissionCounterKey = 'careuk-wdis-about-care-support-team-form';
    const submissionNumber = getCurrentSubmissionNumber(submissionCounterKey);
    const submissionWord = numberToWord(submissionNumber);
    const uniqueName = `Jane ${submissionWord}`;
    const uniquePhone = `07${String(submissionNumber).padStart(9, '0').slice(-9)}`;
    const uniqueEmail = `jane.caresupport.${submissionNumber}@example.com`;

    await test.step('Open About our care support team page and verify title, H1, and breadcrumb', async () => {
        await openWhereDoIStartSubpage(page, baseURL, route);

        await expect(page, 'Page title should include the key words care support team across environments').toHaveTitle(/care\s*support\s*team/i);
        await expect(page.getByRole('heading', { level: 1 }).first(), 'H1 should read Free advice and support').toHaveText(/free advice and support/i);

        const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
        await expect(breadcrumb, 'About our care support team page should expose breadcrumb navigation').toBeVisible();
        const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
        await expect(currentItem, 'Breadcrumb current item should read About our care support team').toHaveText(/about our care support team/i);
    });

    await test.step('Verify hero FIND A CARE HOME button navigates to /care-homes and return', async () => {
        const heroFindCareHome = page.locator('.hero a[href="/care-homes"], [class*="hero"] a[href="/care-homes"]').filter({ hasText: /find a care home/i }).first();
        await expect(heroFindCareHome, 'Hero should expose FIND A CARE HOME CTA').toBeVisible();

        await clickWithCookieGuard(page, heroFindCareHome);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Hero CTA should navigate to /care-homes').toHaveURL(new RegExp(`${new URL('/care-homes', baseURL).toString()}(?:$|[?#])`, 'i'));

        await openWhereDoIStartSubpage(page, baseURL, route);
    });

    await test.step('Verify video module behavior on About our care support team page', async () => {
        await verifyVideoModuleIfPresent(page);
    });

    await test.step('Verify nearest care home module with M33 Residential care flow', async () => {
        await verifyNearestHomeModuleIfPresent(page, baseURL, route);
    });

    await test.step('Use TOP control to return to top, then move back to the form', async () => {
        await verifyTopControlIfPresent(page);
    });

    const nameInput = page.getByRole('textbox', { name: /^your name$/i }).first();
    const phoneInput = page.getByRole('textbox', { name: /^telephone$/i }).first();
    const emailInput = page.getByRole('textbox', { name: /^email$/i }).first();
    const careHomeNameInput = page.getByRole('textbox', { name: /^care home name$/i }).first();
    const discussionInput = page.getByRole('textbox', { name: /^what you would like to discuss$/i }).first();
    const submitButton = page.getByRole('button', { name: /^submit$/i }).first();

    await test.step('Locate form and verify all expected fields are visible', async () => {
        await nameInput.scrollIntoViewIfNeeded().catch(() => { });
        await expect(nameInput, 'Form should expose Your name field').toBeVisible({ timeout: 15000 });
        await expect(phoneInput, 'Form should expose Telephone field').toBeVisible({ timeout: 15000 });
        await expect(emailInput, 'Form should expose Email field').toBeVisible({ timeout: 15000 });
        await expect(careHomeNameInput, 'Form should expose Care home name field').toBeVisible({ timeout: 15000 });
        await expect(discussionInput, 'Form should expose What you would like to discuss field').toBeVisible({ timeout: 15000 });
        await expect(submitButton, 'Form should expose Submit button').toBeVisible({ timeout: 15000 });
    });

    await test.step('Journey 1: Submit with all fields empty and verify name required browser validation', async () => {
        await nameInput.scrollIntoViewIfNeeded().catch(() => { });
        await clickWithCookieGuard(page, submitButton);
        await page.waitForTimeout(300);

        const nameValidationMessage = normalizeWhitespace(await nameInput.evaluate((el) => el.validationMessage || ''));
        expect(nameValidationMessage.toLowerCase(), 'Your name required validation should be Please fill in this field').toContain('please fill in this field');
    });

    await test.step('Journey 2: Progressive field filling and per-field validation clearing', async () => {
        await nameInput.fill(uniqueName);
        await nameInput.press('Tab').catch(() => { });
        await page.waitForTimeout(300);

        const requiredFieldValidationMessages = await Promise.all([
            phoneInput.evaluate((el) => el.validationMessage || '').catch(() => ''),
            emailInput.evaluate((el) => el.validationMessage || '').catch(() => ''),
            careHomeNameInput.evaluate((el) => el.validationMessage || '').catch(() => ''),
            discussionInput.evaluate((el) => el.validationMessage || '').catch(() => ''),
        ]);

        const nonEmptyValidationCount = requiredFieldValidationMessages
            .map((value) => normalizeWhitespace(value))
            .filter((value) => value.length > 0).length;

        expect(
            nonEmptyValidationCount >= 3,
            'After filling Your name only, validation feedback should be present for remaining required fields'
        ).toBeTruthy();

        await phoneInput.fill(uniquePhone);
        await phoneInput.press('Tab').catch(() => { });
        await page.waitForTimeout(250);
        await expect.poll(async () => normalizeWhitespace(await phoneInput.evaluate((el) => el.validationMessage || '').catch(() => '')), {
            message: 'Telephone validation message should clear after entering a valid number',
            timeout: 5000,
        }).toBe('');

        await emailInput.fill(uniqueEmail);
        await emailInput.press('Tab').catch(() => { });
        await page.waitForTimeout(250);
        await expect.poll(async () => normalizeWhitespace(await emailInput.evaluate((el) => el.validationMessage || '').catch(() => '')), {
            message: 'Email validation message should clear after entering a valid email',
            timeout: 5000,
        }).toBe('');

        await careHomeNameInput.fill('Abney Court');
        await careHomeNameInput.press('Tab').catch(() => { });
        await page.waitForTimeout(250);
        await expect.poll(async () => normalizeWhitespace(await careHomeNameInput.evaluate((el) => el.validationMessage || '').catch(() => '')), {
            message: 'Care home name validation message should clear after entering Abney Court',
            timeout: 5000,
        }).toBe('');

        await discussionInput.fill(careSupportTeamDiscussionText());
        await discussionInput.press('Tab').catch(() => { });
        await page.waitForTimeout(250);
        await expect.poll(async () => normalizeWhitespace(await discussionInput.evaluate((el) => el.validationMessage || '').catch(() => '')), {
            message: 'Discussion field validation message should clear after entering discussion text',
            timeout: 5000,
        }).toBe('');
    });

    await test.step('Journey 3: Wait for manual reCAPTCHA, submit automatically, and verify success message', async () => {
        const waitResult = await waitForManualRecaptchaAndEnabledSubmit(page, submitButton, {
            successMessageRegex: /thanks for getting in touch\s*we will aim to call you back within 24 hours\.?/i,
        });

        if (!waitResult.alreadySubmitted) {
            await clickWithCookieGuard(page, submitButton);
            await page.waitForLoadState('domcontentloaded').catch(() => { });
            await page.waitForTimeout(1200);
        }

        await expect(
            page.locator('body').first(),
            'Successful submission should show callback confirmation message where the form was'
        ).toContainText(/thanks for getting in touch\s*we will aim to call you back within 24 hours\.?/i, { timeout: 30000 });

        incrementSubmissionNumber(submissionCounterKey);
    });
}, 600000);


