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
// Coverage notes - Events and venue hire section (top nav "Events and venue hire")
// ============================================================================
// Scope: every page under the "Events and venue hire" mega-nav branch,
// discovered via direct DOM probing of the real meganav on both QA and Live
// (not guessed) - 12 unique Live pages under 2 top-level branches (Events,
// Venue hire).
//
// Tests in this file:
//   1-12. Events and Venue Hire - <Page> Traversal (one per EVENTS_PAGES entry)
//      Title/H1/breadcrumb/footer/card-count - the standard page-chrome check
//      used across every project's menu-item specs. 11 of the 12 are
//      liveOnly-gated (see STRUCTURAL DRIFT below); the root "Events" page
//      is NOT gated since a real (but unrelated) page exists at the same URL
//      on QA too - see the H1-drift note below instead.
//   13. Events and Venue Hire - Accordion Functionality
//      Expands/collapses the real Bootstrap-style accordion on
//      /events/submit-an-event (4 real items - the richest accordion page
//      found in this section; much smaller than other sections' accordion
//      pages, so the "large number of items" threshold used elsewhere is
//      relaxed here).
//   14. Events and Venue Hire - YouTube Video Playback
//      Plays/fullscreens/exits fullscreen/pauses a real YouTube embed on
//      /venue-hire/our-rooms (6 real room-tour videos - confirmed NOT hidden
//      behind that page's one accordion item, which is an unrelated
//      "Room capacities" table). liveOnly (see STRUCTURAL DRIFT below).
//   15. Events and Venue Hire - Events Team Contact Form - <journey>
//      "Contact our events team" (same JotForm as every other project
//      contact-team form, team=events) on /events/event-support-and-guidance
//      - liveOnly, gated the same way as the rest of this branch since the
//      page itself doesn't exist on QA.
//
// STRUCTURAL DRIFT confirmed 2026-07-23 (the most extensive drift found in
// this project so far - not a few pages differing, but almost the entire
// branch): Live's current content lives under /events/* and /venue-hire/*
// (12 pages total, discovered via direct DOM probe of Live's real meganav).
// QA's meganav for this exact same top-level item ("Events and venue hire")
// instead points at an entirely different, differently-structured branch
// under /our-events/* - 17 pages covering different sub-topics entirely
// (an "Our events"/webinars branch with RSC Desktop Seminars/Science Camp
// webinars, and a MUCH deeper "Venue hire" branch with 12 venue-hire-by-
// occasion pages - weddings/product launches/private dining/networking/
// meetings and AGMs/filming/conferences/celebrations/award ceremonies - none
// of which exist on Live's current, much leaner Venue hire section).
// Confirmed (not guessed) that Live has since migrated off the /our-events/*
// URL structure entirely: https://www.rsc.org/our-events and
// https://www.rsc.org/our-events/venue-hire both 301-redirect to /events and
// /venue-hire respectively. Per this project's "build to current Live
// content" convention (same as Publishing's/Standards and recognition's
// Live-only pages), every page in EVENTS_PAGES is built from Live's current
// structure and gated liveOnly via a real page.goto() + response.status()
// === 404 check - confirmed all 11 non-root URLs genuinely 404 on QA (not
// simply unlinked from QA's nav - the URLs themselves don't resolve there).
//
// ONE EXCEPTION, not gated liveOnly: https://[qa]/events itself returns a
// real 200 with GENUINELY DIFFERENT, unrelated content (H1 "Events" - an
// events-listing/search page with its own real cards) rather than 404 -
// confirmed via direct probe this is NOT the section's actual overview page
// on QA (that lives at /our-events, H1 "Events overview"), just a
// coincidentally-identical URL slug pointing at something else entirely.
// Handled the same way as this project's other H1-content-drift findings -
// a regex accepting either wording - rather than a liveOnly skip, since a
// real, valid page genuinely exists at this URL on both environments (they
// just serve unrelated content).
//
// "Contact our events team" (team=events) - same JotForm 250933318259966
// pattern as Membership/Publishing/Policy and campaigning's contact-team
// cards - was confirmed present on 4 different Live pages under /events/*
// (Find an event, UK and Ireland events, Member network events, Event
// support and guidance) but is clearly a single shared sidebar widget
// repeated across them, not 4 distinct forms - tested once here on Event
// support and guidance, matching this project's one-form-per-team
// convention. Confirmed absent on QA's equivalent /our-events/support-for-
// events page (not simply hidden), so gated the same liveOnly way as the
// rest of this branch (via the hosting page's own 404 check) rather than
// Policy and campaigning's element-presence gate, since here the whole page
// is unavailable, not just the card.
//
// NOTE: "Events Team Contact Form - Validate Successful Submission" will
// currently ALWAYS skip on both environments - it requires QA (real
// submissions must not be sent on Live, per project instruction) AND
// requires the hosting page to exist (only exists on Live, per the
// liveOnly gate above). This is an expected, real consequence of the
// structural drift above, not an oversight - it will start running for
// real the moment QA's content syncs to Live's current structure.
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
// Traversal - every page in the Events and venue hire mega-nav branch (built
// from Live's current structure - see STRUCTURAL DRIFT above)
// ============================================================================
const EVENTS_PAGES = [
    // Not liveOnly - a real, different page exists at this same URL on QA too (see above).
    { testName: "Events and Venue Hire - Events Overview Traversal", href: "/events", h1: /^(Events overview|Events)$/, breadcrumbParent: null },
    { testName: "Events and Venue Hire - Find an Event Traversal", href: "/events/find-an-event", h1: "Find an event", breadcrumbParent: "Events", liveOnly: true },
    { testName: "Events and Venue Hire - UK and Ireland Events Traversal", href: "/events/find-an-event/uk-and-ireland-events", h1: "UK and Ireland events", breadcrumbParent: "Find an event", liveOnly: true },
    { testName: "Events and Venue Hire - Member Network Events Traversal", href: "/events/find-an-event/member-network-events", h1: "Member network events", breadcrumbParent: "Find an event", liveOnly: true },
    { testName: "Events and Venue Hire - Events by Topic Traversal", href: "/events/find-an-event/events-by-topic", h1: "Events by topic", breadcrumbParent: "Find an event", liveOnly: true },
    { testName: "Events and Venue Hire - Submit an Event Traversal", href: "/events/submit-an-event", h1: "Submit an event", breadcrumbParent: "Events", liveOnly: true },
    { testName: "Events and Venue Hire - Event Support and Guidance Traversal", href: "/events/event-support-and-guidance", h1: "Event support and guidance", breadcrumbParent: "Events", liveOnly: true },
    { testName: "Events and Venue Hire - Venue Hire Traversal", href: "/venue-hire", h1: "The Royal Society of Chemistry at Burlington House", breadcrumbParent: null, liveOnly: true },
    { testName: "Events and Venue Hire - Our Rooms Traversal", href: "/venue-hire/our-rooms", h1: "Our rooms", breadcrumbParent: "Venue hire", liveOnly: true },
    { testName: "Events and Venue Hire - Event Ideas Traversal", href: "/venue-hire/event-ideas", h1: "Event ideas", breadcrumbParent: "Venue hire", liveOnly: true },
    { testName: "Events and Venue Hire - Catering Traversal", href: "/venue-hire/catering", h1: "Catering", breadcrumbParent: "Venue hire", liveOnly: true },
    { testName: "Events and Venue Hire - Enquiries and Visits Traversal", href: "/venue-hire/enquiries-and-visits", h1: "Contact our venue hire team", breadcrumbParent: "Venue hire", liveOnly: true },
];

