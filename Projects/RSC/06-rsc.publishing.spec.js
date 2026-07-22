const { test, expect } = require('@playwright/test');
const { getCurrentSubmissionNumber, incrementSubmissionNumber } = require('./submissionCounter');

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
// Coverage notes - Publishing section (top nav "Publishing")
// ============================================================================
// Scope: every page under the "Publishing" mega-nav branch, built from Live's
// menu tree (confirmed 2026-07-21 via direct DOM probing - not guessed) since
// this is the environment-synchronised source of truth per project
// instruction. 59 unique pages across 7 top-level branches: Our publishing
// portfolio, Publish with us, Open access, Journals, Books, Databases,
// Product information.
//
// Tests in this file:
//   1-59. Publishing - <Page> Traversal (one per PUBLISHING_PAGES entry)
//      Title/H1/breadcrumb/footer/card-count - the standard page-chrome
//      check used across every project's menu-item specs. 3 entries are
//      Live-only (see LIVE-ONLY PAGES below) and skip on QA via a real
//      404 check rather than a menu-visibility check, since these are
//      identified by direct URL, not by clicking through the meganav.
//   60. Publishing - Accordion Functionality
//      Expands/collapses a sample of the Bootstrap-style accordion on
//      /publishing/publish-with-us/publish-a-journal-article/experimental-reporting
//      (21 real accordion items - the single richest accordion page found
//      in this section).
//   61. Publishing - YouTube Video Playback
//      Plays/fullscreens/exits fullscreen/pauses a real YouTube embed on
//      /publishing/publish-with-us/publish-a-journal-article/assessment-and-review
//      (3 videos), reusing MCC's proven ytm-skin play/fullscreen/pause
//      sequence verbatim.
//   62. Publishing - Our Open Access Community Interactive Tools
//      The "Consortia by country/region" dropdown and "Find institution"
//      free-text search (both Flourish-hosted embeds) on
//      /publishing/open-access/open-access-agreements/our-open-access-community.
//      Confirmed a REAL, reproducible QA-only defect (see KNOWN ISSUE below)
//      - this test exercises genuine functionality and is expected to fail
//      on QA and pass on Live, left as an intentional fail per this
//      project's established convention (same pattern as the homepage
//      spec's "Skip to menu" finding) rather than silently skipped.
//   63-66. Publishing - <Team> Contact Form - <journey>
//      4 "Send message" modal forms across 2 pages, all the exact same
//      JotForm (250933318259966) already used by 05-rsc-membership.spec.js's
//      "Contact our membership team" - just a different `team` query string
//      per card: library-catalogue's "Contact the library at Burlington
//      House" (team=library), and librarians-portal's 3 cards (team=sales,
//      team=ejournals, team=technicalsupport). Each gets the standard
//      Present/Blank/Partial/Successful-submission set, QA-only real
//      submission (see LIVE SUBMISSION GATING in 05-rsc-membership.spec.js's
//      own notes - same convention, applied here too).
//
// KEY MECHANICS confirmed 2026-07-21:
//   - This section's accordion markup is a DIFFERENT component from the rest
//     of the site's structured-CMS accordion (`.accordion__item`, BEM-style,
//     used by the meganav/homepage) - these are Bootstrap accordions
//     (`.accordion-item` > `.accordion-header` > `.accordion-button` +
//     `.accordion-collapse.collapse` -> `...collapse show` on expand),
//     confirmed via direct DOM probe on multiple pages. Both class patterns
//     are checked when counting accordions, but only the Bootstrap one
//     exists anywhere in this section.
//   - The country-dropdown/Find-institution page and the video page both
//     embed 3rd-party iframes (Flourish for the former, youtube-nocookie.com
//     for the latter) - interactions go through page.frameLocator(), not
//     page.locator().
//   - The "Send message" JotForm lightbox pattern is IDENTICAL to
//     05-rsc-membership.spec.js's - same form ID (250933318259966), same
//     field IDs (#input_16/17/9/29/30/11/27_0), just a different `team`
//     query string baked into each card's `.script--jotform[data-query-string]`.
//     Multiple "Send message" buttons can exist on one page (librarians
//     portal has 3) all sharing the identical CSS class
//     (`lightbox-250933318259966`) - each must be scoped to its own `.card`
//     via `hasText` to click the right one.
//
// LIVE-ONLY PAGES (confirmed 2026-07-21 via direct meganav comparison,
// consistent with the project's "build to Live content, prepare for QA sync"
// instruction): "Boards and teams" (and its child "Our editorial board
// members", nested under it on Live only - QA currently has a flat,
// differently-URLed "Our editorial board members" that will disappear once
// content syncs, so it isn't covered here) and "Guiding principles for AI".
// All 3 return a genuine 404 on QA today - each Traversal test navigates
// directly and test.skip()s if the response is a 404, rather than gating on
// meganav visibility (these pages aren't necessarily reachable via a menu
// click path worth re-proving here, since 02-rsc.meganav.spec.js already
// covers meganav mechanics).
//
// KNOWN ISSUE, QA-only, confirmed real and reproducible (not test flakiness)
// - left as an intentional fail on QA per this project's "Skip to menu"
// precedent, not test.skip()'d: on
// /publishing/open-access/open-access-agreements/our-open-access-community,
// the "Consortia by country/region" Flourish dropdown's real .click() times
// out (element never becomes stable/clickable) on QA, and the "Find
// institution" free-text input's .click() also times out - both work
// perfectly on Live (confirmed via the identical interaction sequence on
// both environments). This is NOT the same "native <select> popup can't be
// measured" limitation documented in 05-rsc-membership.spec.js's wizard
// KNOWN ISSUE - here the actual .click() action itself fails to complete,
// a directly automatable, reproducible defect, not a rendering nuance.
// ============================================================================

