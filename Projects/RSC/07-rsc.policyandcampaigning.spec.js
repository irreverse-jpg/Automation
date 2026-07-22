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
// Coverage notes - Policy and campaigning section (top nav "Policy and campaigning")
// ============================================================================
// Scope: every page under the "Policy and campaigning" mega-nav branch,
// discovered via direct DOM probing of the real meganav on both QA and Live
// (not guessed) - 8 top-level items, one ("Science culture") with 2 children.
// 10 unique pages total.
//
// Tests in this file:
//   1-10. Policy and Campaigning - <Page> Traversal (one per POLICY_PAGES entry)
//      Title/H1/breadcrumb/footer/card-count - the standard page-chrome check
//      used across every project's menu-item specs. The "Sustainability" page
//      is handled as its own dedicated test (see ENVIRONMENT DRIFT below)
//      rather than in the shared config loop, since its href AND H1 both
//      differ by environment, not just its H1.
//   11. Policy and Campaigning - Accordion Functionality
//      Expands/collapses a sample of the Bootstrap-style accordion on
//      /policy-and-campaigning/get-involved (13 real accordion items).
//   12. Policy and Campaigning - YouTube Video Playback
//      Plays/fullscreens/exits fullscreen/pauses a real YouTube embed on
//      /policy-and-campaigning/outreach, reusing the exact same MCC-derived
//      sequence already used in 06-rsc.publishing.spec.js. This page's video
//      lives inside a COLLAPSED accordion item ("Public attitudes to
//      chemistry") - confirmed via direct DOM probe that the iframe is
//      simply not visible/interactable until that accordion is expanded.
//   13. Policy and Campaigning - Education Team Contact Form - <journey>
//      "Contact our education team" (same JotForm as every other project
//      contact-team form, team=education) on /policy-and-campaigning/education
//      - confirmed Live-only (see ENVIRONMENT DRIFT below), gated via
//      test.skip() on element presence rather than a hardcoded environment
//      check, so it starts running for real the moment QA syncs it in.
//
// ENVIRONMENT DRIFT confirmed 2026-07-21 (same category as prior specs'
// Members'-Area/Journals/H1-wording findings):
//   - "Sustainability" is a genuinely different page per environment, not
//     just a relabelled link: Live is /policy-and-campaigning/sustainability
//     (H1 "Sustainability"), QA is
//     /policy-and-campaigning/environmental-sustainability (H1
//     "Environmental sustainability") - confirmed each URL 404s on the OTHER
//     environment, so this isn't a redirect/alias, it's two independently
//     content-managed pages. Handled with its own baseURL-conditional test
//     rather than forcing it into the shared PAGES loop.
//   - "Discovery and innovation" (menu label, both environments) has H1
//     "Discovery and innovation" on QA but "Research and innovation" on Live.
//   - "Resources and toolkits" (menu label, both environments) has H1
//     "Resources and toolkits" on QA but "Resources and toolkits to help you
//     promote inclusion" on Live.
//   - "Contact our education team" (a `.script--jotform`/lightbox card on
//     the Education page) exists on Live but is entirely absent from QA's
//     current build of that page - confirmed via direct probe, not a menu
//     visibility difference like the Membership spec's obituaries pattern,
//     since the Education PAGE itself exists on both environments, just
//     without this specific card on QA.
//   - The "sustainability" pages otherwise differ in card/accordion/video
//     counts too (independently authored content, not a content-sync gap)
//     - confirmed via direct probe, so no shared assertions are made about
//     its internal content beyond the standard page-chrome/footer checks.
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
// Traversal - every page in the Policy and campaigning mega-nav branch
// (except "Sustainability", handled separately below - see ENVIRONMENT DRIFT)
// ============================================================================
const POLICY_PAGES = [
    { testName: "Policy and Campaigning - Making the World a Better Place Traversal", href: "/policy-and-campaigning", h1: "Making the world a better place", breadcrumbParent: null },
    { testName: "Policy and Campaigning - Discovery and Innovation Traversal", href: "/policy-and-campaigning/discovery-and-innovation", h1: /^(Research and innovation|Discovery and innovation)$/, breadcrumbParent: null },
    { testName: "Policy and Campaigning - Science Culture Traversal", href: "/policy-and-campaigning/science-culture", h1: "Science culture", breadcrumbParent: null },
    { testName: "Policy and Campaigning - Resources and Toolkits Traversal", href: "/policy-and-campaigning/science-culture/resources-and-toolkits", h1: /^Resources and toolkits( to help you promote inclusion)?$/, breadcrumbParent: "Science culture" },
    { testName: "Policy and Campaigning - Activities and Collaborations Traversal", href: "/policy-and-campaigning/science-culture/activities-and-collaborations", h1: "Activities and collaborations", breadcrumbParent: "Science culture" },
    { testName: "Policy and Campaigning - Education Traversal", href: "/policy-and-campaigning/education", h1: "Education", breadcrumbParent: null },
    { testName: "Policy and Campaigning - Outreach Traversal", href: "/policy-and-campaigning/outreach", h1: "Get involved with public engagement and outreach", breadcrumbParent: null },
    { testName: "Policy and Campaigning - Get Involved Traversal", href: "/policy-and-campaigning/get-involved", h1: "Get involved", breadcrumbParent: null },
    { testName: "Policy and Campaigning - Policy Library Traversal", href: "/policy-and-campaigning/policy-library", h1: "Policy library", breadcrumbParent: null },
];

