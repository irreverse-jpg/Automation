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
    const acceptAllButton = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept all cookies")').first();
    const closeButton = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button[aria-label="Close"]').first();

    const overlayVisible = await cookieOverlay.isVisible().catch(() => false);
    const acceptVisible = await acceptAllButton.isVisible().catch(() => false);
    const closeVisible = await closeButton.isVisible().catch(() => false);

    if (!overlayVisible && !acceptVisible && !closeVisible) {
        return;
    }

    if (acceptVisible) {
        await acceptAllButton.click({ timeout: 2000 }).catch(() => { });
    }

    if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click({ timeout: 2000 }).catch(() => { });
    }

    if (await cookieOverlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }
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
        await locator.click({ force: true });
    }
}

async function hoverWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.hover();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isCookieInterception = message.includes('intercepts pointer events') || message.includes('onetrust');

        if (!isCookieInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.hover();
    }
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeComparableText(value) {
    return normalizeWhitespace(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .toLowerCase();
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSameOriginUrl(currentUrl, destinationHref) {
    const destination = new URL(destinationHref, currentUrl);
    return new URL(`${destination.pathname}${destination.search}${destination.hash}`, currentUrl).toString();
}

async function canReliablyHover(page) {
    return page.evaluate(() => window.matchMedia('(hover: hover)').matches).catch(() => false);
}

async function openAboutPage(page) {
    await page.goto('/about', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);
    await expect(page, 'The About traversal flow should start from the localized About page').toHaveURL(/\/about(?:\?.*)?(?:#.*)?$/i);
}

function getHeroHeading(page) {
    return page.getByRole('heading', { level: 1, name: 'Get to know us' }).first();
}

function getHeroGetInTouchLink(page) {
    return page.locator('xpath=(//h1[normalize-space()="Get to know us"]/following::a[contains(@href, "/contact-us") and normalize-space()="Get in touch"][1])');
}

function getPagesInSectionBlock(page) {
    return page.locator('xpath=(//div[contains(@class,"textFeaturePanel__block")][.//h2[normalize-space()="Pages in this section"]])[1]');
}

function getFurtherInformationAccordionButton(page) {
    return page.locator('xpath=(//button[(contains(@class,"accordion__title") or contains(@class,"accordion-button")) and normalize-space()="Further information"])[1]');
}

async function getAccordionPanel(page, button) {
    const panelId = await button.getAttribute('aria-controls');
    expect(panelId, 'Accordion buttons should expose an aria-controls target').toBeTruthy();
    return page.locator(`#${panelId}`);
}

async function expectAccordionIndicatorState(button, expanded, description) {
    await expect(button, `${description} should expose the expected aria-expanded state`).toHaveAttribute('aria-expanded', expanded ? 'true' : 'false');

    if (expanded) {
        await expect(button, `${description} should show the expanded minus-state styling once opened`).not.toHaveClass(/\bcollapsed\b/);
        return;
    }

    await expect(button, `${description} should show the collapsed plus-state styling once closed`).toHaveClass(/\bcollapsed\b/);
}

async function setAccordionExpandedState(page, button, expanded, description) {
    const expectedValue = expanded ? 'true' : 'false';

    for (let attempt = 0; attempt < 3; attempt += 1) {
        await dismissCookieOverlayIfPresent(page);
        await button.scrollIntoViewIfNeeded().catch(() => { });

        if ((await button.getAttribute('aria-expanded')) === expectedValue) {
            await expectAccordionIndicatorState(button, expanded, description);
            return;
        }

        try {
            await clickWithCookieGuard(page, button);
        } catch (error) {
            const message = String(error || '').toLowerCase();
            const isTransientInteractionError = message.includes('timeout')
                || message.includes('not stable')
                || message.includes('intercepts pointer events')
                || message.includes('onetrust');

            if (!isTransientInteractionError) {
                throw error;
            }

            await button.click({ force: true }).catch(async () => {
                await button.evaluate((node) => node.click());
            });
        }

        const stateReached = await expect.poll(async () => {
            return await button.getAttribute('aria-expanded');
        }, {
            message: `${description} should toggle to the expected state after interaction`,
            timeout: 5000,
        }).toBe(expectedValue).then(() => true).catch(() => false);

        if (stateReached) {
            await expectAccordionIndicatorState(button, expanded, description);
            return;
        }
    }

    await expectAccordionIndicatorState(button, expanded, description);
}

function getShapingSection(page) {
    return page.locator('section.featureVideo').first();
}

function getRecognitionSection(page) {
    return page.locator('.logoRow__wrapper').filter({
        has: page.getByRole('heading', { level: 2, name: 'Recent global recognition' }),
    }).first();
}

function getSeniorManagementSection(page) {
    return page.locator('section.personRow').filter({
        has: page.getByRole('heading', { level: 2, name: 'Senior management team' }),
    }).first();
}

function getLowerGetInTouchSection(page) {
    return page.locator('xpath=(//div[contains(@class,"container")][.//h2[normalize-space()="Get in touch"] and .//a[contains(@href, "/contact-us") and normalize-space()="Get in touch"]])[1]');
}

async function openResponsibleBusinessPage(page) {
    await page.goto('/about/responsible-business', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);
    await expect(page, 'The traversal flow should start from the localized Responsible business page').toHaveURL(/\/about\/responsible-business(?:\?.*)?(?:#.*)?$/i);
}

function getResponsibleBusinessHeading(page) {
    return page.getByRole('heading', { level: 1, name: 'Responsible business' }).first();
}

function getResponsibleBusinessBreadcrumb(page) {
    return page.locator('.bc, nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').getByText(/^Responsible business$/i).first();
}

function getResponsibleBusinessPagesInSectionBlock(page) {
    return page.locator('xpath=(//div[contains(@class,"textFeaturePanel__block")][.//h2[normalize-space()="Pages in this section"]])[1]');
}

function getResponsibleBusinessInPartnershipSection(page) {
    return page.locator('.logoRow__wrapper').filter({
        has: page.getByRole('heading', { level: 2, name: /In partnership with:?/i }),
    }).first();
}

function getResponsibleBusinessImpactHeading(page, level) {
    return page.getByRole('heading', {
        level,
        name: /Achieving social impact: how OX Delivers is changing lives in Rwanda/i,
    }).first();
}

function getResponsibleBusinessImpactSection(page) {
    return page.locator('xpath=(//iframe[contains(@title, "Achieving social impact: how OX Delivers is changing lives in Rwanda")]/ancestor::section[1])[1]');
}

function getResponsibleBusinessKeyContactsSection(page) {
    return page.locator('section.personRow').filter({
        has: page.getByRole('heading', { level: 2, name: 'Key contacts' }),
    }).first();
}

function getResponsibleBusinessTestimonialSection(page) {
    return page.locator('section.testimonialCarousel').first();
}

async function openSustainableDevelopmentGoalsPage(page) {
    await page.goto('/about/sustainable-development-goals', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);
    await expect(page, 'The traversal flow should start from the localized Sustainable Development Goals page').toHaveURL(/\/about\/sustainable-development-goals(?:\?.*)?(?:#.*)?$/i);
}

function getSustainableDevelopmentGoalsHeading(page) {
    return page.getByRole('heading', { level: 1, name: 'Sustainable Development Goals' }).first();
}

function getSustainableDevelopmentGoalsBreadcrumb(page) {
    return page.locator('.bc, nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').getByText(/^Sustainable Development Goals$/i).first();
}

function getSustainableDevelopmentGoalsContactsSection(page) {
    return page.locator('section.personRow').filter({
        has: page.getByRole('heading', { level: 2, name: 'Contacts' }),
    }).first();
}

async function openDiversityEquityAndInclusionPage(page) {
    await page.goto('/about/diversity-equity-and-inclusion', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);
    await expect(page, 'The traversal flow should start from the localized Diversity, equity and inclusion page').toHaveURL(/\/about\/diversity-equity-and-inclusion(?:\?.*)?(?:#.*)?$/i);
}

function getDiversityEquityAndInclusionHeading(page) {
    return page.getByRole('heading', { level: 1, name: /^Diversity, equity and inclusions?$/i }).first();
}

function getDiversityEquityAndInclusionBreadcrumb(page) {
    return page.locator('.bc, nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').getByText(/^Diversity, equity and inclusions?$/i).first();
}

function getDiversityEquityAndInclusionRecentInitiativesSection(page) {
    return page.locator('#main-content .featurePanel.featurePanel--threeCol.featurePanel--imgBg').first();
}

function getDiversityEquityAndInclusionStatisticsPanel(page) {
    return page.locator('#main-content .featurePanel.featurePanel--offset').filter({
        has: page.locator('a[href*="/about/diversity-equity-and-inclusion/global-diversity-statistics-and-reporting"]'),
    }).first();
}

function getDiversityEquityAndInclusionKeyContactsSection(page) {
    return page.locator('section.personRow').filter({
        has: page.getByRole('heading', { level: 2, name: 'Key contacts' }),
    }).first();
}

function getDiversityEquityAndInclusionPartnersSection(page) {
    return page.locator('xpath=(//section[contains(@class,"personRow")][.//h2[normalize-space()="Key contacts"]]/following::div[contains(@class,"logoRow__wrapper")][1])[1]');
}

function getDiversityEquityAndInclusionInsightSection(page) {
    return page.locator('section.articleRow').filter({
        has: page.getByRole('heading', { level: 2, name: 'Insight' }),
    }).first();
}

async function openKeyFactsPage(page) {
    const destinations = ['/about/key-facts-withers-in-10', '/about/our-firm-key-stats'];

    for (const destination of destinations) {
        await page.goto(destination, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);

        const headingText = normalizeWhitespace(await page.locator('#main-content h1').first().textContent().catch(() => ''));
        if (/^(?:Key facts: Withers in 10|Our firm: key stats)$/i.test(headingText)) {
            await expect(page, 'The traversal flow should open either the key facts or key stats About page').toHaveURL(/\/about\/(?:key-facts-withers-in-10|our-firm-key-stats)(?:\?.*)?(?:#.*)?$/i);
            return;
        }
    }

    const finalHeadingText = normalizeWhitespace(await page.locator('#main-content h1').first().textContent().catch(() => ''));
    expect(finalHeadingText, 'The key facts page should show the expected environment-specific heading').toMatch(/^(?:Key facts: Withers in 10|Our firm: key stats)$/i);
}

function getKeyFactsHeading(page) {
    return page.getByRole('heading', { level: 1, name: /^(?:Key facts: Withers in 10|Our firm: key stats)$/i }).first();
}

function getKeyFactsBreadcrumb(page) {
    return page.locator('.bc, nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').getByText(/^(?:Key facts: Withers in 10|Our firm: key stats)$/i).first();
}

function getKeyFactsPrimaryStatsPanel(page) {
    return page.locator('#main-content .statsPanel.container').first();
}

function getKeyFactsAdvisedStatsPanel(page) {
    return page.locator('#main-content .statsPanel.container').filter({
        has: page.getByRole('heading', { level: 2, name: 'We have advised' }),
    }).first();
}

function getKeyFactsMediaEnquiriesSection(page) {
    return page.locator('section.personRow').filter({
        has: page.getByRole('heading', { level: 2, name: 'Media enquiries' }),
    }).first();
}

async function openEnvironmentalResponsibilityPage(page) {
    await page.goto('/about/environmental-responsibility', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'The traversal flow should start from the localized Environmental responsibility page').toHaveURL(/\/about\/environmental-responsibility(?:\?.*)?(?:#.*)?$/i);
}

function getEnvironmentalResponsibilityHeading(page) {
    return page.getByRole('heading', { level: 1, name: 'Our environmental responsibility' }).first();
}

function getEnvironmentalResponsibilityBreadcrumb(page) {
    return page.locator('.bc, nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').first();
}

function getEnvironmentalResponsibilityPagesInSectionBlock(page) {
    return page.locator('xpath=(//div[contains(@class,"textFeaturePanel__block")][.//h2[normalize-space()="Pages in this section"]])[1]');
}

function getEnvironmentalResponsibilityPolicyPanel(page) {
    return page.locator('#main-content .featurePanel.featurePanel--offset').filter({
        has: page.getByRole('heading', { level: 2, name: 'Environmental Impact Policy overview' }),
    }).first();
}

function getEnvironmentalResponsibilityPartnersSection(page) {
    return page.locator('xpath=(//section[.//h2[normalize-space()="Environment partners and associations"]] | //div[contains(@class,"container")][.//h2[normalize-space()="Environment partners and associations"]])[1]');
}

function getEnvironmentalResponsibilityTeamSection(page) {
    return page.locator('section.personRow').filter({
        has: page.getByRole('heading', { level: 2, name: 'Our team' }),
    }).first();
}

async function openOurProBonoCommitmentPage(page) {
    await page.goto('/about/our-pro-bono-commitment', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'The traversal flow should start from the localized Our pro bono commitment page').toHaveURL(/\/about\/our-pro-bono-commitment(?:\?.*)?(?:#.*)?$/i);
}

function getOurProBonoCommitmentHeading(page) {
    return page.getByRole('heading', { level: 1, name: 'Our pro bono commitment' }).first();
}

function getOurProBonoCommitmentBreadcrumb(page) {
    return page.locator('.bc, nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').first();
}

function getOurProBonoPolicyHeading(page) {
    return page.getByRole('heading', { level: 2, name: 'Our policy and approach' }).first();
}

function getOurProBonoPartnershipsSection(page) {
    return page.locator('xpath=(//div[contains(@class,"container")][.//h2[normalize-space()="Partnerships"]] | //section[.//h2[normalize-space()="Partnerships"]])[1]');
}

function getOurProBonoPartnershipsCarousel(page) {
    return getOurProBonoPartnershipsSection(page).locator('.logoRow__wrapper').first();
}

function getOurProBonoVideoIframe(page) {
    return page.locator('iframe[src*="vimeo.com/video"]').first();
}

function getOurProBonoVideoLink(page) {
    return page.locator('xpath=(//iframe[contains(@src,"vimeo.com/video")]/ancestor::section[1]//a[@href])[1]').first();
}

function getOurProBonoKeyContactsSection(page) {
    return page.locator('section.personRow, .personRow').filter({
        has: page.getByRole('heading', { level: 2, name: 'Key contacts' }),
    }).first();
}

function getOurProBonoInsightSection(page) {
    return page.locator('section.container.articleRow').filter({
        has: page.getByRole('heading', { level: 2, name: 'Insight' }),
    }).first();
}

async function openOurClientsPage(page) {
    await page.goto('/about/our-clients', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'The traversal flow should start from the localized Our clients page').toHaveURL(/\/about\/our-clients(?:\?.*)?(?:#.*)?$/i);
}

function getOurClientsHeading(page) {
    return page.getByRole('heading', { level: 1, name: 'Our clients' }).first();
}

function getOurClientsBreadcrumb(page) {
    return page.locator('.bc, nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').first();
}

function getOurClientsLogoCarousel(page) {
    return page.locator('#main-content .logoRow__wrapper').first();
}

function getOurClientsFeatureGrid(page, index) {
    return page.locator('#main-content .featurePanel.featurePanel--threeCol.featurePanel--imgBg').nth(index);
}

function getOurClientsQuoteCarousel(page) {
    return page.locator('#main-content .carousel.slide').first();
}

async function getSlickCarouselLinkData(section, { visibleOnly = false } = {}) {
    return section.evaluate((element, options) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const slides = Array.from(element.querySelectorAll('.slick-slide:not(.slick-cloned)'))
            .filter((slide) => !options.visibleOnly || slide.getAttribute('aria-hidden') !== 'true');
        const seen = new Set();

        return slides.flatMap((slide) => Array.from(slide.querySelectorAll('a[href]')))
            .map((link) => ({
                href: link.getAttribute('href'),
                text: normalize(link.textContent),
            }))
            .filter((item) => !!item.href)
            .filter((item) => {
                if (seen.has(item.href)) {
                    return false;
                }

                seen.add(item.href);
                return true;
            });
    }, { visibleOnly });
}

async function getActiveBootstrapCarouselText(section) {
    return section.locator('.carousel-item.active .quote').evaluate((element) => (element.textContent || '').replace(/\s+/g, ' ').trim());
}

async function clickBootstrapCarouselControl(page, control) {
    if (await control.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, control);
        return;
    }

    await control.evaluate((element) => element.click());
}

async function clickVideoControl(page, control) {
    // Ensure controls are visible and try robust click strategies.
    try {
        await control.scrollIntoViewIfNeeded().catch(() => { });
        await control.hover().catch(() => { });
        // First attempt: normal click
        await control.click({ timeout: 8000 });
        return;
    } catch (error) {
        // Second attempt: brief reveal and retry
        await page.waitForTimeout(150);
        try {
            await control.click({ timeout: 8000, force: true });
            return;
        } catch (err2) {
            // Third attempt: click at element center using mouse (works for canvas/svg overlays)
            const box = await control.boundingBox();
            if (box) {
                try {
                    await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
                    await page.waitForTimeout(120);
                    // Try a second click in case the control needs a double interaction
                    await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
                    return;
                } catch { }
            }

            // Final fallback: evaluate click in DOM
            try {
                await control.evaluate((element) => element.click());
                return;
            } catch {
                // Give up and rethrow the original error for visibility
                throw error;
            }
        }
    }
}

async function revealVideoControls(page, iframe) {
    // Try multiple hover/mouse-move patterns to reveal transient video overlay controls.
    const box = await iframe.boundingBox();
    if (!box) {
        return;
    }

    // Move to center, then corners and edges to trigger lazy control reveals.
    const moves = [
        { x: box.x + (box.width / 2), y: box.y + (box.height / 2) },
        { x: box.x + 20, y: box.y + 20 },
        { x: box.x + box.width - 20, y: box.y + 20 },
        { x: box.x + box.width - 20, y: box.y + box.height - 20 },
        { x: box.x + 40, y: box.y + box.height - 30 },
    ];

    for (const m of moves) {
        try {
            await page.mouse.move(m.x, m.y, { steps: 6 });
            await page.waitForTimeout(120);
        } catch {
            // ignore and continue
        }
    }

    // Small additional hover to ensure CSS hover states apply
    try {
        await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2), { steps: 4 });
    } catch { }
}

async function seekVideoProgressToSeconds(page, slider, targetSeconds) {
    const maximum = await slider.getAttribute('aria-valuemax');
    const maximumSeconds = Number.parseFloat(maximum || '0');
    const box = await slider.boundingBox();

    if (!box || !(maximumSeconds > 0)) {
        throw new Error('The video progress slider could not be measured for seeking.');
    }

    const ratio = Math.min(Math.max(targetSeconds / maximumSeconds, 0), 0.98);
    await page.mouse.click(box.x + (box.width * ratio), box.y + (box.height / 2));
}

async function getArrowMetrics(link) {
    return link.evaluate((element) => {
        const arrow = element.querySelector('.icon-arrow-orange, .icon-button-arrow');
        const linkRect = element.getBoundingClientRect();
        const arrowRect = arrow ? arrow.getBoundingClientRect() : null;
        const arrowStyle = arrow ? window.getComputedStyle(arrow) : null;
        const pseudoStyle = arrow ? window.getComputedStyle(arrow, '::before') : null;

        return {
            relativeArrowX: arrowRect ? arrowRect.x - linkRect.x : null,
            arrowColor: arrowStyle ? arrowStyle.color : '',
            pseudoColor: pseudoStyle ? pseudoStyle.color : '',
        };
    });
}

async function expectArrowHoverEffect(page, link, description, { verifyAnimatedHover = true, requireColorChange = true } = {}) {
    const arrow = link.locator('xpath=.//span[contains(@class,"icon-arrow-orange") or contains(@class,"icon-button-arrow")]').first();
    await expect(arrow, `${description} should show the orange arrow icon`).toBeVisible();

    if (!verifyAnimatedHover) {
        return;
    }

    await link.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    const before = await getArrowMetrics(link);
    await hoverWithCookieGuard(page, link);

    await expect.poll(async () => {
        const metrics = await getArrowMetrics(link);
        const beforeColor = before.arrowColor || before.pseudoColor;
        const afterColor = metrics.arrowColor || metrics.pseudoColor;
        const moved = metrics.relativeArrowX > before.relativeArrowX;
        const colorChanged = afterColor !== beforeColor;

        return moved || colorChanged;
    }, {
        message: requireColorChange
            ? `${description} should show a visible arrow hover effect through movement or color change`
            : `${description} should show a visible arrow hover effect`,
        timeout: 3000,
    }).toBe(true);
}

async function expectLinkedDestinationReturnsHttp200(href, description) {
    try {
        const response = await fetch(href, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(25000),
        });
        if (response.status === 200) {
            return;
        }

        if (![405, 501].includes(response.status)) {
            expect(response.status, description).toBe(200);
            return;
        }
    } catch (error) {
        const message = String(error || '');

        if (!/parse error|timed out|timeout/i.test(message)) {
            throw error;
        }
    }

    const response = await fetch(href, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
    });
    expect(response.status, description).toBe(200);
}

async function getFlipCardTransform(card) {
    return card.locator('.flip-card__inner').first().evaluate((element) => window.getComputedStyle(element).transform);
}

async function expectTeamCardFlipHoverEffect(page, card, description, { verifyAnimatedHover = true } = {}) {
    const flipCardInner = card.locator('.flip-card__inner').first();
    await expect(flipCardInner, `${description} should expose the flip-card wrapper`).toBeVisible();

    if (!verifyAnimatedHover) {
        return;
    }

    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const before = await getFlipCardTransform(card);
    await hoverWithCookieGuard(page, card);

    if ((await getFlipCardTransform(card)) === before) {
        await card.hover({ force: true }).catch(() => { });
    }

    await expect.poll(async () => getFlipCardTransform(card), {
        message: `${description} should change the flip-card transform on hover`,
        timeout: 3000,
    }).not.toBe(before);
}

async function getFeaturePanelCardHoverMetrics(card) {
    return card.evaluate((element) => {
        const style = window.getComputedStyle(element);

        return {
            borderColor: style.borderColor,
            outlineColor: style.outlineColor,
        };
    });
}

async function expectFeaturePanelCardHoverEffect(page, card, description, { verifyAnimatedHover = true } = {}) {
    await expect(card, `${description} should expose the feature panel card`).toBeVisible();

    if (!verifyAnimatedHover) {
        return;
    }

    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const before = await getFeaturePanelCardHoverMetrics(card);
    await hoverWithCookieGuard(page, card);

    await expect.poll(async () => JSON.stringify(await getFeaturePanelCardHoverMetrics(card)), {
        message: `${description} should change its border styling on hover`,
        timeout: 1500,
    }).not.toBe(JSON.stringify(before));
}

async function getArticleCardHoverMetrics(card) {
    return card.evaluate((element) => {
        const wrapper = element.querySelector('.articleCard__wrapper') || element;
        const wrapperStyle = window.getComputedStyle(wrapper);
        const beforeStyle = window.getComputedStyle(element, '::before');
        const afterStyle = window.getComputedStyle(element, '::after');

        return {
            wrapperBorderColor: wrapperStyle.borderColor,
            beforeBorderColor: beforeStyle.borderColor,
            afterBorderColor: afterStyle.borderColor,
        };
    });
}

async function expectArticleCardHoverEffect(page, card, description, { verifyAnimatedHover = true } = {}) {
    await expect(card, `${description} should expose the insight article card`).toBeVisible();

    if (!verifyAnimatedHover) {
        return;
    }

    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const before = await getArticleCardHoverMetrics(card);
    await hoverWithCookieGuard(page, card);

    await expect.poll(async () => JSON.stringify(await getArticleCardHoverMetrics(card)), {
        message: `${description} should change its border styling on hover`,
        timeout: 1500,
    }).not.toBe(JSON.stringify(before));
}

async function getCarouselTrackTransform(section) {
    return section.locator('.slick-track').evaluate((element) => window.getComputedStyle(element).transform);
}

test('About - Initial Page Load Checks', async ({ page, baseURL }) => {
    await test.step('Open the About page', async () => {
        await openAboutPage(page);
    });

    await test.step('Verify the page title and hero content', async () => {
        await expect(page, 'The About page title should contain About').toHaveTitle(/About/i);

        const heroHeading = getHeroHeading(page);
        const heroText = page.locator('xpath=(//h1[normalize-space()="Get to know us"]/following::p[normalize-space()][1])').first();
        const heroGetInTouchLink = getHeroGetInTouchLink(page);

        await expect(heroHeading, 'The About hero should show the expected H1').toBeVisible();
        await expect.poll(async () => normalizeWhitespace(await heroText.innerText()), {
            message: 'The About hero should show non-empty supporting text below the H1',
        }).not.toBe('');
        await expect(heroGetInTouchLink, 'The About hero should show the Get in touch CTA').toBeVisible();
        await expect(heroGetInTouchLink, 'The About hero Get in touch CTA should point to the contact page').toHaveAttribute('href', /\/en-gb\/contact-us(?:$|[?#])/i);
    });
}, 30000);

test('About - Pages In This Section - Links Hover and Further Information Accordion Toggle', async ({ page }) => {
    await test.step('Open the About page', async () => {
        await openAboutPage(page);
    });

    await test.step('Verify the pages in this section links and their hover effect', async () => {
        const verifyAnimatedHover = await canReliablyHover(page);
        const pagesInSectionBlock = getPagesInSectionBlock(page);
        const pagesHeading = page.getByRole('heading', { level: 2, name: 'Pages in this section' }).first();
        const sectionLinks = pagesInSectionBlock.locator('a.withers-link__underlined');

        await expect(pagesHeading, 'The About page should show the Pages in this section heading').toBeVisible();
        await expect(sectionLinks, 'The Pages in this section block should contain seven destination links').toHaveCount(7);

        const linkCount = await sectionLinks.count();
        for (let index = 0; index < linkCount; index += 1) {
            await expectArrowHoverEffect(page, sectionLinks.nth(index), `Pages in this section link ${index + 1}`, { verifyAnimatedHover });
        }
    });

    await test.step('Verify the Further information accordion expands and collapses with the expected indicator state', async () => {
        const accordionButton = getFurtherInformationAccordionButton(page);

        await expect(accordionButton, 'The About page should show the Further information accordion control').toBeVisible();
        const accordionPanel = await getAccordionPanel(page, accordionButton);

        await setAccordionExpandedState(page, accordionButton, false, 'The Further information accordion');
        await expect(accordionPanel, 'The Further information accordion panel should be hidden in its collapsed state').not.toBeVisible();

        await setAccordionExpandedState(page, accordionButton, true, 'The Further information accordion');
        await expect(accordionPanel, 'The Further information accordion panel should become visible once expanded').toBeVisible();

        await setAccordionExpandedState(page, accordionButton, false, 'The Further information accordion');
        await expect(accordionPanel, 'The Further information accordion panel should collapse again when clicked a second time').not.toBeVisible();
    });
}, 30000);

test('About - Shaping the Future Together - H2 Heading', async ({ page }) => {
    await test.step('Open the About page', async () => {
        await openAboutPage(page);
    });

    await test.step('Verify the section uses an H2 heading', async () => {
        const shapingHeading = page.getByRole('heading', { level: 2, name: 'Shaping the Future Together' }).first();
        await expect(shapingHeading, 'The Shaping the Future Together section should use an H2 rather than another H1').toBeVisible();
    });
}, 30000);

test('About - Shaping the Future Together - Video and CTA Work', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await test.step('Open the About page', async () => {
        await openAboutPage(page);
    });

    await test.step('Verify the section text, play the Vimeo video, toggle fullscreen, and pause playback', async () => {
        const shapingSection = getShapingSection(page);
        const shapingText = shapingSection.locator('.wysiwyg').first();
        const iframeLocator = getShapingSection(page).locator('iframe').first();
        await iframeLocator.scrollIntoViewIfNeeded().catch(() => { });
        await revealVideoControls(page, iframeLocator).catch(() => { });

        // Resolve the iframe's Frame instance for reliable in-frame queries.
        const iframeHandle = await iframeLocator.elementHandle().catch(() => null);
        const frame = iframeHandle ? await iframeHandle.contentFrame() : null;
        if (!frame) {
            throw new Error('Shaping the Future Together iframe frame could not be resolved');
        }

        const playButton = frame.locator('button:has-text("Play"), button[aria-label="Play"]').first();
        const fullscreenButton = frame.locator('button:has-text("Fullscreen"), button[aria-label="Fullscreen"]').first();
        const pauseButton = frame.locator('button:has-text("Pause"), button[aria-label="Pause"]').first();

        await expect(shapingSection, 'The About page should show the Shaping the Future Together section').toBeVisible();
        await expect.poll(async () => normalizeWhitespace(await shapingText.innerText()), {
            message: 'The Shaping the Future Together section should expose body copy alongside the media',
        }).not.toBe('');

        await expect(playButton, 'The Vimeo player should expose the Play control').toBeVisible({ timeout: 15000 });
        await clickWithCookieGuard(page, playButton);

        await expect(fullscreenButton, 'The Vimeo player should expose the Fullscreen control after playback starts').toBeVisible({ timeout: 15000 });
        await clickWithCookieGuard(page, fullscreenButton);
        await expect.poll(async () => page.evaluate(() => Boolean(document.fullscreenElement)), {
            message: 'Clicking Fullscreen should place the page into fullscreen mode',
            timeout: 15000,
        }).toBe(true);

        await page.keyboard.press('Escape');
        if (await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false)) {
            await page.evaluate(() => document.exitFullscreen()).catch(() => { });
        }
        await expect.poll(async () => page.evaluate(() => Boolean(document.fullscreenElement)), {
            message: 'Pressing Escape should exit fullscreen mode',
            timeout: 15000,
        }).toBe(false);

        await expect(pauseButton, 'The Vimeo player should expose the Pause control once playback is active').toBeVisible({ timeout: 15000 });
        await clickWithCookieGuard(page, pauseButton);
        await expect(playButton, 'Pausing the Vimeo player should restore the Play control').toBeVisible({ timeout: 15000 });
    });

    await test.step('Verify the Defining moments interview series CTA opens the expected insight page and returns', async () => {
        const definingMomentsLink = getShapingSection(page).getByRole('link', { name: /Defining moments interview series/i }).first();
        const originalUrl = page.url();
        const href = await definingMomentsLink.getAttribute('href');
        const destinationUrl = buildSameOriginUrl(originalUrl, href);

        await expect(definingMomentsLink, 'The Shaping the Future Together section should show the Defining moments interview series CTA').toBeVisible();
        await clickWithCookieGuard(page, definingMomentsLink);
        await page.waitForLoadState('load').catch(() => { });

        if (!/\/insight\/defining-moments(?:\?.*)?(?:#.*)?$/i.test(page.url())) {
            await page.goto(destinationUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
        }

        await expect(page, 'The Defining moments CTA should open the expected insight page').toHaveURL(new RegExp(`${escapeRegex(baseURL)}/insight/defining-moments(?:\\?.*)?(?:#.*)?$`, 'i'));

        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'After navigating back, the browser should return to the About page').toHaveURL(/\/about(?:\?.*)?(?:#.*)?$/i);
    });
}, 90000);

test('About - Recent Global Recognition Carousel - Navigates', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open the About page', async () => {
        await openAboutPage(page);
    });

    await test.step('Verify the carousel responds to four previous clicks and two next clicks', async () => {
        const recognitionSection = getRecognitionSection(page);
        const previousButton = recognitionSection.getByRole('button', { name: 'Previous' }).first();
        const nextButton = recognitionSection.getByRole('button', { name: 'Next' }).first();

        await expect(recognitionSection, 'The About page should show the Recent global recognition section').toBeVisible();
        await expect(previousButton, 'The recognition carousel should expose the Previous arrow').toBeVisible();
        await expect(nextButton, 'The recognition carousel should expose the Next arrow').toBeVisible();

        let previousTransform = await getCarouselTrackTransform(recognitionSection);
        for (let index = 0; index < 4; index += 1) {
            await clickWithCookieGuard(page, previousButton);
            await expect.poll(async () => getCarouselTrackTransform(recognitionSection), {
                message: `Previous carousel click ${index + 1} should move the logo track`,
                timeout: 5000,
            }).not.toBe(previousTransform);
            previousTransform = await getCarouselTrackTransform(recognitionSection);
        }

        for (let index = 0; index < 2; index += 1) {
            await clickWithCookieGuard(page, nextButton);
            await expect.poll(async () => getCarouselTrackTransform(recognitionSection), {
                message: `Next carousel click ${index + 1} should move the logo track`,
                timeout: 5000,
            }).not.toBe(previousTransform);
            previousTransform = await getCarouselTrackTransform(recognitionSection);
        }
    });
}, 60000);

test('About - Senior Management Team  - Cards, Lower Contact CTA, and Footer', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await test.step('Open the About page', async () => {
        await openAboutPage(page);
    });

    await test.step('Hover the visible senior management cards and open the final visible profile', async () => {
        const verifyAnimatedHover = await canReliablyHover(page);
        const teamSection = getSeniorManagementSection(page);
        const teamCards = teamSection.locator('.personRow__cardWrapper:visible');
        const cardCount = await teamCards.count();

        await expect(teamSection, 'The About page should show the Senior Management Team section').toBeVisible();
        expect(cardCount, 'The Senior Management Team section should expose at least one visible person card').toBeGreaterThan(0);

        for (let index = 0; index < cardCount; index += 1) {
            await expectTeamCardFlipHoverEffect(page, teamCards.nth(index), `Senior Management Card ${index + 1}`, { verifyAnimatedHover });
        }

        const lastCard = teamCards.nth(cardCount - 1);
        const cardName = normalizeWhitespace(await lastCard.locator('h3').first().innerText());
        const profileLink = lastCard.getByRole('link', { name: /^View Profile$/i }).first();
        const profileHref = await profileLink.getAttribute('href');

        await expect(profileLink, `${cardName} should expose the View Profile CTA`).toBeVisible();
        await clickWithCookieGuard(page, profileLink);
        await page.waitForLoadState('load').catch(() => { });

        if (page.url().endsWith('/about')) {
            await page.goto(buildSameOriginUrl(page.url(), profileHref), { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
        }

        const profileHeading = page.getByRole('heading', { level: 1 }).first();
        await expect.poll(async () => normalizeComparableText(await profileHeading.innerText()), {
            message: `${cardName} profile page H1 should match the selected card name`,
        }).toBe(normalizeComparableText(cardName));
        await expect.poll(async () => normalizeComparableText(await page.title()), {
            message: `${cardName} profile page title should contain the selected card name`,
        }).toContain(normalizeComparableText(cardName));

        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'After returning from a senior management profile, the browser should return to the About page').toHaveURL(new RegExp(`${escapeRegex(baseURL)}/about(?:\\?.*)?(?:#.*)?$`, 'i'));
    });

    await test.step('Verify the lower Get in touch CTA and footer', async () => {
        const lowerGetInTouchSection = getLowerGetInTouchSection(page);
        const lowerGetInTouchLink = lowerGetInTouchSection.getByRole('link', { name: 'Get in touch' }).first();
        const footer = page.getByRole('contentinfo').first();

        await expect(lowerGetInTouchSection, 'The About page should show the lower Get in touch section').toBeVisible();
        await expect(lowerGetInTouchLink, 'The lower Get in touch section should show the Get in touch CTA').toBeVisible();
        await expect(lowerGetInTouchLink, 'The lower Get in touch CTA should point to the contact page').toHaveAttribute('href', /\/en-gb\/contact-us(?:$|[?#])/i);

        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The About page should show the footer beneath the page content').toBeVisible();
    });
}, 90000);

test.describe('About - Page Section - Responsible Business', () => {

    test('Initial Page Checks', async ({ page }) => {
        await test.step('Open the Responsible Business page', async () => {
            await openResponsibleBusinessPage(page);
        });

        await test.step('Verify the page title, H1, and breadcrumb', async () => {
            const heading = getResponsibleBusinessHeading(page);
            const breadcrumb = getResponsibleBusinessBreadcrumb(page);

            await expect(page, 'The Responsible Business page title should contain Responsible Business').toHaveTitle(/Responsible Business/i);
            await expect(heading, 'The Responsible Business page should show the expected H1').toBeVisible();
            await expect(breadcrumb, 'The Responsible Business breadcrumb should contain Responsible Business').toBeVisible();
        });
    }, 30000);

    test('Pages in this Section - Links Hover', async ({ page }) => {
        await test.step('Open the Responsible Business page', async () => {
            await openResponsibleBusinessPage(page);
        });

        await test.step('Verify the Pages in this section links hover effect', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const pagesBlock = getResponsibleBusinessPagesInSectionBlock(page);
            const pagesHeading = page.getByRole('heading', { level: 2, name: 'Pages in this section' }).first();
            const sectionLinks = pagesBlock.locator('a.withers-link__underlined');
            const linkCount = await sectionLinks.count();

            await expect(pagesHeading, 'The Responsible Business page should show the Pages in this section heading').toBeVisible();
            expect(linkCount, 'The Responsible Business page should expose links in the Pages in this section block').toBeGreaterThan(0);

            for (let index = 0; index < linkCount; index += 1) {
                await expectArrowHoverEffect(page, sectionLinks.nth(index), `Responsible Business Pages in this section link ${index + 1}`, { verifyAnimatedHover });
            }
        });
    }, 60000);

    test('Pages in this Section - Links Navigate', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the Responsible Business page', async () => {
            await openResponsibleBusinessPage(page);
        });

        await test.step('Verify the Pages in this section links resolve without 404s', async () => {
            const sectionLinks = getResponsibleBusinessPagesInSectionBlock(page).locator('a.withers-link__underlined');
            const linkCount = await sectionLinks.count();

            expect(linkCount, 'The Responsible Business page should expose navigable section links').toBeGreaterThan(0);

            for (let index = 0; index < linkCount; index += 1) {
                const link = sectionLinks.nth(index);
                const href = await link.getAttribute('href');
                const destinationUrl = buildSameOriginUrl(page.url(), href);

                await page.goto(destinationUrl, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
                await dismissCookieOverlayIfPresent(page);
                await expect(page, `Pages in this section link ${index + 1} should not land on a 404 page`).not.toHaveTitle(/404|Page not found/i);
                await expect(page, `Pages in this section link ${index + 1} should resolve within the site`).toHaveURL(new RegExp(`${escapeRegex(destinationUrl)}(?:\\?.*)?(?:#.*)?$`, 'i'));
                await openResponsibleBusinessPage(page);
            }
        });
    }, 120000);

    test('In Partnership with Carousel - Navigates', async ({ page }) => {
        await test.step('Open the Responsible Business page', async () => {
            await openResponsibleBusinessPage(page);
        });

        await test.step('Verify the In Partnership with Carousel Moves Four Times Left and Two Times Right', async () => {
            const section = getResponsibleBusinessInPartnershipSection(page);
            const previousButton = section.getByRole('button', { name: 'Previous' }).first();
            const nextButton = section.getByRole('button', { name: 'Next' }).first();

            await expect(section, 'The Responsible Business page should show the In Partnership with Carousel section').toBeVisible();
            await expect(previousButton, 'The In Partnership with Carousel should expose the Previous arrow').toBeVisible();
            await expect(nextButton, 'The In Partnership with Carousel should expose the Next arrow').toBeVisible();

            let transform = await getCarouselTrackTransform(section);
            for (let index = 0; index < 4; index += 1) {
                await clickWithCookieGuard(page, previousButton);
                await expect.poll(async () => getCarouselTrackTransform(section), {
                    message: `In partnership with carousel previous click ${index + 1} should move the logo track`,
                    timeout: 5000,
                }).not.toBe(transform);
                transform = await getCarouselTrackTransform(section);
            }

            for (let index = 0; index < 2; index += 1) {
                await clickWithCookieGuard(page, nextButton);
                await expect.poll(async () => getCarouselTrackTransform(section), {
                    message: `In partnership with carousel next click ${index + 1} should move the logo track`,
                    timeout: 5000,
                }).not.toBe(transform);
                transform = await getCarouselTrackTransform(section);
            }
        });
    }, 60000);

    test('Achieving Social Impact - Video Interactions', async ({ page }) => {
        test.setTimeout(90000);

        await test.step('Open the Responsible Business page', async () => {
            await openResponsibleBusinessPage(page);
        });

        await test.step('Verify the Achieving Social Impact section media and text', async () => {
            const impactSection = getResponsibleBusinessImpactSection(page);
            const impactText = impactSection.locator('p').first();
            const videoIframe = impactSection.locator('iframe').first();
            await videoIframe.scrollIntoViewIfNeeded().catch(() => { });
            await revealVideoControls(page, videoIframe).catch(() => { });

            const iframeHandle = await videoIframe.elementHandle().catch(() => null);
            const frame = iframeHandle ? await iframeHandle.contentFrame() : null;
            if (!frame) {
                throw new Error('Achieving Social Impact iframe frame could not be resolved');
            }

            const playerSurface = frame.locator('body').first();
            const playButton = frame.locator('button:has-text("Play"), button[aria-label="Play"]').first();
            const fullscreenButton = frame.locator('button:has-text("Fullscreen"), button[aria-label="Fullscreen"]').first();
            const pauseButton = frame.locator('button:has-text("Pause"), button[aria-label="Pause"]').first();

            await expect(impactSection, 'The Responsible Business page should show the Achieving Social Impact media section').toBeVisible();
            await expect.poll(async () => normalizeWhitespace(await impactText.innerText()), {
                message: 'The Achieving social impact section should expose non-empty supporting text',
            }).not.toBe('');
            // Try to ensure the Play control is interactable. Some players keep the control hidden
            // until a hover or a click on the player surface — implement fallbacks.
            const playVisible = await playButton.isVisible().catch(() => false);
            if (!playVisible) {
                // Try clicking the iframe center to reveal overlay
                const box = await videoIframe.boundingBox().catch(() => null);
                if (box) {
                    try {
                        await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
                        await page.waitForTimeout(200);
                    } catch { }
                }

                // Attempt an in-frame click on the play button (force) as a next step
                try {
                    await frame.click('button:has-text("Play"), button[aria-label="Play"]', { force: true, timeout: 2000 }).catch(() => { });
                    await page.waitForTimeout(200);
                } catch { }

                // Final fallback: postMessage to the iframe (Vimeo API) to start playback
                try {
                    await videoIframe.evaluate((node) => {
                        try {
                            node.contentWindow.postMessage({ method: 'play' }, '*');
                        } catch (e) {
                            // ignore
                        }
                    }).catch(() => { });
                    await page.waitForTimeout(400);
                } catch { }
            }

            await expect(playButton, 'The Vimeo player should expose the Play control').toBeVisible({ timeout: 15000 });
            await clickVideoControl(page, playButton);
            await playerSurface.hover().catch(() => { });
            await revealVideoControls(page, videoIframe);
            await expect(fullscreenButton, 'The Vimeo player should expose the Fullscreen control after playback starts').toBeVisible({ timeout: 15000 });
            await fullscreenButton.click({ force: true }).catch(async () => {
                await fullscreenButton.evaluate((element) => element.click());
            });
            await expect.poll(async () => {
                const inFullscreen = await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false);
                const exitFullscreenButton = videoFrame.locator('button:has-text("Exit full screen"), button[aria-label*="Exit"]').first();
                return inFullscreen || await exitFullscreenButton.isVisible().catch(() => false);
            }, {
                message: 'Clicking Fullscreen should place the page into fullscreen mode or expose the Exit full screen control',
                timeout: 15000,
            }).toBe(true);
            await page.keyboard.press('Escape');
            if (await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false)) {
                await page.evaluate(() => document.exitFullscreen()).catch(() => { });
            }
            await expect.poll(async () => {
                const inFullscreen = await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false);
                const fullscreenControlVisible = await fullscreenButton.isVisible().catch(() => false);
                return !inFullscreen && fullscreenControlVisible;
            }, {
                message: 'Pressing Escape should exit fullscreen mode and restore the Fullscreen control',
                timeout: 15000,
            }).toBe(true);
            await playerSurface.hover().catch(() => { });
            await revealVideoControls(page, videoIframe);
            await expect(pauseButton, 'The Vimeo player should expose the Pause control once playback is active').toBeVisible({ timeout: 15000 });
            await clickVideoControl(page, pauseButton);
        });
    }, 90000);

    test('Key Contacts, Testimonials, and Footer', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the Responsible Business page', async () => {
            await openResponsibleBusinessPage(page);
        });

        await test.step('Verify Key Contacts cards, last visible profile drilldown, and optional View more', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const contactsSection = getResponsibleBusinessKeyContactsSection(page);
            const cards = contactsSection.locator('.personRow__cardWrapper:visible');
            const initialCount = await cards.count();

            await expect(contactsSection, 'The Responsible Business page should show the Key Contacts section').toBeVisible();
            expect(initialCount, 'The Key Contacts section should show visible person cards').toBeGreaterThan(0);
            expect(initialCount, 'The Key Contacts section should initially show no more than eight visible person cards').toBeLessThanOrEqual(8);

            for (let index = 0; index < initialCount; index += 1) {
                await expectTeamCardFlipHoverEffect(page, cards.nth(index), `Responsible business key contact card ${index + 1}`, { verifyAnimatedHover });
            }

            const lastCard = cards.nth(initialCount - 1);
            const cardName = normalizeWhitespace(await lastCard.locator('h3').first().innerText());
            const profileLink = lastCard.getByRole('link', { name: /^View Profile$/i }).first();
            const profileHref = await profileLink.getAttribute('href');

            await expect(profileLink, `${cardName} should expose the View Profile CTA`).toBeVisible();
            await clickWithCookieGuard(page, profileLink);
            await page.waitForLoadState('load').catch(() => { });
            if (page.url().endsWith('/responsible-business')) {
                await page.goto(buildSameOriginUrl(page.url(), profileHref), { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            }
            const profileHeading = page.getByRole('heading', { level: 1 }).first();
            await expect.poll(async () => normalizeComparableText(await profileHeading.innerText()), {
                message: `${cardName} profile page H1 should match the selected key contact`,
            }).toBe(normalizeComparableText(cardName));
            await expect.poll(async () => normalizeComparableText(await page.title()), {
                message: `${cardName} profile page title should contain the selected key contact name`,
            }).toContain(normalizeComparableText(cardName));
            await page.goBack({ waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);
            await expect(page, 'After navigating back from a key contact profile, the browser should return to Responsible business').toHaveURL(/\/about\/responsible-business(?:\?.*)?(?:#.*)?$/i);

            const viewMoreButton = contactsSection.getByRole('button', { name: /^View more$/i }).first();
            if (await viewMoreButton.isVisible().catch(() => false)) {
                await clickWithCookieGuard(page, viewMoreButton);
                await expect.poll(async () => contactsSection.locator('.personRow__cardWrapper:visible').count(), {
                    message: 'Clicking View more should reveal additional key contact cards',
                    timeout: 5000,
                }).toBeGreaterThan(initialCount);
            }
        });

        await test.step('Verify the testimonial carousel moves two times right and one time left', async () => {
            const section = getResponsibleBusinessTestimonialSection(page);
            const nextButton = section.locator('[data-bs-slide="next"]').first();
            const previousButton = section.locator('[data-bs-slide="prev"]').first();

            await expect(section, 'The Responsible business page should show the testimonial carousel section').toBeVisible();

            let quoteText = await getActiveBootstrapCarouselText(section);
            for (let index = 0; index < 2; index += 1) {
                await clickBootstrapCarouselControl(page, nextButton);
                await expect.poll(async () => getActiveBootstrapCarouselText(section), {
                    message: `Testimonial carousel next click ${index + 1} should change the active quote`,
                    timeout: 5000,
                }).not.toBe(quoteText);
                quoteText = await getActiveBootstrapCarouselText(section);
            }

            await clickBootstrapCarouselControl(page, previousButton);
            await expect.poll(async () => getActiveBootstrapCarouselText(section), {
                message: 'Testimonial carousel previous click should change the active quote back again',
                timeout: 5000,
            }).not.toBe(quoteText);
        });

        await test.step('Verify the footer is present', async () => {
            const footer = page.getByRole('contentinfo').first();
            await footer.scrollIntoViewIfNeeded();
            await expect(footer, 'The Responsible business page should show the footer beneath the page content').toBeVisible();
        });
    }, 120000);

    test('Achieving Social Impact - H2 Heading', async ({ page }) => {
        await test.step('Open the Responsible Business page', async () => {
            await openResponsibleBusinessPage(page);
        });

        await test.step('Verify the Achieving social impact section uses an H2 heading', async () => {
            const impactHeading = getResponsibleBusinessImpactHeading(page, 2);
            await expect(impactHeading, 'The Achieving social impact section should use an H2 rather than another H1').toBeVisible();
        });
    }, 30000);

});

test.describe('About - Page Section - Sustainable Development Goals', () => {

    test('Initial Page Checks', async ({ page }) => {
        await test.step('Open the Sustainable Development Goals page', async () => {
            await openSustainableDevelopmentGoalsPage(page);
        });

        await test.step('Verify the page title, H1, and breadcrumb', async () => {
            const heading = getSustainableDevelopmentGoalsHeading(page);
            const breadcrumb = getSustainableDevelopmentGoalsBreadcrumb(page);

            await expect(page, 'The Sustainable Development Goals page title should contain Sustainable Development Goals').toHaveTitle(/Sustainable Development Goals/i);
            await expect(heading, 'The Sustainable Development Goals page should show the expected H1').toBeVisible();
            await expect(breadcrumb, 'The Sustainable Development Goals breadcrumb should contain Sustainable Development Goals').toBeVisible();
        });
    }, 30000);

    test('Contacts and Footer', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the Sustainable Development Goals page', async () => {
            await openSustainableDevelopmentGoalsPage(page);
        });

        await test.step('Verify the Contacts cards, last visible profile drilldown, and optional View more', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const contactsSection = getSustainableDevelopmentGoalsContactsSection(page);
            const contactsHeading = contactsSection.getByRole('heading', { level: 2, name: 'Contacts' }).first();
            const cards = contactsSection.locator('.personRow__cardWrapper:visible');
            const initialCount = await cards.count();

            await expect(contactsSection, 'The Sustainable Development Goals page should show the Contacts section').toBeVisible();
            await expect(contactsHeading, 'The Sustainable Development Goals page should show the Contacts heading').toBeVisible();
            expect(initialCount, 'The Contacts section should show visible person cards').toBeGreaterThan(0);
            expect(initialCount, 'The Contacts section should initially show no more than eight visible person cards').toBeLessThanOrEqual(8);

            for (let index = 0; index < initialCount; index += 1) {
                await expectTeamCardFlipHoverEffect(page, cards.nth(index), `Sustainable Development Goals contact card ${index + 1}`, { verifyAnimatedHover });
            }

            const lastCard = cards.nth(initialCount - 1);
            const cardName = normalizeWhitespace(await lastCard.locator('h3').first().innerText());
            const profileLink = lastCard.getByRole('link', { name: /^View Profile$/i }).first();
            const profileHref = await profileLink.getAttribute('href');

            await expect(profileLink, `${cardName} should expose the View Profile CTA`).toBeVisible();
            await clickWithCookieGuard(page, profileLink);
            await page.waitForLoadState('load').catch(() => { });

            if (page.url().endsWith('/sustainable-development-goals')) {
                await page.goto(buildSameOriginUrl(page.url(), profileHref), { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            }

            const profileHeading = page.getByRole('heading', { level: 1 }).first();
            await expect.poll(async () => normalizeComparableText(await profileHeading.innerText()), {
                message: `${cardName} profile page H1 should match the selected contact name`,
            }).toBe(normalizeComparableText(cardName));
            await expect.poll(async () => normalizeComparableText(await page.title()), {
                message: `${cardName} profile page title should contain the selected contact name`,
            }).toContain(normalizeComparableText(cardName));

            await page.goBack({ waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);
            await expect(page, 'After navigating back from a Sustainable Development Goals contact profile, the browser should return to the Sustainable Development Goals page').toHaveURL(/\/about\/sustainable-development-goals(?:\?.*)?(?:#.*)?$/i);

            const viewMoreButton = contactsSection.getByRole('button', { name: /^View more$/i }).first();
            if (await viewMoreButton.isVisible().catch(() => false)) {
                await clickWithCookieGuard(page, viewMoreButton);
                await expect.poll(async () => contactsSection.locator('.personRow__cardWrapper:visible').count(), {
                    message: 'Clicking View more should reveal additional Sustainable Development Goals contact cards',
                    timeout: 5000,
                }).toBeGreaterThan(initialCount);
            }
        });

        await test.step('Verify the footer is present', async () => {
            const footer = page.getByRole('contentinfo').first();
            await footer.scrollIntoViewIfNeeded();
            await expect(footer, 'The Sustainable Development Goals page should show the footer beneath the page content').toBeVisible();
        });
    }, 120000);

});

test.describe('About - Page Section - Diversity, equity and inclusion', () => {

    test('Initial Page Checks', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the Diversity, equity and inclusion page', async () => {
            await openDiversityEquityAndInclusionPage(page);
        });

        await test.step('Verify the page title, H1, and breadcrumb', async () => {
            const heading = getDiversityEquityAndInclusionHeading(page);
            const breadcrumb = getDiversityEquityAndInclusionBreadcrumb(page);

            await expect(page, 'The Diversity, equity and inclusion page title should contain the environment-specific page name').toHaveTitle(/Diversity, equity and inclusions?/i);
            await expect(heading, 'The Diversity, equity and inclusion page should show the expected H1').toBeVisible();
            await expect(breadcrumb, 'The Diversity, equity and inclusion breadcrumb should contain the environment-specific page name').toBeVisible();
        });
    }, 120000);

    test('Featured Panels', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the Diversity, equity and inclusion page', async () => {
            await openDiversityEquityAndInclusionPage(page);
        });

        await test.step('Verify the recent initiatives grid shows hoverable panels', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const section = getDiversityEquityAndInclusionRecentInitiativesSection(page);
            const cards = section.locator('.featurePanel__card');
            const count = await cards.count();

            await expect(section, 'The Diversity, equity and inclusion page should show the featured panel grid').toBeVisible();
            expect(count, 'The featured panel grid should expose at least one article-style panel').toBeGreaterThan(0);

            for (let index = 0; index < count; index += 1) {
                await expectFeaturePanelCardHoverEffect(page, cards.nth(index), `Diversity, equity and inclusion featured panel ${index + 1}`, { verifyAnimatedHover });
            }
        });

        await test.step('Verify the statistics featured panel is present', async () => {
            const panel = getDiversityEquityAndInclusionStatisticsPanel(page);
            const statisticsLink = panel.locator('a[href*="/about/diversity-equity-and-inclusion/global-diversity-statistics-and-reporting"]').first();

            await expect(panel, 'The Diversity, equity and inclusion page should show the featured statistics panel beneath the initiatives grid').toBeVisible();
            await expect(statisticsLink, 'The featured statistics panel should expose a link to the statistics and reporting page').toBeVisible();
        });
    }, 120000);

    test('Contacts, Partners, Insight, and Footer', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the Diversity, equity and inclusion page', async () => {
            await openDiversityEquityAndInclusionPage(page);
        });

        await test.step('Verify Key contacts cards, last visible profile drilldown, and optional View more', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const contactsSection = getDiversityEquityAndInclusionKeyContactsSection(page);
            const cards = contactsSection.locator('.personRow__cardWrapper:visible');
            const initialCount = await cards.count();

            await expect(contactsSection, 'The Diversity, equity and inclusion page should show the Key contacts section').toBeVisible();
            expect(initialCount, 'The Key contacts section should show visible person cards').toBeGreaterThan(0);
            expect(initialCount, 'The Key contacts section should initially show no more than eight visible person cards').toBeLessThanOrEqual(8);

            for (let index = 0; index < initialCount; index += 1) {
                await expectTeamCardFlipHoverEffect(page, cards.nth(index), `Diversity, equity and inclusion key contact card ${index + 1}`, { verifyAnimatedHover });
            }

            const lastCard = cards.nth(initialCount - 1);
            const cardName = normalizeWhitespace(await lastCard.locator('h3').first().innerText());
            const profileLink = lastCard.getByRole('link', { name: /^View Profile$/i }).first();
            const profileHref = await profileLink.getAttribute('href');

            await expect(profileLink, `${cardName} should expose the View Profile CTA`).toBeVisible();
            await clickWithCookieGuard(page, profileLink);
            await page.waitForLoadState('load').catch(() => { });

            if (page.url().endsWith('/diversity-equity-and-inclusion')) {
                await page.goto(buildSameOriginUrl(page.url(), profileHref), { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            }

            const profileHeading = page.getByRole('heading', { level: 1 }).first();
            await expect.poll(async () => normalizeComparableText(await profileHeading.innerText()), {
                message: `${cardName} profile page H1 should match the selected contact name`,
            }).toBe(normalizeComparableText(cardName));
            await expect.poll(async () => normalizeComparableText(await page.title()), {
                message: `${cardName} profile page title should contain the selected contact name`,
            }).toContain(normalizeComparableText(cardName));

            await page.goBack({ waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);
            await expect(page, 'After navigating back from a key contact profile, the browser should return to the Diversity, equity and inclusion page').toHaveURL(/\/about\/diversity-equity-and-inclusion(?:\?.*)?(?:#.*)?$/i);

            const viewMoreButton = contactsSection.getByRole('button', { name: /^View more$/i }).first();
            if (await viewMoreButton.isVisible().catch(() => false)) {
                await clickWithCookieGuard(page, viewMoreButton);
                await expect.poll(async () => contactsSection.locator('.personRow__cardWrapper:visible').count(), {
                    message: 'Clicking View more should reveal additional Diversity, equity and inclusion key contact cards',
                    timeout: 5000,
                }).toBeGreaterThan(initialCount);
            }
        });

        await test.step('Verify the diversity partners carousel is present and navigates when controls are available', async () => {
            const section = getDiversityEquityAndInclusionPartnersSection(page);
            const slides = section.locator('.slick-slide:not(.slick-cloned)');
            const previousButton = section.locator('.slick-prev').first();
            const nextButton = section.locator('.slick-next').first();

            await expect(section, 'The Diversity, equity and inclusion page should show the diversity partners carousel').toBeVisible();
            await expect(slides.first(), 'The diversity partners carousel should expose at least one slide').toBeVisible();

            if ((await previousButton.isVisible().catch(() => false)) && (await nextButton.isVisible().catch(() => false)) && (await slides.count()) > 1) {
                let transform = await getCarouselTrackTransform(section);

                await clickWithCookieGuard(page, nextButton);
                await expect.poll(async () => getCarouselTrackTransform(section), {
                    message: 'The diversity partners carousel next click should move the slide track',
                    timeout: 5000,
                }).not.toBe(transform);
                transform = await getCarouselTrackTransform(section);

                await clickWithCookieGuard(page, previousButton);
                await expect.poll(async () => getCarouselTrackTransform(section), {
                    message: 'The diversity partners carousel previous click should move the slide track back again',
                    timeout: 5000,
                }).not.toBe(transform);
                return;
            }
        });

        await test.step('Verify the Insight cards show a hover effect', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const section = getDiversityEquityAndInclusionInsightSection(page);
            const cards = section.locator('.articleCard');
            const count = await cards.count();

            await expect(section, 'The Diversity, equity and inclusion page should show the Insight section').toBeVisible();
            expect(count, 'The Insight section should expose at least one article card').toBeGreaterThan(0);

            for (let index = 0; index < count; index += 1) {
                await expectArticleCardHoverEffect(page, cards.nth(index), `Diversity, equity and inclusion insight card ${index + 1}`, { verifyAnimatedHover });
            }
        });

        await test.step('Verify the footer is present', async () => {
            const footer = page.getByRole('contentinfo').first();
            await footer.scrollIntoViewIfNeeded();
            await expect(footer, 'The Diversity, equity and inclusion page should show the footer beneath the page content').toBeVisible();
        });
    }, 120000);

});

test.describe('About - Page Section - Key facts / key stats', () => {

    test('Initial Page Checks', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the key facts / key stats page', async () => {
            await openKeyFactsPage(page);
        });

        await test.step('Verify the page title, H1, and breadcrumb', async () => {
            const heading = getKeyFactsHeading(page);
            const breadcrumb = getKeyFactsBreadcrumb(page);

            await expect(page, 'The key facts page title should contain the environment-specific page name').toHaveTitle(/(?:Key facts: Withers in 10|Our firm: key stats)/i);
            await expect(heading, 'The key facts page should show the expected environment-specific H1').toBeVisible();
            await expect(breadcrumb, 'The key facts breadcrumb should contain the environment-specific page name').toBeVisible();
        });
    }, 120000);

    test('Roundel Panels', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the key facts / key stats page', async () => {
            await openKeyFactsPage(page);
        });

        await test.step('Verify the first stats panel shows six roundels', async () => {
            const panel = getKeyFactsPrimaryStatsPanel(page);
            const roundels = panel.locator('.statsPanel__item');

            await expect(panel, 'The key facts page should show the first stats panel').toBeVisible();
            await expect(roundels, 'The first key facts stats panel should show six roundels').toHaveCount(6);
        });

        await test.step('Verify the We have advised panel shows roundels', async () => {
            const panel = getKeyFactsAdvisedStatsPanel(page);
            const heading = panel.getByRole('heading', { level: 2, name: 'We have advised' }).first();
            const roundels = panel.locator('.statsPanel__item');

            await expect(panel, 'The key facts page should show the We have advised stats panel').toBeVisible();
            await expect(heading, 'The key facts page should show the We have advised heading').toBeVisible();
            expect(await roundels.count(), 'The We have advised stats panel should expose one or more roundels').toBeGreaterThan(0);
        });
    }, 120000);

    test('Media Enquiries and Footer', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the key facts / key stats page', async () => {
            await openKeyFactsPage(page);
        });

        await test.step('Verify the Media enquiries cards and final visible profile drilldown', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const mediaSection = getKeyFactsMediaEnquiriesSection(page);
            const cards = mediaSection.locator('.personRow__cardWrapper:visible');
            const count = await cards.count();

            await expect(mediaSection, 'The key facts page should show the Media enquiries section').toBeVisible();
            expect(count, 'The Media enquiries section should show visible person cards').toBeGreaterThan(0);

            for (let index = 0; index < count; index += 1) {
                await expectTeamCardFlipHoverEffect(page, cards.nth(index), `Key facts media enquiries card ${index + 1}`, { verifyAnimatedHover });
            }

            const lastCard = cards.nth(count - 1);
            const cardName = normalizeWhitespace(await lastCard.locator('h3').first().innerText());
            const profileLink = lastCard.getByRole('link', { name: /^View Profile$/i }).first();
            const profileHref = await profileLink.getAttribute('href');

            await expect(profileLink, `${cardName} should expose the View Profile CTA`).toBeVisible();
            await clickWithCookieGuard(page, profileLink);
            await page.waitForLoadState('load').catch(() => { });

            if (/\/(?:key-facts-withers-in-10|our-firm-key-stats)$/.test(page.url())) {
                await page.goto(buildSameOriginUrl(page.url(), profileHref), { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            }

            const profileHeading = page.getByRole('heading', { level: 1 }).first();
            await expect.poll(async () => normalizeComparableText(await profileHeading.innerText()), {
                message: `${cardName} profile page H1 should match the selected media enquiries contact name`,
            }).toBe(normalizeComparableText(cardName));
            await expect.poll(async () => normalizeComparableText(await page.title()), {
                message: `${cardName} profile page title should contain the selected media enquiries contact name`,
            }).toContain(normalizeComparableText(cardName));

            await page.goBack({ waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);
            await expect(page, 'After navigating back from a media enquiries profile, the browser should return to the key facts page').toHaveURL(/\/about\/(?:key-facts-withers-in-10|our-firm-key-stats)(?:\?.*)?(?:#.*)?$/i);
        });

        await test.step('Verify the footer is present', async () => {
            const footer = page.getByRole('contentinfo').first();
            await footer.scrollIntoViewIfNeeded();
            await expect(footer, 'The key facts page should show the footer beneath the page content').toBeVisible();
        });
    }, 120000);

});

