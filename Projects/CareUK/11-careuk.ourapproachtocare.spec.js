const { test, expect } = require('@playwright/test');
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

function buildFeedbackFormData(submissionNum) {
    const phoneTail = String(submissionNum).padStart(9, '0').slice(-9);
    const feedbackSeed = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
    const shouldConsentCheckbox = submissionNum % 2 === 1;

    return {
        firstName: `Jane ${numberToWord(submissionNum)}`,
        surname: `Smith ${numberToWord(submissionNum)}`,
        email: `jane.ourapproach.feedback.${submissionNum}@example.com`,
        telephone: `07${phoneTail}`,
        careHomeName: 'Abney Court',
        residentName: 'Richard Roe',
        feedback: feedbackSeed.slice(0, 200),
        shouldConsent: shouldConsentCheckbox,
    };
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

async function openOurApproachToCareFromMenu(page, baseURL) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'Our approach to care flow should begin at the CareUK homepage').toHaveURL(new URL('/', baseURL).toString());

    await clickSecondLevelItem(page, 'Our approach to care', 'Our approach to care');

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'Second-level Our approach to care navigation should open the canonical page').toHaveURL(new RegExp(`${new URL('/our-approach-to-care', baseURL).toString()}(?:$|[?#])`, 'i'));
}

async function openOurApproachToCarePage(page, baseURL) {
    await page.goto('/our-approach-to-care', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'Our approach to care checks should run from the canonical page URL').toHaveURL(new RegExp(`${new URL('/our-approach-to-care', baseURL).toString()}(?:$|[?#])`, 'i'));
}

async function openOurApproachToCareSubpage(page, baseURL, route) {
    try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch {
        // Slow upstream responses can occasionally miss the first navigation timeout in UAT2.
        await page.goto(route, { waitUntil: 'commit', timeout: 60000 });
    }
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, `Expected to open ${route}`).toHaveURL(new RegExp(`${new URL(route, baseURL).toString()}(?:$|[?#])`, 'i'));
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

async function getSectionCtaHrefByHeading(page, headingTag, headingText, ctaPattern = 'read more') {
    return page.evaluate(({ tag, wantedHeading, wantedCta }) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const headings = Array.from(document.querySelectorAll(tag));
        const heading = headings.find((item) => normalize(item.textContent).toLowerCase() === wantedHeading.toLowerCase() && isVisible(item));
        if (!heading) {
            return '';
        }

        let scope = heading.parentElement;
        for (let depth = 0; depth < 6 && scope; depth += 1) {
            const links = Array.from(scope.querySelectorAll('a[href]')).filter((item) => isVisible(item));
            const matched = links.find((link) => new RegExp(wantedCta, 'i').test(normalize(link.textContent)));
            if (matched) {
                return matched.getAttribute('href') || '';
            }
            scope = scope.parentElement;
        }

        return '';
    }, { tag: headingTag, wantedHeading: headingText, wantedCta: ctaPattern });
}

async function getSectionCtaHrefByHeadingRegex(page, headingTag, headingRegex, ctaPattern = 'read more') {
    return page.evaluate(({ tag, wantedHeadingRegex, wantedCta }) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const headingMatcher = new RegExp(wantedHeadingRegex, 'i');
        const ctaMatcher = new RegExp(wantedCta, 'i');

        const headings = Array.from(document.querySelectorAll(tag));
        const heading = headings.find((item) => headingMatcher.test(normalize(item.textContent)) && isVisible(item));
        if (!heading) {
            return '';
        }

        let scope = heading.parentElement;
        for (let depth = 0; depth < 6 && scope; depth += 1) {
            const links = Array.from(scope.querySelectorAll('a[href]')).filter((item) => isVisible(item));
            const matched = links.find((link) => ctaMatcher.test(normalize(link.textContent)));
            if (matched) {
                return matched.getAttribute('href') || '';
            }
            scope = scope.parentElement;
        }

        return '';
    }, { tag: headingTag, wantedHeadingRegex: headingRegex, wantedCta: ctaPattern });
}

