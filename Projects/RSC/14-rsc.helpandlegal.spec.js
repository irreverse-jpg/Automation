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
// Coverage notes - the footer's "Help and legal" link column
// ============================================================================
// Scope: every page linked from the footer's "Help and legal" column
// (discovered via direct DOM probing of the real footer on both QA and
// Live, not guessed) - deeper than the shallow "click and check H1"
// coverage 03-rsc.footer.spec.js already gives 4 of these same pages
// (Cookies, Privacy, Terms and conditions, Accessibility).
//
// Tests in this file:
//   1-9. Help and Legal - <Page> Traversal (one per HELPANDLEGAL_PAGES entry)
//      Title/H1/breadcrumb/footer/card-count/link-navigation-check - the
//      standard page-chrome check used across every spec in this project.
//      "Safeguarding" is liveOnly (see ENVIRONMENT DRIFT below).
//   10. Help and Legal - Accordion Functionality
//      Expands/collapses the real Bootstrap-style accordion on
//      /help-and-legal/terms-of-use (3 real items - the richest accordion
//      page found in this column; Cookies has 2, everything else has 0 -
//      the "large number of items" threshold used in other specs is
//      relaxed here, same as 10-rsc.eventsandvenuehire.spec.js's).
//   11. Help and Legal - Safeguarding Team Contact Form - <journey>
//      "Contact our safeguarding team" (team=safeguarding, same JotForm
//      250933318259966 pattern as every other project contact-team form)
//      on /help-and-legal/safeguarding - liveOnly, since the whole hosting
//      page doesn't exist on QA (not just the card).
//
// No video test in this file - confirmed via direct probe that none of
// this column's 9 pages embed a YouTube (or other) video.
//
// ENVIRONMENT DRIFT confirmed 2026-07-24 (same category as this project's
// other content-drift findings, and the narrowest drift found in this
// project so far - only 1 of 9 pages differs in existence, and only 1 page
// has an H1 wording difference, everything else is byte-identical on both
// environments):
//   - Live's "Help and legal" footer column has 1 extra link QA's doesn't:
//     "Safeguarding" -> /help-and-legal/safeguarding (already noted as a
//     Live-only footer link in 03-rsc.footer.spec.js's own coverage notes,
//     confirmed here as a genuine 404 on QA via direct probe, not merely
//     unlinked).
//   - The Accessibility page's H1 differs: QA "Accessibility", Live
//     "Accessibility statement" - handled with a regex, same pattern as
//     every other spec's H1 drift.
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
// Traversal - every page in the footer's "Help and legal" column
// ============================================================================
const HELPANDLEGAL_PAGES = [
    { testName: "Help and Legal - Help and Legal Traversal", href: "/help-and-legal", h1: "Help and legal", breadcrumbParent: null },
    { testName: "Help and Legal - Cookies Traversal", href: "/help-and-legal/cookies", h1: "Cookies", breadcrumbParent: "Help and legal" },
    { testName: "Help and Legal - Copyright and Permissions Traversal", href: "/help-and-legal/copyright-and-permissions", h1: "Copyright and permissions", breadcrumbParent: "Help and legal" },
    { testName: "Help and Legal - Human Rights Policy Traversal", href: "/help-and-legal/human-rights-policy", h1: "Human Rights Policy and Code of Conduct for Associates (“Code of Conduct”)", breadcrumbParent: "Help and legal" },
    { testName: "Help and Legal - Modern Slavery Act Statement Traversal", href: "/help-and-legal/modern-slavery-act-statement", h1: "Modern slavery act statement", breadcrumbParent: "Help and legal" },
    { testName: "Help and Legal - Privacy Traversal", href: "/help-and-legal/privacy", h1: "Privacy", breadcrumbParent: "Help and legal" },
    { testName: "Help and Legal - Terms and Conditions Traversal", href: "/help-and-legal/terms-of-use", h1: "Terms of use", breadcrumbParent: "Help and legal" },
    { testName: "Help and Legal - Accessibility Traversal", href: "/help-and-legal/accessibility", h1: /^Accessibility( statement)?$/, breadcrumbParent: "Help and legal" },
    // Live-only (see ENVIRONMENT DRIFT above) - gated via a real 404 check.
    { testName: "Help and Legal - Safeguarding Traversal", href: "/help-and-legal/safeguarding", h1: "Safeguarding children and vulnerable adults", breadcrumbParent: "Help and legal", liveOnly: true },
];

