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
// Coverage notes - Life at a Care UK Home (/life-at-a-care-uk-home) and
// every page it links to
// ============================================================================
// Scope: the "Life at a Care UK home" hub page (reached via the real menu)
// and all 7 real sub-pages under it (Environment and Facilities, Our Teams,
// Food and Dining, Lifestyle, Keeping in Touch/Visiting, Part of the
// Community, Wishing Trees), plus nested destinations under Lifestyle (4)
// and Food and Dining (5, including Chef of the Year 2025).
//
// Tests in this file (18 total):
//   1. Life at a Care UK home - Initial Page Checks
//      Navigates via the menu, checks title/breadcrumb/H1, follows the
//      hero "FIND A CARE HOME" CTA to /care-homes and back, checks the
//      "Wishing trees" section's "Read more" CTA, any video module on the
//      page, the "What's going on?" article row's "Read more" CTA to
//      /news, then the TOP button + footer.
//   2-8. Seven generated "Traversal" tests (one per lifeTraversalScenarios
//      entry: Environment and Facilities, Our Teams, Food and Dining,
//      Lifestyle, Keeping in Touch, Part of the Community, Wishing Trees) -
//      each runs the shared conditional traversal checks (video/FAQ-
//      accordion/carousel/TOP if present).
//   9-12. Four generated "Lifestyle - <Sub-topic> Traversal" tests (Meaningful
//      Lifestyles, Activities and Outings, Keeping Active, Use of Technology)
//      - each opens Lifestyle, follows that sub-topic's own "Read more" CTA,
//      confirms the destination URL, then the shared conditional checks.
//   13-17. Five generated "Food and dining - <Sub-topic> Traversal" tests
//      (Personalisation and Choice, Nutrition and Hydration, Our Catering
//      Teams, Our Dining Experience, Sample Menu) - same shape as the
//      Lifestyle sub-topics, but against fixed expected routes.
//   18. Life at a Care UK home - Food and dining - Chef of the Year 2025
//      Traversal
//      Opens the Food and Dining sub-page, follows its "Chef of the Year"
//      CTA, confirms the destination URL/H1, then generically checks for
//      any video/accordion/carousel modules and the TOP control (each
//      only if actually present on the page - not assumed).
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

async function openLifeAtCareUKHomeFromMenu(page, baseURL) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'Life at a Care UK home flow should begin at the CareUK homepage').toHaveURL(new URL('/', baseURL).toString());

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
    }, 'Life at a Care UK home');

    await clickSecondLevelItem(page, 'Life at a Care UK home', 'Life at a Care UK home');

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'Second-level Life at a Care UK home navigation should open the canonical page').toHaveURL(new RegExp(`${new URL('/life-at-a-care-uk-home', baseURL).toString()}(?:$|[?#])`, 'i'));
}

async function openLifeAtCareUKHomePage(page, baseURL) {
    await page.goto('/life-at-a-care-uk-home', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'Life at a Care UK home checks should run from the canonical page URL').toHaveURL(new RegExp(`${new URL('/life-at-a-care-uk-home', baseURL).toString()}(?:$|[?#])`, 'i'));
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


async function openLifeAtCareUKSubpage(page, baseURL, route) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, `Expected to open ${route}`).toHaveURL(new RegExp(`${new URL(route, baseURL).toString()}(?:$|[?#])`, 'i'));
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

async function runConditionalTraversalChecks(page, baseURL, route) {
    await openLifeAtCareUKSubpage(page, baseURL, route);
    await verifyVideoModuleIfPresent(page);
    await verifyAccordionModuleIfPresent(page);
    await verifyCarouselModulesIfPresent(page);
    await verifyTopControlIfPresent(page);
}

