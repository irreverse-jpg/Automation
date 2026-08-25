const { test, expect } = require('@playwright/test');

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
// Coverage notes - npl.co.uk "Education and learning" meganav section
// ============================================================================
// Scope: the full "Education and learning" top-level meganav item - 13 of
// its 15 sub-items get the full traversal + deep per-page check treatment
// below; the 2 external links ("Training and courses", "e-learning
// courses" - both point to training.npl.co.uk) get a lighter href-only
// check instead of a full page load, since validating third-party page
// content is out of scope for this suite (see EXTERNAL_LINKS below).
//
// Per-page checks in this file go deeper than the other traversal specs
// ([[05-npl.research-and-science.spec.js]], [[06-npl.products-and-services.spec.js]],
// [[07-npl.strategic-programmes.spec.js]]) per Hector's explicit request to
// check "fully and deeply, FE-wise and functionality": in addition to the
// existing title/landmarks/exactly-one-H1 checks, every landing page also
// gets:
//   - Meta description, canonical link, and favicon presence (SEO/head
//     essentials)
//   - No broken images (every visible <img> must actually have loaded -
//     naturalWidth > 0)
//   - A sample of same-origin links found in the main content area resolve
//     without a 4xx/5xx status (first 6, to keep runtime bounded - this is
//     a spot-check, not an exhaustive link crawl)
//   - No browser console errors fire while the page loads
//
// Confirmed sub-items (2026-07-28, Live), in Live's panel order:
//   Training and courses, e-learning courses, Question and answers,
//   Resources, Careers overview, Work experience, PostGraduate Institute
//   for Measurement Science, Apprenticeships, Early careers, STEM futures,
//   Sainsbury Science Management Fellows, Outreach overview, Resources for
//   schools, Measurement at home, The SI units.
//
// CONFIRMED CATASTROPHIC DEFECT (2026-07-28): this is by far the worst
// defect rate found in the suite - only 1 of the 13 in-scope links
// ("Work experience") is correct on UAT. Breakdown:
//   - Hardcoded href="/" (dead ends to homepage): Question and answers,
//     Resources, Careers overview, PostGraduate Institute for Measurement
//     Science, STEM futures, Resources for schools, Measurement at home,
//     The SI units (8 links).
//   - Points to a wrong, unrelated page (not a dead link, silently shows
//     the wrong content): Apprenticeships (goes to "/kelvin-calc"), Early
//     careers (goes to "/research-and-publications"), Outreach overview
//     (goes to "/national-challenges") (3 links).
//   - Missing from the panel entirely: "Sainsbury Science Management
//     Fellows" doesn't appear anywhere in UAT's 15-link panel - UAT shows a
//     "Graduate programme" link in roughly the same position instead (not
//     present in Live's panel at all under this section). The traversal
//     below still asserts "Sainsbury Science Management Fellows" is found,
//     which correctly fails with a clear "link not found" message rather
//     than silently passing.
//   - The 2 external links ("Training and courses"/"e-learning courses")
//     are checked separately (href-only, no page load) - "Training and
//     courses" is ALSO broken on UAT, redirecting to "/about-us" instead
//     of the external training site.
// All 13 in-scope links are fine on Live.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

// Identified by label (for readability/fallback matching) and expected URL slug (sourced
// from Live - see file header for confirmed Live/UAT differences this tolerates).
const SUB_ITEMS = [
    // matchLabel is shorter than the display label because UAT's link text is "Questions and
    // answers" (plural) vs Live's "Question and answers" - the plural doesn't contain the
    // singular as a substring, so the fallback text match needs a shared substring instead.
    { label: 'Question and answers', matchLabel: 'and answers', slug: 'q-a' },
    { label: 'Resources', slug: 'resources' },
    { label: 'Careers overview', slug: 'careers' },
    { label: 'Work experience', slug: 'work-experience' },
    { label: 'PostGraduate Institute for Measurement Science', slug: 'pgi' },
    { label: 'Apprenticeships', slug: 'apprenticeships', knownWrongLinkOnUat: true },
    { label: 'Early careers', slug: 'early-careers', knownWrongLinkOnUat: true },
    { label: 'STEM futures', slug: 'stem-futures' },
    { label: 'Sainsbury Science Management Fellows', slug: 'sainsbury-management-fellowships', knownMissingOnUat: true },
    { label: 'Outreach overview', slug: 'outreach', knownWrongLinkOnUat: true },
    { label: 'Resources for schools', slug: 'school-posters' },
    { label: 'Measurement at home', slug: 'measurement-at-home' },
    { label: 'The SI units', slug: 'the-si-units' },
];

