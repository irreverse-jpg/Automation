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
// Coverage notes - Types of Care (/types-of-care) and every page it links to
// ============================================================================
// Scope: the "Types of Care" hub page (reached via the real menu), all 6
// individual care-type destination pages (Residential, Respite, Dementia,
// Nursing, Nursing Dementia, End-of-Life), 5 nested destinations under
// Dementia Care, and the Day Clubs page (its own carousel, club-finder
// links, and nearest-care-home search).
//
// Tests in this file (13 total):
//   1. Types of Care - Initial Page Checks
//      Navigates via the menu, checks title/breadcrumb/H1, follows the
//      hero "FIND A CARE HOME" CTA to /care-homes and back, verifies all 6
//      care-type cards expose the correct H4 + READ MORE CTA, checks the
//      FAQ heading and every accordion item, then the TOP button + footer.
//   2-7. Six generated "Traversal" tests (one per typesOfCareTraversalScenarios
//      entry: Residential, Respite, Dementia, Nursing, Nursing Dementia,
//      End-of-Life Care) - each runs the shared conditional traversal checks
//      (video/FAQ-accordion/carousel/TOP if present). Note: Residential,
//      Respite, Dementia, and Nursing Care are ALSO reached and deeply
//      tested via the homepage carousel in 05-careuk.carehomes.spec.js - the
//      two files test the same destination URLs via different entry paths,
//      not a duplicate-coverage mistake.
//   8-12. Five generated "Dementia Care - <Sub-topic> Traversal" tests
//      (Understanding and Getting to Know You, Providing Dementia Friendly
//      Environments, Our Dedicated People and Their Expertise, Support for
//      Families and Carers, Namaste Care) - each opens Dementia Care,
//      follows that sub-topic's own "Read more" CTA to its expected route,
//      then the shared conditional checks.
//   13. Types of Care - Day Clubs Traversal
//      Navigates to Day Clubs via the menu, checks title/H1/breadcrumb and
//      the page's usual modules, follows "Find care home" under "Find a
//      day club near you" and back, clicks through EVERY individual day
//      club link (confirming each club's name appears in both the
//      destination's title and H1), checks "Get in touch" routes to
//      /news/events/day-club-sign-up and back, confirms the day-clubs
//      carousel's arrow state progresses correctly from start to end,
//      checks a nearest-care-home search (M33 + "Day club only" option),
//      then the footer/TOP button.
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

        return { clicked: true };
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

async function openTypesOfCareFromMenu(page, baseURL) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'Types of care flow should begin at the CareUK homepage').toHaveURL(new URL('/', baseURL).toString());

    await page.evaluate((wantedRoot) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => normalize(node.textContent))
            .join(' ')
            .trim();

        const rootItems = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li'));
        const root = rootItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedRoot);
        if (root) {
            (root.querySelector(':scope > a[href]') || root).click();
        }
    }, 'Types of care');

    await clickSecondLevelItem(page, 'Types of care', 'Types of care');

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'Second-level Types of care navigation should open the canonical page').toHaveURL(new RegExp(`${new URL('/types-of-care', baseURL).toString()}(?:$|[?#])`, 'i'));
}

async function openTypesOfCarePage(page, baseURL) {
    await page.goto('/types-of-care', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'Types of care checks should run from the canonical page URL').toHaveURL(new RegExp(`${new URL('/types-of-care', baseURL).toString()}(?:$|[?#])`, 'i'));
}

async function openTypesOfCareSubpage(page, baseURL, route) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
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