async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

// Below the "lg" breakpoint the header (and #mainnav) is collapsed behind a "Toggle
// navigation" hamburger button - it stays visible whether the menu is open or collapsed
// (a toggle, not a show-once affordance), so this checks aria-expanded before clicking.
async function openMobileMenuIfPresent(page) {
    const toggleButton = page.getByRole('button', { name: 'Toggle navigation' });
    const toggleVisible = await toggleButton.isVisible().catch(() => false);
    if (!toggleVisible) return;

    const isExpanded = await toggleButton.getAttribute('aria-expanded').catch(() => null);
    if (isExpanded !== 'true') {
        await toggleButton.click();
        await page.waitForTimeout(300);
    }
}

async function openPage(page, path) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    return response;
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
// Traversal - every page in the Publishing mega-nav branch
// ============================================================================
const PUBLISHING_PAGES = [
    { testName: "Publishing - Our publishing portfolio Traversal", href: "/publishing", h1: "Our publishing portfolio", breadcrumbParent: null },
    { testName: "Publishing - Publish with us Traversal", href: "/publishing/publish-with-us", h1: "Why publish with us", breadcrumbParent: null },
    { testName: "Publishing - Publish a journal article Traversal", href: "/publishing/publish-with-us/publish-a-journal-article", h1: "Publish a journal article", breadcrumbParent: "Publish with us" },
    { testName: "Publishing - Article templates Traversal", href: "/publishing/publish-with-us/publish-a-journal-article/article-templates", h1: "Article templates", breadcrumbParent: "Publish a journal article" },
    { testName: "Publishing - Choose the right journal Traversal", href: "/publishing/publish-with-us/publish-a-journal-article/choose-the-right-journal", h1: "Choose the right journal", breadcrumbParent: "Publish a journal article" },
    { testName: "Publishing - Assessment and review Traversal", href: "/publishing/publish-with-us/publish-a-journal-article/assessment-and-review", h1: "Assessment and review", breadcrumbParent: "Publish a journal article" },
    { testName: "Publishing - Revise or transfer your article Traversal", href: "/publishing/publish-with-us/publish-a-journal-article/revise-or-transfer-your-article", h1: "Revise or transfer your article", breadcrumbParent: "Publish a journal article" },
    { testName: "Publishing - Preparing Supplementary Information Traversal", href: "/publishing/publish-with-us/publish-a-journal-article/preparing-supplementary-information", h1: "Preparing Supplementary Information", breadcrumbParent: "Publish a journal article" },
    { testName: "Publishing - Experimental reporting Traversal", href: "/publishing/publish-with-us/publish-a-journal-article/experimental-reporting", h1: "Experimental details and characterisation required for journal articles", breadcrumbParent: "Publish a journal article" },
    { testName: "Publishing - Data sharing Traversal", href: "/publishing/publish-with-us/publish-a-journal-article/data-sharing", h1: "Data sharing", breadcrumbParent: "Publish a journal article" },
    { testName: "Publishing - Publish a book Traversal", href: "/publishing/publish-with-us/publish-a-book", h1: "Get started as a book author", breadcrumbParent: "Publish with us" },
    { testName: "Publishing - Active series Traversal", href: "/publishing/publish-with-us/publish-a-book/active-series", h1: "Active series accepting proposals", breadcrumbParent: "Publish a book" },
    { testName: "Publishing - Propose your book idea Traversal", href: "/publishing/publish-with-us/publish-a-book/propose-your-book-idea", h1: "Propose your book idea", breadcrumbParent: "Publish a book" },
    { testName: "Publishing - Prepare and submit your manuscript Traversal", href: "/publishing/publish-with-us/publish-a-book/prepare-and-submit-your-manuscript", h1: "Prepare and submit your manuscript", breadcrumbParent: "Publish a book" },
    { testName: "Publishing - Promote your book Traversal", href: "/publishing/publish-with-us/publish-a-book/promote-your-book", h1: "Promote your book", breadcrumbParent: "Publish a book" },
    { testName: "Publishing - Book policies Traversal", href: "/publishing/publish-with-us/publish-a-book/book-policies", h1: "Book policies and ethical guidelines", breadcrumbParent: "Publish a book" },
    { testName: "Publishing - Making an impact Traversal", href: "/publishing/publish-with-us/maximise-your-impact-and-visibility", h1: "Maximise your impact and visibility", breadcrumbParent: "Publish with us" },
    { testName: "Publishing - Open access Traversal", href: "/publishing/open-access", h1: "How open access works and why it matters", breadcrumbParent: null },
    { testName: "Publishing - Open access options Traversal", href: "/publishing/open-access/open-access-options", h1: "Your open access options", breadcrumbParent: "Open access" },
    { testName: "Publishing - Payments and funding Traversal", href: "/publishing/open-access/payments-and-funding", h1: "Payments and funding", breadcrumbParent: "Open access" },
    { testName: "Publishing - Sharing your research Traversal", href: "/publishing/open-access/sharing-your-research", h1: "Sharing your research", breadcrumbParent: "Open access" },
    { testName: "Publishing - Open access agreements Traversal", href: "/publishing/open-access/open-access-agreements", h1: "The benefits of open access agreements and how they work", breadcrumbParent: "Open access" },
    { testName: "Publishing - Our open access community Traversal", href: "/publishing/open-access/open-access-agreements/our-open-access-community", h1: "Our open access community", breadcrumbParent: "Open access agreements" },
    { testName: "Publishing - Open access for books Traversal", href: "/publishing/open-access/open-access-for-books", h1: "Open access for books", breadcrumbParent: "Open access" },
    { testName: "Publishing - Journals Traversal", href: "/publishing/journals", h1: "Explore our journals", breadcrumbParent: null },
    { testName: "Publishing - Review for us Traversal", href: "/publishing/journals/review-for-us", h1: "Review for us", breadcrumbParent: "Journals" },
    { testName: "Publishing - Calls for papers Traversal", href: "/publishing/journals/calls-for-papers", h1: "Calls for papers", breadcrumbParent: "Journals" },
    { testName: "Publishing - Journal metrics Traversal", href: "/publishing/journals/journal-metrics", h1: "Journal metrics", breadcrumbParent: "Journals" },
    { testName: "Publishing - Boards and teams Traversal", href: "/publishing/journals/boards-and-teams", h1: "Our journal boards and teams", breadcrumbParent: "Journals", liveOnly: true },
    { testName: "Publishing - Our editorial board members Traversal", href: "/publishing/journals/boards-and-teams/our-editorial-board-members", h1: "Our editorial board members", breadcrumbParent: "Boards and teams", liveOnly: true },
    // H1 differs by environment: QA "Sign up for journal email alerts", Live "Sign up for email alerts" - confirmed 2026-07-21.
    { testName: "Publishing - Email alerts Traversal", href: "/publishing/journals/email-alerts", h1: /^Sign up for( journal)? email alerts$/, breadcrumbParent: "Journals" },
    { testName: "Publishing - Processes and policies Traversal", href: "/publishing/journals/processes-and-policies", h1: "Our publishing process and editorial policies", breadcrumbParent: "Journals" },
    { testName: "Publishing - Author responsibilities Traversal", href: "/publishing/journals/processes-and-policies/author-responsibilities", h1: "Author responsibilities", breadcrumbParent: "Processes and policies" },
    { testName: "Publishing - Reviewer responsibilities Traversal", href: "/publishing/journals/processes-and-policies/reviewer-responsibilities", h1: "Reviewer responsibilities", breadcrumbParent: "Processes and policies" },
    { testName: "Publishing - Licences, copyright and permissions Traversal", href: "/publishing/journals/processes-and-policies/licences-copyright-and-permissions", h1: "Licences, copyright and permissions", breadcrumbParent: "Processes and policies" },
    { testName: "Publishing - Guiding principles for AI Traversal", href: "/publishing/journals/processes-and-policies/guiding-principles-for-artificial-intelligence", h1: "Guiding principles for artificial intelligence", breadcrumbParent: "Processes and policies", liveOnly: true },
    { testName: "Publishing - Books Traversal", href: "/publishing/books", h1: "Our books", breadcrumbParent: null },
    { testName: "Publishing - Booksellers Traversal", href: "/publishing/books/booksellers", h1: "Booksellers", breadcrumbParent: "Books" },
    { testName: "Publishing - Textbook Adoptions Policy Traversal", href: "/publishing/books/textbook-adoptions-policy", h1: "Textbook Adoptions Policy", breadcrumbParent: "Books" },
    { testName: "Publishing - Databases Traversal", href: "/publishing/databases", h1: "Our databases", breadcrumbParent: null },
    { testName: "Publishing - Product information Traversal", href: "/publishing/product-information", h1: "Our products and services", breadcrumbParent: null },
    { testName: "Publishing - Product catalogue Traversal", href: "/publishing/product-information/product-catalogue", h1: "Product overview", breadcrumbParent: "Product information" },
    { testName: "Publishing - RSC Gold Traversal", href: "/publishing/product-information/product-catalogue/rsc-gold", h1: "RSC Gold", breadcrumbParent: "Product catalogue" },
    { testName: "Publishing - RSC Select Traversal", href: "/publishing/product-information/product-catalogue/rsc-select", h1: "RSC Select", breadcrumbParent: "Product catalogue" },
    { testName: "Publishing - Journal subscriptions Traversal", href: "/publishing/product-information/product-catalogue/journals", h1: "Journal subscriptions", breadcrumbParent: "Product catalogue" },
    { testName: "Publishing - Product Catalogue Books Traversal", href: "/publishing/product-information/product-catalogue/books", h1: "Books", breadcrumbParent: "Product catalogue" },
    { testName: "Publishing - Product Catalogue Databases Traversal", href: "/publishing/product-information/product-catalogue/databases", h1: "Databases", breadcrumbParent: "Product catalogue" },
    // H1 differs by environment: QA "Text and data mining (TDM)", Live "Licensing for AI and TDM
    // applications " (Live's has a trailing space in the markup itself, confirmed 2026-07-21).
    { testName: "Publishing - AI and TDM applications Traversal", href: "/publishing/product-information/product-catalogue/text-and-data-mining", h1: /^(Licensing for AI and TDM applications|Text and data mining \(TDM\))\s*$/, breadcrumbParent: "Product catalogue" },
    { testName: "Publishing - Magazines Traversal", href: "/publishing/product-information/product-catalogue/magazines", h1: "Magazines", breadcrumbParent: "Product catalogue" },
    { testName: "Publishing - Access and usage Traversal", href: "/publishing/product-information/access-and-usage", h1: "Accessing our products", breadcrumbParent: "Product information" },
    { testName: "Publishing - Free trials Traversal", href: "/publishing/product-information/access-and-usage/free-trials", h1: "Free one-month trial to our journals", breadcrumbParent: "Access and usage" },
    { testName: "Publishing - Usage reports Traversal", href: "/publishing/product-information/access-and-usage/usage-reports", h1: "Usage reports", breadcrumbParent: "Access and usage" },
    { testName: "Publishing - KBART MARC and URL lists Traversal", href: "/publishing/product-information/access-and-usage/kbart-marc-and-url-lists", h1: "KBART, MARC and URL lists", breadcrumbParent: "Access and usage" },
    { testName: "Publishing - Terms and conditions Traversal", href: "/publishing/product-information/access-and-usage/terms-and-conditions", h1: "Terms and conditions", breadcrumbParent: "Access and usage" },
    { testName: "Publishing - Research4Life Traversal", href: "/publishing/product-information/access-and-usage/research4life", h1: "Research4Life", breadcrumbParent: "Access and usage" },
    { testName: "Publishing - Promotional materials Traversal", href: "/publishing/product-information/promotional-materials", h1: "Promotional materials", breadcrumbParent: "Product information" },
    // H1 differs by environment: QA "Library catalogue", Live "Library catalogue and services" - confirmed 2026-07-21.
    { testName: "Publishing - Library catalogue Traversal", href: "/publishing/product-information/library-catalogue", h1: /^Library catalogue( and services)?$/, breadcrumbParent: "Product information" },
    // H1 differs by environment: QA "Digital Collection (formerly the Virtual Library)", Live "Digital Collection" - confirmed 2026-07-21.
    { testName: "Publishing - Digital Collection (formerly the Virtual Library) Traversal", href: "/publishing/product-information/library-catalogue/digital-collection", h1: /^Digital Collection( \(formerly the Virtual Library\))?$/, breadcrumbParent: "Library catalogue" },
    { testName: "Publishing - Librarians portal Traversal", href: "/publishing/product-information/librarians-portal", h1: "Librarians' portal", breadcrumbParent: "Product information" },
];