// External links (training.npl.co.uk) - checked by href pattern only, no page load, since
// validating third-party page content is out of scope for this suite.
const EXTERNAL_LINKS = [
    { label: 'Training and courses', hrefPattern: /^https:\/\/training\.npl\.co\.uk\/?$/i },
    { label: 'e-learning courses', hrefPattern: /^https:\/\/training\.npl\.co\.uk\/courses\//i },
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

// "#nav-toggle" is a toggle button, and its click doesn't always register on the first
// attempt - this retries a few times and is a no-op on desktop where it isn't rendered.
async function openMenuIfPresent(page) {
    const navToggle = page.locator('#nav-toggle');
    if (!(await navToggle.isVisible().catch(() => false))) {
        return;
    }

    if (await page.locator('.nav-main__level1-item').first().isVisible().catch(() => false)) {
        return;
    }

    await dismissCookieOverlayIfPresent(page);
    const level1Items = page.locator('.nav-main__level1-item').first();
    await expect.poll(async () => {
        await navToggle.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        return await level1Items.isVisible().catch(() => false);
    }, {
        message: 'Opening the mobile menu should expose the primary navigation items',
        timeout: 10000,
        intervals: [300, 500, 1000],
    }).toBe(true);
}

// On tablet/mobile, re-clicking an already-expanded top-level item does not collapse it
// (aria-expanded stays "true") - "#back-to-main" is what actually resets the accordion, and
// skipping this before expanding a 2nd item leaves that 2nd panel's own links obstructed.
async function collapseAnyExpandedItem(page) {
    const anyExpanded = await page.locator('.nav-main__level1-item > a.nav-main__control[aria-expanded="true"]').first().isVisible().catch(() => false);
    if (!anyExpanded) {
        return;
    }

    const backButton = page.locator('#back-to-main');
    if (await backButton.isVisible().catch(() => false)) {
        await backButton.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
    }
}

async function expandEducationAndLearning(page) {
    await openMenuIfPresent(page);
    await collapseAnyExpandedItem(page);

    const item = page.locator('.nav-main__level1-item > a.nav-main__control').filter({ hasText: 'Education and learning' }).first();
    await expect(item, 'Top-level navigation item "Education and learning" should be visible before expanding').toBeVisible();
    const controlsId = await item.getAttribute('aria-controls');
    const panel = page.locator(`#${controlsId}`);

    await expect.poll(async () => {
        await dismissCookieOverlayIfPresent(page);
        await item.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(400);
        return await panel.isVisible().catch(() => false);
    }, {
        message: 'Expanding "Education and learning" should reveal its panel',
        timeout: 15000,
        intervals: [400, 700, 1200, 2000],
    }).toBe(true);

    return panel;
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
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

test('Education and Learning - Meganav Exposes All 15 Expected Sub-Items', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Expand Education and learning and count sub-items', async () => {
        const panel = await expandEducationAndLearning(page);
        const linkTexts = await panel.locator('a').evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
        expect(linkTexts.length, 'Education and learning panel should expose all 15 links').toBe(15);
    });
}, 30000);

for (const externalLink of EXTERNAL_LINKS) {
    test(`Education and Learning - Verify External Link "${externalLink.label}"`, async ({ page }) => {
        await test.step('Open homepage', async () => {
            await openHomepage(page);
        });

        await test.step(`Check the href for "${externalLink.label}"`, async () => {
            const panel = await expandEducationAndLearning(page);
            const link = panel.getByRole('link', { name: externalLink.label, exact: true }).first();
            await expect(link, `Education and learning panel should expose a link for "${externalLink.label}"`).toBeVisible();
            const href = await link.getAttribute('href');
            expect(href || '', `"${externalLink.label}" should point to the external training site (see file header for confirmed UAT defect)`).toMatch(externalLink.hrefPattern);
        });
    }, 30000);
}

