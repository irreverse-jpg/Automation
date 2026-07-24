const { test, expect } = require('@playwright/test');
const { verifyPageLinksNavigateCorrectly } = require('./linkNavigationHelpers');

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
// Coverage notes - Funding and support section (top nav "Funding and support")
// ============================================================================
// Scope: every page under the "Funding and support" mega-nav branch,
// discovered via direct DOM probing of the real meganav on both QA and Live
// - 8 top-level items (one, "Wellbeing", just duplicates 2 hrefs already
// reachable under Chemists' Community Fund), 3 branches with children
// (Careers, Chemists' Community Fund, The Pan Africa Chemistry Network).
// 30 unique pages total. QA has one extra "Career toolkit" page not present
// in Live's current menu - out of scope, same convention as every prior spec
// (build to current Live content).
//
// Tests in this file:
//   1-30. Funding and Support - <Page> Traversal (one per FUNDING_PAGES entry)
//      Title/H1/breadcrumb/footer/card-count PLUS (new as of 2026-07-22,
//      see LINK NAVIGATION COVERAGE below) a full check that every real
//      link/button in the page's main content actually navigates somewhere
//      valid.
//   31. Funding and Support - Accordion Functionality
//      Expands/collapses a sample of the Bootstrap-style accordion on
//      /funding-and-support/careers/career-support/faqs (27 real items).
//   32. Funding and Support - YouTube Video Playback
//      Plays/fullscreens/exits fullscreen/pauses a real YouTube embed on
//      /funding-and-support/careers/professional-development (2 videos on
//      this page - the same multi-video scenario as
//      06-rsc.publishing.spec.js's assessment-and-review page, so the same
//      stable-iframe-by-exact-src fix is applied here too).
//
// LINK NAVIGATION COVERAGE (new as of 2026-07-22, per explicit project
// instruction, retrofitted into every prior menu-section spec in this
// project too): every Traversal test now also calls
// `verifyPageLinksNavigateCorrectly()` (./linkNavigationHelpers.js) to
// confirm every real link/button in the page's main content area actually
// navigates to a working destination - not just that the elements exist.
// Cards are sampled (max 6 - first, last, and a spread across the middle)
// when a page has more than 6, since several pages in this project have
// 30-500+ cards; every other link/button in main content is checked in
// full (typically far fewer per page once in-page anchor jumps/mailto/tel
// are excluded). See that file's own header comment for the full exclusion
// list (header/nav/footer links, JotForm lightbox triggers, accordion/
// combobox toggles - all covered by their own dedicated tests elsewhere).
//
// ENVIRONMENT DRIFT confirmed 2026-07-22: the Chemists' Community Fund
// contact page's H1 differs by environment - QA reads "Contact Chemists'
// Community Fund", Live reads "Contact the Chemists' Community Fund" (note
// the extra "the") - fixed with a regex, same pattern as every prior spec's
// content-drift findings. Every other one of the 30 shared pages has
// byte-identical H1 text on both environments (checked directly, not
// assumed).
//
// This section has no contact-us JotForm modal (confirmed via direct probe
// of /funding-and-support/chemists-community-fund/contact-us) and no
// Live-only pages requiring 404-gating - the simplest section structurally
// of the 5 built so far in this project, though the largest in raw content
// (several pages here have videos AND accordions simultaneously).
// ============================================================================

async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

async function openPage(page, path) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

async function expectPageChrome(page, { h1, breadcrumbParent }) {
    const pageHeading = page.locator('h1').first();
    await expect(pageHeading, `Page should show the "${h1}" H1`).toHaveText(h1);

    const breadcrumbNav = page.locator('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]').first();
    await expect(breadcrumbNav, 'Page should expose a breadcrumb trail').toBeVisible();

    if (breadcrumbParent) {
        await expect(breadcrumbNav, `Breadcrumb should include "${breadcrumbParent}" as a previous level`).toContainText(breadcrumbParent);
    }
}

async function verifyFooterVisible(page) {
    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'Page should expose a visible footer at the bottom').toBeVisible();
}