for (const config of PUBLISHING_PAGES) {
    test(config.testName, async ({ page }) => {
        test.setTimeout(60000);

        if (config.liveOnly) {
            const response = await test.step(`Open ${config.href} and check it exists on this environment`, async () => {
                return openPage(page, config.href);
            });
            test.skip(!response || response.status() === 404, 'This page does not exist yet on this environment - see LIVE-ONLY PAGES note.');
        } else {
            await test.step(`Open ${config.href} and verify page chrome`, async () => {
                await openPage(page, config.href);
            });
        }

        await test.step('Verify page chrome (H1 and breadcrumb)', async () => {
            await expectPageChrome(page, { h1: config.h1, breadcrumbParent: config.breadcrumbParent });
        });

        await test.step('Verify the page exposes at least one content card', async () => {
            const cardCount = await page.locator('.card').count();
            expect(cardCount, `${config.href} should expose at least one content card`).toBeGreaterThan(0);
        });

        await test.step('Verify footer visibility', async () => {
            await verifyFooterVisible(page);
        });
    });
}

// ============================================================================
// Accordion functionality (Bootstrap-style accordion, distinct from the
// structured-CMS `.accordion__item` used elsewhere in this site)
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

test('Publishing - Accordion Functionality', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Experimental reporting page', async () => {
        await openPage(page, '/publishing/publish-with-us/publish-a-journal-article/experimental-reporting');
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
// YouTube video playback (reuses MCC's proven ytm-skin play/fullscreen/pause
// sequence verbatim - see 05-mcc.visitlords.spec.js/06-mcc.tickets.spec.js etc.)
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

test('Publishing - YouTube Video Playback', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Assessment and review page', async () => {
        await openPage(page, '/publishing/publish-with-us/publish-a-journal-article/assessment-and-review');
    });

    await test.step('Play, fullscreen, exit fullscreen, and pause the first video', async () => {
        const youTubeCount = await page.locator('iframe[src*="youtube"]').count();
        expect(youTubeCount, 'This page should expose at least one YouTube video').toBeGreaterThan(0);

        // This page has 3 YouTube embeds, and on desktop more than one can be simultaneously
        // ":visible" at once - re-evaluating a ":visible" selector after the fullscreen
        // enter/exit dance can silently resolve to a DIFFERENT iframe than the one that was
        // actually played, so pin the exact iframe by its real src instead of re-querying
        // ":visible" for every subsequent interaction. Confirmed 2026-07-21: this was why the
        // final pause-check intermittently failed on desktop only (tablet/mobile only ever
        // show one YouTube iframe visible at a time, so the bug never showed there).
        const videoSrc = await page.locator('iframe[src*="youtube"]:visible').first().getAttribute('src');
        const stableSelector = `iframe[src="${videoSrc}"]`;
        const visibleYouTube = page.locator(stableSelector).first();
        const videoFrame = page.frameLocator(stableSelector).first();
        await testYouTubeVideo(visibleYouTube, videoFrame, page);
    });
});