for (const subItem of SUB_ITEMS) {
    test(`Education and Learning - Navigate to "${subItem.label}" and Verify the Landing Page`, async ({ page }) => {
        test.setTimeout(30000);

        await test.step('Open homepage', async () => {
            await openHomepage(page);
        });

        // Attached after the homepage load (not before) so this only captures errors from
        // the actual landing page traversal, not homepage-load noise unrelated to this item.
        const consoleErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });

        await test.step(`Click the sub-item for "${subItem.label}"`, async () => {
            const panel = await expandEducationAndLearning(page);

            // Identified by href slug, falling back to label text when the href carries no
            // useful information (the confirmed href="/" and wrong-target defects on UAT).
            const linkData = await panel.locator('a').evaluateAll((nodes) => nodes.map((node) => ({
                href: node.getAttribute('href') || '',
                text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
            })));
            let matchIndex = linkData.findIndex(({ href }) => {
                const lastSegment = href.split('/').filter(Boolean).pop() || '';
                return lastSegment.toLowerCase().includes(subItem.slug.toLowerCase());
            });
            if (matchIndex === -1) {
                const fallbackText = (subItem.matchLabel || subItem.label).toLowerCase();
                matchIndex = linkData.findIndex(({ text }) => text.toLowerCase().includes(fallbackText));
            }
            expect(matchIndex, `Education and learning panel should expose a link whose URL or text matches "${subItem.label}"${subItem.knownMissingOnUat ? ' (confirmed missing from the UAT panel entirely as of 2026-07-28 - see file header)' : ''}`).toBeGreaterThanOrEqual(0);

            const targetLink = panel.locator('a').nth(matchIndex);
            const targetHref = linkData[matchIndex].href;

            // A plain click on some meganav links reports success but never actually
            // navigates (confirmed elsewhere in this suite - see
            // [[05-npl.research-and-science.spec.js]]) - falling back to a direct goto keeps
            // the traversal moving. For the confirmed href="/" defects this fallback is a
            // no-op (goto("/") stays on the homepage too), so it doesn't mask that finding.
            await clickWithCookieGuard(page, targetLink);
            const navigated = await page.waitForURL((url) => url.pathname !== '/', { timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            if (!navigated) {
                await page.goto(targetHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }

            // Fail fast and specifically here rather than letting the test run out its
            // 30s budget on the later toHaveURL assertion - when a link genuinely redirects
            // to the homepage, the accumulated waits above already eat most of that budget,
            // so without this check the failure surfaces as an unhelpful generic
            // "Test timeout exceeded" instead of naming the actual defect.
            if (new URL(page.url()).pathname === '/') {
                throw new Error(`"${subItem.label}" link redirects to the homepage instead of navigating to a page containing "${subItem.slug}"`);
            }

            await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
        });

        await test.step('Verify the landing page URL matches the expected slug', async () => {
            const note = subItem.knownWrongLinkOnUat
                ? ' (confirmed pointing to the wrong page on UAT as of 2026-07-28 - see file header)'
                : ' (confirmed href="/" on UAT as of 2026-07-28 for several sub-items - see file header)';
            await expect(page, `"${subItem.label}" should navigate to a page containing "${subItem.slug}"${note}`).toHaveURL(new RegExp(subItem.slug, 'i'));
        });

        await test.step('Verify SEO/head essentials: title, meta description, canonical, favicon', async () => {
            const title = (await page.title()).trim();
            expect(title.length, `"${subItem.label}" landing page should have a non-empty title`).toBeGreaterThan(0);

            const description = page.locator('meta[name="description"]').first();
            await expect(description, `"${subItem.label}" landing page should expose a meta description`).toBeAttached();
            const descriptionContent = (await description.getAttribute('content')) || '';
            expect(descriptionContent.trim().length, `"${subItem.label}" landing page's meta description should not be empty`).toBeGreaterThan(0);

            const canonical = page.locator('link[rel="canonical"]').first();
            await expect(canonical, `"${subItem.label}" landing page should expose a canonical link`).toHaveAttribute('href', /https?:\/\//i);

            const favicon = page.locator('link[rel~="icon" i], link[rel="shortcut icon" i]').first();
            await expect(favicon, `"${subItem.label}" landing page should expose a favicon link tag`).toBeAttached();
        });

        await test.step('Verify landmarks and exactly one H1', async () => {
            await expect(page.getByRole('main'), `"${subItem.label}" landing page should expose a main landmark`).toBeVisible();
            const hasBanner = (await page.getByRole('banner').count()) > 0;
            const hasContentInfo = (await page.getByRole('contentinfo').count()) > 0;
            expect(hasBanner, `"${subItem.label}" landing page should expose a banner landmark`).toBeTruthy();
            expect(hasContentInfo, `"${subItem.label}" landing page should expose a contentinfo landmark`).toBeTruthy();

            // Always exactly one H1, no per-page carve-outs - matches the convention used by
            // every other traversal spec in this suite.
            const h1Count = await page.locator('h1').count();
            expect(h1Count, `"${subItem.label}" landing page should contain exactly one H1`).toBe(1);
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

            expect(brokenImages, `"${subItem.label}" landing page has broken image(s) that failed to load: ${JSON.stringify(brokenImages)}`).toEqual([]);
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

            for (const link of sampleLinks) {
                await test.step(`Check link resolves: ${link}`, async () => {
                    const response = await page.request.get(link, { timeout: 15000 }).catch(() => null);
                    expect(response && response.status() < 400, `Main-content link on "${subItem.label}" should not return a 4xx/5xx status: ${link}`).toBeTruthy();
                });
            }
        });

        await test.step('Verify no console errors fired while loading', async () => {
            expect(consoleErrors, `"${subItem.label}" landing page produced console error(s): ${JSON.stringify(consoleErrors.slice(0, 5))}`).toEqual([]);
        });
    }, 45000);
}