for (const config of EVENTS_PAGES) {
    test(config.testName, async ({ page }) => {
        // The full link/card click-through check (verifyPageLinksNavigateCorrectly) can
        // involve dozens of individual navigations on content-heavy pages - bumped generously
        // here to match the convention already applied across every other spec in this project.
        test.setTimeout(600000);

        if (config.liveOnly) {
            const response = await test.step(`Open ${config.href} and check it exists on this environment`, async () => {
                return openPage(page, config.href);
            });
            test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see STRUCTURAL DRIFT.');
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
// Accordion functionality (Bootstrap-style accordion, same component used in
// 06/07/08's specs - .accordion-item/.accordion-button/.accordion-collapse)
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

test('Events and Venue Hire - Accordion Functionality', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    const response = await test.step('Open the Submit an event page', async () => {
        return openPage(page, '/events/submit-an-event');
    });
    test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see STRUCTURAL DRIFT.');

    await test.step('Verify a sample of the real accordion items expand/collapse correctly', async () => {
        const items = page.locator('.accordion-item');
        const count = await items.count();
        // This section's richest accordion page only has 4 real items (much smaller than
        // Publishing/Standards and recognition's 20-40+ item pages) - relaxed threshold
        // accordingly rather than reusing the ">10" convention used elsewhere.
        expect(count, 'This page should expose a handful of real accordion items').toBeGreaterThan(2);

        const indexesToCheck = new Set([0, count - 1, Math.floor(count / 2)]);
        for (const index of indexesToCheck) {
            await toggleBootstrapAccordionAndVerify(items.nth(index), `Accordion item #${index + 1}`);
        }
    });
});

// ============================================================================
// YouTube video playback (reuses the same ytm-skin play/fullscreen/pause
// sequence as 06/07's specs, verbatim)
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

test('Events and Venue Hire - YouTube Video Playback', async ({ page }) => {
    test.setTimeout(90000);

    const response = await test.step('Open the Our rooms page', async () => {
        return openPage(page, '/venue-hire/our-rooms');
    });
    test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see STRUCTURAL DRIFT.');

    await test.step('Play, fullscreen, exit fullscreen, and pause a video', async () => {
        const youTubeCount = await page.locator('iframe[src*="youtube"]').count();
        expect(youTubeCount, 'This page should expose at least one YouTube video').toBeGreaterThan(0);

        // Pin the exact iframe by its real src rather than re-querying ":visible" for every
        // interaction - this page has 6 YouTube iframes (one per room), so re-querying
        // ":visible" after the fullscreen enter/exit dance risks resolving to a different
        // iframe than the one actually played, same fix already needed in
        // 06-rsc.publishing.spec.js's video test.
        const videoSrc = await page.locator('iframe[src*="youtube"]:visible').first().getAttribute('src');
        const stableSelector = `iframe[src="${videoSrc}"]`;
        const visibleYouTube = page.locator(stableSelector).first();
        const videoFrame = page.frameLocator(stableSelector).first();
        await testYouTubeVideo(visibleYouTube, videoFrame, page);
    });
});

// ============================================================================
// "Contact our events team" - same JotForm (250933318259966) already used by
// every other project spec, liveOnly (see STRUCTURAL DRIFT above).
// ============================================================================
function contactModalFrame(page) {
    return page.frameLocator('iframe[src*="250933318259966"]').first();
}

async function openEventsContactModal(page) {
    const card = page.locator('.card', { hasText: 'Contact our events team' });
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

test('Events and Venue Hire - Events Team Contact Form - Verify it is Present', async ({ page }) => {
    const response = await test.step('Open Event support and guidance', async () => {
        return openPage(page, '/events/event-support-and-guidance');
    });
    test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see STRUCTURAL DRIFT.');

    await test.step('Open the contact modal', async () => {
        await openEventsContactModal(page);
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

test('Events and Venue Hire - Events Team Contact Form - Validate When All Fields Empty', async ({ page }) => {
    const response = await test.step('Open Event support and guidance', async () => {
        return openPage(page, '/events/event-support-and-guidance');
    });
    test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see STRUCTURAL DRIFT.');

    await test.step('Open the contact modal', async () => {
        await openEventsContactModal(page);
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

test('Events and Venue Hire - Events Team Contact Form - Validate Partial Submission', async ({ page }) => {
    const response = await test.step('Open Event support and guidance', async () => {
        return openPage(page, '/events/event-support-and-guidance');
    });
    test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see STRUCTURAL DRIFT.');

    await test.step('Open the contact modal', async () => {
        await openEventsContactModal(page);
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

test('Events and Venue Hire - Events Team Contact Form - Validate Successful Submission', async ({ page, baseURL }) => {
    test.skip(!isQaEnvironment(baseURL), 'Real form submissions must not be sent on Live - QA only, per project instruction.');
    test.setTimeout(60000);

    const response = await test.step('Open Event support and guidance', async () => {
        return openPage(page, '/events/event-support-and-guidance');
    });
    test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see STRUCTURAL DRIFT.');

    const counterKey = 'events-support-team';
    const submissionNumber = getCurrentSubmissionNumber(counterKey);

    await test.step('Open the contact modal', async () => {
        await openEventsContactModal(page);
    });

    await test.step(`Fill and submit the form with unique submission #${submissionNumber}`, async () => {
        const frame = contactModalFrame(page);
        await frame.locator('#input_16').fill(`RSCEventsSupport${submissionNumber}`);
        await frame.locator('#input_17').fill(`Contact${submissionNumber}`);
        await frame.locator('#input_9').fill(`rsc.events.support.${submissionNumber}@example.com`);
        await frame.locator('#input_29').selectOption({ label: 'No' });
        await frame.locator('#input_11').fill(`Events team enquiry test submission ${submissionNumber} - generated by automation.`);
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
