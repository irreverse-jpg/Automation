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
// Coverage notes - npl.co.uk site-wide footer
// ============================================================================
// Scope: the footer (`contentinfo` landmark), reached from the homepage -
// 9 legal/utility links and the 5-icon social row.
//
// Confirmed footer links (2026-07-30):
//   Privacy notice, Cookies, Quality, HSE, Contact us, Terms, Anti-slavery
//   and ethics ("Anti-slavery policy" on UAT - text differs, href doesn't),
//   Accessibility, Share your feedback, plus 5 social icons (LinkedIn,
//   Twitter/X, Facebook, Instagram, YouTube).
//
// CONFIRMED LIVE/UAT CONTENT DIFFERENCE: "Share your feedback" (->
// "/submit-feedback-or-product-ideas") exists in UAT's footer but NOT in
// Live's (8 links there, 9 on UAT) - not asserted as a defect (it may be a
// staged feature ahead of a Live release), but worth knowing this section
// legitimately differs in link COUNT between environments, unlike most of
// this suite's other Live/UAT differences which are about broken targets.
//
// PER HECTOR'S EXPLICIT SCOPE (2026-07-30):
//   - Social links: existence + correct destination only, nothing deeper -
//     see "Footer - Verify Social Links".
//   - Every other footer link: full deep FE checks (same depth as
//     [[08-npl.education-and-learning.spec.js]] onward: title, meta
//     description, canonical, favicon, landmarks, exactly one H1, not a
//     404 page, no broken images, sampled main-content link health, no
//     console errors) - see "Footer - Navigate to ... and Verify the
//     Landing Page".
//   - "Share your feedback" additionally gets the standard 3-journey form
//     coverage (empty submission, invalid data, successful submission)
//     used across this team's other projects' forms, backed by
//     `submissionCounter.js`/`submission-counter.txt` for unique data on
//     each real run. The successful-submission journey needs a REAL Google
//     reCAPTCHA solved by a human and only makes sense on UAT (the page
//     doesn't exist on Live) - it SKIPS outright in headless runs
//     (`testInfo.project.use?.headless !== false`), matching the pattern
//     used for Withers' reCAPTCHA-gated forms: this isn't a failure, it's
//     an expected skip unless someone runs it headed.
//
// GOTCHA: the feedback form's field `id` AND `name` attributes both embed
// a random per-page-load suffix (e.g. "...-cdb1_FirstName_Value" one load,
// "...-7f64_FirstName_Value" the next) - confirmed by loading the page
// twice and comparing. Never select these fields by id/name; use
// `page.getByLabel(...)` (the visible label text is stable) instead.
//
// CONFIRMED FINDINGS (2026-07-30):
//   - "Contact us" throws a console error (`requestStorageAccess:
//     Permission denied.`) - the SAME finding already documented against
//     the same /Contact page in [[10-npl.about-npl.spec.js]] (reached
//     there via "Contact NPL" in the About NPL menu) - don't double-count
//     it as a second, separate defect.
//   - "Share your feedback" has NO meta description tag at all (confirmed
//     directly: 0 matches for `meta[name="description"]`) - a real,
//     isolated SEO gap on this specific page.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';
const SOCIAL_DOMAINS = ['linkedin.com', 'twitter.com', 'facebook.com', 'instagram.com', 'youtube.com'];
const FEEDBACK_FORM_COUNTER_KEY = 'submit-feedback-or-product-ideas';

const FOOTER_LINKS = [
    { name: 'Privacy notice', href: '/privacy-notice' },
    // The "Cookies" link's href is /privacy-policy/cookies, but the site redirects that
    // path to /privacy-notice/cookies - confirmed on both Live and UAT (2026-07-28).
    { name: 'Cookies', href: '/privacy-policy/cookies', expectedUrlPattern: /\/privacy-notice\/cookies/i },
    { name: 'Quality', href: '/quality' },
    { name: 'HSE', href: '/health-safety-and-environment' },
    { name: 'Contact us', href: '/Contact' },
    { name: 'Terms', href: '/terms-conditions' },
    { name: 'Anti-slavery and ethics', matchLabel: 'anti-slavery', href: '/anti-slavery-and-ethics' },
    { name: 'Accessibility', href: '/accessibility' },
    // UAT-only (see file header) - not present in Live's footer as of 2026-07-30.
    { name: 'Share your feedback', href: '/submit-feedback-or-product-ideas' },
];

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (!(await cookieOverlay.isVisible().catch(() => false))) {
        return;
    }

    const acceptAllButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await acceptAllButton.isVisible().catch(() => false)) {
        // NPL's OneTrust accept button renders before its click handler finishes attaching -
        // clicking the instant it's visible silently no-ops, so this retries until dismissed.
        await expect.poll(async () => {
            await acceptAllButton.click({ force: true, timeout: 2000 }).catch(() => {});
            return await cookieOverlay.isVisible().catch(() => false);
        }, {
            message: 'Cookie overlay should be dismissed after accepting',
            timeout: 8000,
            intervals: [300, 500, 1000],
        }).toBe(false).catch(() => {});
        return;
    }

    await page.keyboard.press('Escape').catch(() => {});
}