// ============================================================================
// Traversal - every page in the Funding and support mega-nav branch
// ============================================================================
const FUNDING_PAGES = [
    { testName: "Funding and Support - Supporting our community Traversal", href: "/funding-and-support", h1: "Supporting our community", breadcrumbParent: null },
    { testName: "Funding and Support - Funding Traversal", href: "/funding-and-support/funding", h1: "Funding", breadcrumbParent: null },
    { testName: "Funding and Support - Careers Traversal", href: "/funding-and-support/careers", h1: "Your career in chemistry", breadcrumbParent: null },
    { testName: "Funding and Support - Career support Traversal", href: "/funding-and-support/careers/career-support", h1: "How we can support your career", breadcrumbParent: "Careers" },
    { testName: "Funding and Support - Career decisions Traversal", href: "/funding-and-support/careers/career-support/career-decisions", h1: "Career decisions", breadcrumbParent: "Career support" },
    { testName: "Funding and Support - Job seeking Traversal", href: "/funding-and-support/careers/career-support/job-seeking", h1: "Job seeking", breadcrumbParent: "Career support" },
    { testName: "Funding and Support - Career consultations Traversal", href: "/funding-and-support/careers/career-support/career-consultations", h1: "Career consultations", breadcrumbParent: "Career support" },
    { testName: "Funding and Support - Career talks and events Traversal", href: "/funding-and-support/careers/career-support/talks-and-events", h1: "Career talks and events", breadcrumbParent: "Career support" },
    { testName: "Funding and Support - Careers support and FAQs Traversal", href: "/funding-and-support/careers/career-support/faqs", h1: "Careers support and FAQs", breadcrumbParent: "Career support" },
    { testName: "Funding and Support - Professional development Traversal", href: "/funding-and-support/careers/professional-development", h1: "Professional development", breadcrumbParent: "Careers" },
    { testName: "Funding and Support - Working in the chemical sciences Traversal", href: "/funding-and-support/careers/working-in-the-chemical-sciences", h1: "Working in the chemical sciences", breadcrumbParent: "Careers" },
    { testName: "Funding and Support - What do chemists earn? Traversal", href: "/funding-and-support/careers/working-in-the-chemical-sciences/what-do-chemists-earn", h1: "What do chemists earn", breadcrumbParent: "Working in the chemical sciences" },
    { testName: "Funding and Support - Technical and vocational pathways Traversal", href: "/funding-and-support/careers/working-in-the-chemical-sciences/technical-and-vocational-pathways", h1: "Technical and vocational pathways", breadcrumbParent: "Working in the chemical sciences" },
    { testName: "Funding and Support - Broadening Horizons Traversal", href: "/funding-and-support/careers/working-in-the-chemical-sciences/broadening-horizons", h1: "Broadening Horizons in the Chemical Sciences programme", breadcrumbParent: "Working in the chemical sciences" },
    { testName: "Funding and Support - Chemists' Community Fund Traversal", href: "/funding-and-support/chemists-community-fund", h1: "Chemists' Community Fund", breadcrumbParent: null },
    { testName: "Funding and Support - Application guidance Traversal", href: "/funding-and-support/chemists-community-fund/application-guidance", h1: "Application guidance", breadcrumbParent: "Chemists' Community Fund" },
    { testName: "Funding and Support - Money and advice Traversal", href: "/funding-and-support/chemists-community-fund/money-and-advice", h1: "Money and advice", breadcrumbParent: "Chemists' Community Fund" },
    { testName: "Funding and Support - Wellbeing and family Traversal", href: "/funding-and-support/chemists-community-fund/wellbeing-and-family", h1: "Wellbeing and family", breadcrumbParent: "Chemists' Community Fund" },
    { testName: "Funding and Support - Wellbeing and listening service Traversal", href: "/funding-and-support/chemists-community-fund/wellbeing-and-family/wellbeing-and-listening-service", h1: "Wellbeing and listening service", breadcrumbParent: "Wellbeing and family" },
    { testName: "Funding and Support - Bullying and harassment support Traversal", href: "/funding-and-support/chemists-community-fund/wellbeing-and-family/bullying-and-harassment-support-line", h1: "Bullying and harassment support", breadcrumbParent: "Wellbeing and family" },
    { testName: "Funding and Support - Employment and study Traversal", href: "/funding-and-support/chemists-community-fund/employment-and-study", h1: "Employment and study", breadcrumbParent: "Chemists' Community Fund" },
    { testName: "Funding and Support - Student support Traversal", href: "/funding-and-support/chemists-community-fund/student-support", h1: "Student support", breadcrumbParent: "Chemists' Community Fund" },
    { testName: "Funding and Support - Case studies Traversal", href: "/funding-and-support/chemists-community-fund/case-studies", h1: "Case studies", breadcrumbParent: "Chemists' Community Fund" },
    { testName: "Funding and Support - Volunteer with us Traversal", href: "/funding-and-support/chemists-community-fund/volunteer-with-us", h1: "Volunteer with us", breadcrumbParent: "Chemists' Community Fund" },
    { testName: "Funding and Support - Meet the team Traversal", href: "/funding-and-support/chemists-community-fund/meet-the-team", h1: "Meet the team", breadcrumbParent: "Chemists' Community Fund" },
    // H1 differs by environment: QA "Contact Chemists' Community Fund", Live "Contact the
    // Chemists' Community Fund" (extra "the") - confirmed 2026-07-22.
    { testName: "Funding and Support - Contact the Chemists' Community Fund Traversal", href: "/funding-and-support/chemists-community-fund/contact-us", h1: /^Contact( the)? Chemists' Community Fund$/, breadcrumbParent: "Chemists' Community Fund" },
    { testName: "Funding and Support - Education Traversal", href: "/funding-and-support/education", h1: "Education", breadcrumbParent: null },
    { testName: "Funding and Support - The Pan Africa Chemistry Network Traversal", href: "/funding-and-support/pan-africa-chemistry-network", h1: "The Pan Africa Chemistry Network", breadcrumbParent: null },
    { testName: "Funding and Support - Our hubs Traversal", href: "/funding-and-support/pan-africa-chemistry-network/hubs", h1: "Our hubs", breadcrumbParent: "The Pan Africa Chemistry Network" },
    { testName: "Funding and Support - Directory of Consultants Traversal", href: "/funding-and-support/directory-of-consultants", h1: "The Directory of Consultants", breadcrumbParent: null },
];

for (const config of FUNDING_PAGES) {
    test(config.testName, async ({ page }) => {
        // The full link/card click-through check (verifyPageLinksNavigateCorrectly) can involve
        // dozens of individual navigations on content-heavy pages - 180s wasn't enough on Live's
        // slower response times (confirmed via a genuine "Test timeout exceeded" on several
        // pages, not a site bug), bumped generously here and in every other spec's equivalent
        // Traversal loop.
        test.setTimeout(600000);

        await test.step(`Open ${config.href} and verify page chrome`, async () => {
            await openPage(page, config.href);
            await expectPageChrome(page, { h1: config.h1, breadcrumbParent: config.breadcrumbParent });
        });

        await test.step('Verify the page exposes at least one content card', async () => {
            const cardCount = await page.locator('.card').count();
            expect(cardCount, `${config.href} should expose at least one content card`).toBeGreaterThan(0);
        });

        await test.step('Verify every link/card on the page navigates correctly', async () => {
            await verifyPageLinksNavigateCorrectly(page, config.href, { openPage, waitForAndAcceptCookieBanner, expect, test });
        });

        await test.step('Verify footer visibility', async () => {
            await verifyFooterVisible(page);
        });
    });
}

// ============================================================================
// Accordion functionality (Bootstrap-style accordion, same component used in
// 06-rsc.publishing.spec.js, 07-rsc.policyandcampaigning.spec.js, and
// 08-rsc.standardsandrecognition.spec.js - .accordion-item/.accordion-button/
// .accordion-collapse)
// ============================================================================
async function toggleBootstrapAccordionAndVerify(item, contextLabel) {
    const button = item.locator('.accordion-button').first();
    const body = item.locator('.accordion-collapse').first();

    await button.scrollIntoViewIfNeeded();
    const classBefore = await body.getAttribute('class');
    const wasExpanded = (classBefore || '').includes('show');

    await button.click();
    await expect.poll(async () => {
        const cls = await body.getAttribute('class');
        return (cls || '').includes('show');
    }, {
        message: `${contextLabel} should toggle its expanded state after clicking its header`,
        timeout: 8000,
    }).toBe(!wasExpanded);

    if (!wasExpanded) {
        await expect(body, `${contextLabel} should reveal visible content when expanded`).toBeVisible();
        const bodyText = (await body.innerText()).trim();
        expect(bodyText.length, `${contextLabel} should show non-empty content when expanded`).toBeGreaterThan(0);
    }

    // Restore original state so the page is left as found.
    await button.click();
    await expect.poll(async () => {
        const cls = await body.getAttribute('class');
        return (cls || '').includes('show');
    }, {
        message: `${contextLabel} should return to its original collapsed/expanded state`,
        timeout: 8000,
    }).toBe(wasExpanded);
}

test('Funding and Support - Accordion Functionality', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Careers support and FAQs page', async () => {
        await openPage(page, '/funding-and-support/careers/career-support/faqs');
    });

    await test.step('Verify a sample of the real accordion items expand/collapse correctly', async () => {
        const items = page.locator('.accordion-item');
        const count = await items.count();
        expect(count, 'This page should expose a large number of real accordion items').toBeGreaterThan(10);

        const indexesToCheck = new Set([0, count - 1, Math.floor(count / 2)]);
        for (const index of indexesToCheck) {
            await toggleBootstrapAccordionAndVerify(items.nth(index), `Accordion item #${index + 1}`);
        }
    });
});