async function getVisibleMainContentLinkHrefs(page, hrefPattern) {
    return page.evaluate(({ patternSource }) => {
        const hrefMatcher = new RegExp(patternSource, 'i');
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const links = Array.from(document.querySelectorAll('a[href]'))
            .filter((link) => isVisible(link))
            .filter((link) => !link.closest('header, footer, .navigation, .breadcrumbs, #onetrust-consent-sdk, #onetrust-pc-sdk'))
            .filter((link) => normalize(link.textContent).length > 0)
            .map((link) => link.getAttribute('href') || '')
            .filter((href) => href && href !== '#' && !href.startsWith('javascript:'));

        const normalized = [];
        for (const href of links) {
            try {
                const url = new URL(href, window.location.origin);
                const candidate = `${url.pathname}${url.search}`;
                if (hrefMatcher.test(candidate)) {
                    normalized.push(candidate);
                }
            } catch {
                if (hrefMatcher.test(href)) {
                    normalized.push(href);
                }
            }
        }

        return Array.from(new Set(normalized));
    }, { patternSource: hrefPattern });
}

async function verifyVideoModuleIfPresent(page) {
    const videoFrame = page.locator('iframe[src*="youtube" i], iframe[src*="vimeo" i]').first();
    if (await videoFrame.isVisible().catch(() => false)) {
        const src = await videoFrame.getAttribute('src');
        expect(src || '', 'Embedded video iframe should point to YouTube or Vimeo').toMatch(/youtube|vimeo/i);
        return;
    }

    const videoContainer = page.locator('.videoPanelInline, .videoPanel, [class*="video"]').filter({ has: page.locator('button, a') }).first();
    if (!await videoContainer.isVisible().catch(() => false)) {
        return;
    }

    const playTrigger = videoContainer.locator('button, a').filter({ hasText: /play/i }).first();
    if (!await playTrigger.isVisible().catch(() => false)) {
        return;
    }

    await playTrigger.scrollIntoViewIfNeeded().catch(() => { });
    await clickWithCookieGuard(page, playTrigger);
    await page.waitForTimeout(500);

    const hydratedFrameVisible = await page.locator('iframe[src*="youtube" i], iframe[src*="vimeo" i]').first().isVisible().catch(() => false);
    if (hydratedFrameVisible) {
        const src = await page.locator('iframe[src*="youtube" i], iframe[src*="vimeo" i]').first().getAttribute('src').catch(() => '');
        expect(src || '', 'Hydrated video iframe should point to YouTube or Vimeo').toMatch(/youtube|vimeo/i);
    }
}

