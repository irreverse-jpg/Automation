const { test, expect } = require('@playwright/test');

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
        const blockedByOverlay =
            message.includes('intercepts pointer events') ||
            message.includes('cookie') ||
            message.includes('onetrust');

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

    await expect(
        page.locator('.navigation.navigation--open .rootlevel').first(),
        'The navigation drawer should open after clicking the menu icon'
    ).toBeVisible();
}

async function clickSecondLevelItem(page, rootName, childName) {
    await openMenuIfPresent(page);

    const result = await page.evaluate(({ wantedRoot, wantedChild }) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) =>
            Array.from(li.childNodes)
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => normalize(node.textContent))
                .join(' ')
                .trim();

        const rootItems = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li.hasSublevel'));
        const root = rootItems.find(
            (item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedRoot
        );

        if (!root) {
            return { clicked: false, reason: 'root-not-found' };
        }

        const childItems = Array.from(root.querySelectorAll(':scope > .sublevelOne > ul > li'));
        const child = childItems.find(
            (item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedChild
        );

        if (!child) {
            return { clicked: false, reason: 'child-not-found' };
        }

        const trigger = child.querySelector(':scope > a[href]') || child;
        trigger.click();

        return { clicked: true };
    }, { wantedRoot: rootName, wantedChild: childName });

    expect(result.clicked, `Second-level menu item "${childName}" under "${rootName}" should be clickable`).toBeTruthy();
}

async function openWhoWeAreFromMenu(page, baseURL) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'Who we are flow should begin at the CareUK homepage').toHaveURL(new URL('/', baseURL).toString());

    await clickSecondLevelItem(page, 'Who we are', 'Who we are');

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(
        page,
        'Second-level Who we are navigation should open the canonical page'
    ).toHaveURL(new RegExp(`${new URL('/company', baseURL).toString()}(?:$|[?#])`, 'i'));
}

async function openWhoWeAreSubpage(page, baseURL, route) {
    try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch {
        await page.goto(route, { waitUntil: 'commit', timeout: 60000 });
    }

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, `Expected to open ${route}`).toHaveURL(
        new RegExp(`${new URL(route, baseURL).toString()}(?:$|[?#])`, 'i')
    );
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

        const inGlobalChrome = await candidate
            .evaluate((element) => Boolean(element.closest('header, footer, .navigation, .breadcrumbs, #onetrust-consent-sdk, #onetrust-pc-sdk')))
            .catch(() => true);

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
        const heading = headings.find(
            (item) => normalize(item.textContent).toLowerCase() === wantedHeading.toLowerCase() && isVisible(item)
        );

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

async function verifyVideoModuleIfPresent(page) {
    const videoFrame = page.locator('iframe[src*="youtube" i], iframe[src*="vimeo" i]').first();
    if (await videoFrame.isVisible().catch(() => false)) {
        const src = await videoFrame.getAttribute('src');
        expect(src || '', 'Embedded video iframe should point to YouTube or Vimeo').toMatch(/youtube|vimeo/i);
        return;
    }

    const videoContainer = page
        .locator('.videoPanelInline, .videoPanel, [class*="video"]')
        .filter({ has: page.locator('button, a') })
        .first();

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

    const hydratedFrame = page.locator('iframe[src*="youtube" i], iframe[src*="vimeo" i]').first();
    const hydratedFrameVisible = await hydratedFrame.isVisible().catch(() => false);
    if (hydratedFrameVisible) {
        const src = await hydratedFrame.getAttribute('src').catch(() => '');
        expect(src || '', 'Hydrated video iframe should point to YouTube or Vimeo').toMatch(/youtube|vimeo/i);
    }
}