for (const config of HELPANDLEGAL_PAGES) {
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

test('Help and Legal - Accordion Functionality', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Terms of use page', async () => {
        await openPage(page, '/help-and-legal/terms-of-use');
    });

    await test.step('Verify each of the real accordion items expand/collapse correctly', async () => {
        const items = page.locator('.accordion-item');
        const count = await items.count();
        // This column's richest accordion page only has 3 real items - relaxed threshold
        // accordingly, same approach already used in 10-rsc.eventsandvenuehire.spec.js.
        expect(count, 'This page should expose a handful of real accordion items').toBeGreaterThan(2);

        for (let index = 0; index < count; index += 1) {
            await toggleBootstrapAccordionAndVerify(items.nth(index), `Accordion item #${index + 1}`);
        }
    });
});

// ============================================================================
// "Contact our safeguarding team" - same JotForm (250933318259966) already
// used by every other project spec, liveOnly (see ENVIRONMENT DRIFT above).
// ============================================================================
function contactModalFrame(page) {
    return page.frameLocator('iframe[src*="250933318259966"]').first();
}

async function openSafeguardingContactModal(page) {
    const card = page.locator('.card', { hasText: 'Contact our safeguarding team' });
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

async function openSafeguardingPageOrSkip(page) {
    const response = await openPage(page, '/help-and-legal/safeguarding');
    return response;
}

test('Help and Legal - Safeguarding Team Contact Form - Verify it is Present', async ({ page }) => {
    const response = await test.step('Open Safeguarding', async () => {
        return openSafeguardingPageOrSkip(page);
    });
    test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see ENVIRONMENT DRIFT.');

    await test.step('Open the contact modal', async () => {
        await openSafeguardingContactModal(page);
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

test('Help and Legal - Safeguarding Team Contact Form - Validate When All Fields Empty', async ({ page }) => {
    const response = await test.step('Open Safeguarding', async () => {
        return openSafeguardingPageOrSkip(page);
    });
    test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see ENVIRONMENT DRIFT.');

    await test.step('Open the contact modal', async () => {
        await openSafeguardingContactModal(page);
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

test('Help and Legal - Safeguarding Team Contact Form - Validate Partial Submission', async ({ page }) => {
    const response = await test.step('Open Safeguarding', async () => {
        return openSafeguardingPageOrSkip(page);
    });
    test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see ENVIRONMENT DRIFT.');

    await test.step('Open the contact modal', async () => {
        await openSafeguardingContactModal(page);
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

test('Help and Legal - Safeguarding Team Contact Form - Validate Successful Submission', async ({ page, baseURL }) => {
    test.skip(!isQaEnvironment(baseURL), 'Real form submissions must not be sent on Live - QA only, per project instruction.');
    test.setTimeout(60000);

    const response = await test.step('Open Safeguarding', async () => {
        return openSafeguardingPageOrSkip(page);
    });
    test.skip(!response || response.status() === 404, 'This page does not exist on this environment - see ENVIRONMENT DRIFT.');

    const counterKey = 'helpandlegal-safeguarding-team';
    const submissionNumber = getCurrentSubmissionNumber(counterKey);

    await test.step('Open the contact modal', async () => {
        await openSafeguardingContactModal(page);
    });

    await test.step(`Fill and submit the form with unique submission #${submissionNumber}`, async () => {
        const frame = contactModalFrame(page);
        await frame.locator('#input_16').fill(`RSCHelpLegalSafeguarding${submissionNumber}`);
        await frame.locator('#input_17').fill(`Contact${submissionNumber}`);
        await frame.locator('#input_9').fill(`rsc.helplegal.safeguarding.${submissionNumber}@example.com`);
        await frame.locator('#input_29').selectOption({ label: 'No' });
        await frame.locator('#input_11').fill(`Safeguarding team enquiry test submission ${submissionNumber} - generated by automation.`);
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