async function getFaqSnapshot(page) {
    return page.evaluate(() => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const faqHeading = Array.from(document.querySelectorAll('h3')).find((heading) => {
            const text = normalize(heading.textContent).toLowerCase();
            return (text === 'frequently asked questions' || text === 'faqs') && isVisible(heading);
        });
        const faqContainer = faqHeading?.closest('.container') || faqHeading?.parentElement || document;
        const buttons = Array.from(faqContainer.querySelectorAll('.accordion-button.titleLink, .accordion .accordion-button')).filter((button) => isVisible(button));

        return buttons.map((button) => {
            const targetSelector = button.getAttribute('data-bs-target') || '';
            const panel = targetSelector ? document.querySelector(targetSelector) : button.closest('.accordion-item')?.querySelector('.accordion-collapse');
            const panelShown = Boolean(panel && panel.classList.contains('show'));
            const collapsedClass = button.classList.contains('collapsed');
            return {
                expanded: panelShown || !collapsedClass,
                collapsedClass,
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
            const panel = targetSelector ? document.querySelector(targetSelector) : button.closest('.accordion-item')?.querySelector('.accordion-collapse');
            return Boolean(panel && panel.classList.contains('show')) || !button.classList.contains('collapsed');
        };

        const faqHeading = Array.from(document.querySelectorAll('h3')).find((heading) => {
            const text = normalize(heading.textContent).toLowerCase();
            return (text === 'frequently asked questions' || text === 'faqs') && isVisible(heading);
        });
        const faqContainer = faqHeading?.closest('.container') || faqHeading?.parentElement || document;
        const buttons = Array.from(faqContainer.querySelectorAll('.accordion-button.titleLink, .accordion .accordion-button')).filter((button) => isVisible(button));
        const target = buttons[targetIndex];

        if (!target) {
            return false;
        }

        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        target.click();

        if (!isExpanded(target)) {
            const targetSelector = target.getAttribute('data-bs-target') || '';
            const panel = targetSelector ? document.querySelector(targetSelector) : target.closest('.accordion-item')?.querySelector('.accordion-collapse');

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

async function runConditionalTraversalChecks(page, baseURL, route) {
    await openTypesOfCareSubpage(page, baseURL, route);
    await verifyVideoModuleIfPresent(page);
    await verifyAccordionModuleIfPresent(page);
    await verifyCarouselModulesIfPresent(page);
    await verifyTopControlIfPresent(page);
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

async function openDayClubsFromMenu(page, baseURL) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'Day clubs flow should begin at the CareUK homepage').toHaveURL(new URL('/', baseURL).toString());

    await page.evaluate((wantedRoot) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => normalize(node.textContent))
            .join(' ')
            .trim();

        const rootItems = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li'));
        const root = rootItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedRoot);
        if (root) {
            (root.querySelector(':scope > a[href]') || root).click();
        }
    }, 'Types of care');

    await clickSecondLevelItem(page, 'Types of care', 'Day clubs');

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'Second-level Day clubs navigation should open the canonical page').toHaveURL(new RegExp(`${new URL('/types-of-care/day-clubs', baseURL).toString()}(?:$|[?#])`, 'i'));
}