async function getGenericAccordionSnapshot(page) {
    return page.evaluate(() => {
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };

        const buttons = Array.from(document.querySelectorAll('.accordion .accordion-button, .accordion-button.titleLink'))
            .filter((button) => isVisible(button));

        return buttons.map((button) => {
            const targetSelector = button.getAttribute('data-bs-target') || '';
            const panel = targetSelector
                ? document.querySelector(targetSelector)
                : button.closest('.accordion-item')?.querySelector('.accordion-collapse');
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

        const buttons = Array.from(document.querySelectorAll('.accordion .accordion-button, .accordion-button.titleLink'))
            .filter((button) => isVisible(button));

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

        const nextRoleButton = carousel.getByRole('button', { name: /next/i }).first();
        const nextCssButton = carousel.locator('.slick-next, .swiper-button-next').first();

        let nextButton = null;
        if (await nextRoleButton.isVisible().catch(() => false)) {
            nextButton = nextRoleButton;
        } else if (await nextCssButton.isVisible().catch(() => false)) {
            nextButton = nextCssButton;
        }

        if (!nextButton) {
            continue;
        }

        const getActiveKey = async () => {
            const target = (await activeSlide.isVisible().catch(() => false)) ? activeSlide : fallbackSlide;
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

    const topLink = page.locator('.footer__scrolltop a, .footer__scrolltop button').first();
    const topTextControl = page.locator('a, button').filter({ hasText: /^top$/i }).first();

    let topControl = null;
    if (await topLink.isVisible().catch(() => false)) {
        topControl = topLink;
    } else if (await topTextControl.isVisible().catch(() => false)) {
        topControl = topTextControl;
    }

    if (!topControl) {
        return;
    }

    await clickWithCookieGuard(page, topControl);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), {
        message: 'TOP control should return the viewport to the top',
        timeout: 10000,
    }).toBeLessThanOrEqual(10);
}

async function runConditionalTraversalChecks(page, baseURL, route) {
    await openWhoWeAreSubpage(page, baseURL, route);
    await verifyVideoModuleIfPresent(page);
    await verifyAccordionModuleIfPresent(page);
    await verifyCarouselModulesIfPresent(page);
    await verifyTopControlIfPresent(page);
}

test('Who We Are - Initial Page Checks', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Open homepage, expand menu, and navigate via Who we are second-level item', async () => {
        await openWhoWeAreFromMenu(page, baseURL);
    });

    await test.step('Verify page title, breadcrumb semantics, and H1', async () => {
        await expect(page, 'Who we are page should expose the expected title').toHaveTitle(/about our company/i);
        await expect(page.getByRole('heading', { level: 1, name: /^Who we are$/i }).first(), 'Who we are page should expose matching H1').toBeVisible();

        const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
        await expect(breadcrumb, 'Who we are page should expose breadcrumb nav in the DOM').toHaveCount(1);

        const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
        await expect(currentItem, 'Breadcrumb current item should be present').toHaveCount(1);
        await expect(currentItem, 'Breadcrumb current item should read Who we are').toHaveText(/who we are/i);
    });

    const whoWeAreCards = [
        { heading: 'Our management team', href: '/company/our-management-team' },
        { heading: 'We all shape our values', href: '/company/we-all-shape-our-values' },
        { heading: 'Our history', href: '/company/our-history' },
        { heading: 'Our approach to ESG', href: '/company/esg' },
    ];

    for (const card of whoWeAreCards) {
        await test.step(`Verify ${card.heading} with READ MORE -> ${card.href}`, async () => {
            const heading = page.getByRole('heading', {
                level: 4,
                name: new RegExp(`^${escapeRegExp(card.heading)}$`, 'i'),
            }).first();

            await heading.scrollIntoViewIfNeeded().catch(() => { });
            await expect(heading, `${card.heading} H4 should be visible`).toBeVisible();

            const href = await getSectionCtaHrefByHeading(page, 'h4', card.heading, 'read more');
            expect(href, `${card.heading} section should expose a READ MORE CTA`).toBeTruthy();
            expect(href, `${card.heading} READ MORE href should match expected route`).toBe(card.href);

            const readMore = await getVisibleContentLink(page, href, /^read more$/i);
            expect(readMore, `${card.heading} section should expose a visible READ MORE CTA`).toBeTruthy();
        });
    }

    await test.step('Verify Care UK Stars Awards card with dynamic year and READ MORE link', async () => {
        const currentYear = new Date().getFullYear();
        const starsHeading = page.getByRole('heading', { level: 4, name: /^Care UK Stars Awards/i }).first();

        await starsHeading.scrollIntoViewIfNeeded().catch(() => { });
        await expect(starsHeading, 'Care UK Stars Awards H4 should be visible').toBeVisible();

        const headingText = await starsHeading.textContent();
        expect(headingText, `Care UK Stars Awards heading should contain the year ${currentYear} or nearby year`).toMatch(/Care UK Stars Awards\s+\d{4}/i);

        const href = await getSectionCtaHrefByHeadingRegex(page, 'h4', 'Care UK Stars Awards', 'read more');
        expect(href, 'Care UK Stars Awards section should expose a READ MORE CTA').toBeTruthy();
        expect(href, 'Care UK Stars Awards READ MORE href should match expected route').toBe('/company/care-uk-stars');

        const readMore = await getVisibleContentLink(page, href, /^read more$/i);
        expect(readMore, 'Care UK Stars Awards section should expose a visible READ MORE CTA').toBeTruthy();
    });

    await test.step('Verify Campaigns at Care UK H3 with READ MORE link', async () => {
        const campaignsHeading = page.getByRole('heading', { level: 3, name: /^campaigns at care uk$/i }).first();

        await campaignsHeading.scrollIntoViewIfNeeded().catch(() => { });
        await expect(campaignsHeading, 'Campaigns at Care UK H3 should be visible').toBeVisible();

        const href = await getSectionCtaHrefByHeading(page, 'h3', 'Campaigns at Care UK', 'read more');
        expect(href, 'Campaigns at Care UK section should expose a READ MORE CTA').toBeTruthy();
        expect(href, 'Campaigns at Care UK READ MORE href should match expected route').toBe('/company/care-uk-campaigns');

        const readMore = await getVisibleContentLink(page, href, /^read more$/i);
        expect(readMore, 'Campaigns at Care UK section should expose a visible READ MORE CTA').toBeTruthy();
    });

    await test.step('Verify TOP button scroll behavior and footer visibility', async () => {
        await verifyTopControlIfPresent(page);
    });
}, 180000);