// ============================================================================
// YouTube video playback (reuses the same ytm-skin play/fullscreen/pause
// sequence as prior specs, with the stable-iframe-by-exact-src fix already
// confirmed necessary for multi-video pages in 06-rsc.publishing.spec.js)
// ============================================================================
async function testYouTubeVideo(videoIframe, videoFrame, page) {
    await videoIframe.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    const playButton = videoFrame.locator('.ytmCuedOverlayPlayButton').first();
    await expect(playButton, 'The video should expose a cued play-button overlay').toBeVisible();

    await playButton.click({ force: true, timeout: 15000 });
    await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => !video.paused).catch(() => false), {
        message: 'The video should start playing once the play button is clicked',
    }).toBe(true);

    await videoIframe.hover();
    await videoFrame.getByRole('button', { name: 'Enter full screen' }).click({ timeout: 5000 });
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
        message: 'The page should enter full screen after clicking the full screen control',
    }).toBe(true);
    await page.waitForTimeout(1000);

    await videoIframe.hover();
    await page.waitForTimeout(300);
    await videoFrame.getByRole('button', { name: /exit full ?screen/i }).click({ timeout: 5000 });
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
        message: 'The page should leave full screen after clicking full screen again',
    }).toBe(false);

    await page.waitForTimeout(1000);
    await videoFrame.locator('video').first().click({ force: true, timeout: 5000 });
    let pausedAfterFirstClick = true;
    try {
        await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => video.paused).catch(() => false), {
            message: 'The video should pause when clicked',
            timeout: 5000,
        }).toBe(true);
    } catch (error) {
        pausedAfterFirstClick = false;
    }

    if (!pausedAfterFirstClick) {
        await videoFrame.locator('video').first().click({ force: true, timeout: 5000 });
        await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => video.paused).catch(() => false), {
            message: 'The video should pause when clicked',
        }).toBe(true);
    }
}

test('Funding and Support - YouTube Video Playback', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Professional development page', async () => {
        await openPage(page, '/funding-and-support/careers/professional-development');
    });

    await test.step('Play, fullscreen, exit fullscreen, and pause the first video', async () => {
        const youTubeCount = await page.locator('iframe[src*="youtube"]').count();
        expect(youTubeCount, 'This page should expose at least one YouTube video').toBeGreaterThan(0);

        // This page has 2 videos - pin the exact iframe by its real src rather than
        // re-querying ":visible" for every interaction, same fix already confirmed
        // necessary in 06-rsc.publishing.spec.js.
        const videoSrc = await page.locator('iframe[src*="youtube"]:visible').first().getAttribute('src');
        const stableSelector = `iframe[src="${videoSrc}"]`;
        const visibleYouTube = page.locator(stableSelector).first();
        const videoFrame = page.frameLocator(stableSelector).first();
        await testYouTubeVideo(visibleYouTube, videoFrame, page);
    });
});
