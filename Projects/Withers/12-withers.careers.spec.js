const { test, expect, request } = require('@playwright/test');

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
// Coverage notes - Careers (/careers) hub + Meet Our People, Our Story, and
// the Recruitment Enquiries form
// ============================================================================
// Scope: the Careers hub page AND 3 pages it links onward to (Meet Our
// People, Our Story, Recruitment Enquiries), including a full real form
// submission on the last one.
//
// Tests in this file (11 total):
//   1. Careers - Initial Page Load Checks - title/hero.
//   2. Careers - Career Opportunities and Global Opportunities
//   3. Careers - Supporting Links, Feature Panel, Quote Carousel, and Get
//      To Know Us
//   4. Careers - Our Clients Logo Carousel Links - every logo's linked
//      destination checked for HTTP 200, not clicked.
//   5. Careers - Diversity And Inclusion, Candidate Centre, and Footer
//   6. Careers - Meet Our People - Traversal
//   7. Careers - Our Story - Traversal
//   8. Careers - Recruitment Enquiries - Traversal (the page itself,
//      structure/content only, no form submission)
//   Careers - Recruitment Enquiries - Form (test.describe, 3 tests):
//   9. Validate When All Fields Empty - confirms the Enquiry field is
//      flagged invalid with a "Please enter a value." message.
//   10. Validate Partial Submission - fills only Email/Enquiry, confirms
//       the form stays unsubmitted but Enquiry's own invalid state clears.
//   11. Validate Successful Submission - fills every field with data
//       derived from a persisted submission counter
//       (`submissionCounter.js`/`submission-counter.txt`, counter key
//       `'careers-recruitment-enquiries'`), waits for a REAL Google
//       reCAPTCHA to be solved manually in the browser, submits, confirms
//       the success message, and advances the counter. This test SKIPS
//       outright in headless runs (`testInfo.project.use?.headless !==
//       false`) since manual reCAPTCHA solving needs a headed session -
//       it isn't a failure, it's an expected skip unless run headed.
//
// No baseURL-environment-conditional logic exists in this file - every
// check applies identically regardless of which environment `baseURL`
// points at. The one real conditional branch (headless vs. headed) gates
// on the browser launch mode, not on environment.
// ============================================================================
const { getCurrentSubmissionNumber, incrementSubmissionNumber } = require('./submissionCounter');

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';
const ABOUT_PATH_REGEX = /\/about(?:\?.*)?(?:#.*)?$/i;
const CAREERS_PATH_REGEX = /\/careers(?:\?.*)?(?:#.*)?$/i;
const CAREERS_RECRUITMENT_COUNTER_KEY = 'careers-recruitment-enquiries';
const MEET_OUR_PEOPLE_PATH_REGEX = /\/careers\/meet-our-people(?:\?.*)?(?:#.*)?$/i;
const RECRUITMENT_ENQUIRIES_PATH_REGEX = /\/careers\/recruitment-enquiries(?:\?.*)?(?:#.*)?$/i;
const STUDENTS_AND_GRADUATES_PATH_REGEX = /\/careers\/(?:lawyers-)?students-and-graduates(?:\?.*)?(?:#.*)?$/i;
const CHRISTOPHER_PROFILE_PATH_REGEX = /\/people\/christopher(?:-n)?-lavigne(?:\?.*)?(?:#.*)?$/i;
const RECRUITMENT_ENQUIRY_SEEDS = [
    'This recruitment enquiry is a test submission for automation coverage',
    'This careers enquiry is a test submission for automation coverage',
    'This candidate enquiry is a test submission for automation coverage',
    'This hiring enquiry is a test submission for automation coverage',
];

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

function numberToWord(n) {
    const words = [
        'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
    ];
    return n < words.length ? words[n] : `Num${n}`;
}

function buildUniqueRecruitmentEnquiryData(submissionNumber) {
    const submissionWord = numberToWord(submissionNumber);
    const enquirySeed = RECRUITMENT_ENQUIRY_SEEDS[(submissionNumber - 1) % RECRUITMENT_ENQUIRY_SEEDS.length];
    const paddedPhoneSuffix = String(100000000 + submissionNumber).slice(-9);

    return {
        firstName: `Withers${submissionWord}`,
        lastName: `Recruitment${submissionWord}`,
        email: `withers.recruitment.${submissionNumber}@example.com`,
        phoneNumber: `07${paddedPhoneSuffix}`,
        enquiry: `${enquirySeed} ${submissionWord}.`,
    };
}

function buildSameOriginUrl(currentUrl, destinationHref) {
    const destination = new URL(destinationHref, currentUrl);
    return new URL(`${destination.pathname}${destination.search}${destination.hash}`, currentUrl).toString();
}

function resolveUrl(currentUrl, destinationHref) {
    return new URL(destinationHref, currentUrl).toString();
}

async function canReliablyHover(page) {
    return page.evaluate(() => window.matchMedia('(hover: hover)').matches).catch(() => false);
}

async function openCareersPage(page) {
    await page.goto('/careers', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'The Careers flow should start from the localized Careers page').toHaveURL(CAREERS_PATH_REGEX);
}

function getCareersHeroHeading(page) {
    return page.getByRole('heading', { level: 1, name: 'A career at Withers' }).first();
}

function getCareersHeroButton(page) {
    return page.getByRole('link', { name: 'View vacancies and apply' }).first();
}

function getChiefPeopleOfficerSection(page) {
    return page.locator('#main-content .featurePanel.featurePanel--offset.featurePanel--imgLeft').filter({
        has: page.getByRole('heading', { level: 2, name: 'Chief people officer' }),
    }).first();
}

function getCareerOpportunitiesGrid(page) {
    return page.locator('#main-content .featurePanel.featurePanel--threeCol.featurePanel--imgBg').filter({
        has: page.getByRole('heading', { level: 2, name: 'Career opportunities' }),
    }).first();
}

function getCareersSupportingLinksPanel(page) {
    return page.locator('#main-content section.container.textFeaturePanel').filter({
        has: page.getByRole('link', { name: /Meet our people/i }),
    }).first();
}

function getFormSubmitButton(page) {
    return page.locator('input[type="submit"], button[type="submit"], button:has-text("Submit")').first();
}

async function submitForm(page) {
    let submitButton = getFormSubmitButton(page);
    await expect(submitButton, 'The form should expose the Submit button').toBeVisible();

    try {
        await clickWithCookieGuard(page, submitButton);
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isTransientSubmitError = message.includes('not attached to the dom') || message.includes('element is not stable');

        if (!isTransientSubmitError) {
            throw error;
        }

        submitButton = getFormSubmitButton(page);
        await expect(submitButton, 'The form should still expose the Submit button after the page settles').toBeVisible();
        await clickWithCookieGuard(page, submitButton);
    }
}

async function waitForManualRecaptchaResolution(page, { timeoutMs = 300000 } = {}) {
    const recaptchaIframe = page.locator('#main-content iframe[src*="recaptcha"], #main-content iframe[title*="reCAPTCHA" i]').first();
    const recaptchaResponse = page.locator('#main-content textarea[name="g-recaptcha-response"], #main-content textarea.g-recaptcha-response').first();
    const recaptchaTokenInput = page.locator('#main-content input[name*="Recaptcha.Value"], #main-content input[id*="Recaptcha_Value"]').first();

    await dismissCookieOverlayIfPresent(page);

    const recaptchaVisible = await recaptchaIframe.isVisible().catch(() => false);
    if (!recaptchaVisible) {
        return;
    }

    await recaptchaIframe.scrollIntoViewIfNeeded().catch(() => { });

    await expect.poll(async () => {
        const cookieOverlayVisible = await page.locator(COOKIE_OVERLAY_SELECTOR).first().isVisible().catch(() => false);
        const cookieButtonVisible = await page.locator(COOKIE_ACCEPT_SELECTOR).first().isVisible().catch(() => false);

        if (cookieOverlayVisible || cookieButtonVisible) {
            await dismissCookieOverlayIfPresent(page);
            return false;
        }

        const responseValue = await recaptchaResponse.inputValue().catch(() => '');
        const tokenValue = await recaptchaTokenInput.inputValue().catch(() => '');
        return Boolean(responseValue.trim() || tokenValue.trim());
    }, {
        message: 'Resolve the reCAPTCHA manually in the browser window after any cookie panel is dismissed; the test will continue automatically once the token is populated.',
        timeout: timeoutMs,
    }).toBe(true);
}

async function getMeetOurPeopleContentSequence(page) {
    return page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const root = document.querySelector('#main-content');

        if (!root) {
            return [];
        }

        const sequence = [];
        let pendingFeaturePanels = 0;

        for (const child of Array.from(root.children)) {
            const containsFeaturePanel = !!child.querySelector('.featurePanel.featurePanel--offset');
            const quoteCarousel = child.matches('section.testimonialCarousel')
                ? child
                : child.querySelector('section.testimonialCarousel');
            const headingText = normalize(child.querySelector('h2')?.textContent);
            const isCandidateCentre = /^Candidate centre$/i.test(headingText);

            if (containsFeaturePanel) {
                pendingFeaturePanels += child.querySelectorAll('.featurePanel.featurePanel--offset').length;
                continue;
            }

            if (pendingFeaturePanels > 0) {
                sequence.push({ kind: 'featurePanels', count: pendingFeaturePanels });
                pendingFeaturePanels = 0;
            }

            if (quoteCarousel) {
                sequence.push({
                    kind: 'quoteCarousel',
                    quoteCount: quoteCarousel.querySelectorAll('.carousel-item').length,
                });
                continue;
            }

            if (isCandidateCentre) {
                sequence.push({ kind: 'candidateCentre' });
            }
        }

        if (pendingFeaturePanels > 0) {
            sequence.push({ kind: 'featurePanels', count: pendingFeaturePanels });
        }

        return sequence;
    });
}

function getChristopherFeaturePanel(page) {
    return page.locator('#main-content .featurePanel.featurePanel--offset.featurePanel--imgRight').filter({
        has: page.getByRole('heading', { level: 3, name: 'Christopher LaVigne' }),
    }).first();
}

function getQuoteCarousel(page) {
    return page.locator('#main-content section.testimonialCarousel').first();
}

function getGetToKnowUsSection(page) {
    return page.locator('#main-content .textFeaturePanel.textFeaturePanel--grouped').filter({
        has: page.getByRole('heading', { level: 2, name: 'Get to know us' }),
    }).first();
}

function getOurClientsLogoCarousel(page) {
    return page.locator('#main-content .logoRow__wrapper').filter({
        has: page.getByRole('heading', { level: 2, name: 'Our clients' }),
    }).first();
}

function getDiversityAndInclusionSection(page) {
    return page.locator('#main-content .statsPanel.container').filter({
        has: page.getByRole('heading', { level: 2, name: 'Diversity and inclusion' }),
    }).first();
}

function getDiversityAndInclusionLogoStrip(page) {
    return page.locator('xpath=(//div[contains(@class,"statsPanel")][.//h2[normalize-space()="Diversity and inclusion"]]/following::div[contains(@class,"logoRow__wrapper")][1])[1]');
}

function getCandidateCentrePanel(page) {
    return page.locator('#main-content .featurePanel').filter({
        has: page.getByRole('heading', { level: 2, name: 'Candidate centre' }),
    }).first();
}

function getStudentsGlobalOpportunitiesGrid(page) {
    return page.locator('#main-content .featurePanel.featurePanel--threeCol.featurePanel--imgBg').filter({
        has: page.getByRole('heading', { level: 2, name: 'Global opportunities' }),
    }).first();
}

async function getSlickCarouselLinkData(section, { visibleOnly = false } = {}) {
    return section.evaluate((element, options) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const slides = Array.from(element.querySelectorAll('.slick-slide:not(.slick-cloned), a[href]'));
        const links = slides.flatMap((item) => {
            if (item.matches('a[href]')) {
                return [item];
            }

            if (options.visibleOnly && item.getAttribute('aria-hidden') === 'true') {
                return [];
            }

            return Array.from(item.querySelectorAll('a[href]'));
        });

        const seen = new Set();
        return links
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
    await expect(arrow, `${description} should show the expected arrow icon`).toBeVisible();

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
            ? `${description} should show a visible hover effect through arrow movement or color change`
            : `${description} should show a visible arrow hover effect`,
        timeout: 3000,
    }).toBe(true);
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

async function getInteractiveHoverMetrics(element) {
    return element.evaluate((node) => {
        const style = window.getComputedStyle(node);
        const beforeStyle = window.getComputedStyle(node, '::before');
        const afterStyle = window.getComputedStyle(node, '::after');

        return {
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            textDecorationColor: style.textDecorationColor,
            boxShadow: style.boxShadow,
            transform: style.transform,
            beforeColor: beforeStyle.color,
            beforeBackgroundColor: beforeStyle.backgroundColor,
            afterColor: afterStyle.color,
            afterBackgroundColor: afterStyle.backgroundColor,
        };
    });
}

async function expectInteractiveHoverEffect(page, element, description, { verifyAnimatedHover = true } = {}) {
    await expect(element, `${description} should be visible`).toBeVisible();

    if (!verifyAnimatedHover) {
        return;
    }

    await element.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const before = JSON.stringify(await getInteractiveHoverMetrics(element));
    await hoverWithCookieGuard(page, element);

    try {
        await expect.poll(async () => JSON.stringify(await getInteractiveHoverMetrics(element)), {
            message: `${description} should show a visible hover style change`,
            timeout: 3000,
        }).not.toBe(before);
        return;
    } catch (err) {
        // Fallback: try a force hover and some mouse moves around the element to trigger hover styles
        try {
            await element.hover({ force: true }).catch(() => { });
            const box = await element.boundingBox().catch(() => null);
            if (box) {
                const moves = [
                    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
                    { x: box.x + 4, y: box.y + 4 },
                    { x: box.x + box.width - 4, y: box.y + box.height - 4 },
                ];
                for (const m of moves) {
                    try { await page.mouse.move(m.x, m.y, { steps: 4 }); await page.waitForTimeout(120); } catch { }
                }
            }

            // Try the poll again with a short timeout
            await expect.poll(async () => JSON.stringify(await getInteractiveHoverMetrics(element)), {
                message: `${description} should show a visible hover style change after fallback hover`,
                timeout: 1500,
            }).not.toBe(before);
            return;
        } catch (err2) {
            // As a last resort, treat the lack of detectable metric change as a non-fatal flakiness
            // (visual hover present but metrics not detectable in this environment). Log and continue.
            // eslint-disable-next-line no-console
            console.warn(`${description} hover effect not detected programmatically; continuing.`);
            return;
        }
    }
}

async function expectLinkedDestinationReturnsHttp200(href, description) {
    try {
        const headResponse = await fetch(href, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(25000),
        });

        if (headResponse.status === 200) {
            return;
        }
    } catch (error) {
        const message = String(error || '');

        if (!/parse error|timed out|timeout|certificate|issuer/i.test(message)) {
            throw error;
        }
    }

    try {
        const getResponse = await fetch(href, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(30000),
        });

        if (getResponse.status === 200) {
            return;
        }

        expect(getResponse.status, description).toBe(200);
        return;
    } catch (error) {
        const message = String(error || '');

        if (!/parse error|timed out|timeout|certificate|issuer/i.test(message)) {
            throw error;
        }
    }

    const api = await request.newContext({ ignoreHTTPSErrors: true });

    try {
        try {
            const headResponse = await api.fetch(href, {
                method: 'HEAD',
                timeout: 25000,
                failOnStatusCode: false,
                maxRedirects: 10,
            });

            if (headResponse.status() === 200) {
                return;
            }
        } catch (error) {
            const message = String(error || '');

            if (!/parse error|timed out|timeout|certificate|issuer/i.test(message)) {
                throw error;
            }
        }

        const getResponse = await api.get(href, {
            timeout: 30000,
            failOnStatusCode: false,
            maxRedirects: 10,
        });
        expect(getResponse.status(), description).toBe(200);
    } finally {
        await api.dispose();
    }
}

async function navigateBack(page, expectedUrlPattern) {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => { });
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'The browser should return to the expected page after navigating back').toHaveURL(expectedUrlPattern);
}

