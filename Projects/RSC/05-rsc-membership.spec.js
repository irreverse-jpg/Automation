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
// Coverage notes - Membership section (top nav "Membership")
// ============================================================================
// Scope: every page under the "Membership" mega-nav branch - Join us
// (/membership, including its embedded "Which membership is right for
// you?" recommendation wizard and "Contact our membership team" modal
// form), Membership categories and its 6 category pages, Benefits and its
// "Community and networking" sub-page, Member stories, Regulations, and
// (Live-only) Member obituaries.
//
// Tests in this file:
//   1-12. Membership - <Page> Traversal (one per MEMBERSHIP_PAGES entry)
//      Title, H1, breadcrumb trail, and footer visibility for every page
//      in the section - the standard page-chrome check used across every
//      project's menu-item specs.
//   13. Membership - Which Membership Is Right For You
//      Drives the embedded JotForm wizard (iframe, form 250921865332962)
//      through its progressive 3-question flow, confirms the recommendation,
//      "Apply now"/"Find out more" links, and "Start again" reset, and
//      documents a real UX finding around the empty-field validation
//      message (see KNOWN ISSUE below). Runs the full flow twice with
//      different answers so two distinct recommendations are exercised.
//   14-17. Membership - Contact Form - <journey>
//      The "Contact our membership team" modal (JotForm iframe, form
//      250933318259966) - present, blank, partial, and a full submission
//      using the shared submissionCounter.js/submission-counter.txt
//      mechanism (counter key 'membership-contact-team'). The full
//      submission is QA-only per project instruction - see LIVE SUBMISSION
//      GATING below.
//   18-19. Membership - Member Obituaries Traversal / Pagination and Sort
//      /news/obituaries - present on Live, absent from QA's current nav
//      (see OBITUARIES ENVIRONMENT NOTE below) - built now so it's ready
//      once QA/Live content sync adds it.
//
// KEY MECHANICS confirmed 2026-07-21:
//   - The "Which membership is right for you?" wizard and the "Contact our
//     membership team" modal are both separate JotForm-hosted iframes
//     (forms.rsc.org), not same-origin markup - every interaction with
//     their fields goes through page.frameLocator(), not page.locator().
//   - The wizard's 2nd and 3rd question <select>s (`#input_5`, `#input_6`)
//     are present in the DOM from page load but hidden until the previous
//     question gets a real answer - a progressive reveal, not a paginated
//     multi-step form.
//   - "Apply now" and "Find out more" are real target="_blank" links, not
//     buttons - "Apply now" goes to members.rsc.org's SSO/login flow,
//     "Find out more" goes to the matching /membership/membership-categories
//     page WITH a `?formlink=membership_wizard` referral param (confirmed
//     this Find-out-more link points at www.rsc.org even when the wizard is
//     served from QA - it's an intentional cross-environment referral, not
//     a bug). "Start again" is an <a>, not a button, and fully resets the
//     wizard back to question 1 with no pre-filled value.
//   - The modal's "Are you a member of the RSC?" dropdown reveals a 4th,
//     conditionally-required field ("Please enter your six-digit membership
//     number") only when answered "Yes".
//   - Neither JotForm iframe has a reCAPTCHA - both run fully unattended.
//
// KNOWN ISSUE (reported, not independently reproducible via bounding-rect
// checks - documented rather than hard-asserted): clicking the wizard's
// first dropdown open (its native OS option list) and then clicking
// elsewhere without selecting anything triggers "This field is required."
// validation that visually covers part of the dropdown's area, per direct
// manual observation. A native <select>'s open option list is rendered by
// the OS/browser chrome outside the page's DOM, so it can't be measured
// with getBoundingClientRect() the way an in-page overlay could - repeated
// probes of the post-blur DOM layout found no measurable overlap. This test
// reproduces the blur-validation trigger and attaches a screenshot for
// manual visual confirmation rather than asserting a specific pixel result.
//
// LIVE SUBMISSION GATING: per project instruction, the "Validate Successful
// Submission" test for the Contact Form (and the wizard's 2 full
// recommendation runs, which don't submit any persisted/CRM data - they're
// a client-side wizard, not a lead-capture form) all run on both
// environments EXCEPT the Contact Form's real submit, which is skipped on
// Live via `test.skip(!isQaEnvironment(baseURL), ...)` - validation
// coverage (blank/partial) still runs on both.
//
// OBITUARIES ENVIRONMENT NOTE: "Member obituaries" (/news/obituaries) is
// present in Live's Membership mega-nav but absent from QA's as of
// 2026-07-21 (confirmed via direct meganav comparison) - QA-run tests for
// this page are skipped via `test.skip(!found, ...)`, matching the
// convention already used for environment-gated page existence in this
// project's meganav spec and in sibling projects (e.g. MCC's
// `runMCCPageTraversal`).
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
// Traversal - every page in the Membership mega-nav branch
// ============================================================================
const MEMBERSHIP_PAGES = [
    { testName: 'Membership - Join Us Traversal', path: '/membership', h1: 'Join us', breadcrumbParent: null },
    { testName: 'Membership - Membership Categories Traversal', path: '/membership/membership-categories', h1: 'Membership categories', breadcrumbParent: 'Membership' },
    { testName: 'Membership - Student Member Traversal', path: '/membership/membership-categories/student-member', h1: 'Undergraduate student member', breadcrumbParent: 'Membership categories' },
    { testName: 'Membership - Affiliate Traversal', path: '/membership/membership-categories/affiliate-member', h1: 'Affiliate', breadcrumbParent: 'Membership categories' },
    { testName: 'Membership - Apprentice Traversal', path: '/membership/membership-categories/apprentice', h1: 'Apprentice', breadcrumbParent: 'Membership categories' },
    { testName: 'Membership - Associate Traversal', path: '/membership/membership-categories/associate-member', h1: 'Associate member (AMRSC)', breadcrumbParent: 'Membership categories' },
    { testName: 'Membership - Member Traversal', path: '/membership/membership-categories/member', h1: 'Member (MRSC)', breadcrumbParent: 'Membership categories' },
    { testName: 'Membership - Fellow Traversal', path: '/membership/membership-categories/fellow', h1: 'Fellow (FRSC)', breadcrumbParent: 'Membership categories' },
    { testName: 'Membership - Benefits Traversal', path: '/membership/benefits', h1: 'Benefits at a glance', breadcrumbParent: 'Membership' },
    { testName: 'Membership - Community and Networking Traversal', path: '/membership/benefits/community-and-networking', h1: 'Community and networking', breadcrumbParent: 'Benefits' },
    { testName: 'Membership - Member Stories Traversal', path: '/membership/member-stories', h1: 'Member stories', breadcrumbParent: 'Membership' },
    { testName: 'Membership - Regulations Traversal', path: '/membership/membership-regulations', h1: 'Membership regulations', breadcrumbParent: 'Membership' },
];