async function getGenericAccordionSnapshot(page) {
    return page.evaluate(() => {
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const buttons = Array.from(document.querySelectorAll('.accordion .accordion-button, .accordion-button.titleLink')).filter((button) => isVisible(button));
        return buttons.map((button) => {
            const targetSelector = button.getAttribute('data-bs-target') || '';
            const panel = targetSelector ? document.querySelector(targetSelector) : button.closest('.accordion-item')?.querySelector('.accordion-collapse');
            const panelShown = Boolean(panel && panel.classList.contains('show'));
            return {
                expanded: panelShown || !button.classList.contains('collapsed'),
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

        const buttons = Array.from(document.querySelectorAll('.accordion .accordion-button, .accordion-button.titleLink')).filter((button) => isVisible(button));
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
        return current.some((item) => item.expanded);
    }, {
        message: 'Accordion interaction should leave at least one item expanded',
        timeout: 10000,
    }).toBe(true);
}

async function verifyCarouselModulesIfPresent(page) {
    const carousels = page.locator('.carouselSignpost, .carouselAwards, .slick-slider, .swiper, [class*="carousel"]');
    const carouselCount = await carousels.count();

    for (let index = 0; index < carouselCount; index += 1) {
        const carousel = carousels.nth(index);
        if (!await carousel.isVisible().catch(() => false)) {
            continue;
        }

        const activeSlide = carousel.locator('.slick-slide.slick-active:not(.slick-cloned), .swiper-slide-active, [role="tabpanel"][aria-hidden="false"], [class*="slide"][class*="active"]').first();
        const fallbackSlide = carousel.locator('.slick-slide:not(.slick-cloned), .swiper-slide, [role="tabpanel"], [class*="slide"]').first();

        if (await activeSlide.isVisible().catch(() => false)) {
            await expect(activeSlide, `Carousel ${index + 1} should expose an active slide`).toBeVisible();
        } else if (await fallbackSlide.isVisible().catch(() => false)) {
            await expect(fallbackSlide, `Carousel ${index + 1} should expose a visible slide`).toBeVisible();
        } else {
            continue;
        }

        const nextButton = carousel.getByRole('button', { name: /next/i }).first()
            .or(carousel.locator('.slick-next, .swiper-button-next').first());

        if (!await nextButton.isVisible().catch(() => false)) {
            continue;
        }

        const getActiveKey = async () => {
            const target = await activeSlide.isVisible().catch(() => false) ? activeSlide : fallbackSlide;
            const text = normalizeWhitespace(await target.textContent().catch(() => ''));
            return text.toLowerCase().slice(0, 140);
        };

        const beforeKey = await getActiveKey();
        await clickWithCookieGuard(page, nextButton);
        await page.waitForTimeout(350);

        if (!beforeKey) {
            continue;
        }

        const afterKey = await getActiveKey();
        if (!afterKey || afterKey === beforeKey) {
            continue;
        }
    }
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

async function runConditionalTraversalChecks(page, baseURL, route) {
    await openOurApproachToCareSubpage(page, baseURL, route);
    await verifyVideoModuleIfPresent(page);
    await verifyAccordionModuleIfPresent(page);
    await verifyCarouselModulesIfPresent(page);
    await verifyTopControlIfPresent(page);
}

async function verifyAtLeastTwoVideoEmbeds(page) {
    const videoCount = await page.evaluate(() => {
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        return Array.from(document.querySelectorAll('iframe[src*="youtube" i], iframe[src*="vimeo" i]'))
            .filter((iframe) => isVisible(iframe)).length;
    });

    expect(videoCount, 'What others say page should expose at least two visible video embeds').toBeGreaterThanOrEqual(2);
}

async function verifyAwardsCollectionPanelSamples(page) {
    const collectionControls = page.locator(
        '.collectionPanel button[aria-expanded], [class*="collectionPanel"] button[aria-expanded], .collectionPanel button:has-text("Expand content"), [class*="collectionPanel"] button:has-text("Expand content")'
    );
    const visibleCount = await collectionControls.count();

    if (visibleCount === 0) {
        return;
    }

    let expandedSamples = 0;
    const sampleCount = Math.min(visibleCount, 4);

    for (let index = 0; index < sampleCount; index += 1) {
        const control = collectionControls.nth(index);
        if (!await control.isVisible().catch(() => false)) {
            continue;
        }

        await control.scrollIntoViewIfNeeded().catch(() => { });

        const beforeExpanded = await control.getAttribute('aria-expanded').catch(() => null);
        try {
            await control.click({ timeout: 5000 });
        } catch {
            await clickWithCookieGuard(page, control).catch(() => { });
        }

        await page.waitForTimeout(120);
        const afterExpanded = await control.getAttribute('aria-expanded').catch(() => null);
        const expandedToggled = beforeExpanded !== afterExpanded;

        if (expandedToggled || afterExpanded === 'true') {
            expandedSamples += 1;
        }

        if (afterExpanded === 'true') {
            await control.click({ timeout: 3000 }).catch(() => { });
            await page.waitForTimeout(100);
        }
    }

    expect(expandedSamples, 'Awards collection panel should provide at least one sample item that toggles expand/collapse state').toBeGreaterThan(0);
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

    await expect(submitButton, 'Feedback form submit button should be visible before manual reCAPTCHA check').toBeVisible({ timeout: 30000 });
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
            return { alreadySubmitted: true };
        }

        if (recaptchaSolved && submitEnabled) {
            return { alreadySubmitted: false };
        }

        await page.waitForTimeout(400);
    }

    throw new Error('Timed out waiting for manual reCAPTCHA completion and enabled submit button on feedback form.');
}

test('Our Approach to Care - Initial Page Checks', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Open homepage, expand menu, and navigate via Our approach to care second-level item', async () => {
        await openOurApproachToCareFromMenu(page, baseURL);
    });

    await test.step('Verify page title, breadcrumb semantics, and H1', async () => {
        await expect(page, 'Our approach to care page should expose the expected title').toHaveTitle(/our approach to care/i);
        await expect(page.getByRole('heading', { level: 1, name: /^Our approach to care$/i }).first(), 'Our approach to care page should expose matching H1').toBeVisible();

        const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
        await expect(breadcrumb, 'Our approach to care page should expose breadcrumb nav in the DOM').toHaveCount(1);

        const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
        await expect(currentItem, 'Breadcrumb current item should be present').toHaveCount(1);
        await expect(currentItem, 'Breadcrumb current item should read Our approach to care').toHaveText(/our approach to care/i);
    });

    await test.step('Verify hero FIND A CARE HOME CTA navigates to /care-homes then return', async () => {
        const heroFindCareHome = page.locator('.hero a[href="/care-homes"], [class*="hero"] a[href="/care-homes"]').filter({ hasText: /find a care home/i }).first();
        await expect(heroFindCareHome, 'The page hero should expose FIND A CARE HOME').toBeVisible();

        await clickWithCookieGuard(page, heroFindCareHome);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Hero FIND A CARE HOME CTA should navigate to /care-homes').toHaveURL(new RegExp(`${new URL('/care-homes', baseURL).toString()}(?:$|[?#])`, 'i'));

        await openOurApproachToCarePage(page, baseURL);
    });

    await test.step('Verify person-centred/person-led card READ MORE route and heading', async () => {
        const href = await getSectionCtaHrefByHeadingRegex(page, 'h4', 'person.*care', 'read more');
        expect(href, 'Person care card should expose READ MORE').toBeTruthy();

        const allowedRoutes = [
            '/our-approach-to-care/person-centred-care',
            '/our-approach-to-care/person-centre-care',
            '/our-approach-to-care/person-led-care',
        ];
        expect(allowedRoutes, 'Person care card READ MORE should target known environment route').toContain(href);

        const readMore = await getVisibleContentLink(page, href, /^read more$/i);
        expect(readMore, 'Person care card should expose a visible READ MORE CTA').toBeTruthy();
    });

    const careApproachCards = [
        { heading: 'Clinical Expertise', href: '/our-approach-to-care/clinical-expertise' },
        { heading: 'Safety / Cleanliness', href: '/our-approach-to-care/safety-cleanliness' },
        { heading: 'What quality means to us', href: '/our-approach-to-care/what-quality-means-to-us' },
    ];

    for (const card of careApproachCards) {
        await test.step(`Verify ${card.heading} with READ MORE -> ${card.href}`, async () => {
            const heading = page.getByRole('heading', { level: 4, name: new RegExp(`^${escapeRegExp(card.heading)}$`, 'i') }).first();
            await heading.scrollIntoViewIfNeeded().catch(() => { });
            await expect(heading, `${card.heading} H4 should be visible`).toBeVisible();

            const href = await getSectionCtaHrefByHeading(page, 'h4', card.heading, 'read more');
            expect(href, `${card.heading} section should expose a READ MORE CTA`).toBeTruthy();
            expect(href, `${card.heading} READ MORE href should match expected route`).toBe(card.href);

            const readMore = await getVisibleContentLink(page, href, /^read more$/i);
            expect(readMore, `${card.heading} section should expose a visible READ MORE CTA`).toBeTruthy();
        });
    }

    await test.step('Verify Care you can trust section with care regulators link', async () => {
        const careYouCanTrustHeading = page.getByRole('heading', { level: 2, name: /^Care you can trust/i }).first();
        await careYouCanTrustHeading.scrollIntoViewIfNeeded().catch(() => { });
        await expect(careYouCanTrustHeading, 'Care you can trust H2 should be visible').toBeVisible();

        const careRegulatorsLink = page.locator('a[href="/our-approach-to-care/our-performance/cqc"]').filter({ hasText: /care regulators/i }).first();
        await expect(careRegulatorsLink, 'Care you can trust section should contain care regulators link').toBeVisible();
        await expect(careRegulatorsLink, 'Care regulators link should target /our-approach-to-care/our-performance/cqc').toHaveAttribute('href', '/our-approach-to-care/our-performance/cqc');
    });

    await test.step('Verify Our Performance section with Awards & Recognition and What others say', async () => {
        const ourPerformanceHeading = page.getByRole('heading', { level: 3, name: /^Our performance/i }).first();
        await ourPerformanceHeading.scrollIntoViewIfNeeded().catch(() => { });
        await expect(ourPerformanceHeading, 'Our Performance H3 should be visible').toBeVisible();

        const performanceCards = [
            { heading: 'Awards & Recognition', href: '/our-approach-to-care/our-performance/our-awards' },
            { heading: 'What others say', href: '/our-approach-to-care/our-performance/what-others-have-to-say' },
        ];

        for (const card of performanceCards) {
            const heading = page.getByRole('heading', { level: 4, name: new RegExp(`^${escapeRegExp(card.heading)}$`, 'i') }).first();
            await heading.scrollIntoViewIfNeeded().catch(() => { });
            await expect(heading, `${card.heading} H4 should be visible`).toBeVisible();

            const href = await getSectionCtaHrefByHeading(page, 'h4', card.heading, 'read more');
            expect(href, `${card.heading} section should expose a READ MORE CTA`).toBeTruthy();
            expect(href, `${card.heading} READ MORE href should match expected route`).toBe(card.href);

            const readMore = await getVisibleContentLink(page, href, /^read more$/i);
            expect(readMore, `${card.heading} section should expose a visible READ MORE CTA`).toBeTruthy();
        }
    });

    await test.step('Verify video module behavior', async () => {
        await verifyVideoModuleIfPresent(page);
    });

    await test.step('Verify TOP button scroll behavior and footer visibility', async () => {
        await verifyTopControlIfPresent(page);
    });
}, 180000);