async function openHomepage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Bounded and swallowed: the homepage embeds a YouTube widget whose network activity can
    // keep the "load" event from firing promptly - domcontentloaded is already enough to interact.
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await expect.poll(async () => {
            await cookieButton.click({ force: true, timeout: 2000 }).catch(() => {});
            return await cookieButton.isVisible().catch(() => false);
        }, {
            message: 'Cookie banner should be dismissed after accepting',
            timeout: 8000,
            intervals: [300, 500, 1000],
        }).toBe(false).catch(() => {});
    }
}

async function openHomeFooter(page) {
    await openHomepage(page);
    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();
    return footer;
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        // Footer links on tablet/mobile routinely get "intercepts pointer events" from
        // whatever page content sits at that scroll position (not just the cookie overlay) -
        // failing fast here and falling back to a force click avoids burning the full default
        // actionTimeout on every single link across a multi-link loop.
        await locator.click({ timeout: 3000 });
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isInterception = message.includes('intercepts pointer events') || message.includes('onetrust') || message.includes('timeout');

        if (!isInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

async function getVisibleFooterLinks(page) {
    const footer = page.getByRole('contentinfo').first();
    return await footer.locator('a[href]').evaluateAll((links) => {
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        return links
            .filter(isVisible)
            .map((link) => ({
                href: link.getAttribute('href'),
                target: link.getAttribute('target'),
                name: link.getAttribute('aria-label') || link.textContent.trim(),
            }))
            .filter((item) => !!item.href);
    });
}

// NPL normalizes path casing on navigation (e.g. "/Contact" -> "/contact"), so this
// compares case-insensitively rather than treating that as a broken link.
function getComparableUrl(url) {
    const current = new URL(url);
    const host = current.hostname === 'x.com' ? 'twitter.com' : current.hostname.replace(/^www\./i, '');
    return `${current.protocol}//${host}${current.pathname}`.toLowerCase();
}

test('Footer - Verify Footer is Present', async ({ page }) => {
    await test.step('Open homepage and scroll to footer', async () => {
        await openHomeFooter(page);
    });
}, 30000);

for (const link of FOOTER_LINKS) {
    test(`Footer - Navigate to "${link.name}" and Verify the Landing Page`, async ({ page, baseURL }) => {
        test.setTimeout(45000);

        await test.step('Open homepage and scroll to footer', async () => {
            await openHomeFooter(page);
        });

        // Attached after the homepage load (not before) so this only captures errors from
        // the actual landing page traversal, not homepage-load noise unrelated to this item -
        // NPL's own GTM/ad-tracking script violates the site's CSP on every page load
        // (confirmed sitewide in [[08-npl.education-and-learning.spec.js]]).
        const consoleErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });

        await test.step(`Click the footer link for "${link.name}"`, async () => {
            const footer = page.getByRole('contentinfo').first();
            const target = footer.getByRole('link', { name: link.matchLabel || link.name, exact: !link.matchLabel }).first();
            await expect(target, `Footer link "${link.name}" should be visible before clicking`).toBeVisible({ timeout: 10000 });
            await target.scrollIntoViewIfNeeded().catch(() => {});

            const expectedUrl = new URL(link.href, baseURL).toString();
            const expectedComparableUrl = getComparableUrl(expectedUrl);
            const matchesDestination = link.expectedUrlPattern
                ? () => link.expectedUrlPattern.test(page.url())
                : () => getComparableUrl(page.url()) === expectedComparableUrl;

            const originalUrl = page.url();
            await clickWithCookieGuard(page, target);
            await page.waitForLoadState('domcontentloaded').catch(() => {});

            try {
                await expect.poll(matchesDestination, {
                    timeout: 10000,
                    message: `Footer link "${link.name}" navigated to an unexpected destination. Expected ${link.expectedUrlPattern || expectedComparableUrl}`,
                }).toBe(true);
            } catch (error) {
                if (page.url() !== originalUrl) {
                    throw error;
                }

                await target.evaluate((node) => node.click());
                await page.waitForLoadState('domcontentloaded').catch(() => {});
                await expect.poll(matchesDestination, {
                    timeout: 10000,
                    message: `Footer link "${link.name}" navigated to an unexpected destination after DOM-click fallback. Expected ${link.expectedUrlPattern || expectedComparableUrl}`,
                }).toBe(true);
            }

            await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
        });

        await test.step('Verify the page is not a 404/error page', async () => {
            const title = (await page.title()).trim();
            const h1Text = (await page.locator('h1').first().textContent().catch(() => '') || '').trim();
            expect(`${title} ${h1Text}`, `"${link.name}" landing page appears to be a 404/error page (title: "${title}", H1: "${h1Text}")`).not.toMatch(/\b404\b|page not found/i);
        });

        await test.step('Verify SEO/head essentials: title, meta description, canonical, favicon', async () => {
            const title = (await page.title()).trim();
            expect(title.length, `"${link.name}" landing page should have a non-empty title`).toBeGreaterThan(0);

            const description = page.locator('meta[name="description"]').first();
            await expect(description, `"${link.name}" landing page should expose a meta description`).toBeAttached();
            const descriptionContent = (await description.getAttribute('content')) || '';
            expect(descriptionContent.trim().length, `"${link.name}" landing page's meta description should not be empty`).toBeGreaterThan(0);

            const canonical = page.locator('link[rel="canonical"]').first();
            await expect(canonical, `"${link.name}" landing page should expose a canonical link`).toHaveAttribute('href', /https?:\/\//i);

            const favicon = page.locator('link[rel~="icon" i], link[rel="shortcut icon" i]').first();
            await expect(favicon, `"${link.name}" landing page should expose a favicon link tag`).toBeAttached();
        });

        await test.step('Verify landmarks and exactly one H1', async () => {
            await expect(page.getByRole('main'), `"${link.name}" landing page should expose a main landmark`).toBeVisible();
            const hasBanner = (await page.getByRole('banner').count()) > 0;
            const hasContentInfo = (await page.getByRole('contentinfo').count()) > 0;
            expect(hasBanner, `"${link.name}" landing page should expose a banner landmark`).toBeTruthy();
            expect(hasContentInfo, `"${link.name}" landing page should expose a contentinfo landmark`).toBeTruthy();

            const h1Count = await page.locator('h1').count();
            expect(h1Count, `"${link.name}" landing page should contain exactly one H1`).toBe(1);
        });

        await test.step('Verify no broken images', async () => {
            const brokenImages = await page.evaluate(() => {
                const isVisible = (el) => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
                };

                return Array.from(document.querySelectorAll('img'))
                    .filter((img) => isVisible(img))
                    .filter((img) => img.complete && img.naturalWidth === 0)
                    .slice(0, 10)
                    .map((img) => (img.getAttribute('src') || img.getAttribute('data-src') || '').slice(0, 150));
            });

            expect(brokenImages, `"${link.name}" landing page has broken image(s) that failed to load: ${JSON.stringify(brokenImages)}`).toEqual([]);
        });

        await test.step('Verify a sample of main-content links resolve (no 4xx/5xx)', async () => {
            const origin = new URL(page.url()).origin;
            const sampleLinks = await page.evaluate((pageOrigin) => {
                const main = document.querySelector('main');
                if (!main) return [];

                const isVisible = (el) => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
                };

                const seen = new Set();
                const hrefs = [];
                for (const link of main.querySelectorAll('a[href]')) {
                    if (!isVisible(link)) continue;
                    const href = link.getAttribute('href') || '';
                    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

                    try {
                        const resolved = new URL(href, window.location.href);
                        if (resolved.origin !== pageOrigin) continue;
                        if (seen.has(resolved.href)) continue;
                        seen.add(resolved.href);
                        hrefs.push(resolved.href);
                    } catch {
                        // ignore unparsable hrefs
                    }

                    if (hrefs.length >= 6) break;
                }
                return hrefs;
            }, origin);

            for (const sampleLink of sampleLinks) {
                await test.step(`Check link resolves: ${sampleLink}`, async () => {
                    const response = await page.request.get(sampleLink, { timeout: 15000 }).catch(() => null);
                    expect(response && response.status() < 400, `Main-content link on "${link.name}" should not return a 4xx/5xx status: ${sampleLink}`).toBeTruthy();
                });
            }
        });

        await test.step('Verify no console errors fired while loading', async () => {
            expect(consoleErrors, `"${link.name}" landing page produced console error(s): ${JSON.stringify(consoleErrors.slice(0, 5))}`).toEqual([]);
        });
    }, 45000);
}

