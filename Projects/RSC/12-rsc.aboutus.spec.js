const { test, expect } = require('@playwright/test');
const { getCurrentSubmissionNumber, incrementSubmissionNumber } = require('./submissionCounter');
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
// Coverage notes - the footer's "About us" link column
// ============================================================================
// Scope: every page linked from the footer's "About us" column (discovered
// via direct DOM probing of the real footer on both QA and Live, not
// guessed), reached directly by URL rather than the footer itself (already
// covered at a shallower "click and check H1" level by
// 03-rsc.footer.spec.js's PRIMARY_FOOTER_LINKS - this file goes deeper on
// the same pages: card counts, link/card click-through verification,
// accordion/video/contact-form coverage where those exist).
//
// Tests in this file:
//   1-9. About Us - <Page> Traversal (one per ABOUTUS_PAGES entry)
//      Title/H1/breadcrumb/footer/card-count/link-navigation-check - the
//      standard page-chrome check used across every spec in this project.
//      "Explore our websites" is liveOnly (see ENVIRONMENT DRIFT below).
//   10. About Us - Accordion Functionality
//      Expands/collapses a sample of the Bootstrap-style accordion on
//      /about-us/partnerships (27 real items - the richest accordion page
//      found in this column, confirmed identically present on both QA and
//      Live).
//   11. About Us - YouTube Video Playback
//      Plays/fullscreens/exits fullscreen/pauses the real YouTube embed on
//      /about-us (the "About us" root page itself).
//   12. About Us - Fundraising Team Contact Form - <journey>
//      "Contact our fundraising team" (same JotForm 250933318259966 pattern
//      as every other project contact-team form, team=fundraising) on
//      /about-us/partnerships - confirmed present on BOTH environments
//      (unlike several other specs' Live-only contact forms), so not gated.
//   13. About Us - Recruitment Team Contact Form - <journey>
//      "Contact our recruitment team" (team=jobs) on /about-us/work-for-us -
//      also confirmed present on both environments.
//
// ENVIRONMENT DRIFT confirmed 2026-07-23 (same category as this project's
// other content-drift findings, but narrower than most - only 1 of 9 pages
// differs, everything else is identical on both environments including
// H1 text, breadcrumbs, and both contact-team forms):
//   - Live's "About us" footer column has one extra link QA's doesn't:
//     "Our websites" -> /about-us/explore-our-websites (56 cards - a large
//     directory of RSC-affiliated external sites). Confirmed via direct
//     probe this URL genuinely 404s on QA (not simply unlinked from the
//     footer) - gated via a real page.goto() + response.status() === 404
//     check, same technique as every other spec's liveOnly pages.
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

function isQaEnvironment(baseURL) {
    return (baseURL || '').includes('xperience-sites.com');
}

// ============================================================================
// Traversal - every page in the footer's "About us" column
// ============================================================================
const ABOUTUS_PAGES = [
    { testName: "About Us - About Us Traversal", href: "/about-us", h1: "About the Royal Society of Chemistry", breadcrumbParent: null },
    { testName: "About Us - History Traversal", href: "/about-us/our-history", h1: "Our history", breadcrumbParent: "About us" },
    { testName: "About Us - Strategy Traversal", href: "/about-us/strategy", h1: "Our strategy", breadcrumbParent: "About us" },
    { testName: "About Us - Charter Traversal", href: "/about-us/charter", h1: "Our charter", breadcrumbParent: "About us" },
    { testName: "About Us - Structure and Governance Traversal", href: "/about-us/structure-and-governance", h1: "Structure and governance", breadcrumbParent: "About us" },
    { testName: "About Us - Partnerships Traversal", href: "/about-us/partnerships", h1: "Our partnerships", breadcrumbParent: "About us" },
    { testName: "About Us - Corporate Information Traversal", href: "/about-us/corporate-information", h1: "Corporate information", breadcrumbParent: "About us" },
    { testName: "About Us - Work for Us Traversal", href: "/about-us/work-for-us", h1: "Work for us", breadcrumbParent: "About us" },
    // Live-only (see ENVIRONMENT DRIFT above) - gated via a real 404 check.
    { testName: "About Us - Explore Our Websites Traversal", href: "/about-us/explore-our-websites", h1: "Explore our websites", breadcrumbParent: "About us", liveOnly: true },
];