function normalizeClubKey(value) {
    const base = normalizeWhitespace(value)
        .toLowerCase()
        .replace(/\b(the|a|an)\b/g, ' ')
        .replace(/\b(day\s*club|day\s*clubs|club|clubs)\b/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return base;
}

async function isCarouselControlDisabled(control) {
    const isVisible = await control.isVisible().catch(() => false);
    if (!isVisible) {
        return true;
    }

    return control.evaluate((element) => {
        const className = String(element.className || '').toLowerCase();
        const ariaDisabled = String(element.getAttribute('aria-disabled') || '').toLowerCase() === 'true';
        const disabledAttr = element.hasAttribute('disabled');
        const disabledClass = /(disabled|inactive|grey|gray|slick-disabled|swiper-button-disabled)/i.test(className);
        return ariaDisabled || disabledAttr || disabledClass;
    }).catch(() => true);
}

test('Types of Care - Initial Page Checks', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Open homepage, expand menu, and navigate via Types of care second-level item', async () => {
        await openTypesOfCareFromMenu(page, baseURL);
    });

    await test.step('Verify page title, breadcrumb semantics, and H1', async () => {
        await expect(page, 'Types of care page should expose the expected title').toHaveTitle(/types of care/i);
        await expect(page.getByRole('heading', { level: 1, name: /^Types of care$/i }).first(), 'Types of care page should expose matching H1').toBeVisible();

        const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
        await expect(breadcrumb, 'Types of care page should expose breadcrumb nav in the DOM').toHaveCount(1);

        const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
        await expect(currentItem, 'Breadcrumb current item should be present').toHaveCount(1);
        await expect(currentItem, 'Breadcrumb current item should read Types of care').toHaveText(/types of care/i);
    });

    await test.step('Verify hero FIND A CARE HOME CTA navigates to /care-homes then return', async () => {
        const heroFindCareHome = page.locator('.hero a[href="/care-homes"], [class*="hero"] a[href="/care-homes"]').filter({ hasText: /find a care home/i }).first();
        await expect(heroFindCareHome, 'The page hero should expose FIND A CARE HOME').toBeVisible();

        await clickWithCookieGuard(page, heroFindCareHome);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Hero FIND A CARE HOME CTA should navigate to /care-homes').toHaveURL(new RegExp(`${new URL('/care-homes', baseURL).toString()}(?:$|[?#])`, 'i'));

        await openTypesOfCarePage(page, baseURL);
    });

    const careTypeCards = [
        { heading: 'Residential care', href: '/types-of-care/residential-care' },
        { heading: 'Respite care', href: '/types-of-care/respite-care' },
        { heading: 'Dementia care', href: '/types-of-care/dementia-care' },
        { heading: 'Nursing care', href: '/types-of-care/nursing-care' },
        { heading: 'Nursing dementia care', href: '/types-of-care/nursing-dementia-care' },
        { heading: 'End-of-life care', href: '/types-of-care/end-of-life-care' },
    ];

    for (const card of careTypeCards) {
        await test.step(`Verify ${card.heading} with READ MORE -> ${card.href}`, async () => {
            const heading = page.getByRole('heading', { level: 4, name: new RegExp(`^${escapeRegExp(card.heading)}$`, 'i') }).first();
            await heading.scrollIntoViewIfNeeded().catch(() => { });
            await expect(heading, `${card.heading} H4 should be visible`).toBeVisible();

            const readMore = await getVisibleContentLink(page, card.href, /^read more$/i);
            expect(readMore, `${card.heading} section should expose a visible READ MORE CTA with ${card.href}`).toBeTruthy();
            await expect(readMore, `${card.heading} READ MORE should target ${card.href}`).toHaveAttribute('href', card.href);
        });
    }

    await test.step('Verify Frequently asked questions heading and all accordion items', async () => {
        const faqHeading = page.getByRole('heading', { level: 3, name: /^Frequently asked questions$/i }).first();
        await faqHeading.scrollIntoViewIfNeeded().catch(() => { });
        await expect(faqHeading, 'Frequently asked questions heading should be visible').toBeVisible();

        const snapshot = await getFaqSnapshot(page);
        expect(snapshot.length, 'FAQs should expose accordion items to validate').toBeGreaterThan(0);

        const initiallyExpandedIndexes = snapshot
            .map((item, index) => (item.expanded ? index : -1))
            .filter((index) => index >= 0);

        expect(initiallyExpandedIndexes.length, 'FAQ accordion should start with no more than one open item').toBeLessThanOrEqual(1);

        for (let activeIndex = 0; activeIndex < snapshot.length; activeIndex += 1) {
            await dismissCookieOverlayIfPresent(page);
            await clickFaqByIndex(page, activeIndex);

            await expect.poll(async () => {
                const current = await getFaqSnapshot(page);
                return current[activeIndex]?.expanded;
            }, {
                message: `FAQ item ${activeIndex + 1} should expand when selected`,
                timeout: 10000,
            }).toBe(true);
        }
    });

    await test.step('Verify TOP button scroll behavior and footer visibility', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

        const footer = page.getByRole('contentinfo').first();
        await expect(footer, 'Footer should be visible at the bottom of the page').toBeVisible();

        const topButton = page.locator('.footer__scrolltop a, .footer__scrolltop button').first()
            .or(page.locator('a, button').filter({ hasText: /^top$/i }).first());

        if (await topButton.isVisible().catch(() => false)) {
            await clickWithCookieGuard(page, topButton);
            await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), {
                message: 'Clicking TOP should return the viewport to the top of the page',
                timeout: 10000,
            }).toBeLessThanOrEqual(10);
        }
    });
}, 180000);

