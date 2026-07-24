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
// Coverage notes - the footer's "Contact us" link column
// ============================================================================
// Scope: every page/link listed under the footer's "Contact us" column
// (discovered via direct DOM probing of the real footer on both QA and
// Live, not guessed) - internal RSC pages get the standard deep page-chrome
// treatment (same as every other spec in this project); the 2 links that
// point straight at a standalone forms.rsc.org page (not an RSC page at
// all) get a lighter, purpose-built check instead (see KEY MECHANICS).
//
// Tests in this file:
//   1-5. Contact Us - <Page> Traversal (one per CONTACTUS_PAGES entry)
//      Title/H1/breadcrumb/footer/card-count/link-navigation-check - the
//      standard page-chrome check used across every spec in this project.
//      "Follow us" and the "Press Office" JotForm link are liveOnly (see
//      ENVIRONMENT DRIFT below). "Venue hire" intentionally reuses the
//      exact same page already deeply covered by
//      10-rsc.eventsandvenuehire.spec.js's "Enquiries and Visits Traversal"
//      - included here too only for footer-column completeness, per
//      explicit project instruction to cover every link in this column.
//   6. Contact Us - Press Office Form Page (liveOnly)
//      Confirms the "Press Office" footer link lands on a real, valid
//      standalone forms.rsc.org page (not embedded as an RSC-page modal,
//      unlike every other JotForm contact-team card in this project) with
//      the expected H1 and a visible First name field. Does not submit -
//      out of scope, this is a different, unfamiliar standalone form
//      layout rather than the well-understood modal pattern used
//      elsewhere.
//   7. Contact Us - Make a Complaint Form Page
//      Same lighter check as above for "Make a complaint" - present on
//      both environments, a DIFFERENT JotForm (251053796870969) from every
//      other contact-team form in this project.
//   8. Contact Us - YouTube Video Playback
//      Plays/fullscreens/exits fullscreen/pauses a real YouTube embed on
//      /contact-us/advertise (2 real videos).
//   9. Contact Us - Advertising Team Contact Form - <journey>
//      "Contact our advertising team" (team=advertising) on
//      /contact-us/advertise - a new team not seen in any other spec,
//      confirmed present on both environments, reusing the same JotForm
//      250933318259966 modal pattern as every other contact-team form.
//
// No accordion test in this file - confirmed via direct probe across all 5
// pages that none of them embed a Bootstrap accordion.
//
// NOT covered here (already tested elsewhere, not duplicated):
//   - "Contact the library at Burlington House" (team=library) appears as a
//     card on /contact-us/library too, but it's the exact same JotForm
//     card already fully tested by 06-rsc.publishing.spec.js at
//     /publishing/product-information/library-catalogue - not repeated
//     here.
//   - "Download our media kit" on /contact-us/advertise is a DIFFERENT,
//     unrelated JotForm (251124362977965, empty team query string) - a
//     lead-capture/document-download gate rather than a "contact a team"
//     card. Judged out of scope for this pass (an unfamiliar one-off form
//     layout, not this project's established contact-team pattern) -
//     confirmed present via direct probe, not otherwise exercised.
//
// KEY MECHANICS confirmed 2026-07-24:
//   - "Press Office" and "Make a complaint" are the first footer/contact
//     links in this whole project that navigate straight to a standalone
//     forms.rsc.org page rather than opening a modal on an RSC page - that
//     page has NO RSC header/footer/breadcrumb at all (it's JotForm's own
//     generic page chrome), but it DOES expose a real `<h1 class="form-
//     header">` matching the form's title, so the same `page.locator('h1')`
//     check works - just without the breadcrumb/footer/card/link-navigation
//     checks that apply to actual RSC pages.
//
// ENVIRONMENT DRIFT confirmed 2026-07-24 (same category as this project's
// other content-drift findings):
//   - Live's "Contact us" footer column has 2 links QA's doesn't: "Press
//     Office" (the forms.rsc.org link above) and "Follow us"
//     (-> /follow-us) - confirmed via direct probe both are genuinely
//     absent on QA (Follow us's URL 404s; Press Office's underlying
//     ?team=pressoffice query simply isn't offered as a footer link on QA,
//     though the shared JotForm itself still exists).
//   - The Library page's H1 differs: QA "Contact the Library or book a
//     visit", Live "Contact or visit the library" - same content-drift
//     category as every other spec's H1 findings, handled with a regex.
//   - "Venue hire" resolves to a different path per environment (already
//     documented in 03-rsc.footer.spec.js and 10-rsc.eventsandvenuehire.
//     spec.js) - QA: /our-events/venue-hire/enquiries-and-visits, Live:
//     /venue-hire/enquiries-and-visits.
//   - The "Contact our advertising team" card's own VISIBLE heading differs
//     by environment (Live: "Contact our advertising team", QA: "Contact
//     us to discuss your advertising goals") and its trigger button's
//     visible label differs too (Live: "Send us an email", QA likely
//     "Send message") - confirmed via direct probe. The button's
//     `data-title="Contact our advertising team"` attribute is stable on
//     both, so the modal-opening helper matches on that instead of the
//     card's visible text or the button's visible label.
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
// Traversal - the internal RSC pages in the footer's "Contact us" column
// ============================================================================
const CONTACTUS_PAGES = [
    { testName: "Contact Us - Contact Us Traversal", href: "/contact-us", h1: "Contact us", breadcrumbParent: null },
    { testName: "Contact Us - Offices Traversal", href: "/contact-us/offices", h1: "Offices", breadcrumbParent: "Contact us" },
    { testName: "Contact Us - Library Traversal", href: "/contact-us/library", h1: /^Contact (or visit the library|the Library or book a visit)$/, breadcrumbParent: "Contact us" },
    { testName: "Contact Us - Advertise Traversal", href: "/contact-us/advertise", h1: "Advertise with us", breadcrumbParent: "Contact us" },
    // Live-only (see ENVIRONMENT DRIFT above) - gated via a real 404 check.
    { testName: "Contact Us - Follow Us Traversal", href: "/follow-us", h1: "RSC official social media accounts", breadcrumbParent: null, liveOnly: true },
];