for (const config of ABOUTUS_PAGES) {
    test(config.testName, async ({ page }) => {
        // The full link/card click-through check (verifyPageLinksNavigateCorrectly) can
        // involve dozens of individual navigations on content-heavy pages - bumped generously
        // here to match the convention already applied across every other spec in this project.
        test.setTimeout(600000);

        if (config.liveOnly) {
            const response = await test.step(`Open ${config.href} and check it exists on this environment`, async () => {
                return openPage(page, config.href);
            });
            test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see ENVIRONMENT DRIFT.');
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

        await test.step('Verify every link/card on the page navigates correctly', async () => {
            await verifyPageLinksNavigateCorrectly(page, config.href, { openPage, waitForAndAcceptCookieBanner, expect, test });
        });

        await test.step('Verify footer visibility', async () => {
            await verifyFooterVisible(page);
        });
    });
}

// ============================================================================
// Accordion functionality (Bootstrap-style accordion, same component used
// throughout this project - .accordion-item/.accordion-button/.accordion-collapse)
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

test('About Us - Accordion Functionality', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Partnerships page', async () => {
        await openPage(page, '/about-us/partnerships');
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
// sequence used across this project, verbatim)
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

test('About Us - YouTube Video Playback', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the About us page', async () => {
        await openPage(page, '/about-us');
    });

    await test.step('Play, fullscreen, exit fullscreen, and pause the video', async () => {
        const youTubeCount = await page.locator('iframe[src*="youtube"]').count();
        expect(youTubeCount, 'This page should expose at least one YouTube video').toBeGreaterThan(0);

        // Pin the exact iframe by its real src rather than re-querying ":visible" for every
        // interaction - same fix already needed elsewhere in this project when a page can
        // expose more than one YouTube iframe candidate.
        const videoSrc = await page.locator('iframe[src*="youtube"]:visible').first().getAttribute('src');
        const stableSelector = `iframe[src="${videoSrc}"]`;
        const visibleYouTube = page.locator(stableSelector).first();
        const videoFrame = page.frameLocator(stableSelector).first();
        await testYouTubeVideo(visibleYouTube, videoFrame, page);
    });
});

// ============================================================================
// "Contact our fundraising team" / "Contact our recruitment team" - same
// JotForm (250933318259966) already used by every other project spec,
// confirmed present on BOTH environments (not liveOnly here).
// ============================================================================
function contactModalFrame(page) {
    return page.frameLocator('iframe[src*="250933318259966"]').first();
}

async function openContactModal(page, cardText) {
    const card = page.locator('.card', { hasText: cardText });
    const sendMessageButton = card.locator('button[class*="lightbox-250933318259966"]');
    await sendMessageButton.scrollIntoViewIfNeeded();
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

function defineContactFormTests({ teamLabel, pageHref, cardText, counterKey, prefix }) {
    test(`About Us - ${teamLabel} Contact Form - Verify it is Present`, async ({ page }) => {
        await test.step(`Open ${pageHref}`, async () => {
            await openPage(page, pageHref);
        });

        await test.step('Open the contact modal', async () => {
            await openContactModal(page, cardText);
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

    test(`About Us - ${teamLabel} Contact Form - Validate When All Fields Empty`, async ({ page }) => {
        await test.step(`Open ${pageHref}`, async () => {
            await openPage(page, pageHref);
        });

        await test.step('Open the contact modal', async () => {
            await openContactModal(page, cardText);
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

    test(`About Us - ${teamLabel} Contact Form - Validate Partial Submission`, async ({ page }) => {
        await test.step(`Open ${pageHref}`, async () => {
            await openPage(page, pageHref);
        });

        await test.step('Open the contact modal', async () => {
            await openContactModal(page, cardText);
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

    test(`About Us - ${teamLabel} Contact Form - Validate Successful Submission`, async ({ page, baseURL }) => {
        test.skip(!isQaEnvironment(baseURL), 'Real form submissions must not be sent on Live - QA only, per project instruction.');
        test.setTimeout(60000);

        const submissionNumber = getCurrentSubmissionNumber(counterKey);

        await test.step(`Open ${pageHref}`, async () => {
            await openPage(page, pageHref);
        });

        await test.step('Open the contact modal', async () => {
            await openContactModal(page, cardText);
        });

        await test.step(`Fill and submit the form with unique submission #${submissionNumber}`, async () => {
            const frame = contactModalFrame(page);
            await frame.locator('#input_16').fill(`${prefix}${submissionNumber}`);
            await frame.locator('#input_17').fill(`Contact${submissionNumber}`);
            await frame.locator('#input_9').fill(`${prefix.toLowerCase()}.${submissionNumber}@example.com`);
            await frame.locator('#input_29').selectOption({ label: 'No' });
            await frame.locator('#input_11').fill(`${teamLabel} team enquiry test submission ${submissionNumber} - generated by automation.`);
            await frame.locator('label[for="input_27_0"]', { hasText: 'I agree' }).click();
            await submitContactModalForm(page);
        });

        await test.step('Verify a success acknowledgement appears', async () => {
            const frame = contactModalFrame(page);
            await expect(frame.getByText(/thank you|success|received/i).first(), 'A successful submission should show a thank-you/success acknowledgement').toBeVisible({ timeout: 20000 });
        });

        await test.step('Advance the submission counter', async () => {
            incrementSubmissionNumber(counterKey);
        });
    });
}

defineContactFormTests({
    teamLabel: 'Fundraising',
    pageHref: '/about-us/partnerships',
    cardText: 'Contact our fundraising team',
    counterKey: 'aboutus-fundraising-team',
    prefix: 'RSCAboutUsFundraising',
});

defineContactFormTests({
    teamLabel: 'Recruitment',
    pageHref: '/about-us/work-for-us',
    cardText: 'Contact our recruitment team',
    counterKey: 'aboutus-recruitment-team',
    prefix: 'RSCAboutUsRecruitment',
});