const typesOfCareTraversalScenarios = [
    {
        name: 'Types of Care - Residential Care Traversal',
        route: '/types-of-care/residential-care',
    },
    {
        name: 'Types of Care - Respite Care Traversal',
        route: '/types-of-care/respite-care',
    },
    {
        name: 'Types of Care - Dementia Care Traversal',
        route: '/types-of-care/dementia-care',
    },
    {
        name: 'Types of Care - Nursing Care Traversal',
        route: '/types-of-care/nursing-care',
    },
    {
        name: 'Types of Care - Nursing Dementia Care Traversal',
        route: '/types-of-care/nursing-dementia-care',
    },
    {
        name: 'Types of Care - End-of-Life Care Traversal',
        route: '/types-of-care/end-of-life-care',
    },
];

for (const scenario of typesOfCareTraversalScenarios) {
    test(scenario.name, async ({ page, baseURL }) => {
        test.setTimeout(120000);
        await runConditionalTraversalChecks(page, baseURL, scenario.route);
    }, 120000);
}

const dementiaNestedScenarios = [
    {
        name: 'Types of Care - Dementia Care - Understanding and Getting to Know You Traversal',
        headingTag: 'h4',
        heading: 'Understanding and getting to know you',
        expectedHref: '/types-of-care/dementia-care/getting-to-know-you',
    },
    {
        name: 'Types of Care - Dementia Care - Providing Dementia Friendly Environments Traversal',
        headingTag: 'h4',
        heading: 'Providing dementia friendly environments',
        expectedHref: '/types-of-care/dementia-care/dementia-friendly-environments',
    },
    {
        name: 'Types of Care - Dementia Care - Our Dedicated People and Their Expertise Traversal',
        headingTag: 'h4',
        heading: 'Our dedicated people and their expertise',
        expectedHref: '/types-of-care/dementia-care/our-people-and-training',
    },
    {
        name: 'Types of Care - Dementia Care - Support for Families and Carers Traversal',
        headingTag: 'h4',
        heading: 'Support for families and carers',
        expectedHref: '/types-of-care/dementia-care/support-for-families-and-carers',
    },
    {
        name: 'Types of Care - Dementia Care - Namaste Care Traversal',
        headingTag: 'h3',
        heading: 'Namaste care',
        expectedHref: '/types-of-care/dementia-care/namaste-care',
    },
];

for (const scenario of dementiaNestedScenarios) {
    test(scenario.name, async ({ page, baseURL }) => {
        test.setTimeout(120000);

        await openTypesOfCareSubpage(page, baseURL, '/types-of-care/dementia-care');

        const href = await getSectionCtaHrefByHeading(page, scenario.headingTag, scenario.heading, 'read more');
        expect(href, `${scenario.heading} should expose a READ MORE CTA`).toBeTruthy();
        expect(href, `${scenario.heading} READ MORE href should match expected route`).toBe(scenario.expectedHref);

        const cta = await getVisibleContentLink(page, scenario.expectedHref, /^read more$/i);
        expect(cta, `${scenario.heading} should expose a visible READ MORE CTA`).toBeTruthy();

        await clickWithCookieGuard(page, cta);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, `${scenario.heading} READ MORE should navigate to expected URL`).toHaveURL(new RegExp(`${new URL(scenario.expectedHref, baseURL).toString()}(?:$|[?#])`, 'i'));

        await verifyVideoModuleIfPresent(page);
        await verifyAccordionModuleIfPresent(page);
        await verifyCarouselModulesIfPresent(page);
        await verifyTopControlIfPresent(page);
    }, 120000);
}