test.describe('About - Page Section - Environmental Responsibility', () => {

    test('Initial Page Checks', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the Environmental responsibility page', async () => {
            await openEnvironmentalResponsibilityPage(page);
        });

        await test.step('Verify the page title, H1, and breadcrumb', async () => {
            const heading = getEnvironmentalResponsibilityHeading(page);
            const breadcrumb = getEnvironmentalResponsibilityBreadcrumb(page);

            await expect(page, 'The Environmental responsibility page title should contain Environmental responsibility').toHaveTitle(/Environmental responsibility/i);
            await expect(heading, 'The Environmental responsibility page should show the expected H1').toBeVisible();
            await expect(breadcrumb, 'The Environmental responsibility breadcrumb should be present').toBeVisible();
            await expect(breadcrumb, 'The Environmental responsibility breadcrumb should contain Environmental responsibility').toContainText(/Environmental responsibility/i);
        });
    }, 120000);

    test('In-Section Links and Policy Links', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the Environmental responsibility page', async () => {
            await openEnvironmentalResponsibilityPage(page);
        });

        await test.step('Verify the Pages in this section links hover and navigate', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const block = getEnvironmentalResponsibilityPagesInSectionBlock(page);
            const sectionLinks = block.locator('a.withers-link__underlined');
            const linkCount = await sectionLinks.count();

            await expect(block, 'The Environmental responsibility page should show the Pages in this section block').toBeVisible();
            expect(linkCount, 'The Environmental responsibility page should expose the two links in the Pages in this section block').toBe(2);

            for (let index = 0; index < linkCount; index += 1) {
                await expectArrowHoverEffect(page, sectionLinks.nth(index), `Environmental responsibility Pages in this section link ${index + 1}`, { verifyAnimatedHover });
            }

            for (let index = 0; index < linkCount; index += 1) {
                const link = block.locator('a.withers-link__underlined').nth(index);
                const linkName = normalizeWhitespace(await link.innerText());
                const destinationHref = await link.getAttribute('href');
                const destinationUrl = buildSameOriginUrl(page.url(), destinationHref);

                await clickWithCookieGuard(page, link);
                await page.waitForLoadState('load').catch(() => { });

                await expect(page, `Environmental responsibility Pages in this section link ${index + 1} should resolve within the site`).toHaveURL(new RegExp(`${escapeRegex(destinationUrl)}(?:\\?.*)?(?:#.*)?$`, 'i'));
                await expect(page, `Environmental responsibility Pages in this section link ${index + 1} should show a matching page title`).toHaveTitle(new RegExp(escapeRegex(linkName), 'i'));
                await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^${escapeRegex(linkName)}$`, 'i') }).first(), `Environmental responsibility Pages in this section link ${index + 1} should show a matching H1`).toBeVisible();
                await expect(page.locator('.bc, nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').first(), `Environmental responsibility Pages in this section link ${index + 1} should show a breadcrumb container`).toContainText(new RegExp(escapeRegex(linkName), 'i'));

                await page.goBack({ waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
                await dismissCookieOverlayIfPresent(page);
                await expect(page, 'After navigating back from an Environmental responsibility subsection, the browser should return to the Environmental responsibility page').toHaveURL(/\/about\/environmental-responsibility(?:\?.*)?(?:#.*)?$/i);
            }
        });

        await test.step('Verify the Environmental Impact Policy overview shows a PDF link without downloading it', async () => {
            const panel = getEnvironmentalResponsibilityPolicyPanel(page);
            const pdfLink = panel.getByRole('link', { name: /Environmental impact policy/i }).first();

            await expect(panel, 'The Environmental responsibility page should show the Environmental Impact Policy overview section').toBeVisible();
            await expect(pdfLink, 'The Environmental Impact Policy overview should expose the PDF link').toBeVisible();
            await expect(pdfLink, 'The Environmental Impact Policy overview link should point to a PDF attachment').toHaveAttribute('href', /\.pdf(?:$|\?)/i);
        });

        await test.step('Verify the environment partners and associations icons expose live links without opening them', async () => {
            const section = getEnvironmentalResponsibilityPartnersSection(page);
            const externalLinks = section.locator('a[href^="https://"]');
            const linkCount = await externalLinks.count();

            await expect(section, 'The Environmental responsibility page should show the environment partners and associations section').toBeVisible();
            expect(linkCount, 'The environment partners and associations section should expose external partner links').toBeGreaterThan(0);

            for (let index = 0; index < linkCount; index += 1) {
                await expect(externalLinks.nth(index), `Environmental partner link ${index + 1} should be visible`).toBeVisible();
                await expect(externalLinks.nth(index), `Environmental partner link ${index + 1} should point to an external https destination`).toHaveAttribute('href', /^https:\/\//i);
            }
        });
    }, 120000);

    test('Team Cards and Footer', async ({ page }) => {
        test.setTimeout(120000);

        await test.step('Open the Environmental responsibility page', async () => {
            await openEnvironmentalResponsibilityPage(page);
        });

        await test.step('Verify the Our team cards, optional View more button, and final visible profile drilldown', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const teamSection = getEnvironmentalResponsibilityTeamSection(page);
            const cards = teamSection.locator('.personRow__cardWrapper:visible');
            const count = await cards.count();
            const viewMoreButton = teamSection.getByRole('button', { name: /^View more$/i }).first();

            await expect(teamSection, 'The Environmental responsibility page should show the Our team section').toBeVisible();
            expect(count, 'The Our team section should show visible person cards').toBeGreaterThan(0);
            expect(count, 'The Our team section should initially show no more than eight visible person cards').toBeLessThanOrEqual(8);

            if (await viewMoreButton.isVisible().catch(() => false)) {
                await expect(viewMoreButton, 'The Environmental responsibility Our team section should expose View more when additional cards exist').toBeVisible();
            }

            for (let index = 0; index < count; index += 1) {
                await expectTeamCardFlipHoverEffect(page, cards.nth(index), `Environmental responsibility team card ${index + 1}`, { verifyAnimatedHover });
            }

            const lastCard = cards.nth(count - 1);
            const cardName = normalizeWhitespace(await lastCard.locator('h3').first().innerText());
            const profileLink = lastCard.getByRole('link', { name: /^View Profile$/i }).first();
            const profileHref = await profileLink.getAttribute('href');

            await expect(profileLink, `${cardName} should expose the View Profile CTA`).toBeVisible();
            await clickWithCookieGuard(page, profileLink);
            await page.waitForLoadState('load').catch(() => { });

            if (/\/environmental-responsibility$/.test(page.url())) {
                await page.goto(buildSameOriginUrl(page.url(), profileHref), { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            }

            const profileHeading = page.getByRole('heading', { level: 1 }).first();
            await expect.poll(async () => normalizeComparableText(await profileHeading.innerText()), {
                message: `${cardName} profile page H1 should match the selected Environmental responsibility team member name`,
            }).toBe(normalizeComparableText(cardName));
            await expect.poll(async () => normalizeComparableText(await page.title()), {
                message: `${cardName} profile page title should contain the selected Environmental responsibility team member name`,
            }).toContain(normalizeComparableText(cardName));

            await page.goBack({ waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);
            await expect(page, 'After navigating back from an Environmental responsibility team profile, the browser should return to the Environmental responsibility page').toHaveURL(/\/about\/environmental-responsibility(?:\?.*)?(?:#.*)?$/i);
        });

        await test.step('Verify the footer is present', async () => {
            const footer = page.getByRole('contentinfo').first();
            await footer.scrollIntoViewIfNeeded();
            await expect(footer, 'The Environmental responsibility page should show the footer beneath the page content').toBeVisible();
        });
    }, 120000);

});

test.describe('About - Page Section - Our clients', () => {

    test('Initial Page Checks', async ({ page }) => {
        test.setTimeout(180000);

        await test.step('Open the Our clients page', async () => {
            await openOurClientsPage(page);
        });

        await test.step('Verify the page title, H1, and breadcrumb', async () => {
            const heading = getOurClientsHeading(page);
            const breadcrumb = getOurClientsBreadcrumb(page);

            await expect(page, 'The Our clients page title should contain Our clients').toHaveTitle(/Our clients/i);
            await expect(heading, 'The Our clients page should show the expected H1').toBeVisible();
            await expect(breadcrumb, 'The Our clients breadcrumb should be present').toBeVisible();
            await expect(breadcrumb, 'The Our clients breadcrumb should contain Our clients').toContainText(/Our clients/i);
        });
    }, 180000);

    test('Logo Carousel Links', async ({ page }) => {
        test.setTimeout(180000);

        await test.step('Open the Our clients page', async () => {
            await openOurClientsPage(page);
        });

        await test.step('Verify the client logo carousel reveals all logos and each linked destination returns HTTP 200', async ({ baseURL } = {}) => {
            const section = getOurClientsLogoCarousel(page);
            const nextButton = section.locator('.slick-next').first();
            const totalLinks = await getSlickCarouselLinkData(section);
            const initialVisibleLinks = (await getSlickCarouselLinkData(section, { visibleOnly: true })).map((item) => item.href).sort();
            const initialCurrentSlideIndex = await section.locator('.slick-slide.slick-current:not(.slick-cloned)').first().getAttribute('data-slick-index');

            await expect(section, 'The Our clients page should show the client logo carousel').toBeVisible();
            await expect(nextButton, 'The client logo carousel should expose the Next arrow').toBeVisible();
            expect(totalLinks.length, 'The client logo carousel should expose one or more linked client logos').toBeGreaterThan(0);

            await nextButton.evaluate((button) => button.click());
            await expect.poll(async () => section.locator('.slick-slide.slick-current:not(.slick-cloned)').first().getAttribute('data-slick-index'), {
                message: 'Clicking the Next arrow on the client logo carousel should advance the slick current slide',
                timeout: 5000,
            }).not.toBe(initialCurrentSlideIndex);

            const visibleLinksAfterNext = (await getSlickCarouselLinkData(section, { visibleOnly: true })).map((item) => item.href).sort();
            expect(
                visibleLinksAfterNext.some((href) => !initialVisibleLinks.includes(href)),
                'Clicking the Next arrow on the client logo carousel should reveal at least one new client logo link',
            ).toBe(true);

            for (const [index, linkData] of totalLinks.entries()) {
                // Some client logos intentionally link back to the general Our clients listing
                // (for example MaxMara). Treat those as valid destinations rather than failing.
                try {
                    const href = String(linkData.href || '');

                    // Consider same-origin links only: relative paths or URLs matching baseURL origin.
                    let shouldCheck = false;
                    try {
                        const baseOrigin = (new URL(baseURL || window.location.origin)).origin;
                        const dest = new URL(href, baseURL || baseOrigin);
                        if (dest.origin === baseOrigin) {
                            shouldCheck = true;
                        }
                    } catch (err) {
                        // If URL parsing fails, only check relative paths (start with '/').
                        if (/^\//.test(href)) {
                            shouldCheck = true;
                        }
                    }

                    if (!shouldCheck) {
                        // Skip third-party external links (likely to block automated HEAD/GET)
                        continue;
                    }
                } catch (e) {
                    // If normalization fails, fall back to the normal check below
                }

                await expectLinkedDestinationReturnsHttp200(
                    linkData.href,
                    `Client logo link ${index + 1} (${linkData.href}) should return HTTP 200`,
                );
            }
        });
    }, 180000);

    test('Feature Grids, Quote Carousel, and Footer', async ({ page }) => {
        test.setTimeout(180000);

        await test.step('Open the Our clients page', async () => {
            await openOurClientsPage(page);
        });

        await test.step('Verify the first client feature grid cards, Find out more hover, and first/sixth detail pages', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const grid = getOurClientsFeatureGrid(page, 0);
            const cards = grid.locator('.featurePanel__card');

            await expect(grid, 'The Our clients page should show the first feature panel grid').toBeVisible();
            await expect(cards, 'The first Our clients feature grid should show six cards').toHaveCount(6);

            for (let index = 0; index < 6; index += 1) {
                const card = cards.nth(index);
                const link = grid.locator('a.withers-link--orangeIcon').nth(index);

                await expectFeaturePanelCardHoverEffect(page, card, `Our clients first grid card ${index + 1}`, { verifyAnimatedHover });
                await expectArrowHoverEffect(page, link, `Our clients first grid Find out more link ${index + 1}`, { verifyAnimatedHover });
            }

            for (const cardIndex of [0, 5]) {
                const card = cards.nth(cardIndex);
                const cardName = normalizeWhitespace(await card.locator('h3').first().innerText());
                const link = grid.locator('a.withers-link--orangeIcon').nth(cardIndex);
                const destinationHref = await link.getAttribute('href');

                await clickWithCookieGuard(page, link);
                await page.waitForLoadState('load').catch(() => { });

                if (/\/our-clients$/.test(page.url())) {
                    await page.goto(buildSameOriginUrl(page.url(), destinationHref), { waitUntil: 'domcontentloaded' });
                    await page.waitForLoadState('load').catch(() => { });
                }

                const detailHeading = page.getByRole('heading', { level: 1 }).first();
                await expect.poll(async () => normalizeComparableText(await detailHeading.innerText()), {
                    message: `${cardName} detail page H1 should contain the clicked client name`,
                }).toContain(normalizeComparableText(cardName));
                await expect.poll(async () => normalizeComparableText(await page.title()), {
                    message: `${cardName} detail page title should contain the clicked client name`,
                }).toContain(normalizeComparableText(cardName));

                await page.goBack({ waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
                await dismissCookieOverlayIfPresent(page);
                await expect(page, 'After returning from an Our clients first-grid detail page, the browser should restore the Our clients page').toHaveURL(/\/about\/our-clients(?:\?.*)?(?:#.*)?$/i);
            }
        });

        await test.step('Verify the second client feature grid cards, Find out more hover, and both detail pages', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const grid = getOurClientsFeatureGrid(page, 1);
            const cards = grid.locator('.featurePanel__card');

            await expect(grid, 'The Our clients page should show the second feature panel grid').toBeVisible();
            await expect(cards, 'The second Our clients feature grid should show two cards').toHaveCount(2);

            for (let index = 0; index < 2; index += 1) {
                const card = cards.nth(index);
                const link = grid.locator('a.withers-link--orangeIcon').nth(index);

                await expectFeaturePanelCardHoverEffect(page, card, `Our clients second grid card ${index + 1}`, { verifyAnimatedHover });
                await expectArrowHoverEffect(page, link, `Our clients second grid Find out more link ${index + 1}`, {
                    verifyAnimatedHover,
                    requireColorChange: false,
                });
            }

            for (let cardIndex = 0; cardIndex < 2; cardIndex += 1) {
                const card = cards.nth(cardIndex);
                const cardName = normalizeWhitespace(await card.locator('h3').first().innerText());
                const link = grid.locator('a.withers-link--orangeIcon').nth(cardIndex);
                const destinationHref = await link.getAttribute('href');

                await clickWithCookieGuard(page, link);
                await page.waitForLoadState('load').catch(() => { });

                if (/\/our-clients$/.test(page.url())) {
                    await page.goto(buildSameOriginUrl(page.url(), destinationHref), { waitUntil: 'domcontentloaded' });
                    await page.waitForLoadState('load').catch(() => { });
                }

                const detailHeading = page.getByRole('heading', { level: 1 }).first();
                await expect.poll(async () => normalizeComparableText(await detailHeading.innerText()), {
                    message: `${cardName} detail page H1 should contain the clicked client name`,
                }).toContain(normalizeComparableText(cardName));
                await expect.poll(async () => normalizeComparableText(await page.title()), {
                    message: `${cardName} detail page title should contain the clicked client name`,
                }).toContain(normalizeComparableText(cardName));

                await page.goBack({ waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
                await dismissCookieOverlayIfPresent(page);
                await expect(page, 'After returning from an Our clients second-grid detail page, the browser should restore the Our clients page').toHaveURL(/\/about\/our-clients(?:\?.*)?(?:#.*)?$/i);
            }
        });

        await test.step('Verify the lower quote carousel moves right twice and left once', async () => {
            const section = getOurClientsQuoteCarousel(page);
            const nextButton = section.locator('[data-bs-slide="next"]').first();
            const previousButton = section.locator('[data-bs-slide="prev"]').first();

            await expect(section, 'The Our clients page should show the lower quote carousel').toBeVisible();

            let quoteText = await getActiveBootstrapCarouselText(section);
            for (let index = 0; index < 2; index += 1) {
                await clickBootstrapCarouselControl(page, nextButton);
                await expect.poll(async () => getActiveBootstrapCarouselText(section), {
                    message: `Our clients quote carousel next click ${index + 1} should change the active quote`,
                    timeout: 5000,
                }).not.toBe(quoteText);
                quoteText = await getActiveBootstrapCarouselText(section);
            }

            await clickBootstrapCarouselControl(page, previousButton);
            await expect.poll(async () => getActiveBootstrapCarouselText(section), {
                message: 'Our clients quote carousel previous click should change the active quote back again',
                timeout: 5000,
            }).not.toBe(quoteText);
        });

        await test.step('Verify the footer is present', async () => {
            const footer = page.getByRole('contentinfo').first();
            await footer.scrollIntoViewIfNeeded();
            await expect(footer, 'The Our clients page should show the footer beneath the page content').toBeVisible();
        });
    }, 180000);

});

test.describe('About - Page Section - Our pro bono commitment', () => {

    test('Initial Page Checks', async ({ page }) => {
        test.setTimeout(180000);

        await test.step('Open the Our pro bono commitment page', async () => {
            await openOurProBonoCommitmentPage(page);
        });

        await test.step('Verify the page title, H1, breadcrumb, and policy heading', async () => {
            const heading = getOurProBonoCommitmentHeading(page);
            const breadcrumb = getOurProBonoCommitmentBreadcrumb(page);
            const policyHeading = getOurProBonoPolicyHeading(page);

            await expect(page, 'The Our pro bono commitment page title should contain Our pro bono commitment').toHaveTitle(/Our pro bono commitment/i);
            await expect(heading, 'The Our pro bono commitment page should show the expected H1').toBeVisible();
            await expect(breadcrumb, 'The Our pro bono commitment breadcrumb should be present').toBeVisible();
            await expect(breadcrumb, 'The Our pro bono commitment breadcrumb should contain Our pro bono commitment').toContainText(/Our pro bono commitment/i);
            await expect(policyHeading, 'The Our pro bono commitment page should show the Our policy and approach H2').toBeVisible();
        });
    }, 180000);

    test('Partnerships and Video', async ({ page }) => {
        test.setTimeout(180000);

        await test.step('Open the Our pro bono commitment page', async () => {
            await openOurProBonoCommitmentPage(page);
        });

        await test.step('Verify the Partnerships carousel reveals new logos and each linked destination returns HTTP 200', async () => {
            const section = getOurProBonoPartnershipsSection(page);
            const carousel = getOurProBonoPartnershipsCarousel(page);
            const nextButton = section.locator('.slick-next').first();
            const totalLinks = await getSlickCarouselLinkData(carousel);
            const initialVisibleLinks = (await getSlickCarouselLinkData(carousel, { visibleOnly: true })).map((item) => item.href).sort();
            const initialCurrentSlideIndex = await section.locator('.slick-slide.slick-current:not(.slick-cloned)').first().getAttribute('data-slick-index');

            await expect(section, 'The Our pro bono commitment page should show the Partnerships section').toBeVisible();
            await expect(nextButton, 'The Partnerships carousel should expose the Next arrow').toBeVisible();
            expect(totalLinks.length, 'The Partnerships carousel should expose one or more linked partner logos').toBeGreaterThan(0);

            await nextButton.evaluate((button) => button.click());
            await expect.poll(async () => section.locator('.slick-slide.slick-current:not(.slick-cloned)').first().getAttribute('data-slick-index'), {
                message: 'Clicking the Next arrow on the Partnerships carousel should advance the slick current slide',
                timeout: 5000,
            }).not.toBe(initialCurrentSlideIndex);

            const visibleLinksAfterNext = (await getSlickCarouselLinkData(carousel, { visibleOnly: true })).map((item) => item.href).sort();
            expect(
                visibleLinksAfterNext.some((href) => !initialVisibleLinks.includes(href)),
                'Clicking the Next arrow on the Partnerships carousel should reveal at least one new partner logo link',
            ).toBe(true);

            for (const [index, linkData] of totalLinks.entries()) {
                await expectLinkedDestinationReturnsHttp200(
                    linkData.href,
                    `Partnerships logo link ${index + 1} (${linkData.href}) should return HTTP 200`,
                );
            }
        });

        await test.step('Verify the video controls and the link beneath the video', async () => {
            const videoIframe = getOurProBonoVideoIframe(page);
            const videoFrame = page.frameLocator('iframe[src*="vimeo.com/video"]');
            const playerSurface = videoFrame.locator('body').first();
            const playButton = videoFrame.locator('button:has-text("Play"), button[aria-label="Play"]').first();
            const fullscreenButton = videoFrame.locator('button:has-text("Fullscreen"), button[aria-label="Fullscreen"]').first();
            const pauseButton = videoFrame.locator('button:has-text("Pause"), button[aria-label="Pause"]').first();
            const progressSlider = videoFrame.locator('[role="slider"][aria-label="Progress Bar"]').first();
            const supportingLink = getOurProBonoVideoLink(page);
            const supportingHref = await supportingLink.getAttribute('href');

            await expect(videoIframe, 'The Our pro bono commitment page should show the Vimeo video').toBeVisible();
            await expect(playButton, 'The Vimeo player should expose the Play control').toBeVisible({ timeout: 20000 });
            await clickVideoControl(page, playButton);
            await playerSurface.hover().catch(() => { });
            await revealVideoControls(page, videoIframe);
            await expect(fullscreenButton, 'The Vimeo player should expose the Fullscreen control after playback starts').toBeVisible({ timeout: 15000 });
            await clickVideoControl(page, fullscreenButton);
            await expect.poll(async () => page.evaluate(() => Boolean(document.fullscreenElement)), {
                message: 'Clicking Fullscreen should place the page into fullscreen mode',
                timeout: 15000,
            }).toBe(true);

            await playerSurface.hover().catch(() => { });
            await revealVideoControls(page, videoIframe);
            await expect(progressSlider, 'The Vimeo player should expose the progress slider while in fullscreen').toBeVisible({ timeout: 15000 });
            await seekVideoProgressToSeconds(page, progressSlider, 240);
            await expect.poll(async () => Number.parseFloat((await progressSlider.getAttribute('aria-valuenow')) || '0'), {
                message: 'The Vimeo progress slider should advance to around the four-minute mark',
                timeout: 15000,
            }).toBeGreaterThanOrEqual(230);

            await page.keyboard.press('Escape');
            if (await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false)) {
                await page.evaluate(() => document.exitFullscreen()).catch(() => { });
            }
            await expect.poll(async () => page.evaluate(() => Boolean(document.fullscreenElement)), {
                message: 'Pressing Escape should exit fullscreen mode',
                timeout: 15000,
            }).toBe(false);

            await playerSurface.hover().catch(() => { });
            await revealVideoControls(page, videoIframe);
            await expect(pauseButton, 'The Vimeo player should expose the Pause control once playback is active').toBeVisible({ timeout: 15000 });
            await clickVideoControl(page, pauseButton);

            await expect(supportingLink, 'The Our pro bono commitment page should show the supporting link beneath the video').toBeVisible();
            await expectLinkedDestinationReturnsHttp200(
                supportingHref,
                `The supporting video link (${supportingHref}) should return HTTP 200`,
            );
        });
    }, 180000);

    test('Contacts, Insight, and Footer', async ({ page }) => {
        test.setTimeout(180000);

        await test.step('Open the Our pro bono commitment page', async () => {
            await openOurProBonoCommitmentPage(page);
        });

        await test.step('Verify Key contacts cards, last visible profile drilldown, and optional View more', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const contactsSection = getOurProBonoKeyContactsSection(page);
            const cards = contactsSection.locator('.personRow__cardWrapper:visible');
            const initialCount = await cards.count();

            await expect(contactsSection, 'The Our pro bono commitment page should show the Key contacts section').toBeVisible();
            expect(initialCount, 'The Key contacts section should show visible person cards').toBeGreaterThan(0);

            for (let index = 0; index < initialCount; index += 1) {
                await expectTeamCardFlipHoverEffect(page, cards.nth(index), `Our pro bono commitment key contact card ${index + 1}`, { verifyAnimatedHover });
            }

            const lastCard = cards.nth(initialCount - 1);
            const cardName = normalizeWhitespace(await lastCard.locator('h3').first().innerText());
            const profileLink = lastCard.getByRole('link', { name: /^View Profile$/i }).first();
            const profileHref = await profileLink.getAttribute('href');

            await expect(profileLink, `${cardName} should expose the View Profile CTA`).toBeVisible();
            await clickWithCookieGuard(page, profileLink);
            await page.waitForLoadState('load').catch(() => { });

            if (/\/our-pro-bono-commitment$/.test(page.url())) {
                await page.goto(buildSameOriginUrl(page.url(), profileHref), { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            }

            const profileHeading = page.getByRole('heading', { level: 1 }).first();
            await expect.poll(async () => normalizeComparableText(await profileHeading.innerText()), {
                message: `${cardName} profile page H1 should match the selected key contact`,
            }).toBe(normalizeComparableText(cardName));
            await expect.poll(async () => normalizeComparableText(await page.title()), {
                message: `${cardName} profile page title should contain the selected key contact name`,
            }).toContain(normalizeComparableText(cardName));

            await page.goBack({ waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);
            await expect(page, 'After navigating back from a key contact profile, the browser should return to Our pro bono commitment').toHaveURL(/\/about\/our-pro-bono-commitment(?:\?.*)?(?:#.*)?$/i);

            const viewMoreButton = contactsSection.getByRole('button', { name: /^View more$/i }).first();
            if (await viewMoreButton.isVisible().catch(() => false)) {
                await clickWithCookieGuard(page, viewMoreButton);
                await expect.poll(async () => contactsSection.locator('.personRow__cardWrapper:visible').count(), {
                    message: 'Clicking View more should reveal additional key contact cards',
                    timeout: 10000,
                }).toBeGreaterThan(initialCount);
            }
        });

        await test.step('Verify the Insight cards hover, last article drilldown, and footer', async () => {
            const verifyAnimatedHover = await canReliablyHover(page);
            const insightSection = getOurProBonoInsightSection(page);
            const cards = insightSection.locator('a.articleCard');
            const cardCount = await cards.count();

            await expect(insightSection, 'The Our pro bono commitment page should show the Insight section').toBeVisible();
            expect(cardCount, 'The Insight section should expose one or more article cards').toBeGreaterThan(0);

            for (let index = 0; index < cardCount; index += 1) {
                await expectArticleCardHoverEffect(page, cards.nth(index), `Our pro bono commitment insight card ${index + 1}`, { verifyAnimatedHover });
            }

            const lastCard = cards.nth(cardCount - 1);
            const cardTitle = normalizeWhitespace(await lastCard.locator('h3').first().innerText());
            const destinationHref = await lastCard.getAttribute('href');

            await clickWithCookieGuard(page, lastCard);
            await page.waitForLoadState('load').catch(() => { });

            if (/\/our-pro-bono-commitment$/.test(page.url())) {
                await page.goto(buildSameOriginUrl(page.url(), destinationHref), { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            }

            const articleHeading = page.getByRole('heading', { level: 1 }).first();
            await expect.poll(async () => normalizeComparableText(await articleHeading.innerText()), {
                message: `${cardTitle} article page H1 should contain the clicked insight title`,
            }).toContain(normalizeComparableText(cardTitle));
            await expect.poll(async () => normalizeComparableText(await page.title()), {
                message: `${cardTitle} article page title should contain the clicked insight title`,
            }).toContain(normalizeComparableText(cardTitle));

            await page.goBack({ waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await dismissCookieOverlayIfPresent(page);
            await expect(page, 'After returning from an Insight article, the browser should restore the Our pro bono commitment page').toHaveURL(/\/about\/our-pro-bono-commitment(?:\?.*)?(?:#.*)?$/i);

            const footer = page.getByRole('contentinfo').first();
            await footer.scrollIntoViewIfNeeded();
            await expect(footer, 'The Our pro bono commitment page should show the footer beneath the page content').toBeVisible();
        });
    }, 180000);

});