// ============================================================================
// "Our open access community" - Consortia dropdown + Find institution search
// (both Flourish-hosted embeds) - see KNOWN ISSUE at the top of this file.
// ============================================================================
test('Publishing - Our Open Access Community Interactive Tools', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open Our open access community', async () => {
        await openPage(page, '/publishing/open-access/open-access-agreements/our-open-access-community');
    });

    await test.step('The "Consortia by country/region" dropdown should be clickable and selectable', async () => {
        const frame = page.frameLocator('iframe[src*="flo.uri.sh"]').first();
        const select = frame.locator('select').first();
        await select.click({ timeout: 10000 });
        await select.selectOption({ index: 1 });
        expect(await select.inputValue(), 'Selecting an option should change the dropdown\'s value').not.toBe('');
    });

    await test.step('The "Find institution" free-text search should accept typed input', async () => {
        const frame = page.frameLocator('iframe[src*="flo.uri.sh"]').nth(1);
        const input = frame.locator('input').first();
        await input.click({ timeout: 10000 });
        await input.type('Oxford', { timeout: 10000 });
        await expect(input, 'Typing into the Find institution field should be reflected in its value').toHaveValue('Oxford');
    });
});

// ============================================================================
// "Send message" contact-team modal forms - identical JotForm (250933318259966)
// to 05-rsc-membership.spec.js's "Contact our membership team", reused across
// 2 pages / 4 cards with a different `team` query string each.
// ============================================================================
function contactModalFrame(page) {
    return page.frameLocator('iframe[src*="250933318259966"]').first();
}