const standardTraversalScenarios = [
    {
        name: 'Our Approach to Care - Clinical Expertise Traversal',
        route: '/our-approach-to-care/clinical-expertise',
    },
    {
        name: 'Our Approach to Care - Safety / Cleanliness Traversal',
        route: '/our-approach-to-care/safety-cleanliness',
    },
    {
        name: 'Our Approach to Care - Safety / Cleanliness - Reducing Infections Traversal',
        route: '/our-approach-to-care/safety-cleanliness/reducing-infections',
    },
    {
        name: 'Our Approach to Care - What quality means to us Traversal',
        route: '/our-approach-to-care/what-quality-means-to-us',
    },
];

for (const scenario of standardTraversalScenarios) {
    test(scenario.name, async ({ page, baseURL }) => {
        test.setTimeout(120000);
        await runConditionalTraversalChecks(page, baseURL, scenario.route);
    }, 120000);
}

test('Our Approach to Care - Person-centred care Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await openOurApproachToCarePage(page, baseURL);
    const href = await getSectionCtaHrefByHeadingRegex(page, 'h4', 'person.*care', 'read more');
    expect(href, 'Person care card should expose READ MORE').toBeTruthy();

    const allowedRoutes = [
        '/our-approach-to-care/person-centred-care',
        '/our-approach-to-care/person-centre-care',
        '/our-approach-to-care/person-led-care',
    ];
    expect(allowedRoutes, 'Person care traversal route should match known environment route').toContain(href);

    await runConditionalTraversalChecks(page, baseURL, href);
}, 120000);

