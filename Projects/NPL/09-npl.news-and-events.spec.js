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
// Coverage notes - npl.co.uk "News and events" meganav section
// ============================================================================
// Scope: the full "News and events" top-level meganav item - 6 of its 8
// sub-items get the full traversal + deep per-page check treatment (same
// depth as [[08-npl.education-and-learning.spec.js]]: title, meta
// description, canonical, favicon, landmarks, exactly one H1, no broken
// images, sampled main-content link health, no console errors).
// "Training courses" (external, training.npl.co.uk) gets a lighter
// href-only check instead of a full page load, matching the other
// traversal specs' treatment of external links.
//
// Confirmed sub-items (2026-07-29, Live), in panel order:
//   News and blog, Case studies, Sign up to the NPL Newsletter, Enhancing
//   safety of advanced cancer treatments for children, Events, Webinars,
//   Training courses, Join us at NPL for Discovery Day.
//
// A NOTE ON THE LAST 3 ITEMS' NATURE: "Enhancing safety...", "Webinars",
// and "Join us at NPL for Discovery Day" are "featured content" links -
// their own link text names specific, current content rather than a
// generic section label, so their target is expected to rotate over time
// as NPL publishes new articles/events (unlike the other, generic-labelled
// items in this suite). The slugs below are a snapshot of what Live showed
// on 2026-07-29 - if these start failing on Live itself in a future run
// (not just UAT), that's most likely the featured content having rotated
// and the spec needing a refresh, not a defect. That said, what's
// confirmed broken TODAY is still a real, worth-reporting finding either
// way - a QA process that lets a section go untested because "the target
// might rotate" would miss exactly the issues below.
//
// CONFIRMED DEFECTS (2026-07-29):
//   - "Sign up to the NPL Newsletter" is hardcoded to href="/" on UAT -
//     dead end to the homepage.
//   - "Training courses" is hardcoded to href="/" on UAT instead of the
//     external training site (same pattern confirmed in
//     [[08-npl.education-and-learning.spec.js]]).
//   - "Join us at NPL for Discovery Day" points to "/uk-telecoms-lab" on
//     UAT - a semantically unrelated page, not a dead link. Notably,
//     "/uk-telecoms-lab" is the SAME wrong destination confirmed for
//     "Quantum Programme" and "AMPI" in
//     [[07-npl.strategic-programmes.spec.js]] - this looks like a
//     recurring CMS fallback/default value bug on UAT (multiple unrelated,
//     misconfigured links all landing on the same arbitrary page) rather
//     than 3 independent one-off mistakes, worth raising as a pattern with
//     whoever manages the CMS.
//   - "Enhancing safety of advanced cancer treatments for children" points
//     to "/home/hector-test" on UAT - NOT a real NPL page. That URL is a
//     literal test/draft content stub (confirmed by visiting it directly:
//     title still shows the generic homepage title, but the H1 reads "Esto
//     es el heading de Hector Test" and body text "Texto de intro" - Spanish
//     CMS placeholder copy). This means a test article has been published
//     into the live "News and events" navigation on UAT in place of real
//     content - a content-management/publishing-process finding, not a
//     broken link in the usual sense. Worth flagging to whoever owns UAT
//     content review specifically, since automated checks alone can't
//     judge "this is inappropriate placeholder content in a real nav slot"
//     - they can only confirm it doesn't match the expected real article.
// All items are fine on Live.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

// Identified by label (for readability/fallback matching) and expected URL slug (sourced
// from Live - see file header for confirmed Live/UAT differences this tolerates).
const SUB_ITEMS = [
    { label: 'News and blog', slug: 'news' },
    { label: 'Case studies', slug: 'case-studies' },
    { label: 'Sign up to the NPL Newsletter', slug: 'impact-in-action', knownBrokenOnUat: true },
    { label: 'Enhancing safety of advanced cancer treatments', slug: 'enhancing-safety', knownWrongLinkOnUat: true },
    { label: 'Events', slug: 'events' },
    // Slug is just the hash portion (not "events-<hash>") to avoid ambiguity with the
    // "Events" item above, whose own last URL segment is the plain word "events".
    { label: 'Webinars', slug: '66450fb6d92cce29618e29722e62824d' },
    { label: 'Join us at NPL for Discovery Day', slug: 'discovery-day-november', knownWrongLinkOnUat: true },
];

// External link (training.npl.co.uk) - checked by href pattern only, no page load, since
// validating third-party page content is out of scope for this suite.
const EXTERNAL_LINKS = [
    { label: 'Training courses', hrefPattern: /^https:\/\/training\.npl\.co\.uk\/?$/i },
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

async function expandNewsAndEvents(page) {
    await openMenuIfPresent(page);
    await collapseAnyExpandedItem(page);

    const item = page.locator('.nav-main__level1-item > a.nav-main__control').filter({ hasText: 'News and events' }).first();
    await expect(item, 'Top-level navigation item "News and events" should be visible before expanding').toBeVisible();
    const controlsId = await item.getAttribute('aria-controls');
    const panel = page.locator(`#${controlsId}`);

    await expect.poll(async () => {
        await dismissCookieOverlayIfPresent(page);
        await item.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(400);
        return await panel.isVisible().catch(() => false);
    }, {
        message: 'Expanding "News and events" should reveal its panel',
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

test('News and Events - Meganav Exposes All 8 Expected Sub-Items', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await openHomepage(page);
    });

    await test.step('Expand News and events and count sub-items', async () => {
        const panel = await expandNewsAndEvents(page);
        const linkTexts = await panel.locator('a').evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
        expect(linkTexts.length, 'News and events panel should expose all 8 links').toBe(8);
    });
}, 30000);

for (const externalLink of EXTERNAL_LINKS) {
    test(`News and Events - Verify External Link "${externalLink.label}"`, async ({ page }) => {
        await test.step('Open homepage', async () => {
            await openHomepage(page);
        });

        await test.step(`Check the href for "${externalLink.label}"`, async () => {
            const panel = await expandNewsAndEvents(page);
            const link = panel.getByRole('link', { name: externalLink.label, exact: true }).first();
            await expect(link, `News and events panel should expose a link for "${externalLink.label}"`).toBeVisible();
            const href = await link.getAttribute('href');
            expect(href || '', `"${externalLink.label}" should point to the external training site (see file header for confirmed UAT defect)`).toMatch(externalLink.hrefPattern);
        });
    }, 30000);
}

for (const subItem of SUB_ITEMS) {
    test(`News and Events - Navigate to "${subItem.label}" and Verify the Landing Page`, async ({ page }) => {
        test.setTimeout(30000);

        await test.step('Open homepage', async () => {
            await openHomepage(page);
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

        await test.step(`Click the sub-item for "${subItem.label}"`, async () => {
            const panel = await expandNewsAndEvents(page);

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
            expect(matchIndex, `News and events panel should expose a link whose URL or text matches "${subItem.label}"`).toBeGreaterThanOrEqual(0);

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
            const note = subItem.knownBrokenOnUat
                ? ' (confirmed href="/" on UAT as of 2026-07-29 - see file header)'
                : subItem.knownWrongLinkOnUat
                    ? ' (confirmed pointing to the wrong page on UAT as of 2026-07-29 - see file header)'
                    : '';
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