for (const config of POLICY_PAGES) {
    test(config.testName, async ({ page }) => {
        test.setTimeout(60000);

        await test.step(`Open ${config.href} and verify page chrome`, async () => {
            await openPage(page, config.href);
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

// "Sustainability"/"Environmental sustainability" - genuinely different page per environment
// (different URL, different H1, different content) - see ENVIRONMENT DRIFT above.
test('Policy and Campaigning - Sustainability Traversal', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    const href = isQaEnvironment(baseURL) ? '/policy-and-campaigning/environmental-sustainability' : '/policy-and-campaigning/sustainability';
    const h1 = isQaEnvironment(baseURL) ? 'Environmental sustainability' : 'Sustainability';

    await test.step(`Open ${href} and verify page chrome`, async () => {
        await openPage(page, href);
        await expectPageChrome(page, { h1, breadcrumbParent: null });
    });

    await test.step('Verify the page exposes at least one content card', async () => {
        const cardCount = await page.locator('.card').count();
        expect(cardCount, `${href} should expose at least one content card`).toBeGreaterThan(0);
    });

    await test.step('Verify footer visibility', async () => {
        await verifyFooterVisible(page);
    });
});

// ============================================================================
// Accordion functionality (Bootstrap-style accordion, same component as
// 06-rsc.publishing.spec.js's - .accordion-item/.accordion-button/.accordion-collapse)
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

test('Policy and Campaigning - Accordion Functionality', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Get involved page', async () => {
        await openPage(page, '/policy-and-campaigning/get-involved');
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
// sequence as 06-rsc.publishing.spec.js, verbatim)
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

test('Policy and Campaigning - YouTube Video Playback', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Outreach page', async () => {
        await openPage(page, '/policy-and-campaigning/outreach');
    });

    await test.step('Expand the accordion item containing the video ("Public attitudes to chemistry")', async () => {
        const accordionItem = page.locator('.accordion-item', { has: page.locator('iframe[src*="youtube"]') }).first();
        await accordionItem.locator('.accordion-button').first().click();
        await page.waitForTimeout(600);
    });

    await test.step('Play, fullscreen, exit fullscreen, and pause the video', async () => {
        const youTubeCount = await page.locator('iframe[src*="youtube"]').count();
        expect(youTubeCount, 'This page should expose at least one YouTube video').toBeGreaterThan(0);

        // Pin the exact iframe by its real src rather than re-querying ":visible" for every
        // interaction - confirmed necessary in 06-rsc.publishing.spec.js when a page has
        // multiple YouTube iframes; harmless (and kept for consistency) here where there's
        // only one.
        const videoSrc = await page.locator('iframe[src*="youtube"]:visible').first().getAttribute('src');
        const stableSelector = `iframe[src="${videoSrc}"]`;
        const visibleYouTube = page.locator(stableSelector).first();
        const videoFrame = page.frameLocator(stableSelector).first();
        await testYouTubeVideo(visibleYouTube, videoFrame, page);
    });
});

// ============================================================================
// "Contact our education team" - same JotForm (250933318259966) already used
// by 05-rsc-membership.spec.js and 06-rsc.publishing.spec.js, Live-only (see
// ENVIRONMENT DRIFT above).
// ============================================================================
function contactModalFrame(page) {
    return page.frameLocator('iframe[src*="250933318259966"]').first();
}

async function openEducationContactModal(page) {
    // The trigger button's label differs by environment: QA reads "Send message" (same as
    // every other project contact-team card), Live reads "Send us an email " - confirmed
    // 2026-07-21. Match on the shared lightbox trigger class instead of the button's text.
    const card = page.locator('.card', { hasText: 'Contact our education team' });
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

test('Policy and Campaigning - Education Team Contact Form - Verify it is Present', async ({ page }) => {
    const found = await test.step('Open Education and check for the "Contact our education team" card', async () => {
        await openPage(page, '/policy-and-campaigning/education');
        return await page.locator('.card', { hasText: 'Contact our education team' }).isVisible().catch(() => false);
    });
    test.skip(!found, 'The "Contact our education team" card does not exist yet on this environment - see ENVIRONMENT DRIFT.');

    await test.step('Open the contact modal', async () => {
        await openEducationContactModal(page);
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

test('Policy and Campaigning - Education Team Contact Form - Validate When All Fields Empty', async ({ page }) => {
    const found = await test.step('Open Education and check for the "Contact our education team" card', async () => {
        await openPage(page, '/policy-and-campaigning/education');
        return await page.locator('.card', { hasText: 'Contact our education team' }).isVisible().catch(() => false);
    });
    test.skip(!found, 'The "Contact our education team" card does not exist yet on this environment - see ENVIRONMENT DRIFT.');

    await test.step('Open the contact modal', async () => {
        await openEducationContactModal(page);
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

test('Policy and Campaigning - Education Team Contact Form - Validate Partial Submission', async ({ page }) => {
    const found = await test.step('Open Education and check for the "Contact our education team" card', async () => {
        await openPage(page, '/policy-and-campaigning/education');
        return await page.locator('.card', { hasText: 'Contact our education team' }).isVisible().catch(() => false);
    });
    test.skip(!found, 'The "Contact our education team" card does not exist yet on this environment - see ENVIRONMENT DRIFT.');

    await test.step('Open the contact modal', async () => {
        await openEducationContactModal(page);
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

test('Policy and Campaigning - Education Team Contact Form - Validate Successful Submission', async ({ page, baseURL }) => {
    test.skip(!isQaEnvironment(baseURL), 'Real form submissions must not be sent on Live - QA only, per project instruction.');
    test.setTimeout(60000);

    const found = await test.step('Open Education and check for the "Contact our education team" card', async () => {
        await openPage(page, '/policy-and-campaigning/education');
        return await page.locator('.card', { hasText: 'Contact our education team' }).isVisible().catch(() => false);
    });
    test.skip(!found, 'The "Contact our education team" card does not exist yet on this environment - see ENVIRONMENT DRIFT.');

    const counterKey = 'policy-education-team';
    const submissionNumber = getCurrentSubmissionNumber(counterKey);

    await test.step('Open the contact modal', async () => {
        await openEducationContactModal(page);
    });

    await test.step(`Fill and submit the form with unique submission #${submissionNumber}`, async () => {
        const frame = contactModalFrame(page);
        await frame.locator('#input_16').fill(`RSCPolicyEducation${submissionNumber}`);
        await frame.locator('#input_17').fill(`Contact${submissionNumber}`);
        await frame.locator('#input_9').fill(`rsc.policy.education.${submissionNumber}@example.com`);
        await frame.locator('#input_29').selectOption({ label: 'No' });
        await frame.locator('#input_11').fill(`Education team enquiry test submission ${submissionNumber} - generated by automation.`);
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