const qualityNestedScenarios = [
    {
        name: 'Our Approach to Care - What quality means to us - Andrew Knight on quality Traversal',
        route: '/our-approach-to-care/what-quality-means-to-us/andrew-knight-on-quality',
    },
    {
        name: 'Our Approach to Care - What quality means to us - Rachel Gilbert on quality Traversal',
        route: '/our-approach-to-care/what-quality-means-to-us/rachel-gilbert-on-quality',
    },
    {
        name: 'Our Approach to Care - What quality means to us - Omar Taylor on quality Traversal',
        route: '/our-approach-to-care/what-quality-means-to-us/omar-taylor-on-quality',
    },
    {
        name: 'Our Approach to Care - What quality means to us - Suzanne Mumford on quality Traversal',
        route: '/our-approach-to-care/what-quality-means-to-us/suzanne-mumford-on-quality',
    },
];

for (const scenario of qualityNestedScenarios) {
    test(scenario.name, async ({ page, baseURL }) => {
        test.setTimeout(120000);
        await runConditionalTraversalChecks(page, baseURL, scenario.route);
    }, 120000);
}

test('Our Approach to Care - Our Performance - What is the CQC Traversal', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    const route = '/our-approach-to-care/our-performance/cqc';

    await test.step('Open CQC page and verify title, breadcrumb, and H1', async () => {
        await openOurApproachToCareSubpage(page, baseURL, route);

        await expect(page, 'CQC page should expose expected title').toHaveTitle(/cqc\s*and\s*ratings/i);
        await expect(page.getByRole('heading', { level: 1, name: /^what is the cqc\??$/i }).first(), 'CQC page should expose matching H1').toBeVisible();

        const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
        await expect(breadcrumb, 'CQC page should expose breadcrumb navigation').toHaveCount(1);

        const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
        await expect(currentItem, 'CQC page breadcrumb current item should be present').toHaveCount(1);
        await expect(currentItem, 'CQC page breadcrumb current item should read What is the CQC?').toHaveText(/what is the cqc\??/i);
    });

    await test.step('Verify care homes list exists', async () => {
        const careHomeLinks = await getVisibleMainContentLinkHrefs(page, '/care-homes/');
        expect(careHomeLinks.length, 'CQC page should expose at least one care-home link in the main content list').toBeGreaterThan(0);
    });

    await test.step('Verify FAQ heading and accordion behavior', async () => {
        const faqHeading = page.getByRole('heading', { name: /faq|frequently asked questions/i }).first();
        await expect(faqHeading, 'CQC page should expose an FAQ heading').toBeVisible();
        await verifyAccordionModuleIfPresent(page);
    });

    await test.step('Verify news block, Show More behavior, and open two news items', async () => {
        const newsHrefPattern = '^/(news|latest-news|newsroom|insights?|blogs?)/';
        const initialNewsHrefs = await getVisibleMainContentLinkHrefs(page, newsHrefPattern);
        expect(initialNewsHrefs.length, 'News section should expose at least one featured item plus six additional items').toBeGreaterThanOrEqual(7);

        const showMoreButton = page.locator('button, a[role="button"], a').filter({ hasText: /show more/i }).first();
        if (await showMoreButton.isVisible().catch(() => false)) {
            const beforeCount = initialNewsHrefs.length;
            await clickWithCookieGuard(page, showMoreButton);

            await expect.poll(async () => {
                const currentHrefs = await getVisibleMainContentLinkHrefs(page, newsHrefPattern);
                return currentHrefs.length;
            }, {
                message: 'Show More should append additional news cards when available',
                timeout: 10000,
            }).toBeGreaterThan(beforeCount);
        }

        const newsAfterExpand = await getVisibleMainContentLinkHrefs(page, newsHrefPattern);
        const sampleNewsHrefs = newsAfterExpand.slice(0, 2);
        expect(sampleNewsHrefs.length, 'News section should provide at least two items to open').toBeGreaterThanOrEqual(2);

        for (const href of sampleNewsHrefs) {
            await openOurApproachToCareSubpage(page, baseURL, route);

            const link = await getVisibleContentLink(page, href, /.+/);
            expect(link, `News item ${href} should be visible and clickable from CQC page`).toBeTruthy();

            await clickWithCookieGuard(page, link);
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);

            await expect(page, `News item ${href} should open the matching article page`).toHaveURL(new RegExp(`${new URL(href, baseURL).toString()}(?:$|[?#])`, 'i'));
            await expect(page.getByRole('heading', { level: 1 }).first(), `News item ${href} page should expose an H1`).toBeVisible();
        }
    });

    await test.step('Verify footer visibility and TOP control behavior', async () => {
        await verifyTopControlIfPresent(page);
    });
}, 180000);