test('Footer - Verify Social Links', async ({ page }) => {
    test.setTimeout(60000);

    await openHomeFooter(page);
    const footerLinks = await getVisibleFooterLinks(page);
    const socialLinks = footerLinks.filter(({ href }) => {
        return href && SOCIAL_DOMAINS.some((domain) => href.includes(domain));
    });

    expect(socialLinks.length, 'The footer should expose at least one social link').toBeGreaterThan(0);
    for (const { href, target, name } of socialLinks) {
        await test.step(`Footer social link: ${name || href} -> ${href}`, async () => {
            const socialUrl = new URL(href);
            const normalizedHost = socialUrl.hostname === 'x.com' ? 'twitter.com' : socialUrl.hostname.replace(/^www\./i, '');

            expect(target, `Footer social link "${href}" should open in a new tab`).toBe('_blank');
            expect(SOCIAL_DOMAINS.includes(normalizedHost), `Footer social link "${href}" should point to one of the supported social domains`).toBe(true);
        });
    }
}, 60000);


// ============================================================================
// "Share your feedback" form (/submit-feedback-or-product-ideas, UAT only)
// ============================================================================

function buildUniqueFeedbackData(submissionNumber) {
    return {
        firstName: `NPLFeedback${submissionNumber}`,
        lastName: `AutomationTest${submissionNumber}`,
        company: 'Candid Group QA Automation',
        email: `npl.feedback.${submissionNumber}@example.com`,
        phone: `07${String(100000000 + submissionNumber).slice(-9)}`,
        feedback: `This is automated QA test submission #${submissionNumber} for the Share your feedback form.`,
    };
}