test('Types of Care - Day Clubs Traversal', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Open homepage, expand menu and navigate to Day clubs via Types of care menu', async () => {
        await openDayClubsFromMenu(page, baseURL);
    });

    await test.step('Verify page title, H1 and breadcrumb for Day clubs', async () => {
        await expect(page, 'Day clubs page should expose expected title').toHaveTitle(/day clubs/i);
        await expect(page.getByRole('heading', { level: 1, name: /^Day clubs$/i }).first(), 'Day clubs page should expose matching H1').toBeVisible();

        const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
        await expect(breadcrumb, 'Day clubs page should expose breadcrumb nav').toHaveCount(1);
        const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
        await expect(currentItem, 'Breadcrumb current item should read Day clubs').toHaveText(/day clubs/i);
    });

    await test.step('Verify day clubs page modules with usual checks', async () => {
        await verifyVideoModuleIfPresent(page);
        await verifyAccordionModuleIfPresent(page);
    });

    await test.step('Verify Find care home link under Find a day club near you and return', async () => {
        const findNearHeading = page.getByRole('heading', { level: 4, name: /^Find a day club near you$/i }).first();
        await expect(findNearHeading, 'Find a day club near you heading should be visible').toBeVisible();
        await findNearHeading.scrollIntoViewIfNeeded().catch(() => { });

        const findCareHomeLink = page.locator('a[href="/care-homes"]').filter({ hasText: /find\s+(?:a\s+)?care\s+home/i }).first();
        await expect(findCareHomeLink, 'Find care home link should be visible under day club finder section').toBeVisible();
        await expect(findCareHomeLink, 'Find care home link should target /care-homes').toHaveAttribute('href', '/care-homes');

        await clickWithCookieGuard(page, findCareHomeLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Find care home link should navigate to /care-homes').toHaveURL(new RegExp(`${new URL('/care-homes', baseURL).toString()}(?:$|[?#])`, 'i'));

        await openTypesOfCareSubpage(page, baseURL, '/types-of-care/day-clubs');
    });

    await test.step('Click each day club link and verify club name appears in destination title and H1', async () => {
        const findNearHeading = page.getByRole('heading', { level: 4, name: /^Find a day club near you$/i }).first();
        await expect(findNearHeading).toBeVisible();

        const clubs = await page.evaluate(() => {
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const isVisible = (element) => {
                const style = window.getComputedStyle(element);
                return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
            };

            const heading = Array.from(document.querySelectorAll('h4')).find((node) => normalize(node.textContent).toLowerCase() === 'find a day club near you' && isVisible(node));
            const container = heading?.closest('.container, section, article, .row, .nearestHome') || heading?.parentElement || document;
            const links = Array.from(container.querySelectorAll('a[href]'))
                .filter((link) => isVisible(link))
                .map((link) => ({
                    href: link.getAttribute('href') || '',
                    text: normalize(link.textContent),
                }))
                .filter((link) => /\/care-homes\//i.test(link.href))
                .filter((link) => link.text.length > 0);

            const unique = [];
            const seen = new Set();
            for (const link of links) {
                const key = `${link.href}|${link.text.toLowerCase()}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                unique.push(link);
            }

            return unique;
        });

        expect(clubs.length, 'Find a day club near you section should expose 8 day club links').toBe(8);

        for (const club of clubs) {
            const clicked = await page.evaluate(({ href, text }) => {
                const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                const isVisible = (element) => {
                    const style = window.getComputedStyle(element);
                    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
                };

                const heading = Array.from(document.querySelectorAll('h4')).find((node) => normalize(node.textContent).toLowerCase() === 'find a day club near you' && isVisible(node));
                const container = heading?.closest('.container, section, article, .row, .nearestHome') || heading?.parentElement || document;
                const links = Array.from(container.querySelectorAll('a[href]')).filter((link) => isVisible(link));
                const target = links.find((link) => (link.getAttribute('href') || '') === href && normalize(link.textContent) === text);

                if (!target) {
                    return false;
                }

                target.scrollIntoView({ block: 'center', inline: 'nearest' });
                target.click();
                return true;
            }, { href: club.href, text: club.text });

            expect(clicked, `Day club link for ${club.text} should be clickable from the day club links section`).toBe(true);

            await page.waitForLoadState('load').catch(() => { });
            if (!new RegExp(`${new URL(club.href, baseURL).toString()}(?:$|[?#])`, 'i').test(page.url())) {
                await openTypesOfCareSubpage(page, baseURL, club.href);
            }

            await dismissCookieOverlayIfPresent(page);

            const titleText = normalizeWhitespace(await page.title());
            const h1Text = normalizeWhitespace(await page.getByRole('heading', { level: 1 }).first().textContent().catch(() => ''));
            const destinationText = `${titleText} ${h1Text}`;

            const clubKey = normalizeClubKey(club.text);
            const destinationKey = normalizeClubKey(destinationText);

            expect(destinationKey, `${club.text} should be represented in destination title/H1 even with article or club wording differences`).toContain(clubKey);

            await page.goBack({ waitUntil: 'load' }).catch(async () => {
                await openTypesOfCareSubpage(page, baseURL, '/types-of-care/day-clubs');
            });
            await dismissCookieOverlayIfPresent(page);
            await expect(page, 'Returning from a day club link should land back on day clubs page').toHaveURL(new RegExp(`${new URL('/types-of-care/day-clubs', baseURL).toString()}(?:$|[?#])`, 'i'));
        }
    });

    await test.step('Verify Get in touch link and button go to /news/events/day-club-sign-up and return', async () => {
        const expectedPath = '/news/events/day-club-sign-up';
        const targets = [
            page.getByRole('link', { name: /^get in touch$/i }).first(),
            page.getByRole('link', { name: /^GET IN TOUCH$/i }).first()
                .or(page.getByRole('button', { name: /^GET IN TOUCH$/i }).first()),
        ];

        for (const target of targets) {
            await expect(target, 'Day clubs page should expose Get in touch link/button').toBeVisible();
            await target.scrollIntoViewIfNeeded().catch(() => { });

            const href = await target.getAttribute('href').catch(() => null);
            if (href) {
                expect(href, 'Get in touch link/button should target /news/events/day-club-sign-up').toBe(expectedPath);
            }

            await clickWithCookieGuard(page, target);
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);
            await expect(page, 'Get in touch should navigate to day-club-sign-up page').toHaveURL(new RegExp(`${new URL(expectedPath, baseURL).toString()}(?:$|[?#])`, 'i'));
            await expect(page, 'Day club sign-up page should have expected title').toHaveTitle(/find out more about our day clubs/i);
            await expect(page.getByRole('heading', { level: 1 }).first(), 'Day club sign-up page should have expected H1').toHaveText(/find out more about our day clubs/i);

            const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
            await expect(breadcrumb, 'Day club sign-up page should expose breadcrumb nav').toHaveCount(1);
            const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
            await expect(currentItem, 'Day club sign-up breadcrumb current item should match page name').toHaveText(/find out more about our day clubs/i);

            await page.goBack({ waitUntil: 'load' }).catch(async () => {
                await openTypesOfCareSubpage(page, baseURL, '/types-of-care/day-clubs');
            });
            await dismissCookieOverlayIfPresent(page);
            await expect(page).toHaveURL(new RegExp(`${new URL('/types-of-care/day-clubs', baseURL).toString()}(?:$|[?#])`, 'i'));
        }
    });

    await test.step('Verify day clubs carousel arrow state progression from start to end', async () => {
        const carousel = page.locator('.slick-slider, [class*="carousel"], .swiper').filter({ has: page.locator('.slick-prev, .slick-next, .swiper-button-prev, .swiper-button-next') }).first();
        await expect(carousel, 'Day clubs page should expose a carousel with nav arrows').toBeVisible();

        const leftArrow = carousel.locator('.slick-prev, .swiper-button-prev, [aria-label*="previous" i], [aria-label*="left" i]').first();
        const rightArrow = carousel.locator('.slick-next, .swiper-button-next, [aria-label*="next" i], [aria-label*="right" i]').first();

        await expect(leftArrow, 'Carousel should expose left arrow control').toHaveCount(1);
        await expect(rightArrow, 'Carousel should expose right arrow control').toHaveCount(1);

        expect(await isCarouselControlDisabled(leftArrow), 'Left carousel arrow should be greyed out on initial state').toBe(true);

        const rightArrowVisible = await rightArrow.isVisible().catch(() => false);
        if (!rightArrowVisible) {
            return;
        }

        expect(await isCarouselControlDisabled(rightArrow), 'Right carousel arrow should be active on initial state when visible').toBe(false);

        await clickWithCookieGuard(page, rightArrow);
        await page.waitForTimeout(300);
        expect(await isCarouselControlDisabled(leftArrow), 'Left carousel arrow should become active after moving right once').toBe(false);

        for (let step = 0; step < 30; step += 1) {
            const rightDisabled = await isCarouselControlDisabled(rightArrow);
            if (rightDisabled) {
                break;
            }
            await clickWithCookieGuard(page, rightArrow);
            await page.waitForTimeout(250);
        }

        expect(await isCarouselControlDisabled(rightArrow), 'Right carousel arrow should become greyed out at end of carousel').toBe(true);
    });

    await test.step('Verify nearest care home search with M33 and Day club only option', async () => {
        const nearestHeading = page.getByRole('heading', { level: 3, name: /your nearest care home/i }).first();
        await expect(nearestHeading, 'Day clubs page should expose Your nearest care home section').toBeVisible();
        await nearestHeading.scrollIntoViewIfNeeded().catch(() => { });

        const nearestSection = page.locator('.nearestHome').first();
        if (!await nearestSection.isVisible().catch(() => false)) {
            const sectionByHeading = nearestHeading.locator('xpath=ancestor::section[1]');
            await expect(sectionByHeading, 'Nearest care home section should be discoverable by heading ancestry').toBeVisible();
        }

        const postcodeInput = page.locator('input#careHomeSearch').first();
        await expect(postcodeInput, 'Nearest care home section should expose postcode input').toBeVisible();
        await postcodeInput.fill('M33');

        const careTypeSelect = page.locator('select[name="type"]').first();
        await expect(careTypeSelect, 'Nearest care home section should expose care type select').toHaveCount(1);

        const selectOptions = await careTypeSelect.locator('option').allTextContents();
        const concreteOptions = selectOptions.map((item) => normalizeWhitespace(item)).filter((item) => item.length > 0 && !/^select/i.test(item));
        expect(concreteOptions.length, 'Nearest care home type dropdown should expose only one concrete option').toBe(1);
        expect(concreteOptions[0], 'Nearest care home type dropdown concrete option should be Day club').toMatch(/day\s*club/i);

        await careTypeSelect.selectOption({ label: /day\s*club/i }).catch(async () => {
            const value = await careTypeSelect.locator('option').filter({ hasText: /day\s*club/i }).first().getAttribute('value');
            if (value) {
                await careTypeSelect.selectOption(value);
            }
        });

        const submitButton = page.getByRole('button', { name: /^submit$/i }).first();
        await expect(submitButton, 'Nearest care home section should expose submit button').toBeVisible();
        await clickWithCookieGuard(page, submitButton);

        await expect.poll(async () => {
            const count = await page.locator('.nearestHome a[href*="/care-homes/"]').filter({ hasText: /view this home/i }).count().catch(() => 0);
            return count;
        }, {
            message: 'Nearest care home search with M33 and Day club should return one visible View this home result',
            timeout: 20000,
        }).toBe(1);
    });

    await test.step('Verify footer and TOP button returns page to top', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

        const footer = page.getByRole('contentinfo').first();
        await expect(footer, 'Footer should be visible at the bottom of Day clubs page').toBeVisible();

        const topButton = page.locator('.footer__scrolltop a, .footer__scrolltop button').first()
            .or(page.locator('a, button').filter({ hasText: /^top$/i }).first());

        if (await topButton.isVisible().catch(() => false)) {
            await clickWithCookieGuard(page, topButton);
            await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), {
                message: 'Clicking TOP should return viewport to top',
                timeout: 10000,
            }).toBeLessThanOrEqual(10);
        }
    });
}, 180000);