for (const config of MEMBERSHIP_PAGES) {
    test(config.testName, async ({ page }) => {
        test.setTimeout(60000);

        await test.step(`Open ${config.path} and verify page chrome`, async () => {
            await openPage(page, config.path);
            await expectPageChrome(page, { h1: config.h1, breadcrumbParent: config.breadcrumbParent });
        });

        await test.step('Verify the page exposes at least one content card', async () => {
            const cardCount = await page.locator('.card').count();
            expect(cardCount, `${config.path} should expose at least one content card`).toBeGreaterThan(0);
        });

        await test.step('Verify footer visibility', async () => {
            await verifyFooterVisible(page);
        });
    });
}

// ============================================================================
// "Which membership is right for you?" wizard
// ============================================================================
function membershipWizardFrame(page) {
    return page.frameLocator('iframe[src*="forms.rsc.org"]').first();
}

async function answerWizardQuestion(frame, locator, label) {
    await frame.locator(locator).selectOption({ label });
}

// Not every answer combination leads to the same 3-question depth - confirmed 2026-07-21:
// (1) "an undergraduate student" (and "an apprentice") as the 1st answer skip straight to an
// enabled "Find my membership" button with q5/q6 never revealed; (2) even among roles that DO
// reveal q5, only answering q5 with "Chemical science" reveals q6 - "A science subject outside
// of chemical science"/"A subject outside of science" both stop at q5. Both entries below are
// confirmed to reveal the full 3-question flow, differing only in role/career stage so this
// test still exercises the progressive-reveal mechanic twice with genuinely different answers.
const WIZARD_ANSWER_SETS = [
    { role: 'working in industry', experience: 'Chemical science', careerStage: 'building on my career (3+ years experience)' },
    { role: 'working in academia', experience: 'Chemical science', careerStage: 'at the very beginning of my career (first 3 years)' },
];