async function openFeedbackForm(page) {
    await page.goto('/submit-feedback-or-product-ideas', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await expect.poll(async () => {
            await cookieButton.click({ force: true, timeout: 2000 }).catch(() => {});
            return await cookieButton.isVisible().catch(() => false);
        }, {
            message: 'Cookie banner should be dismissed after accepting',
            timeout: 8000,
            intervals: [300, 500, 1000],
        }).toBe(false).catch(() => {});
    }
}

function getFeedbackSubmitButton(page) {
    return page.locator('form').filter({ has: page.getByLabel(/write your feedback/i) }).locator('input[type="submit"]').first();
}

async function submitFeedbackForm(page) {
    const submitButton = getFeedbackSubmitButton(page);
    await expect(submitButton, 'The feedback form should expose a submit button').toBeVisible();
    await submitButton.scrollIntoViewIfNeeded().catch(() => {});
    await dismissCookieOverlayIfPresent(page);
    await submitButton.click({ force: true, timeout: 5000 });
}

function getFeedbackValidationErrors(page) {
    return page.locator('.field-validation-error, .validation-summary-errors').filter({ hasNotText: '' });
}

// Field ids/names embed a random per-page-load suffix (confirmed by loading the page twice
// and comparing) - getByLabel is used everywhere instead since the visible label is stable.
test('Feedback Form - Verify it is Present', async ({ page }) => {
    await test.step('Open the feedback page', async () => {
        await openFeedbackForm(page);
        await expect(page, 'The feedback form test should land on the feedback page').toHaveURL(/submit-feedback-or-product-ideas/i);
        await expect(page, 'The feedback page should load the expected title').toHaveTitle(/Share your feedback/i);
    });

    await test.step('Verify the key form fields are visible', async () => {
        await expect(page.getByLabel('First name:'), 'The feedback form should expose a First name field').toBeVisible();
        await expect(page.getByLabel('Last name:'), 'The feedback form should expose a Last name field').toBeVisible();
        await expect(page.getByLabel('Company:'), 'The feedback form should expose a Company field').toBeVisible();
        await expect(page.getByLabel('Email:'), 'The feedback form should expose an Email field').toBeVisible();
        await expect(page.getByLabel('Phone:'), 'The feedback form should expose a Phone field').toBeVisible();
        await expect(page.getByLabel(/write your feedback/i), 'The feedback form should expose the feedback/suggestions textarea').toBeVisible();
        await expect(getFeedbackSubmitButton(page), 'The feedback form should expose a submit button').toBeVisible();
    });
}, 30000);