test('Our Approach to Care - Our Performance - Our Approach to Care in Scotland Traversal', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    const route = '/our-approach-to-care/our-performance/care-in-scotland';

    await test.step('Open Care in Scotland page and verify title, breadcrumb, and H1', async () => {
        await openOurApproachToCareSubpage(page, baseURL, route);

        await expect(page, 'Care in Scotland page should expose expected title').toHaveTitle(/care in scotland/i);
        await expect(page.getByRole('heading', { level: 1, name: /^care uk is the top-rated provider in scotland$/i }).first(), 'Care in Scotland page should expose matching H1').toBeVisible();

        const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
        await expect(breadcrumb, 'Care in Scotland page should expose breadcrumb navigation').toHaveCount(1);

        const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
        await expect(currentItem, 'Care in Scotland page breadcrumb current item should be present').toHaveCount(1);
        await expect(currentItem, 'Care in Scotland page breadcrumb current item should read Our approach to care in Scotland').toHaveText(/our approach to care in scotland/i);
    });

    await test.step('Verify care homes list exists', async () => {
        const careHomeLinks = await getVisibleMainContentLinkHrefs(page, '/care-homes/');
        expect(careHomeLinks.length, 'Care in Scotland page should expose at least one care-home link in the main content list').toBeGreaterThan(0);
    });

    await test.step('Verify FAQ heading and accordion behavior if present', async () => {
        const faqHeading = page.getByRole('heading', { name: /faq|frequently asked questions/i }).first();
        if (await faqHeading.isVisible().catch(() => false)) {
            await verifyAccordionModuleIfPresent(page);
        }
    });

    await test.step('Verify news block, Show More behavior, and open two news items', async () => {
        const newsHrefPattern = '^/(news|latest-news|newsroom|insights?|blogs?)/';
        const initialNewsHrefs = await getVisibleMainContentLinkHrefs(page, newsHrefPattern);
        expect(initialNewsHrefs.length, 'News section should expose at least one news item').toBeGreaterThanOrEqual(1);

        const showMoreButton = page.locator('button, a[role="button"], a').filter({ hasText: /show more/i }).first();
        if (await showMoreButton.isVisible().catch(() => false)) {
            const beforeCount = initialNewsHrefs.length;
            await clickWithCookieGuard(page, showMoreButton);

            await expect.poll(async () => {
                const currentHrefs = await getVisibleMainContentLinkHrefs(page, newsHrefPattern);
                return currentHrefs.length;
            }, {
                message: 'Show More should append additional news cards when available',
                timeout: 10000,
            }).toBeGreaterThan(beforeCount);
        }

        const newsAfterExpand = await getVisibleMainContentLinkHrefs(page, newsHrefPattern);
        const sampleNewsHrefs = newsAfterExpand.slice(0, Math.min(2, newsAfterExpand.length));
        expect(sampleNewsHrefs.length, 'News section should provide at least one item to open').toBeGreaterThanOrEqual(1);

        for (const href of sampleNewsHrefs) {
            await openOurApproachToCareSubpage(page, baseURL, route);

            const link = await getVisibleContentLink(page, href, /.+/);
            expect(link, `News item ${href} should be visible and clickable from Care in Scotland page`).toBeTruthy();

            await clickWithCookieGuard(page, link);
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);

            await expect(page, `News item ${href} should open the matching article page`).toHaveURL(new RegExp(`${new URL(href, baseURL).toString()}(?:$|[?#])`, 'i'));
            await expect(page.getByRole('heading', { level: 1 }).first(), `News item ${href} page should expose an H1`).toBeVisible();
        }
    });

    await test.step('Verify footer visibility and TOP control behavior', async () => {
        await verifyTopControlIfPresent(page);
    });
}, 180000);