for (const config of CONTACTUS_PAGES) {
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

// "Venue hire" - already deeply covered by 10-rsc.eventsandvenuehire.spec.js's own
// "Enquiries and Visits Traversal" (same underlying page, same environment-specific href) -
// included here too only for footer-column completeness, per explicit project instruction.
test('Contact Us - Venue Hire Traversal', async ({ page, baseURL }) => {
    test.setTimeout(600000);

    const href = isQaEnvironment(baseURL) ? '/our-events/venue-hire/enquiries-and-visits' : '/venue-hire/enquiries-and-visits';

    await test.step(`Open ${href} and verify page chrome`, async () => {
        await openPage(page, href);
        await expectPageChrome(page, { h1: 'Contact our venue hire team', breadcrumbParent: 'Venue hire' });
    });

    await test.step('Verify the page exposes at least one content card', async () => {
        const cardCount = await page.locator('.card').count();
        expect(cardCount, `${href} should expose at least one content card`).toBeGreaterThan(0);
    });

    await test.step('Verify every link/card on the page navigates correctly', async () => {
        await verifyPageLinksNavigateCorrectly(page, href, { openPage, waitForAndAcceptCookieBanner, expect, test });
    });

    await test.step('Verify footer visibility', async () => {
        await verifyFooterVisible(page);
    });
});

// ============================================================================
// Standalone forms.rsc.org pages ("Press Office", "Make a complaint") - not
// embedded as an RSC-page modal like every other contact-team card in this
// project (see KEY MECHANICS above). Presence/H1/first-name-field only - no
// submission attempted, an unfamiliar one-off form layout for each.
// ============================================================================
async function openExternalFormPage(page, url) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    return response;
}

test('Contact Us - Press Office Form Page', async ({ page, baseURL }) => {
    // Confirmed via direct probe: this footer link only exists on Live - see ENVIRONMENT DRIFT.
    test.skip(isQaEnvironment(baseURL), 'The "Press Office" footer link does not exist on QA - see ENVIRONMENT DRIFT.');

    await test.step('Open the Press Office JotForm page', async () => {
        await openExternalFormPage(page, 'https://forms.rsc.org/250933318259966?team=pressoffice');
    });

    await test.step('Verify the form page loads with the expected heading and a First name field', async () => {
        await expect(page.locator('h1').first(), 'The Press Office form should show a "Contact us" heading').toHaveText('Contact us');
        await expect(page.locator('#input_16'), 'The form should expose a visible First name field').toBeVisible();
    });
});