test('Feedback Form - Validate When All Fields Empty', async ({ page }) => {
    await test.step('Open the feedback page', async () => {
        await openFeedbackForm(page);
    });

    await test.step('Submit the form with every field empty', async () => {
        await submitFeedbackForm(page);
    });

    await test.step('Verify the form stays on the page and shows a required-field validation message', async () => {
        await expect(page, 'The empty feedback form should remain on the feedback page').toHaveURL(/submit-feedback-or-product-ideas/i);
        await expect(page.getByText('Please enter a value.').first(), 'Submitting the empty feedback form should show the "Please enter a value." validation message for the required feedback field').toBeVisible();
    });
}, 30000);

test('Feedback Form - Validate Invalid Email Format', async ({ page }) => {
    await test.step('Open the feedback page', async () => {
        await openFeedbackForm(page);
    });

    await test.step('Fill the feedback field and an invalid email, then submit', async () => {
        await page.getByLabel('First name:').fill('Test');
        await page.getByLabel('Last name:').fill('User');
        await page.getByLabel('Email:').fill('not-a-valid-email');
        await page.getByLabel(/write your feedback/i).fill('Automated QA test message for the invalid-email validation journey.');
        await submitFeedbackForm(page);
    });

    await test.step('Verify the form stays on the page and shows an email-format validation message', async () => {
        await expect(page, 'The invalid-email feedback form should remain on the feedback page').toHaveURL(/submit-feedback-or-product-ideas/i);
        await expect(page.getByText('Please enter email value in format mymail@domain.com').first(), 'Submitting an invalid email should show the expected email-format validation message').toBeVisible();
    });
}, 30000);

// Requires a REAL Google reCAPTCHA solved by a human, so this skips outright in headless runs
// (matching the pattern used for other projects' reCAPTCHA-gated forms, e.g. Withers' careers
// Recruitment enquiries form) - this is an expected skip, not a failure, unless run headed.
// The feedback page only exists on UAT (see file header), so this is inherently UAT-only too.
test('Feedback Form - Validate Successful Submission', async ({ page }, testInfo) => {
    test.setTimeout(420000);

    if (testInfo.project.use?.headless !== false) {
        test.skip(true, 'Manual reCAPTCHA solving requires a headed browser session.');
    }

    const submissionNumber = getCurrentSubmissionNumber(FEEDBACK_FORM_COUNTER_KEY);
    const submission = buildUniqueFeedbackData(submissionNumber);

    await test.step('Open the feedback page', async () => {
        await openFeedbackForm(page);
        await expect(page, 'The successful-submission test should land on the feedback page').toHaveURL(/submit-feedback-or-product-ideas/i);
    });

    await test.step('Fill the feedback form with a unique submission dataset', async () => {
        await page.getByLabel('First name:').fill(submission.firstName);
        await page.getByLabel('Last name:').fill(submission.lastName);
        await page.getByLabel('Company:').fill(submission.company);
        await page.getByLabel('Email:').fill(submission.email);
        await page.getByLabel('Phone:').fill(submission.phone);
        await page.getByLabel(/write your feedback/i).fill(submission.feedback);
    });

    await test.step('Wait for manual reCAPTCHA resolution', async () => {
        const recaptchaIframe = page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA" i]').first();
        const recaptchaResponse = page.locator('textarea[name="g-recaptcha-response"]').first();

        await dismissCookieOverlayIfPresent(page);
        await recaptchaIframe.scrollIntoViewIfNeeded().catch(() => {});

        await expect.poll(async () => {
            await dismissCookieOverlayIfPresent(page);
            const responseValue = await recaptchaResponse.inputValue().catch(() => '');
            return Boolean(responseValue.trim());
        }, {
            message: 'Resolve the reCAPTCHA manually in the browser window; the test will continue automatically once the token is populated.',
            timeout: 300000,
        }).toBe(true);
    });

    await test.step('Submit the completed feedback form', async () => {
        await submitFeedbackForm(page);
    });

    await test.step('Verify the submission succeeds and advance the submission counter', async () => {
        // Exact success wording hasn't been confirmed yet (needs a real headed run to solve
        // the reCAPTCHA) - matches the general "thank you" acknowledgement pattern used
        // elsewhere on this site/other projects. Tighten this regex once confirmed for real.
        await expect(page.getByText(/thank you|thanks|feedback.*received|received.*feedback|submitted/i).first(), 'A successful feedback submission should show a success acknowledgement').toBeVisible();
        incrementSubmissionNumber(FEEDBACK_FORM_COUNTER_KEY);
    });
});