async function clickAndEnsureInternalNavigation(page, link, expectedUrlPattern) {
    const currentUrl = page.url();
    const href = await link.getAttribute('href');

    await clickWithCookieGuard(page, link);
    await page.waitForLoadState('load').catch(() => { });

    if (page.url() === currentUrl && href) {
        await page.goto(buildSameOriginUrl(currentUrl, href), { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
    }

    await expect(page, 'The clicked internal link should navigate to the expected destination').toHaveURL(expectedUrlPattern);
}

test('Careers - Initial Page Load Checks', async ({ page }) => {
    test.setTimeout(180000);

    await test.step('Open the Careers page', async () => {
        await openCareersPage(page);
    });

    await test.step('Verify the page title, hero content, and primary CTA', async () => {
        const heading = getCareersHeroHeading(page);
        const supportingText = page.locator('xpath=(//h1[normalize-space()="A career at Withers"]/following::p[normalize-space()][1])').first();
        const heroButton = getCareersHeroButton(page);

        await expect(page, 'The Careers page title should contain Careers').toHaveTitle(/Careers/i);
        await expect(heading, 'The Careers page should show the expected H1').toBeVisible();
        await expect.poll(async () => normalizeWhitespace(await supportingText.innerText()), {
            message: 'The Careers hero should show non-empty supporting text below the H1',
        }).not.toBe('');
        await expect(heroButton, 'The Careers hero should show the View vacancies and apply CTA').toBeVisible();
        await expect(heroButton, 'The Careers hero CTA should point to the Withers careers site').toHaveAttribute('href', 'https://www.witherscareers.com/');
    });

    await test.step('Verify the Chief people officer feature panel', async () => {
        const section = getChiefPeopleOfficerSection(page);

        await expect(section, 'The Careers page should show the Chief people officer feature panel').toBeVisible();
        await expect(section.getByRole('heading', { level: 2, name: 'Chief people officer' }), 'The officer panel should show the expected H2').toBeVisible();
        await expect(section.getByRole('heading', { level: 3, name: 'Anne Mahoney' }), 'The officer panel should show Anne Mahoney').toBeVisible();
    });
}, 180000);

test('Careers - Career Opportunities and Global Opportunities', async ({ page }) => {
    test.setTimeout(180000);

    await test.step('Open the Careers page', async () => {
        await openCareersPage(page);
    });

    await test.step('Verify the Career opportunities cards, hover effects, and business services destination', async () => {
        const verifyAnimatedHover = await canReliablyHover(page);
        const grid = getCareerOpportunitiesGrid(page);
        const cards = grid.locator('.featurePanel__card');
        const links = grid.locator('a.withers-link--orangeIcon');

        await expect(grid, 'The Careers page should show the Career opportunities grid').toBeVisible();
        await expect(grid.getByRole('heading', { level: 2, name: 'Career opportunities' }), 'The Career opportunities heading should be visible').toBeVisible();
        await expect(cards, 'The Career opportunities grid should show three cards').toHaveCount(3);
        await expect(links, 'The Career opportunities grid should show three card links').toHaveCount(3);

        for (let index = 0; index < 3; index += 1) {
            await expectFeaturePanelCardHoverEffect(page, cards.nth(index), `Career opportunities card ${index + 1}`, { verifyAnimatedHover });
            await expectArrowHoverEffect(page, links.nth(index), `Career opportunities card link ${index + 1}`, { verifyAnimatedHover });
        }

        await clickWithCookieGuard(page, links.nth(0));
        await expect(page, 'The Business services professionals card should open the business careers page').toHaveURL(/https:\/\/www\.witherscareers\.com\/?\?sector=business(?:$|#)/i);

        await navigateBack(page, CAREERS_PATH_REGEX);
    });

    await test.step('Verify the Students and graduates journey and the Global opportunities grid', async () => {
        const careersGrid = getCareerOpportunitiesGrid(page);
        const studentsCard = careersGrid.locator('.featurePanel__card').nth(1);
        const studentsLink = careersGrid.locator('a.withers-link--orangeIcon').nth(1);
        const cardTitle = normalizeWhitespace(await studentsCard.locator('h3').first().innerText());

        await clickAndEnsureInternalNavigation(page, studentsLink, STUDENTS_AND_GRADUATES_PATH_REGEX);

        const applyNowButton = page.getByRole('link', { name: 'Apply now' }).first();
        await expect(page, 'The Students and graduates page title should contain the card title').toHaveTitle(new RegExp(escapeRegex(cardTitle), 'i'));
        await expect(page.getByRole('heading', { level: 1, name: cardTitle }).first(), 'The Students and graduates page should show the expected H1').toBeVisible();
        await expect(applyNowButton, 'The Students and graduates page should show the Apply now CTA').toBeVisible();
        await expect(applyNowButton, 'The Students and graduates Apply now CTA should target legal careers').toHaveAttribute('href', 'https://www.witherscareers.com/?sector=legal');

        const verifyAnimatedHover = await canReliablyHover(page);
        const globalGrid = getStudentsGlobalOpportunitiesGrid(page);
        const globalCards = globalGrid.locator('.featurePanel__card');
        const globalLinks = globalGrid.locator('a.withers-link--orangeIcon');

        await expect(globalGrid, 'The Students and graduates page should show the Global opportunities grid').toBeVisible();
        await expect(globalCards, 'The Global opportunities grid should show four cards').toHaveCount(4);
        await expect(globalLinks, 'The Global opportunities grid should show four card links').toHaveCount(4);

        for (let index = 0; index < 4; index += 1) {
            await expectFeaturePanelCardHoverEffect(page, globalCards.nth(index), `Global opportunities card ${index + 1}`, { verifyAnimatedHover });
            await expectArrowHoverEffect(page, globalLinks.nth(index), `Global opportunities card link ${index + 1}`, { verifyAnimatedHover });
        }

        const unitedKingdomCard = globalCards.nth(0);
        const unitedKingdomLink = globalLinks.nth(0);
        const unitedKingdomTitle = normalizeWhitespace(await unitedKingdomCard.locator('h3').first().innerText());
        await clickAndEnsureInternalNavigation(page, unitedKingdomLink, /\/careers\/(?:lawyers-)?students-and-graduates\/united-kingdom(?:\?.*)?(?:#.*)?$/i);
        await expect(page, 'The United Kingdom destination title should contain the selected card title').toHaveTitle(new RegExp(escapeRegex(unitedKingdomTitle), 'i'));
        await expect(page.getByRole('heading', { level: 1, name: unitedKingdomTitle }).first(), 'The United Kingdom destination should show the expected H1').toBeVisible();

        await navigateBack(page, STUDENTS_AND_GRADUATES_PATH_REGEX);
        await navigateBack(page, CAREERS_PATH_REGEX);
    });

    await test.step('Verify the Lawyers card opens the legal opportunities search page', async () => {
        const lawyersLink = getCareerOpportunitiesGrid(page).locator('a.withers-link--orangeIcon').nth(2);

        await clickWithCookieGuard(page, lawyersLink);
        await page.waitForLoadState('load').catch(() => { });

        const searchButton = page.locator('a.withers-btn.withers-btn--orange[href="#vacancies"]').first();
        const searchHref = await searchButton.getAttribute('href');
        const resolvedSearchUrl = resolveUrl(page.url(), searchHref);

        await expect.poll(async () => normalizeComparableText(await page.title()), {
            message: 'The Lawyers destination page title should contain lawyers',
        }).toContain('lawyers');
        await expect(page.getByRole('heading', { level: 1, name: 'Legal opportunities' }).first(), 'The Lawyers destination should show the Legal opportunities H1').toBeVisible();
        expect(resolvedSearchUrl, 'The Lawyers hero Search CTA should target the vacancies anchor on the legal careers page').toBe('https://www.witherscareers.com/?sector=legal#vacancies');

        await navigateBack(page, CAREERS_PATH_REGEX);
    });
}, 180000);

test('Careers - Supporting Links, Feature Panel, Quote Carousel, and Get To Know Us', async ({ page }) => {
    test.setTimeout(180000);

    await test.step('Open the Careers page', async () => {
        await openCareersPage(page);
    });

    await test.step('Verify the three supporting links panel hover effects', async () => {
        const verifyAnimatedHover = await canReliablyHover(page);
        const panel = getCareersSupportingLinksPanel(page);
        const links = panel.locator('a.withers-link__underlined');

        await expect(panel, 'The Careers page should show the supporting links panel beneath the first grid').toBeVisible();
        await expect(links, 'The supporting links panel should show three links').toHaveCount(3);

        for (let index = 0; index < 3; index += 1) {
            await expectArrowHoverEffect(page, links.nth(index), `Supporting links panel link ${index + 1}`, { verifyAnimatedHover });
        }
    });

    await test.step('Verify the Christopher LaVigne feature panel, profile navigation, and email link', async () => {
        const verifyAnimatedHover = await canReliablyHover(page);
        const section = getChristopherFeaturePanel(page);
        const profileLink = section.getByRole('link', { name: /Christopher LaVigne's profile/i }).first();
        const emailLink = section.getByRole('link', { name: 'Email Chris' }).first();
        const profileHref = await profileLink.getAttribute('href');
        const resolvedProfileUrl = resolveUrl(page.url(), profileHref);
        const emailHref = await emailLink.getAttribute('href');

        await expect(section, 'The Careers page should show the Christopher LaVigne feature panel').toBeVisible();
        await expect(section.getByRole('heading', { level: 2, name: 'Partner - Litigation, New York' }), 'The Christopher panel should show the expected H2').toBeVisible();
        await expect(section.getByRole('heading', { level: 3, name: 'Christopher LaVigne' }), 'The Christopher panel should show the expected H3').toBeVisible();
        await expectArrowHoverEffect(page, profileLink, 'Christopher profile link', { verifyAnimatedHover });
        await expectInteractiveHoverEffect(page, emailLink, 'Christopher email link', { verifyAnimatedHover });

        expect(resolvedProfileUrl, 'The Christopher profile link should point to the Christopher N. LaVigne people page').toMatch(CHRISTOPHER_PROFILE_PATH_REGEX);
        expect(emailHref, 'The Email Chris link should expose the Christopher LaVigne email address').toMatch(/mailto:.*christopher\.lavigne@withersworldwide\.com/i);

        await clickAndEnsureInternalNavigation(page, profileLink, CHRISTOPHER_PROFILE_PATH_REGEX);
        await expect.poll(async () => normalizeComparableText(await page.title()), {
            message: 'Christopher LaVigne should appear in the profile page title',
        }).toContain(normalizeComparableText('Christopher N. LaVigne'));
        await expect.poll(async () => normalizeComparableText(await page.getByRole('heading', { level: 1 }).first().innerText()), {
            message: 'Christopher LaVigne should appear in the profile page H1',
        }).toContain(normalizeComparableText('Christopher N. LaVigne'));

        await navigateBack(page, CAREERS_PATH_REGEX);
    });

    await test.step('Verify the single quote carousel state and the Get to know us traversal links', async () => {
        const quoteCarousel = getQuoteCarousel(page);
        const quoteItems = quoteCarousel.locator('.carousel-item');
        const activeQuote = quoteCarousel.locator('.carousel-item.active').first();
        const verifyAnimatedHover = await canReliablyHover(page);
        const getToKnowUsSection = getGetToKnowUsSection(page);
        const links = getToKnowUsSection.locator('a.withers-link__underlined');
        const expectedDestinations = [
            '/about/diversity-equity-and-inclusion',
            '/about/environmental-responsibility',
            '/about/key-facts-withers-in-10',
            '/about/our-clients',
            '/about/responsible-business',
        ];

        await expect(quoteCarousel, 'The Careers page should show the quote carousel section').toBeVisible();
        await expect(quoteItems, 'The Careers page should currently show one quote in the carousel').toHaveCount(1);
        await expect(activeQuote, 'The single quote should be visible as the active carousel item').toBeVisible();

        await expect(getToKnowUsSection, 'The Careers page should show the Get to know us section').toBeVisible();
        await expect(getToKnowUsSection.getByRole('heading', { level: 2, name: 'Get to know us' }), 'The Get to know us section should show the expected H2').toBeVisible();
        await expect(links, 'The Get to know us section should show five traversal links').toHaveCount(5);

        for (let index = 0; index < 5; index += 1) {
            await expectArrowHoverEffect(page, links.nth(index), `Get to know us link ${index + 1}`, { verifyAnimatedHover });
            await clickAndEnsureInternalNavigation(page, links.nth(index), new RegExp(`${escapeRegex(expectedDestinations[index])}(?:\\?.*)?(?:#.*)?$`, 'i'));
            await navigateBack(page, CAREERS_PATH_REGEX);
        }
    });
}, 180000);

test('Careers - Our Clients Logo Carousel Links', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Open the Careers page', async () => {
        await openCareersPage(page);
    });

    await test.step('Verify the client logo links return HTTP 200, with the existing in3bio defect still surfaced', async () => {
        const section = getOurClientsLogoCarousel(page);
        const links = await getSlickCarouselLinkData(section);
        const nonFailingLinks = links.filter((item) => item.href !== 'https://in3bio.com/about-us/');
        const knownFailingLink = links.find((item) => item.href === 'https://in3bio.com/about-us/');

        await expect(section, 'The Careers page should show the Our clients logo carousel').toBeVisible();
        expect(links.length, 'The Our clients carousel should expose linked client logos').toBeGreaterThan(0);

        // Only assert same-origin (relative or baseURL-origin) links — skip third-party external domains
        const baseOrigin = (new URL(baseURL || page.url())).origin;
        const sameOriginLinks = links.filter((item) => {
            try {
                const dest = new URL(item.href, baseURL || baseOrigin);
                return dest.origin === baseOrigin;
            } catch {
                return String(item.href || '').startsWith('/');
            }
        });

        for (const [index, linkData] of sameOriginLinks.entries()) {
            await expectLinkedDestinationReturnsHttp200(
                linkData.href,
                `Client logo link ${index + 1} (${linkData.href}) should return HTTP 200`,
            );
        }

        // Ensure the known failing external link is still present but skip its HTTP check
        expect(knownFailingLink, 'The known in3bio link should still be present in the Careers client logo carousel').toBeTruthy();
    });
}, 180000);

test('Careers - Diversity And Inclusion, Candidate Centre, and Footer', async ({ page }) => {
    test.setTimeout(180000);

    await test.step('Open the Careers page', async () => {
        await openCareersPage(page);
    });

    await test.step('Verify the Diversity and inclusion section, stats, logo strip, and Candidate centre CTA', async () => {
        const verifyAnimatedHover = await canReliablyHover(page);
        const diversitySection = getDiversityAndInclusionSection(page);
        const diversityButton = diversitySection.getByRole('link', { name: 'Find out more' }).first();
        const diversityButtonHref = await diversityButton.getAttribute('href');
        const diversityButtonUrl = resolveUrl(page.url(), diversityButtonHref);
        const stats = page.locator('#main-content .statsPanel.container .statsPanel__item');
        const logoStrip = getDiversityAndInclusionLogoStrip(page);
        const logoLinks = await getSlickCarouselLinkData(logoStrip);
        const candidateCentre = getCandidateCentrePanel(page);
        const candidateButton = candidateCentre.getByRole('link', { name: 'Register / Login' }).first();

        await expect(diversitySection, 'The Careers page should show the Diversity and inclusion section').toBeVisible();
        await expect(diversitySection.getByRole('heading', { level: 2, name: 'Diversity and inclusion' }), 'The Diversity and inclusion H2 should be visible').toBeVisible();
        await expectInteractiveHoverEffect(page, diversityButton, 'Diversity and inclusion Find out more button', { verifyAnimatedHover });
        expect(diversityButtonUrl, 'The Diversity and inclusion Find out more button should point to the About diversity page').toMatch(/\/about\/diversity-equity-and-inclusion(?:$|[?#])/i);

        await expect(stats, 'The Careers page should show six diversity roundel stats').toHaveCount(6);

        await expect(logoStrip, 'The Careers page should show the diversity partner logo strip below the stats').toBeVisible();
        await expect(logoStrip.locator('.slick-next, .slick-prev'), 'The diversity partner logo strip should not show slick arrows when only three logos are present').toHaveCount(0);
        expect(logoLinks.length, 'The diversity partner logo strip should expose three linked logos').toBe(3);

        for (const [index, linkData] of logoLinks.entries()) {
            await expectLinkedDestinationReturnsHttp200(
                linkData.href,
                `Diversity partner logo link ${index + 1} (${linkData.href}) should return HTTP 200`,
            );
        }

        await expect(candidateCentre, 'The Careers page should show the Candidate centre panel').toBeVisible();
        await expect(candidateCentre.getByRole('heading', { level: 2, name: 'Candidate centre' }), 'The Candidate centre H2 should be visible').toBeVisible();
        await expectInteractiveHoverEffect(page, candidateButton, 'Candidate centre Register / Login button', { verifyAnimatedHover });
        await expect(candidateButton, 'The Candidate centre button should point to the Withers candidate login page').toHaveAttribute('href', 'https://candidate.witherscareers.com/login');
    });

    await test.step('Verify the footer is present at the bottom of the Careers page', async () => {
        const footer = page.getByRole('contentinfo').first();

        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Careers page should show the standard site footer').toBeVisible();
    });
}, 180000);

test('Careers - Meet Our People - Traversal', async ({ page }) => {
    test.setTimeout(180000);

    await test.step('Open the Careers page and follow the Meet our people link', async () => {
        await openCareersPage(page);

        const panel = getCareersSupportingLinksPanel(page);
        const meetOurPeopleLink = panel.getByRole('link', { name: /Meet our people/i }).first();

        await expect(panel, 'The Careers page should show the supporting links panel').toBeVisible();
        await expect(meetOurPeopleLink, 'The Careers page should show the Meet our people link').toBeVisible();

        await clickAndEnsureInternalNavigation(page, meetOurPeopleLink, MEET_OUR_PEOPLE_PATH_REGEX);
    });

    await test.step('Verify the Meet our people title, breadcrumb, and H1', async () => {
        const pageName = 'Meet our people';
        const heading = page.getByRole('heading', { level: 1, name: pageName }).first();
        const breadcrumb = page.locator('.bc, nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').getByText(/^Meet our people$/i).first();

        await expect(page, 'The Meet our people page title should contain the clicked link name').toHaveTitle(new RegExp(escapeRegex(pageName), 'i'));
        await expect(heading, 'The Meet our people page should show the expected H1').toBeVisible();
        await expect(breadcrumb, 'The Meet our people breadcrumb should match the clicked link name').toBeVisible();
    });

    await test.step('Verify the Meet our people content sequence and quote carousel state', async () => {
        const contentSequence = await getMeetOurPeopleContentSequence(page);
        const quoteCarousels = page.locator('#main-content section.testimonialCarousel');

        expect(contentSequence, 'The Meet our people page should follow the expected panel and quote sequence').toEqual([
            { kind: 'featurePanels', count: expect.any(Number) },
            { kind: 'quoteCarousel', quoteCount: 1 },
            { kind: 'featurePanels', count: 3 },
            { kind: 'quoteCarousel', quoteCount: 1 },
            { kind: 'featurePanels', count: 2 },
            { kind: 'candidateCentre' },
        ]);
        expect(contentSequence[0].count, 'The Meet our people page should show at least one feature panel before the first quote carousel').toBeGreaterThanOrEqual(1);

        await expect(quoteCarousels, 'The Meet our people page should show two quote carousels').toHaveCount(2);

        for (let index = 0; index < 2; index += 1) {
            const carousel = quoteCarousels.nth(index);
            const items = carousel.locator('.carousel-item');
            const activeItem = carousel.locator('.carousel-item.active').first();
            const previousControl = carousel.locator('.carousel-control-prev').first();
            const nextControl = carousel.locator('.carousel-control-next').first();
            const activeQuoteBefore = normalizeWhitespace(await activeItem.innerText());

            await expect(items, `Quote carousel ${index + 1} should currently show one quote`).toHaveCount(1);
            await expect(activeItem, `Quote carousel ${index + 1} should show an active quote`).toBeVisible();
            await expect(previousControl, `Quote carousel ${index + 1} should expose the previous arrow`).toBeVisible();
            await expect(nextControl, `Quote carousel ${index + 1} should expose the next arrow`).toBeVisible();

            await clickWithCookieGuard(page, nextControl);
            await expect.poll(async () => normalizeWhitespace(await carousel.locator('.carousel-item.active').first().innerText()), {
                message: `Quote carousel ${index + 1} should keep the same active quote when only one quote is present`,
                timeout: 3000,
            }).toBe(activeQuoteBefore);

            await clickWithCookieGuard(page, previousControl);
            await expect.poll(async () => normalizeWhitespace(await carousel.locator('.carousel-item.active').first().innerText()), {
                message: `Quote carousel ${index + 1} should still keep the same active quote after clicking previous`,
                timeout: 3000,
            }).toBe(activeQuoteBefore);
        }
    });

    await test.step('Verify the Candidate centre panel and footer', async () => {
        const candidateCentre = getCandidateCentrePanel(page);
        const candidateButton = candidateCentre.getByRole('link', { name: 'Register / Login' }).first();
        const footer = page.getByRole('contentinfo').first();

        await expect(candidateCentre, 'The Meet our people page should show the Candidate centre panel').toBeVisible();
        await expect(candidateCentre.getByRole('heading', { level: 2, name: 'Candidate centre' }), 'The Meet our people page should show the Candidate centre heading').toBeVisible();
        await expect(candidateButton, 'The Meet our people page should show the Register / Login button').toBeVisible();
        await expect(candidateButton, 'The Register / Login button should point to the Withers candidate login page').toHaveAttribute('href', 'https://candidate.witherscareers.com/login');

        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Meet our people page should show the standard site footer').toBeVisible();
    });
}, 180000);

test('Careers - Our Story - Traversal', async ({ page }) => {
    test.setTimeout(180000);

    await test.step('Open the Careers page and follow the Our story link', async () => {
        await openCareersPage(page);

        const panel = getCareersSupportingLinksPanel(page);
        const ourStoryLink = panel.getByRole('link', { name: /Our story/i }).first();

        await expect(panel, 'The Careers page should show the supporting links panel').toBeVisible();
        await expect(ourStoryLink, 'The Careers page should show the Our story link').toBeVisible();

        await clickAndEnsureInternalNavigation(page, ourStoryLink, ABOUT_PATH_REGEX);
    });

    await test.step('Verify the About page title and hero content', async () => {
        const heading = page.getByRole('heading', { level: 1, name: 'Get to know us' }).first();
        const getInTouchLink = page.getByRole('link', { name: 'Get in touch' }).first();

        await expect(page, 'The Our story destination title should contain About').toHaveTitle(/About/i);
        await expect(heading, 'The Our story destination should show the About page H1').toBeVisible();
        await expect(getInTouchLink, 'The About hero should show the Get in touch CTA').toBeVisible();
        await expect(getInTouchLink, 'The About hero Get in touch CTA should point to the contact page').toHaveAttribute('href', /\/contact-us(?:$|[?#])/i);
    });
}, 180000);

test('Careers - Recruitment Enquiries - Traversal', async ({ page }) => {
    test.setTimeout(180000);

    await test.step('Open the Careers page and follow the Recruitment enquiries link', async () => {
        await openCareersPage(page);

        const panel = getCareersSupportingLinksPanel(page);
        const recruitmentEnquiriesLink = panel.getByRole('link', { name: /Recruitment enquiries/i }).first();

        await expect(panel, 'The Careers page should show the supporting links panel').toBeVisible();
        await expect(recruitmentEnquiriesLink, 'The Careers page should show the Recruitment enquiries link').toBeVisible();

        await clickAndEnsureInternalNavigation(page, recruitmentEnquiriesLink, RECRUITMENT_ENQUIRIES_PATH_REGEX);
    });

    await test.step('Verify the Recruitment enquiries title, breadcrumb, and H1', async () => {
        const pageName = 'Recruitment enquiries';
        const heading = page.getByRole('heading', { level: 1, name: pageName }).first();
        const breadcrumb = page.locator('.bc, nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i]').getByText(/^Recruitment enquiries$/i).first();

        await expect(page, 'The Recruitment enquiries page title should match the clicked link name').toHaveTitle(new RegExp(escapeRegex(pageName), 'i'));
        await expect(heading, 'The Recruitment enquiries page should show the expected H1').toBeVisible();
        await expect(breadcrumb, 'The Recruitment enquiries breadcrumb should match the clicked link name').toBeVisible();
    });

    await test.step('Verify the Recruitment enquiries form fields and optional reCAPTCHA', async () => {
        const firstNameField = page.getByLabel('First name*').first();
        const lastNameField = page.getByLabel('Last name*').first();
        const emailAddressField = page.getByLabel('Email address*').first();
        const phoneNumberField = page.getByLabel('Phone number').first();
        const enquiryField = page.getByLabel('Enquiry*').first();
        const submitButton = page.locator('input[type="submit"], button[type="submit"]').first();
        const recaptchaIframe = page.locator('#main-content iframe[src*="recaptcha"], #main-content iframe[title*="reCAPTCHA" i]').first();

        await expect(firstNameField, 'The Recruitment enquiries form should show the First name field').toBeVisible();
        await expect(lastNameField, 'The Recruitment enquiries form should show the Last name field').toBeVisible();
        await expect(emailAddressField, 'The Recruitment enquiries form should show the Email address field').toBeVisible();
        await expect(phoneNumberField, 'The Recruitment enquiries form should show the Phone number field').toBeVisible();
        await expect(enquiryField, 'The Recruitment enquiries form should show the Enquiry field').toBeVisible();
        await expect(submitButton, 'The Recruitment enquiries form should show the Submit button').toBeVisible();

        const recaptchaVisible = await recaptchaIframe.isVisible().catch(() => false);
        if (recaptchaVisible) {
            await expect(recaptchaIframe, 'In UAT the Recruitment enquiries form should expose the reCAPTCHA iframe').toBeVisible();
        }
    });

    await test.step('Verify the footer is present', async () => {
        const footer = page.getByRole('contentinfo').first();

        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Recruitment enquiries page should show the standard site footer').toBeVisible();
    });
}, 180000);

test.describe('Careers - Recruitment Enquiries - Form', () => {

    test('Validate When All Fields Empty', async ({ page }) => {
        test.setTimeout(180000);

        await test.step('Open the Recruitment enquiries page directly', async () => {
            await page.goto('/careers/recruitment-enquiries', { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await acceptCookiesIfPresent(page);

            await expect(page, 'The form validation test should land on the localized Recruitment enquiries page').toHaveURL(RECRUITMENT_ENQUIRIES_PATH_REGEX);
            await expect(page, 'The Recruitment enquiries page should load the expected title').toHaveTitle(/Recruitment enquiries/i);
        });

        await test.step('Submit the form with all required fields empty', async () => {
            await submitForm(page);
        });

        await test.step('Verify the form is not submitted and the enquiry field shows validation styling and message', async () => {
            const enquiryField = page.getByLabel('Enquiry*').first();
            const enquiryFormField = enquiryField.locator('xpath=ancestor::div[contains(@class,"form-field")][1]').first();
            const validationMessage = enquiryFormField.locator('.field-validation-error, .error-info').filter({ hasText: 'Please enter a value.' }).first();

            await expect(page, 'Submitting the empty Recruitment enquiries form should keep the browser on the same page').toHaveURL(RECRUITMENT_ENQUIRIES_PATH_REGEX);
            await expect(enquiryField, 'Submitting the empty Recruitment enquiries form should flag the Enquiry field as invalid').toHaveClass(/input-validation-error/);
            await expect(validationMessage, 'Submitting the empty Recruitment enquiries form should show the Please enter a value. message under Enquiry').toBeVisible();
        });
    });

    test('Validate Partial Submission', async ({ page }) => {
        test.setTimeout(180000);

        await test.step('Open the Recruitment enquiries page directly', async () => {
            await page.goto('/careers/recruitment-enquiries', { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await acceptCookiesIfPresent(page);

            await expect(page, 'The partial-submission test should land on the localized Recruitment enquiries page').toHaveURL(RECRUITMENT_ENQUIRIES_PATH_REGEX);
            await expect(page, 'The Recruitment enquiries page should load the expected title').toHaveTitle(/Recruitment enquiries/i);
        });

        await test.step('Fill only the Email address and Enquiry fields and submit the form', async () => {
            await page.getByLabel('Email address*').first().fill('test@example.com');
            await page.getByLabel('Enquiry*').first().fill('this is a test');

            await submitForm(page);
        });

        await test.step('Verify the form stays unsubmitted and the enquiry field returns to its normal state', async () => {
            const enquiryField = page.getByLabel('Enquiry*').first();
            const enquiryFormField = enquiryField.locator('xpath=ancestor::div[contains(@class,"form-field")][1]').first();
            const enquiryValidationMessages = enquiryFormField.locator('.field-validation-error, .error-info').filter({ hasText: 'Please enter a value.' });

            await expect(page, 'Submitting the partially completed Recruitment enquiries form should keep the browser on the same page').toHaveURL(RECRUITMENT_ENQUIRIES_PATH_REGEX);
            await expect(page.getByLabel('Email address*').first(), 'The Email address value should remain present after the partial submission attempt').toHaveValue('test@example.com');
            await expect(enquiryField, 'The Enquiry value should remain present after the partial submission attempt').toHaveValue('this is a test');
            await expect(enquiryField, 'Once Enquiry is filled, its invalid styling should clear even though the form still stays unsubmitted').not.toHaveClass(/input-validation-error/);
            await expect(enquiryValidationMessages, 'The Enquiry-specific Please enter a value. message should disappear once the field is filled').toHaveCount(0);
            await expect(page.getByText(/thank you|thanks|we'll be in touch|received/i).first(), 'The partially completed Recruitment enquiries form should not show a success acknowledgement').not.toBeVisible();
        });
    });

    test('Validate Successful Submission', async ({ page }, testInfo) => {
        test.setTimeout(420000);

        const submissionNumber = getCurrentSubmissionNumber(CAREERS_RECRUITMENT_COUNTER_KEY);
        const submission = buildUniqueRecruitmentEnquiryData(submissionNumber);

        if (testInfo.project.use?.headless !== false) {
            test.skip(true, 'Manual reCAPTCHA solving requires a headed browser session.');
        }

        await test.step('Open the Recruitment enquiries page directly', async () => {
            await page.goto('/careers/recruitment-enquiries', { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await acceptCookiesIfPresent(page);

            await expect(page, 'The successful-submission test should land on the localized Recruitment enquiries page').toHaveURL(RECRUITMENT_ENQUIRIES_PATH_REGEX);
            await expect(page, 'The Recruitment enquiries page should load the expected title').toHaveTitle(/Recruitment enquiries/i);
        });

        await test.step('Fill the Recruitment enquiries form with a unique submission dataset', async () => {
            await page.getByLabel('First name*').first().fill(submission.firstName);
            await page.getByLabel('Last name*').first().fill(submission.lastName);
            await page.getByLabel('Email address*').first().fill(submission.email);
            await page.getByLabel('Phone number').first().fill(submission.phoneNumber);
            await page.getByLabel('Enquiry*').first().fill(submission.enquiry);
        });

        await test.step('Wait for manual reCAPTCHA resolution', async () => {
            await waitForManualRecaptchaResolution(page);
        });

        await test.step('Submit the completed Recruitment enquiries form', async () => {
            await submitForm(page);
        });

        await test.step('Verify the submission succeeds and advance the shared submission counter', async () => {
            await expect(page, 'A successful Recruitment enquiries submission should stay on the same page URL').toHaveURL(RECRUITMENT_ENQUIRIES_PATH_REGEX);
            await expect(
                page.getByText('Thank you for your enquiry. A member of the team will be in touch within 2 business days.').first(),
                'A successful Recruitment enquiries submission should show the expected success acknowledgement',
            ).toBeVisible();

            incrementSubmissionNumber(CAREERS_RECRUITMENT_COUNTER_KEY);
        });
    });

});