test('Membership - Which Membership Is Right For You', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Open the Join us page', async () => {
        await openPage(page, '/membership');
    });

    await test.step('KNOWN ISSUE: leaving the first question blank and clicking elsewhere triggers a validation message near the dropdown', async () => {
        const frame = membershipWizardFrame(page);
        const roleSelect = frame.locator('#input_3');
        await roleSelect.click();
        await page.locator('h1').first().click({ position: { x: 0, y: 0 } }).catch(() => { });
        await expect(frame.getByText('This field is required.').first(), 'Blurring the empty "I am" dropdown should surface a required-field validation message').toBeVisible();
        await page.screenshot({ path: 'test-results/membership-wizard-validation-known-issue.png' }).catch(() => { });
    });

    for (const [index, answers] of WIZARD_ANSWER_SETS.entries()) {
        await test.step(`Complete the wizard with answer set ${index + 1} and confirm a recommendation appears`, async () => {
            const frame = membershipWizardFrame(page);

            await answerWizardQuestion(frame, '#input_3', answers.role);
            await expect(frame.locator('#input_5'), 'Answering the 1st question should reveal the 2nd').toBeVisible({ timeout: 10000 });

            await answerWizardQuestion(frame, '#input_5', answers.experience);
            await expect(frame.locator('#input_6'), 'Answering the 2nd question should reveal the 3rd').toBeVisible({ timeout: 10000 });

            await answerWizardQuestion(frame, '#input_6', answers.careerStage);

            const findMyMembershipButton = frame.getByRole('button', { name: /find my membership/i });
            await expect(findMyMembershipButton, 'The "Find my membership" button should be enabled once all 3 questions are answered').toBeEnabled();
            await findMyMembershipButton.click();

            const applyNowLink = frame.getByRole('link', { name: /apply now/i });
            const findOutMoreLink = frame.getByRole('link', { name: /find out more/i });
            await expect(applyNowLink, 'The recommendation should show an "Apply now" link').toBeVisible({ timeout: 10000 });
            await expect(findOutMoreLink, 'The recommendation should show a "Find out more" link').toBeVisible({ timeout: 10000 });
            await expect(applyNowLink, '"Apply now" should open in a new tab').toHaveAttribute('target', '_blank');
            await expect(findOutMoreLink, '"Find out more" should open in a new tab').toHaveAttribute('target', '_blank');

            const findOutMoreHref = await findOutMoreLink.getAttribute('href');
            expect(findOutMoreHref, '"Find out more" should carry the wizard referral param').toContain('formlink=membership_wizard');
        });

        await test.step(`Start again after answer set ${index + 1} and confirm the wizard resets`, async () => {
            const frame = membershipWizardFrame(page);
            const startAgainLink = frame.getByText('Start again', { exact: false }).first();
            await startAgainLink.click();

            await expect(frame.locator('#input_3'), 'Clicking "Start again" should show the 1st question again').toBeVisible();
            await expect(frame.locator('#input_3'), 'Clicking "Start again" should reset the 1st question to no answer').toHaveValue('');
            await expect(frame.locator('#input_5'), 'Clicking "Start again" should hide the 2nd question again').toBeHidden();
        });
    }
});

// ============================================================================
// "Contact our membership team" modal form
// ============================================================================
const CONTACT_FORM_COUNTER_KEY = 'membership-contact-team';

function isQaEnvironment(baseURL) {
    return (baseURL || '').includes('xperience-sites.com');
}

function contactModalFrame(page) {
    return page.frameLocator('iframe[src*="250933318259966"]').first();
}

async function openContactModal(page) {
    const sendMessageButton = page.getByRole('button', { name: 'Send message' });
    await sendMessageButton.scrollIntoViewIfNeeded();
    await sendMessageButton.click();
    await expect(contactModalFrame(page).locator('#input_16'), 'The contact modal should expose the First name field once opened').toBeVisible();
}

async function submitContactModalForm(page) {
    const frame = contactModalFrame(page);
    const submitButton = frame.locator('button[type="submit"], input[type="submit"]').first();
    await submitButton.scrollIntoViewIfNeeded();
    await submitButton.click();
}