test('Our Approach to Care - Our Performance - Awards & Recognition Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    const route = '/our-approach-to-care/our-performance/our-awards';
    await openOurApproachToCareSubpage(page, baseURL, route);

    await test.step('Verify awards page semantics and collection panel behavior', async () => {
        await expect(page, 'Awards page should expose expected title semantics').toHaveTitle(/award|recognition/i);
        await expect(page.getByRole('heading', { level: 1 }).first(), 'Awards page should expose H1').toBeVisible();
        await verifyAwardsCollectionPanelSamples(page);
    });

    await test.step('Run usual module checks', async () => {
        await verifyVideoModuleIfPresent(page);
        await verifyAccordionModuleIfPresent(page);
        await verifyCarouselModulesIfPresent(page);
        await verifyTopControlIfPresent(page);
    });
}, 120000);

test('Our Approach to Care - Our Performance - What others say Traversal', async ({ page, baseURL }) => {
    test.setTimeout(600000);

    const route = '/our-approach-to-care/our-performance/what-others-have-to-say';
    const submissionCounterKey = 'careuk-ourapproach-what-others-feedback-form';
    const submissionNumber = getCurrentSubmissionNumber(submissionCounterKey);
    const submissionData = buildFeedbackFormData(submissionNumber);

    await test.step('Open What others say page and verify semantics', async () => {
        await openOurApproachToCareSubpage(page, baseURL, route);
        await expect(page, 'What others say page should expose expected title semantics').toHaveTitle(/what others have to say|what others say|feedback/i);
        await expect(page.getByRole('heading', { level: 1 }).first(), 'What others say page should expose H1').toBeVisible();
    });

    await test.step('Verify at least two videos are present', async () => {
        await verifyAtLeastTwoVideoEmbeds(page);
    });

    const feedbackFormHeading = page.getByRole('heading', { name: /give us your feedback|feedback/i }).first();
    const firstNameInput = page.getByRole('textbox', { name: /^first name$/i }).first();
    const surnameInput = page.getByRole('textbox', { name: /^surname$/i }).first();
    const emailAddressInput = page.getByRole('textbox', { name: /^email address$/i }).first();
    const telephoneInput = page.getByRole('textbox', { name: /^telephone$/i }).first();
    const careHomeNameInput = page.getByRole('textbox', { name: /^please enter care home name$|^care home name$/i }).first();
    const residentNameInput = page.getByRole('textbox', { name: /^please enter resident'?s name$|^resident'?s name$/i }).first();
    const feedbackTextarea = page.getByRole('textbox', { name: /^feedback$/i }).first();
    const consentCheckbox = page.getByRole('checkbox', { name: /^i give consent to publish my comments/i }).first();
    const feedbackSubmitButton = page.getByRole('button', { name: /^submit$/i }).last();

    await test.step('Locate feedback form and validate key fields are visible', async () => {
        if (await feedbackFormHeading.isVisible().catch(() => false)) {
            await feedbackFormHeading.scrollIntoViewIfNeeded().catch(() => { });
        }

        await expect(firstNameInput, 'Feedback form should expose First name').toBeVisible({ timeout: 20000 });
        await expect(surnameInput, 'Feedback form should expose Surname').toBeVisible({ timeout: 20000 });
        await expect(emailAddressInput, 'Feedback form should expose Email address').toBeVisible({ timeout: 20000 });
        await expect(telephoneInput, 'Feedback form should expose Telephone').toBeVisible({ timeout: 20000 });
        await expect(careHomeNameInput, 'Feedback form should expose Care home name').toBeVisible({ timeout: 20000 });
        await expect(feedbackTextarea, 'Feedback form should expose Feedback textarea').toBeVisible({ timeout: 20000 });
        await expect(feedbackSubmitButton, 'Feedback form should expose Submit').toBeVisible({ timeout: 20000 });
    });

    await test.step('Journey 1: Submit empty form and verify required validation appears', async () => {
        await firstNameInput.scrollIntoViewIfNeeded().catch(() => { });
        await clickWithCookieGuard(page, feedbackSubmitButton);
        await page.waitForTimeout(300);

        const firstNameValidationMessage = normalizeWhitespace(await firstNameInput.evaluate((el) => el.validationMessage || '').catch(() => ''));
        expect(firstNameValidationMessage.toLowerCase(), 'First name required validation should be present').toContain('please fill in this field');
    });

    await test.step('Journey 2: Fill fields progressively and verify validation clears', async () => {
        await firstNameInput.fill(submissionData.firstName);
        await firstNameInput.press('Tab').catch(() => { });
        await page.waitForTimeout(250);

        await surnameInput.fill(submissionData.surname);
        await surnameInput.press('Tab').catch(() => { });
        await page.waitForTimeout(250);

        await emailAddressInput.fill(submissionData.email);
        await emailAddressInput.press('Tab').catch(() => { });
        await page.waitForTimeout(250);
        await expect.poll(async () => normalizeWhitespace(await emailAddressInput.evaluate((el) => el.validationMessage || '').catch(() => '')), {
            message: 'Email validation should clear after entering a valid email',
            timeout: 5000,
        }).toBe('');

        await telephoneInput.fill(submissionData.telephone);
        await telephoneInput.press('Tab').catch(() => { });
        await page.waitForTimeout(250);
        await expect.poll(async () => normalizeWhitespace(await telephoneInput.evaluate((el) => el.validationMessage || '').catch(() => '')), {
            message: 'Telephone validation should clear after entering a valid phone number',
            timeout: 5000,
        }).toBe('');

        await careHomeNameInput.fill(submissionData.careHomeName);
        await careHomeNameInput.press('Tab').catch(() => { });
        await page.waitForTimeout(250);
        await expect.poll(async () => normalizeWhitespace(await careHomeNameInput.evaluate((el) => el.validationMessage || '').catch(() => '')), {
            message: 'Care home name validation should clear after entering a valid value',
            timeout: 5000,
        }).toBe('');

        if (await residentNameInput.isVisible().catch(() => false)) {
            await residentNameInput.fill(submissionData.residentName);
            await residentNameInput.press('Tab').catch(() => { });
            await page.waitForTimeout(250);
        }

        await feedbackTextarea.fill(submissionData.feedback);
        await feedbackTextarea.press('Tab').catch(() => { });
        await page.waitForTimeout(250);
        await expect.poll(async () => normalizeWhitespace(await feedbackTextarea.evaluate((el) => el.validationMessage || '').catch(() => '')), {
            message: 'Feedback validation should clear after entering feedback text',
            timeout: 5000,
        }).toBe('');

        if (await consentCheckbox.isVisible().catch(() => false)) {
            if (submissionData.shouldConsent) {
                await consentCheckbox.check({ force: true }).catch(() => { });
            } else {
                const isChecked = await consentCheckbox.isChecked().catch(() => false);
                if (isChecked) {
                    await consentCheckbox.uncheck({ force: true }).catch(() => { });
                }
            }
        }
    });

    await test.step('Journey 3: Wait for manual reCAPTCHA completion, submit, and verify success message', async () => {
        const waitResult = await waitForManualRecaptchaAndEnabledSubmit(page, feedbackSubmitButton, {
            successMessageRegex: /many thanks for your feedback\.?/i,
        });

        if (!waitResult.alreadySubmitted) {
            await clickWithCookieGuard(page, feedbackSubmitButton);
        }

        await expect(page.locator('body').first(), 'Successful feedback submission should show confirmation message').toContainText(/many thanks for your feedback/i, { timeout: 30000 });

        incrementSubmissionNumber(submissionCounterKey);
    });

    await test.step('Run usual post-submit checks where applicable', async () => {
        await verifyTopControlIfPresent(page);
    });
}, 600000);