async function openContactModalFromCard(page, cardHeading) {
    const card = page.locator('.card', { hasText: cardHeading });
    const sendMessageButton = card.getByRole('button', { name: 'Send message' });
    await sendMessageButton.scrollIntoViewIfNeeded();
    // On pages with multiple "Send message" cards (e.g. librarians-portal's 3), the lightbox
    // click handlers can still be wiring up right after load - a click that lands before that
    // finishes silently does nothing. Wait for the button to be stable first.
    await page.waitForTimeout(500);
    await sendMessageButton.click();
    await expect(contactModalFrame(page).locator('#input_16'), 'The contact modal should expose the First name field once opened').toBeVisible({ timeout: 20000 });
}

async function submitContactModalForm(page) {
    const frame = contactModalFrame(page);
    const submitButton = frame.locator('button[type="submit"], input[type="submit"]').first();
    await submitButton.scrollIntoViewIfNeeded();
    await submitButton.click();
}

function buildUniqueSubmissionData(counterKey, submissionNumber) {
    return {
        firstName: `RSC${counterKey.replace(/[^a-zA-Z0-9]/g, '')}${submissionNumber}`,
        lastName: `Contact${submissionNumber}`,
        email: `rsc.${counterKey.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.${submissionNumber}@example.com`,
        message: `Publishing enquiry test submission ${submissionNumber} for ${counterKey} - generated by automation.`,
    };
}