function buildUniqueSubmissionData(submissionNumber) {
    return {
        firstName: `RSCMembership${submissionNumber}`,
        lastName: `Contact${submissionNumber}`,
        email: `rsc.membership.contact.${submissionNumber}@example.com`,
        message: `Membership enquiry test submission ${submissionNumber} - generated by automation.`,
    };
}

test('Membership - Contact Form - Verify it is Present', async ({ page }) => {
    await test.step('Open Join us and the contact modal', async () => {
        await openPage(page, '/membership');
        await openContactModal(page);
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

test('Membership - Contact Form - Validate When All Fields Empty', async ({ page }) => {
    await test.step('Open Join us and the contact modal', async () => {
        await openPage(page, '/membership');
        await openContactModal(page);
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

test('Membership - Contact Form - Validate Partial Submission', async ({ page }) => {
    await test.step('Open Join us and the contact modal', async () => {
        await openPage(page, '/membership');
        await openContactModal(page);
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

test('Membership - Contact Form - Validate Successful Submission', async ({ page, baseURL }) => {
    test.skip(!isQaEnvironment(baseURL), 'Real form submissions must not be sent on Live - QA only, per project instruction.');
    test.setTimeout(60000);

    const submissionNumber = getCurrentSubmissionNumber(CONTACT_FORM_COUNTER_KEY);
    const submission = buildUniqueSubmissionData(submissionNumber);

    await test.step('Open Join us and the contact modal', async () => {
        await openPage(page, '/membership');
        await openContactModal(page);
    });

    await test.step(`Fill and submit the form with unique submission #${submissionNumber}`, async () => {
        const frame = contactModalFrame(page);
        await frame.locator('#input_16').fill(submission.firstName);
        await frame.locator('#input_17').fill(submission.lastName);
        await frame.locator('#input_9').fill(submission.email);
        await frame.locator('#input_29').selectOption({ label: 'No' });
        await frame.locator('#input_11').fill(submission.message);
        // Two <label for="input_27_0"> elements exist (the question's own top label plus the
        // "I agree" option label) - the "I agree" one visually sits on top of its own radio
        // input and intercepts a plain check(), so click it specifically by its text instead.
        await frame.locator('label[for="input_27_0"]', { hasText: 'I agree' }).click();
        await submitContactModalForm(page);
    });

    await test.step('Verify a success acknowledgement appears', async () => {
        const frame = contactModalFrame(page);
        await expect(frame.getByText(/thank you|success|received/i).first(), 'A successful submission should show a thank-you/success acknowledgement').toBeVisible({ timeout: 20000 });
    });

    await test.step('Advance the submission counter', async () => {
        incrementSubmissionNumber(CONTACT_FORM_COUNTER_KEY);
    });
});

// ============================================================================
// Member obituaries (Live-only, see OBITUARIES ENVIRONMENT NOTE above)
// ============================================================================
// Below the "lg" breakpoint the header (and #mainnav) is collapsed behind a "Toggle
// navigation" hamburger button - same mechanic as 01-rsc.homepage.spec.js/02-rsc.meganav.spec.js.
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

async function findObituariesMenuLink(page) {
    await openPage(page, '/');
    await openMobileMenuIfPresent(page);

    const membershipLink = page.locator('#mainnav .mainLevel > li.mainnav__item > a.mainnav__link', { hasText: 'Membership' }).first();
    await membershipLink.click({ force: true });
    await page.waitForTimeout(400);

    const obituariesLink = page.locator('#mainnav a.mainnav__link', { hasText: 'Member obituaries' }).first();
    return await obituariesLink.isVisible().catch(() => false);
}

function obituariesResultCards(page) {
    return page.locator('.card');
}

function obituariesPaginationControl(page, ariaLabel) {
    return page.locator(`.pagination [aria-label="${ariaLabel}"]`).first();
}

async function isPaginationControlDisabled(control) {
    const tagName = await control.evaluate((el) => el.tagName);
    return tagName === 'BUTTON';
}

// Numbered page-jump links are desktop-only site-wide - confirmed for the search-results
// pagination component in 04-rsc.search.spec.js, and this page reuses the exact same
// .pagination/.pagination__link markup.
async function isDesktopViewport(page) {
    const toggleButton = page.getByRole('button', { name: 'Toggle navigation' });
    return !(await toggleButton.isVisible().catch(() => false));
}

test('Membership - Member Obituaries Traversal', async ({ page }) => {
    test.setTimeout(60000);

    const found = await test.step('Confirm "Member obituaries" exists in this environment\'s Membership menu', async () => {
        return await findObituariesMenuLink(page);
    });
    test.skip(!found, 'Member obituaries is not yet in this environment\'s Membership menu - see OBITUARIES ENVIRONMENT NOTE.');

    await test.step('Open /news/obituaries and verify page chrome', async () => {
        await openPage(page, '/news/obituaries');
        await expect(page.locator('h1').first(), 'The obituaries page should show its H1').toHaveText('Obituaries of RSC members');
    });

    await test.step('Verify the page lists obituary cards', async () => {
        const cardCount = await obituariesResultCards(page).count();
        expect(cardCount, 'The obituaries page should list at least one card').toBeGreaterThan(0);
    });

    await test.step('Verify footer visibility', async () => {
        await verifyFooterVisible(page);
    });
});

test('Membership - Member Obituaries Pagination and Sort', async ({ page }) => {
    test.setTimeout(120000);

    const found = await test.step('Confirm "Member obituaries" exists in this environment\'s Membership menu', async () => {
        return await findObituariesMenuLink(page);
    });
    test.skip(!found, 'Member obituaries is not yet in this environment\'s Membership menu - see OBITUARIES ENVIRONMENT NOTE.');

    await test.step('Open /news/obituaries', async () => {
        await openPage(page, '/news/obituaries');
        const cardCount = await obituariesResultCards(page).count();
        expect(cardCount, 'The obituaries page should list cards to paginate through').toBeGreaterThan(0);
    });

    await test.step('On the first page, Previous should be disabled and Next enabled', async () => {
        await expect(obituariesPaginationControl(page, 'Previous'), 'Previous should be disabled on the first page').toBeDisabled();
        expect(await isPaginationControlDisabled(obituariesPaginationControl(page, 'Next page')), 'Next page should be enabled on the first page').toBe(false);
    });

    let lastPageNumber;
    await test.step('Clicking Next page moves forward and enables Previous', async () => {
        await obituariesPaginationControl(page, 'Next page').click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(new URL(page.url()).searchParams.get('Page'), 'Clicking Next page should navigate to Page=2').toBe('2');
        expect(await isPaginationControlDisabled(obituariesPaginationControl(page, 'Previous')), 'Previous should be enabled once past the first page').toBe(false);
    });

    // Numbered page-jump links only render visibly on desktop (see the shared helper's
    // comment above) - mobile/tablet users page via Previous/Next only.
    test.skip(!(await isDesktopViewport(page)), 'Numbered page-jump links are desktop-only');

    await test.step('Jumping to the last page disables Next (Previous stays enabled)', async () => {
        const pageLinks = page.locator('.pagination__items > li:not(.dots) > a.pagination__link[href]');
        const linkTexts = (await pageLinks.allInnerTexts()).map((text) => text.trim()).filter((text) => /^\d+$/.test(text));
        lastPageNumber = Math.max(...linkTexts.map(Number));

        await page.locator(`.pagination__link[href*="Page=${lastPageNumber}"]`).first().click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(new URL(page.url()).searchParams.get('Page'), 'Clicking the last page number should navigate to the final page').toBe(String(lastPageNumber));
        await expect(obituariesPaginationControl(page, 'Next page'), 'Next page should be disabled on the last page').toBeDisabled();
        expect(await isPaginationControlDisabled(obituariesPaginationControl(page, 'Previous')), 'Previous should still be enabled on the last page').toBe(false);
    });

    await test.step('Sorting updates the sortby URL param and the dropdown\'s displayed text', async () => {
        const combobox = page.locator('[role="combobox"][aria-labelledby*="sortby"]').first();
        await combobox.click();
        const option = page.locator('.select2-results__option', { hasText: 'Alphabetical (A-Z)' }).first();
        await option.waitFor({ state: 'visible', timeout: 5000 });
        await option.click();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        expect(new URL(page.url()).searchParams.get('sortby'), 'Selecting "Alphabetical (A-Z)" should set sortby=a-z in the URL').toBe('a-z');
        await expect.poll(() => page.locator('.select2-selection__rendered').first().innerText(), {
            message: 'The sort dropdown should display "Alphabetical (A-Z)" as selected',
        }).toBe('Alphabetical (A-Z)');
    });
});