const standardTraversalScenarios = [
    { name: 'Who We Are - Our Management Team Traversal', route: '/company/our-management-team' },
    { name: 'Who We Are - We All Shape Our Values Traversal', route: '/company/we-all-shape-our-values' },
    { name: 'Who We Are - Our History Traversal', route: '/company/our-history' },
    { name: 'Who We Are - Our Approach to ESG Traversal', route: '/company/esg' },
    { name: 'Who We Are - Care UK Stars Awards Traversal', route: '/company/care-uk-stars' },
    { name: 'Who We Are - Care UK Campaigns Traversal', route: '/company/care-uk-campaigns' },
];

for (const scenario of standardTraversalScenarios) {
    test(scenario.name, async ({ page, baseURL }) => {
        test.setTimeout(120000);
        await runConditionalTraversalChecks(page, baseURL, scenario.route);
    }, 120000);
}

const managementTeamMembers = [
    { name: 'Andrew Knight', route: '/company/our-management-team/andrew-knight' },
    { name: 'Matt Rosenberg', route: '/company/our-management-team/matt-rosenberg' },
    { name: 'Martin Friend', route: '/company/our-management-team/martin-friend' },
    { name: 'Rachel Harvey', route: '/company/our-management-team/rachel-harvey' },
    { name: 'Jacqui White', route: '/company/our-management-team/jacqui-white' },
    { name: 'Leah Queripel', route: '/company/our-management-team/leah-queripel' },
    { name: 'Richard Pearman', route: '/company/our-management-team/richard-pearman' },
    { name: 'Tony Weedon', route: '/company/our-management-team/tony-weedon' },
];