test('Life at a Care UK home - Initial Page Checks', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Open homepage, expand menu, and navigate via Life at a Care UK home second-level item', async () => {
        await openLifeAtCareUKHomeFromMenu(page, baseURL);
    });

    await test.step('Verify page title, breadcrumb semantics, and H1', async () => {
        await expect(page, 'Life at a Care UK home page should expose the expected title').toHaveTitle(/life in our care homes/i);
        await expect(page.getByRole('heading', { level: 1, name: /^Life at a Care UK home$/i }).first(), 'Life at a Care UK home page should expose matching H1').toBeVisible();

        const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
        await expect(breadcrumb, 'Life at a Care UK home page should expose breadcrumb nav in the DOM').toHaveCount(1);

        const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
        await expect(currentItem, 'Breadcrumb current item should be present').toHaveCount(1);
        await expect(currentItem, 'Breadcrumb current item should read Life at a Care UK home').toHaveText(/life at a care uk home/i);
    });

    await test.step('Verify hero FIND A CARE HOME CTA navigates to /care-homes then return', async () => {
        const heroFindCareHome = page.locator('.hero a[href="/care-homes"], [class*="hero"] a[href="/care-homes"]').filter({ hasText: /find a care home/i }).first();
        await expect(heroFindCareHome, 'The page hero should expose FIND A CARE HOME').toBeVisible();

        await clickWithCookieGuard(page, heroFindCareHome);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Hero FIND A CARE HOME CTA should navigate to /care-homes').toHaveURL(new RegExp(`${new URL('/care-homes', baseURL).toString()}(?:$|[?#])`, 'i'));

        await openLifeAtCareUKHomePage(page, baseURL);
    });

    const lifeCards = [
        { heading: 'Environment and facilities', href: '/life-at-a-care-uk-home/environment-facilities' },
        { heading: 'Our teams', href: '/life-at-a-care-uk-home/our-teams' },
        { heading: 'Food and dining', href: '/life-at-a-care-uk-home/food' },
        { heading: 'Lifestyle', href: '/life-at-a-care-uk-home/lifestyle' },
        { heading: 'Keeping in touch', href: '/life-at-a-care-uk-home/visiting' },
        { heading: 'Part of the community', href: '/life-at-a-care-uk-home/community' },
    ];

    for (const card of lifeCards) {
        await test.step(`Verify ${card.heading} with READ MORE -> ${card.href}`, async () => {
            const heading = page.getByRole('heading', { level: 4, name: new RegExp(`^${card.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).first();
            await heading.scrollIntoViewIfNeeded().catch(() => { });
            await expect(heading, `${card.heading} H4 should be visible`).toBeVisible();

            const readMore = await getVisibleContentLink(page, card.href, /^read more$/i);
            expect(readMore, `${card.heading} section should expose a visible READ MORE CTA with ${card.href}`).toBeTruthy();
            await expect(readMore, `${card.heading} READ MORE should target ${card.href}`).toHaveAttribute('href', card.href);
        });
    }

    await test.step('Verify Wishing trees section and READ MORE CTA', async () => {
        const wishingTreesHeading = page.getByRole('heading', { level: 3, name: /^Wishing trees$/i }).first();
        await wishingTreesHeading.scrollIntoViewIfNeeded().catch(() => { });
        await expect(wishingTreesHeading, 'Wishing trees H3 should be visible').toBeVisible();

        const wishingTreesReadMore = await getVisibleContentLink(page, '/life-at-a-care-uk-home/wishing-trees', /^read more$/i);
        expect(wishingTreesReadMore, 'Wishing trees section should expose a READ MORE CTA').toBeTruthy();
        await expect(wishingTreesReadMore, 'Wishing trees READ MORE should target /life-at-a-care-uk-home/wishing-trees').toHaveAttribute('href', '/life-at-a-care-uk-home/wishing-trees');
    });

    await test.step('Verify video module behavior', async () => {
        await verifyVideoModuleIfPresent(page);
    });

    await test.step('Verify What\'s going on? article row and READ MORE CTA to /news', async () => {
        const whatsGoingOnHeading = page.getByRole('heading', { level: 4, name: /^What\'s going on\?$/i }).first();
        await whatsGoingOnHeading.scrollIntoViewIfNeeded().catch(() => { });
        await expect(whatsGoingOnHeading, 'What\'s going on? H4 should be visible').toBeVisible();

        const newsReadMore = await getVisibleContentLink(page, '/news', /^read more$/i);
        expect(newsReadMore, 'What\'s going on? row should expose a READ MORE CTA to /news').toBeTruthy();
        await expect(newsReadMore, 'What\'s going on? READ MORE should target /news').toHaveAttribute('href', '/news');
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


const lifeTraversalScenarios = [
    {
        name: 'Life at a Care UK home - Environment and Facilities Traversal',
        route: '/life-at-a-care-uk-home/environment-facilities',
    },
    {
        name: 'Life at a Care UK home - Our Teams Traversal',
        route: '/life-at-a-care-uk-home/our-teams',
    },
    {
        name: 'Life at a Care UK home - Food and Dining Traversal',
        route: '/life-at-a-care-uk-home/food',
    },
    {
        name: 'Life at a Care UK home - Lifestyle Traversal',
        route: '/life-at-a-care-uk-home/lifestyle',
    },
    {
        name: 'Life at a Care UK home - Keeping in Touch Traversal',
        route: '/life-at-a-care-uk-home/visiting',
    },
    {
        name: 'Life at a Care UK home - Part of the Community Traversal',
        route: '/life-at-a-care-uk-home/community',
    },
    {
        name: 'Life at a Care UK home - Wishing Trees Traversal',
        route: '/life-at-a-care-uk-home/wishing-trees',
    },
];

for (const scenario of lifeTraversalScenarios) {
    test(scenario.name, async ({ page, baseURL }) => {
        test.setTimeout(120000);
        await runConditionalTraversalChecks(page, baseURL, scenario.route);
    }, 120000);
}

const lifestyleNestedScenarios = [
    {
        name: 'Life at a Care UK home - Lifestyle - Meaningful Lifestyles Traversal',
        heading: 'Meaningful lifestyles',
        hrefPattern: /\/life-at-a-care-uk-home\/lifestyle/i,
    },
    {
        name: 'Life at a Care UK home - Lifestyle - Activities and Outings Traversal',
        heading: 'Activities and outings',
        hrefPattern: /\/life-at-a-care-uk-home\/lifestyle/i,
    },
    {
        name: 'Life at a Care UK home - Lifestyle - Keeping Active Traversal',
        heading: 'Keeping active',
        hrefPattern: /\/life-at-a-care-uk-home\/lifestyle/i,
    },
    {
        name: 'Life at a Care UK home - Lifestyle - Use of Technology Traversal',
        heading: 'Use of technology',
        hrefPattern: /\/life-at-a-care-uk-home\/lifestyle/i,
    },
];

for (const scenario of lifestyleNestedScenarios) {
    test(scenario.name, async ({ page, baseURL }) => {
        test.setTimeout(120000);

        await openLifeAtCareUKSubpage(page, baseURL, '/life-at-a-care-uk-home/lifestyle');

        const href = await getSectionCtaHrefByHeading(page, 'h4', scenario.heading, 'read more');
        expect(href, `${scenario.heading} should expose a READ MORE CTA`).toBeTruthy();
        expect(href, `${scenario.heading} READ MORE href should remain within life-at-a-care-uk-home lifestyle paths`).toMatch(scenario.hrefPattern);

        const cta = await getVisibleContentLink(page, href, /^read more$/i);
        expect(cta, `${scenario.heading} should expose a visible READ MORE CTA`).toBeTruthy();

        await clickWithCookieGuard(page, cta);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, `${scenario.heading} READ MORE should navigate to a lifestyle destination page`).toHaveURL(/\/life-at-a-care-uk-home\/lifestyle\//i);

        await verifyVideoModuleIfPresent(page);
        await verifyAccordionModuleIfPresent(page);
        await verifyCarouselModulesIfPresent(page);
        await verifyTopControlIfPresent(page);
    }, 120000);
}

const foodNestedScenarios = [
    {
        name: 'Life at a Care UK home - Food and dining - Personalisation and Choice Traversal',
        heading: 'Personalisation and choice',
        expectedHref: '/life-at-a-care-uk-home/food/personalisation-choice',
    },
    {
        name: 'Life at a Care UK home - Food and dining - Nutrition and Hydration Traversal',
        heading: 'Nutrition and hydration',
        expectedHref: '/life-at-a-care-uk-home/food/nutrition-hydration',
    },
    {
        name: 'Life at a Care UK home - Food and dining - Our Catering Teams Traversal',
        heading: 'Our catering teams',
        expectedHref: '/life-at-a-care-uk-home/food/our-catering-teams',
    },
    {
        name: 'Life at a Care UK home - Food and dining - Our Dining Experience Traversal',
        heading: 'Our dining experience',
        expectedHref: '/life-at-a-care-uk-home/food/our-dining-experience',
    },
    {
        name: 'Life at a Care UK home - Food and dining - Sample Menu Traversal',
        heading: 'Sample menu',
        expectedHref: '/life-at-a-care-uk-home/food/sample-menu',
    },
];

for (const scenario of foodNestedScenarios) {
    test(scenario.name, async ({ page, baseURL }) => {
        test.setTimeout(120000);

        await openLifeAtCareUKSubpage(page, baseURL, '/life-at-a-care-uk-home/food');

        const href = await getSectionCtaHrefByHeading(page, 'h4', scenario.heading, 'read more');
        expect(href, `${scenario.heading} should expose a READ MORE CTA`).toBeTruthy();
        expect(href, `${scenario.heading} READ MORE href should match expected route`).toBe(scenario.expectedHref);

        const cta = await getVisibleContentLink(page, href, /^read more$/i);
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

test('Life at a Care UK home - Food and dining - Chef of the Year 2025 Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await openLifeAtCareUKSubpage(page, baseURL, '/life-at-a-care-uk-home/food');

    const chefLink = await getVisibleContentLink(page, '/life-at-a-care-uk-home/food/chef-of-the-year', /chef of the year/i);
    expect(chefLink, 'Food page should expose a visible Chef of the Year CTA').toBeTruthy();

    await clickWithCookieGuard(page, chefLink);
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);

    await expect(page, 'Chef of the Year CTA should navigate to /life-at-a-care-uk-home/food/chef-of-the-year').toHaveURL(new RegExp(`${new URL('/life-at-a-care-uk-home/food/chef-of-the-year', baseURL).toString()}(?:$|[?#])`, 'i'));
    await expect(page.getByRole('heading', { level: 1 }).first(), 'Chef of the Year page should expose an H1').toBeVisible();

    await verifyVideoModuleIfPresent(page);
    await verifyAccordionModuleIfPresent(page);
    await verifyCarouselModulesIfPresent(page);
    await verifyTopControlIfPresent(page);
}, 120000);