function isQaEnvironment(baseURL) {
    return (baseURL || '').includes('xperience-sites.com');
}

const CONTACT_TEAM_FORMS = [
    {
        pageHref: '/publishing/product-information/library-catalogue',
        cardHeading: 'Contact the library at Burlington House',
        counterKey: 'publishing-library-burlington-house',
        label: 'Library (Burlington House)',
    },
    {
        pageHref: '/publishing/product-information/librarians-portal',
        cardHeading: 'Contact our sales team',
        counterKey: 'publishing-librarians-sales',
        label: 'Librarians Portal - Sales',
    },
    {
        pageHref: '/publishing/product-information/librarians-portal',
        cardHeading: 'Contact our eJournals team',
        counterKey: 'publishing-librarians-ejournals',
        label: 'Librarians Portal - eJournals',
    },
    {
        pageHref: '/publishing/product-information/librarians-portal',
        cardHeading: 'Contact our technical support team',
        counterKey: 'publishing-librarians-technical-support',
        label: 'Librarians Portal - Technical Support',
    },
];

for (const form of CONTACT_TEAM_FORMS) {
    test(`Publishing - ${form.label} Contact Form - Verify it is Present`, async ({ page }) => {
        await test.step(`Open ${form.pageHref} and the contact modal`, async () => {
            await openPage(page, form.pageHref);
            await openContactModalFromCard(page, form.cardHeading);
        });

        await test.step('Verify the key fields are visible', async () => {
            const frame = contactModalFrame(page);
            await expect(frame.locator('#input_16'), 'First name field should be visible').toBeVisible();
            await expect(frame.locator('#input_17'), 'Last name field should be visible').toBeVisible();
            await expect(frame.locator('#input_9'), 'Email address field should be visible').toBeVisible();
            await expect(frame.locator('#input_29'), '"Are you a member of the RSC?" dropdown should be visible').toBeVisible();
            await expect(frame.locator('#input_11'), 'Message field should be visible').toBeVisible();
        });
    });

    test(`Publishing - ${form.label} Contact Form - Validate When All Fields Empty`, async ({ page }) => {
        await test.step(`Open ${form.pageHref} and the contact modal`, async () => {
            await openPage(page, form.pageHref);
            await openContactModalFromCard(page, form.cardHeading);
        });

        await test.step('Submit the form with all required fields empty', async () => {
            await submitContactModalForm(page);
        });

        await test.step('Verify the form stays open and shows required-field validation', async () => {
            const frame = contactModalFrame(page);
            await expect(frame.getByText('There are', { exact: false }).first(), 'Submitting the empty form should show an error-count banner').toBeVisible();
            const requiredMessages = frame.getByText('This field is required.');
            await expect(requiredMessages.first(), 'Submitting the empty form should show at least one required-field message').toBeVisible();
            expect(await requiredMessages.count(), 'The empty form should flag all 6 required fields').toBeGreaterThanOrEqual(6);
        });
    });

    test(`Publishing - ${form.label} Contact Form - Validate Partial Submission`, async ({ page }) => {
        await test.step(`Open ${form.pageHref} and the contact modal`, async () => {
            await openPage(page, form.pageHref);
            await openContactModalFromCard(page, form.cardHeading);
        });

        await test.step('Fill only the email field and submit', async () => {
            const frame = contactModalFrame(page);
            await frame.locator('#input_9').fill('partial.test@example.com');
            await submitContactModalForm(page);
        });

        await test.step('Verify the form stays open and still shows validation for the remaining required fields', async () => {
            const frame = contactModalFrame(page);
            const requiredMessages = frame.getByText('This field is required.');
            await expect(requiredMessages.first(), 'The partially completed form should still show at least one required-field message').toBeVisible();
            await expect(frame.locator('#input_9'), 'The filled email field should keep its value after the blocked submit').toHaveValue('partial.test@example.com');
        });
    });

    test(`Publishing - ${form.label} Contact Form - Validate Successful Submission`, async ({ page, baseURL }) => {
        test.skip(!isQaEnvironment(baseURL), 'Real form submissions must not be sent on Live - QA only, per project instruction.');
        test.setTimeout(60000);

        const submissionNumber = getCurrentSubmissionNumber(form.counterKey);
        const submission = buildUniqueSubmissionData(form.counterKey, submissionNumber);

        await test.step(`Open ${form.pageHref} and the contact modal`, async () => {
            await openPage(page, form.pageHref);
            await openContactModalFromCard(page, form.cardHeading);
        });

        await test.step(`Fill and submit the form with unique submission #${submissionNumber}`, async () => {
            const frame = contactModalFrame(page);
            await frame.locator('#input_16').fill(submission.firstName);
            await frame.locator('#input_17').fill(submission.lastName);
            await frame.locator('#input_9').fill(submission.email);
            await frame.locator('#input_29').selectOption({ label: 'No' });
            await frame.locator('#input_11').fill(submission.message);
            // Two <label for="input_27_0"> elements exist (the question's own top label plus
            // the "I agree" option label) - target the "I agree" one specifically by its text.
            await frame.locator('label[for="input_27_0"]', { hasText: 'I agree' }).click();
            await submitContactModalForm(page);
        });

        await test.step('Verify a success acknowledgement appears', async () => {
            const frame = contactModalFrame(page);
            await expect(frame.getByText(/thank you|success|received/i).first(), 'A successful submission should show a thank-you/success acknowledgement').toBeVisible({ timeout: 20000 });
        });

        await test.step('Advance the submission counter', async () => {
            incrementSubmissionNumber(form.counterKey);
        });
    });
}