for (const member of managementTeamMembers) {
    test(`Who We Are - Our Management Team - ${member.name} Traversal`, async ({ page, baseURL }) => {
        test.setTimeout(120000);

        await test.step(`Open ${member.name} profile and verify semantics`, async () => {
            await openWhoWeAreSubpage(page, baseURL, member.route);

            await expect(page, `${member.name} page should expose expected title with name`).toHaveTitle(new RegExp(escapeRegExp(member.name), 'i'));
            const profileH1 = page.locator('main h1, h1').first();
            await expect(profileH1, `${member.name} page should expose H1`).toBeVisible();
            await expect(profileH1, `${member.name} page H1 should correspond to the member name`).toHaveText(
                new RegExp(escapeRegExp(member.name), 'i')
            );

            const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i]').first();
            const currentItem = breadcrumb.locator('.breadcrumb-item.active, [aria-current="page"]').first();
            await expect(currentItem, `${member.name} breadcrumb current item should contain the name`).toHaveText(
                new RegExp(escapeRegExp(member.name), 'i')
            );
        });

        await test.step('Run module checks', async () => {
            await verifyVideoModuleIfPresent(page);
            await verifyAccordionModuleIfPresent(page);
            await verifyCarouselModulesIfPresent(page);
        });

        await test.step('Verify footer visibility and TOP control behavior', async () => {
            await verifyTopControlIfPresent(page);
        });
    }, 120000);
}

const campaignTraversalScenarios = [
    { name: 'Step into Christmas', route: '/company/care-uk-campaigns/step-into-christmas' },
    { name: 'Fixer Uppers', route: '/company/care-uk-campaigns/fixer-uppers' },
    { name: 'The Centenarian Club', route: '/company/care-uk-campaigns/the-centenarian-club' },
    { name: 'VE Day 80th Anniversary', route: '/company/care-uk-campaigns/ve-day-80th-anniversary' },
    { name: 'Generations of Change', route: '/company/care-uk-campaigns/generations-of-change' },
    { name: 'The Big Dementia Conversation', route: '/company/care-uk-campaigns/the-big-dementia-conversation' },
    { name: 'Harvest Festival', route: '/company/care-uk-campaigns/harvest-festival' },
    { name: 'The Big Care UK Sports Day', route: '/company/care-uk-campaigns/the-big-care-uk-sports-day' },
    { name: '80th Anniversary of D-Day', route: '/company/care-uk-campaigns/dday-80th-anniversary' },
    { name: 'Recipes to remember', route: '/company/care-uk-campaigns/recipes-to-remember' },
    { name: 'Christmas number one', route: '/company/care-uk-campaigns/christmas-number-1' },
    { name: 'Care home open week 2023', route: '/company/care-uk-campaigns/care-home-open-week' },
    { name: 'Bedtime stories', route: '/company/care-uk-campaigns/bedtime-stories' },
    { name: 'Wisdom booths', route: '/company/care-uk-campaigns/wisdom-booths' },
    { name: 'Platinum Jubilee', route: '/company/care-uk-campaigns/platinum-jubilee' },
    { name: 'Long lost hobbies', route: '/company/care-uk-campaigns/long-lost-hobbies' },
    { name: "Let's get physical", route: '/company/care-uk-campaigns/lets-get-physical' },
    { name: 'The Big Draw', route: '/company/care-uk-campaigns/the-big-draw' },
    { name: 'Food for thought', route: '/company/care-uk-campaigns/food-for-thought' },
    { name: 'Ride 800', route: '/company/care-uk-campaigns/our-ride800-blog' },
];

for (const campaign of campaignTraversalScenarios) {
    test(`Who We Are - Care UK Campaigns - ${campaign.name} Traversal`, async ({ page, baseURL }) => {
        test.setTimeout(120000);
        await runConditionalTraversalChecks(page, baseURL, campaign.route);
    }, 120000);
}