test('Contact Us - Make a Complaint Form Page', async ({ page }) => {
    await test.step('Open the Make a Complaint JotForm page', async () => {
        await openExternalFormPage(page, 'https://forms.rsc.org/251053796870969?team=commentsandcomplaints');
    });

    await test.step('Verify the form page loads with the expected heading and a First name field', async () => {
        await expect(page.locator('h1').first(), 'The Make a Complaint form should show a "Comments and complaints" heading').toHaveText('Comments and complaints');
        await expect(page.locator('#input_16'), 'The form should expose a visible First name field').toBeVisible();
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

test('Contact Us - YouTube Video Playback', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Advertise page', async () => {
        await openPage(page, '/contact-us/advertise');
    });

    await test.step('Play, fullscreen, exit fullscreen, and pause a video', async () => {
        const youTubeCount = await page.locator('iframe[src*="youtube"]').count();
        expect(youTubeCount, 'This page should expose at least one YouTube video').toBeGreaterThan(0);

        // Pin the exact iframe by its real src rather than re-querying ":visible" for every
        // interaction - this page has 2 YouTube iframes, same fix already needed elsewhere in
        // this project when a page can expose more than one video candidate.
        const videoSrc = await page.locator('iframe[src*="youtube"]:visible').first().getAttribute('src');
        const stableSelector = `iframe[src="${videoSrc}"]`;
        const visibleYouTube = page.locator(stableSelector).first();
        const videoFrame = page.frameLocator(stableSelector).first();
        await testYouTubeVideo(visibleYouTube, videoFrame, page);
    });
});

// ============================================================================
// "Contact our advertising team" - same JotForm (250933318259966) already
// used by every other project spec, confirmed present on BOTH environments.
// ============================================================================
function contactModalFrame(page) {
    return page.frameLocator('iframe[src*="250933318259966"]').first();
}

async function openAdvertisingContactModal(page) {
    // The card's own visible heading differs by environment (Live: "Contact our advertising
    // team", QA: "Contact us to discuss your advertising goals") - confirmed via direct probe.
    // The trigger button's data-title attribute is stable on both, so match on that instead of
    // the card's visible text (same lesson already applied to Policy and campaigning's
    // education contact card, which matches on the shared lightbox class for a similar reason).
    const sendMessageButton = page.locator('button[data-title="Contact our advertising team"]').first();
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

test('Contact Us - Advertising Team Contact Form - Verify it is Present', async ({ page }) => {
    await test.step('Open Advertise', async () => {
        await openPage(page, '/contact-us/advertise');
    });

    await test.step('Open the contact modal', async () => {
        await openAdvertisingContactModal(page);
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

test('Contact Us - Advertising Team Contact Form - Validate When All Fields Empty', async ({ page }) => {
    await test.step('Open Advertise', async () => {
        await openPage(page, '/contact-us/advertise');
    });

    await test.step('Open the contact modal', async () => {
        await openAdvertisingContactModal(page);
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

test('Contact Us - Advertising Team Contact Form - Validate Partial Submission', async ({ page }) => {
    await test.step('Open Advertise', async () => {
        await openPage(page, '/contact-us/advertise');
    });

    await test.step('Open the contact modal', async () => {
        await openAdvertisingContactModal(page);
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

test('Contact Us - Advertising Team Contact Form - Validate Successful Submission', async ({ page, baseURL }) => {
    test.skip(!isQaEnvironment(baseURL), 'Real form submissions must not be sent on Live - QA only, per project instruction.');
    test.setTimeout(60000);

    const counterKey = 'contactus-advertising-team';
    const submissionNumber = getCurrentSubmissionNumber(counterKey);

    await test.step('Open Advertise', async () => {
        await openPage(page, '/contact-us/advertise');
    });

    await test.step('Open the contact modal', async () => {
        await openAdvertisingContactModal(page);
    });

    await test.step(`Fill and submit the form with unique submission #${submissionNumber}`, async () => {
        const frame = contactModalFrame(page);
        await frame.locator('#input_16').fill(`RSCContactUsAdvertising${submissionNumber}`);
        await frame.locator('#input_17').fill(`Contact${submissionNumber}`);
        await frame.locator('#input_9').fill(`rsc.contactus.advertising.${submissionNumber}@example.com`);
        await frame.locator('#input_29').selectOption({ label: 'No' });
        await frame.locator('#input_11').fill(`Advertising team enquiry test submission ${submissionNumber} - generated by automation.`);
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
