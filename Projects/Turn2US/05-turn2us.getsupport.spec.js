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
// Coverage notes - "Get support" meganav section
// ============================================================================
// Scope: every real destination reachable from the "Get support" top-level
// meganav item (confirmed via direct probing 2026-09-23), EXCEPT the
// "/get-support" landing page itself (reached via the panel's "View Get
// support" duplicate link) - per Hector, that page will get its own proper
// coverage later, so it's deliberately excluded here for now.
//
// The 6 real destinations covered as standard traversals:
//   1. Benefits Calculator -> https://staging-beta-benefits-calculator.turn2us.org.uk/
//   2. Grants Search -> https://staging-grants-search.turn2us.org.uk/
//   3. Turn2us PIP Helper -> https://staging-pip.turn2us.org.uk/
//   4. Information about Benefits -> /get-support/information-about-benefits
//   5. Information for your Situation -> /get-support/information-for-your-situation
//   6. Turn2us Grants Programmes -> /get-support/apply-for-grants
//
// Each standard traversal (per Hector's instructions, matching every other
// client project's convention): navigates via the real meganav, confirms the
// page title contains the clicked label, confirms exactly one H1 matching
// the label, checks every real on-page button/link for a working
// destination (no 404/5xx), and confirms the footer + its "Back to top"
// control both work.
//
// Confirmed real content quirks (not test bugs), left as notes:
//   - The 3 external tool destinations (Benefits Calculator/Grants Search/
//     PIP Helper) are entirely separate applications on their own
//     subdomains, each with its own header/footer template (different from
//     the main Turn2us site's) - `.feature-card`/footer selectors below are
//     generic enough to work across both templates rather than assuming one
//     shape.
//   - "Turn2us PIP Helper"'s H1 visually reads "Turn2us PIP Helper", but its
//     raw text content also includes a screen-reader-only expansion
//     ("Personal Independence Payment") rendered with no surrounding
//     whitespace, so a plain textContent() read looks like
//     "Turn2us Personal Independence PaymentPIP Helper" - confirmed via
//     direct DOM inspection this is a real, intentional sr-only a11y
//     enhancement (expanding the PIP acronym for screen readers), not a
//     rendering bug. Matched with a loose regex rather than an exact string
//     for this reason.
//   - Confirmed CURRENT genuine mismatch, left as a deliberately-set
//     expectation rather than a failing generic assertion: "Turn2us Grants
//     Programmes" (the meganav label) lands on a page titled/H1'd
//     "Apply for Grants" - a completely different name, not merely a
//     reworded version of the link label. Matches the same kind of
//     link-label-vs-destination-title drift already accepted as normal in
//     other client projects in this workspace (e.g. MCC's "Overseas Tours"
//     -> H1 "MCC Touring Programme").
//
// SUB-TRAVERSALS - "Get support" > "Benefits Calculator" landing page's
// feature-card component (3 cards, confirmed via direct probing):
//   1. "Use the Turn2us Benefits Calculator" (-> /survey, same destination as
//      the page's own "Get Started" hero button) - covered here.
//   2. "Return to a calculation" (a calculation-reference + postcode lookup
//      form, `#index_token`/`#index_postcode`/`#btnFind`) - covered here.
//   3. "Your Situation" (opens in a new tab) - covered here, including all
//      15 real destination pages it links onward to.
//
// The full multi-step Benefits Calculator wizard itself (reached via card
// 1) is its own large, separate body of work - see
// docs/benefits-calculator-journey.md for the full
// dictated reference journey. This file currently only covers entering the
// wizard (its first real screen, "Before We Begin") - the full end-to-end
// journey/permutation tests are being built separately per Hector's own
// phased plan (single deterministic journey first, then several varied
// journeys).
// ============================================================================

const GET_SUPPORT_DESTINATIONS = [
    {
        name: 'Benefits Calculator',
        titlePattern: /Benefits Calculator/i,
        h1Pattern: /Benefits Calculator/i,
    },
    {
        name: 'Grants Search',
        titlePattern: /Grants Search/i,
        h1Pattern: /Grants Search/i,
    },
    {
        name: 'Turn2us PIP Helper',
        // See coverage notes above - the H1's raw text also carries a hidden
        // sr-only acronym expansion, so this is matched loosely rather than
        // as one exact contiguous phrase.
        titlePattern: /PIP Helper/i,
        h1Pattern: /Turn2us.*PIP Helper/i,
    },
    {
        name: 'Information about Benefits',
        titlePattern: /Information about Benefits/i,
        h1Pattern: /Information about Benefits/i,
    },
    {
        name: 'Information for your Situation',
        titlePattern: /Information for your Situation/i,
        h1Pattern: /Information for your Situation/i,
    },
    {
        name: 'Turn2us Grants Programmes',
        // Confirmed real quirk (see coverage notes above) - this destination's
        // real title/H1 is "Apply for Grants", not a variant of the menu label.
        titlePattern: /Apply for Grants/i,
        h1Pattern: /Apply for Grants/i,
    },
];

async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#CybotCookiebotDialog').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

// Below the breakpoint where the desktop nav collapses, `#main-nav` is hidden behind the
// `#nav-toggle` hamburger button - same mechanic as 02-turn2us.meganav.spec.js.
async function openMenuIfPresent(page) {
    const mainNav = page.locator('#main-nav').first();
    if (await mainNav.isVisible().catch(() => false)) {
        return;
    }

    const toggleButton = page.locator('#nav-toggle');
    await expect(toggleButton, 'The "Toggle menu" hamburger icon should be visible when the meganav is collapsed').toBeVisible();
    await toggleButton.click();
    await expect(mainNav, 'The Turn2us meganav should be visible after opening the hamburger menu').toBeVisible();
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLooseLabelPattern(normalizedText) {
    return new RegExp(`^\\s*${escapeRegExp(normalizedText).replace(/\s+/g, '\\s+')}\\s*$`);
}

// Navigates fresh from the homepage, expands "Get support" (the meganav's first root item), and
// clicks the child link matching `name` - never hardcodes hrefs, since destinations are CMS-managed
// and may drift.
async function navigateViaGetSupportMenu(page, name) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    await openMenuIfPresent(page);

    const getSupportLink = page.locator('#main-nav > ul > li.nav__item').filter({
        has: page.locator(':scope > a', { hasText: buildLooseLabelPattern('Get support') }),
    }).locator(':scope > a').first();

    await getSupportLink.click();
    const panelId = await getSupportLink.getAttribute('aria-controls');
    const panel = page.locator(`#${panelId}`);
    await expect(panel, '"Get support" panel should be visible once expanded').toBeVisible();

    const childLink = panel.locator('a', { hasText: buildLooseLabelPattern(name) }).first();
    await expect(childLink, `"${name}" should be visible in the "Get support" panel`).toBeVisible();
    await childLink.click();
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

// Checks every real, visible on-page link (excluding header/nav/footer chrome) for a working
// destination - matches the "no dead links" convention used throughout this workspace. mailto:/
// tel: links are format-checked instead of requested.
// Confirmed with Hector (2026-09-24) - not asserted as failures:
//   - Staging's `/T2UWebsite/media/Documents/...` media library isn't synced (confirmed 10/10
//     "Annual reports" PDFs 404 on Staging, all 200 on Live) - an environment sync gap, not a
//     real broken-link defect.
//   - `https://www.mygov.scot/clothing-grants` (linked from the "Back to School support" page,
//     confirmed present on both Staging and Live - the same real link either way, not
//     environment-specific) consistently resets the connection - confirmed via both Playwright
//     and a plain `curl` from this machine. A third-party gov.scot site issue outside Turn2us's
//     control, so it's noted rather than failed.
function isAcceptedBrokenOrExternalLink(url) {
    return url.includes('/T2UWebsite/media/Documents/') || url === 'https://www.mygov.scot/clothing-grants';
}

async function verifyPageButtonsNotBroken(page) {
    const buttons = await page.evaluate(() => {
        const isVisible = (el) => {
            const s = getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
        };
        return Array.from(document.querySelectorAll('a[href]'))
            .filter((a) => isVisible(a) && !a.closest('header, nav, footer, #main-nav'))
            .map((a) => ({ text: (a.textContent || '').replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') }));
    });

    for (const button of buttons) {
        if (!button.href || button.href === '#' || button.href.startsWith('javascript:')) {
            continue;
        }

        // expect.soft() - a page can have many independent links/files (e.g. the "Annual
        // reports" page alone has 10 PDF downloads), and one broken one shouldn't hide whether
        // the others are also broken, matching this file's established convention for exactly
        // this kind of "many independent items" scenario (see verifyTitleH1AndBreadcrumb etc.).
        await test.step(`"${button.text || button.href}" link`, async () => {
            if (button.href.startsWith('mailto:')) {
                expect.soft(button.href, `"${button.text}"'s mailto should contain a real-looking email address`).toMatch(/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/i);
                return;
            }
            if (button.href.startsWith('tel:')) {
                expect.soft(button.href, `"${button.text}"'s tel link should contain a real-looking phone number`).toMatch(/^tel:\+?[\d\s]+$/i);
                return;
            }

            const targetUrl = new URL(button.href, page.url()).toString();
            if (isAcceptedBrokenOrExternalLink(targetUrl)) {
                return;
            }

            let response;
            try {
                response = await page.request.get(targetUrl);
            } catch (error) {
                expect.soft(false, `"${button.text}"'s link (${targetUrl}) should be reachable: ${error.message}`).toBe(true);
                return;
            }
            const status = response.status();
            expect.soft(status, `"${button.text}"'s link (${targetUrl}) should not be a dead/not-found link`).not.toBe(404);
            expect.soft(status, `"${button.text}"'s link (${targetUrl}) should not return a server error`).toBeLessThan(500);
        });
    }
}

// Footer + "Back to top" are present in both the main site's template and the external tools'
// own template (different markup, same real behaviour) - confirmed via direct probing 2026-09-23.
async function verifyFooterAndBackToTop(page) {
    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'The page should show a footer').toBeVisible();

    const backToTop = footer.getByRole('link', { name: 'Back to top', exact: true }).first();
    await expect(backToTop, 'The footer should expose a "Back to top" control').toBeVisible();

    const scrollYBeforeClick = await page.evaluate(() => window.scrollY);
    await backToTop.click();

    // Some of these pages (e.g. the Benefits Calculator/Grants Search landing pages) are short
    // enough that scrolling the footer into view never actually moves the page away from the top
    // in the first place - confirmed via direct probing 2026-09-23 (scrollYBeforeClick is
    // genuinely 0 there). In that case there's nothing to scroll back FROM, so the control is
    // trivially satisfied by not needing to do anything - it's already there.
    if (scrollYBeforeClick <= 50) {
        return;
    }

    // Confirmed real, template-specific quirk 2026-09-23: the main site's own "Back to top"
    // lands within ~50px of the true top, but the PIP Helper external tool's own template stably
    // settles at ~179px (never 0) - almost certainly its sticky header consuming space above the
    // anchor target rather than a broken link, since it does genuinely scroll most of the way up.
    // A loose "scrolled most of the way back up" check accommodates that real per-template
    // variance without papering over an actually-broken "Back to top" (one that doesn't move the
    // page at all, or barely moves it).
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), {
        message: '"Back to top" should scroll the page back up to (or very near) the top',
    }).toBeLessThan(scrollYBeforeClick * 0.15);
}

async function runGetSupportPageTraversal(page, { name, titlePattern, h1Pattern }) {
    test.setTimeout(60000);

    await test.step(`Navigate to "${name}" via the "Get support" menu`, async () => {
        await navigateViaGetSupportMenu(page, name);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, `The title should match ${titlePattern}`).toHaveTitle(titlePattern);
    });

    await test.step('Verify exactly one H1, matching the expected name', async () => {
        await expect(page.locator('h1'), 'The page should have exactly one H1').toHaveCount(1);
        await expect(page.locator('h1').first(), `The H1 should match ${h1Pattern}`).toHaveText(h1Pattern);
    });

    await test.step('Verify the page\'s buttons/links are not broken', async () => {
        await verifyPageButtonsNotBroken(page);
    });

    await test.step('Verify the footer and its "Back to top" control', async () => {
        await verifyFooterAndBackToTop(page);
    });
}


// ============================================================================
// Coverage notes - "/get-support" landing page
// ============================================================================
// Per Hector's own instruction: reached via the "Get support" meganav
// panel's OWN link (not a submenu item) - confirmed via direct probing this
// is a real anchor with `href="/get-support"` inside the panel, whose
// accessible text reads "View Get support Get support" (a duplicated-text
// a11y quirk - the panel renders both a `.text-mobile` "View Get support"
// span and a `.text-desktop` "Get support" span simultaneously, one hidden
// by CSS per breakpoint, so a plain textContent() read picks up both). This
// doesn't match `navigateViaGetSupportMenu()`'s exact-label matching (used
// for the 6 standard submenu destinations earlier in this file), so a
// dedicated `navigateToGetSupportLandingPage()` helper below finds it by
// href instead.
//
// The landing page shows 8 real feature cards (`.ctaRowItem`, confirmed via
// direct probing 2026-09-24, read fresh - never hardcoded, since CMS-managed
// and may drift): "Search through our A-Z of benefits", "More benefits
// information", "Grants - frequently asked questions", "Find an adviser"
// (the ONE external, cross-domain card - opens in the SAME tab, confirmed
// via direct probing, not a new one despite being cross-origin), "Turn2us
// grants", "Back to School support", "Are you listed on Advice Finder?", and
// "Annual reports".
//
// Tests in this section:
//   1. Get Support - Landing Page Traversal
//      Standard checks (title/H1/breadcrumb/footer/back-to-top) plus
//      confirming exactly 8 real feature cards are present.
//   2. Get Support - Card Destinations Traversal
//      Per Hector: "the usual standard checks and a sense check of the body
//      contents... if there are links, ensure these work, if there are
//      downloadable files, check these work, but not going into further
//      detail." Loops the 7 same-site cards (excludes "Find an adviser",
//      which gets its own deep sub-traversal below), clicking each and
//      verifying title/H1/breadcrumb, a real non-trivial body, and every
//      on-page link/file (reusing `verifyPageButtonsNotBroken()`, which
//      already treats a PDF href like any other link - no special-casing
//      needed for "downloadable files").
//   3. Get Support - Benefit Guides A-Z Traversal
//      The "Search through our A-Z of benefits" card's destination
//      (`/get-support/information-about-benefits/a-z-of-benefits`) has a
//      real A-Z tab widget (`button.tab-list__toggle`, one per letter,
//      confirmed via direct probing 2026-09-24) - a genuinely disabled
//      button (real `disabled` attribute, not just a styling class) for any
//      letter with zero benefit guides, and a working ARIA tab/tabpanel
//      (`aria-controls`/`aria-selected`) for every enabled one. Every letter
//      is exercised: enabled letters must reveal real content, disabled
//      ones must genuinely stay inert.
//   4. Get Support - Find an Adviser Traversal
//      The "Find an adviser" card's destination is a wholly separate app
//      (`https://advicefinder.turn2us.org.uk/`, confirmed via direct probing
//      to use Cookiebot too, unlike the Benefits Calculator/Grants Search/
//      PIP Helper tools which have none). Its form (`#myt2uForm`) has a
//      Topic dropdown (`#Filters_SelectedTopicCode`), a postcode field
//      (`#Filters_Postcode`), a Distance dropdown
//      (`#Filters_SelectedProximity`), and a "Search" submit button.
//      Confirmed via direct probing: submitting with nothing filled shows 3
//      real validation messages (`.errorMessage`); several realistic
//      Topic+Postcode+Distance permutations (using the same example
//      postcodes - M335SH, SE173HE - established elsewhere in this
//      workspace) each return a real "X agencies found" result set.
//
// FINDINGS from the first full run (2026-09-24), reviewed with Hector the
// same day:
//   - ALL 10 of the "Annual reports" page's PDF download links 404 on
//     Staging while the exact same URLs return real `200`/`application/pdf`
//     on Live - confirmed as an accepted, known environment-sync gap (not
//     worth failing on), tracked via `isAcceptedBrokenOrExternalLink()`
//     below (matched by the shared `/T2UWebsite/media/Documents/` path
//     prefix, not 10 individual URLs).
//   - "Are you listed on Advice Finder?"'s destination breadcrumb ("Update
//     Advice Finder") doesn't relate to its own H1 ("Update your
//     organisation's information on Find an Adviser") by simple substring -
//     confirmed IDENTICAL on Live (same title/H1/breadcrumb triplet,
//     word-for-word), so this is a permanent, accepted naming quirk, not a
//     Staging-only defect - tracked in `ACCEPTED_NAMING_MISMATCHES` below.
//   - The "Back to School support" page (NOT "More benefits information" -
//     corrected after initially misattributing which card leads here) links
//     onward to "School uniform help in Scotland"
//     (https://www.mygov.scot/clothing-grants) - this third-party gov.scot
//     site consistently resets the connection (confirmed via both
//     Playwright's `request.get()` and a plain `curl` from this machine -
//     not a one-off flake - while `www.gov.uk` itself resolves fine from the
//     same machine at the same time). Confirmed the exact same link exists
//     on Live too, so this isn't Staging-specific either. Per Hector: since
//     it's an external URL outside Turn2us's control, this is left as a
//     note (via `isAcceptedBrokenOrExternalLink()`, not a failing
//     assertion) rather than something to fail the suite over.
//
// Confirmed real content quirk, not a defect: submitting the Find an
// Adviser form with a topic selected but a nonsense, non-UK-format postcode
// (e.g. "ZZZ999") shows NO validation error and still returns a full,
// unfiltered result set (confirmed: 29 "agencies found" for Topic=Benefits
// with that garbage postcode) - the tool only validates that the postcode
// field is non-empty, not that it's a real UK postcode format. Not asserted
// as a failure here since the tool doesn't crash or mislead, just doesn't
// geo-filter for an unparseable postcode - worth knowing, not worth failing.
// ============================================================================

const GET_SUPPORT_LANDING_CARD_NAMES = [
    'More benefits information',
    'Grants - frequently asked questions',
    'Turn2us grants',
    'Back to School support',
    'Are you listed on Advice Finder?',
    'Annual reports',
];

const FIND_AN_ADVISER_SEARCHES = [
    { topicLabel: 'Benefits', topicValue: '04BA', postcode: 'M335SH', distance: '10' },
    { topicLabel: 'Housing', topicValue: '04HD', postcode: 'SE173HE', distance: '25' },
    { topicLabel: 'Debt', topicValue: '04DE', postcode: 'M335SH', distance: '50' },
    { topicLabel: 'Mental Health', topicValue: '04MA', postcode: 'SE173HE', distance: '5' },
];

// Finds the "/get-support" landing page link by href, not by label text - its accessible text is
// "View Get support Get support" (see coverage notes above), which doesn't cleanly match the exact
// label matching `navigateViaGetSupportMenu()` uses for the 6 standard submenu destinations.
async function navigateToGetSupportLandingPage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    await openMenuIfPresent(page);

    const getSupportLink = page.locator('#main-nav > ul > li.nav__item').filter({
        has: page.locator(':scope > a', { hasText: buildLooseLabelPattern('Get support') }),
    }).locator(':scope > a').first();

    await getSupportLink.click();
    const panelId = await getSupportLink.getAttribute('aria-controls');
    const panel = page.locator(`#${panelId}`);
    await expect(panel, '"Get support" panel should be visible once expanded').toBeVisible();

    const landingLink = panel.locator('a[href="/get-support"]').first();
    await expect(landingLink, 'The "Get support" panel should expose its own landing-page link').toBeVisible();
    await landingLink.click();
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

async function readGetSupportLandingCards(page) {
    return page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        return Array.from(document.querySelectorAll('.ctaRowItem')).map((item) => {
            const heading = item.querySelector('h2, h3, h4');
            const link = item.querySelector('a.button, a');
            return {
                heading: normalize(heading?.textContent),
                linkText: normalize(link?.textContent),
                href: link?.getAttribute('href') || null,
            };
        }).filter((card) => card.href);
    });
}

test.describe('Get Support - Landing Page', () => {

test('Initial Page Load Tests', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Navigate to the "/get-support" landing page', async () => {
        await navigateToGetSupportLandingPage(page);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should match "Get support"').toHaveTitle(/Get support/i);
    });

    await test.step('Verify exactly one H1, matching "Get Support"', async () => {
        await expect(page.locator('h1'), 'The page should have exactly one H1').toHaveCount(1);
        await expect(page.locator('h1').first(), 'The H1 should match "Get Support"').toHaveText(/Get Support/i);
    });

    await test.step('Verify the breadcrumb', async () => {
        const breadcrumbNav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(breadcrumbNav, 'The page should show a breadcrumb').toBeVisible();
        await expect(breadcrumbNav, 'The breadcrumb should show "Get Support" as the current page').toContainText(/Get Support/i);
    });

    await test.step('Verify exactly 8 real feature cards are present', async () => {
        const cards = await readGetSupportLandingCards(page);
        expect(cards.length, 'The "/get-support" landing page should expose 8 real feature cards').toBe(8);
    });

    await test.step('Verify the footer and its "Back to top" control', async () => {
        await verifyFooterAndBackToTop(page);
    });
});

test('Card Destinations Traversal', async ({ page }) => {
    // 6 real destination pages, each with a title/H1/breadcrumb check, a body sense-check, and a
    // full links/downloadable-files sweep (the Annual Reports page alone has 10 PDF links) -
    // generous margin over a normal ~1-2 minute run.
    test.setTimeout(3 * 60 * 1000);

    for (const cardName of GET_SUPPORT_LANDING_CARD_NAMES) {
        await test.step(`"${cardName}"`, async () => {
            await navigateToGetSupportLandingPage(page);

            const cards = await readGetSupportLandingCards(page);
            const card = cards.find((c) => c.heading === cardName);
            expect(card, `The "/get-support" landing page should expose a "${cardName}" card`).toBeTruthy();

            const cardLink = page.locator('.ctaRowItem a.button', { hasText: card.linkText }).first();
            await cardLink.click();
            await page.waitForLoadState('load').catch(() => { });

            await test.step('Verify title, H1, and breadcrumb', async () => {
                await verifyTitleH1AndBreadcrumb(page, cardName);
            });

            await test.step('Sense-check the body has real content', async () => {
                const bodyText = (await page.locator('main').innerText().catch(() => '')).trim();
                expect(bodyText.length, `"${cardName}" should show real, non-trivial body content`).toBeGreaterThan(100);
            });

            await test.step('Verify every link and downloadable file on the page', async () => {
                await verifyPageButtonsNotBroken(page);
            });
        });
    }
});

test('Benefit Guides A-Z Traversal', async ({ page }) => {
    // 26 letters, most enabled and requiring a click + content check - generous margin over a
    // normal ~1-2 minute run.
    test.setTimeout(3 * 60 * 1000);

    await test.step('Navigate to the A-Z of Benefits page', async () => {
        await navigateToGetSupportLandingPage(page);
        const cards = await readGetSupportLandingCards(page);
        const card = cards.find((c) => c.heading === 'Search through our A-Z of benefits');
        expect(card, 'The "/get-support" landing page should expose a "Search through our A-Z of benefits" card').toBeTruthy();

        const cardLink = page.locator('.ctaRowItem a.button', { hasText: card.linkText }).first();
        await cardLink.click();
        await page.waitForLoadState('load').catch(() => { });

        await verifyTitleH1AndBreadcrumb(page, 'A-Z of Benefits');
    });

    const letters = await test.step('Read every letter tab fresh from the page', async () => {
        const items = await page.evaluate(() => Array.from(document.querySelectorAll('button.tab-list__toggle')).map((btn) => ({
            letter: btn.textContent.trim(),
            disabled: btn.disabled,
            panelId: btn.getAttribute('aria-controls'),
        })));
        expect(items.length, 'The A-Z of Benefits page should expose all 26 letter tabs').toBe(26);
        return items;
    });

    for (const { letter, disabled, panelId } of letters) {
        await test.step(`Letter "${letter}"${disabled ? ' (no results - should stay disabled)' : ''}`, async () => {
            const tabButton = page.locator('button.tab-list__toggle', { hasText: letter }).first();

            if (disabled) {
                expect.soft(await tabButton.isDisabled(), `Letter "${letter}" should genuinely be disabled (no benefit guides starting with it)`).toBe(true);
                return;
            }

            await tabButton.click();
            await expect.soft(tabButton, `Letter "${letter}" should become the selected tab once clicked`).toHaveAttribute('aria-selected', 'true');

            const panelText = (await page.locator(`#${panelId}`).innerText().catch(() => '')).trim();
            expect.soft(panelText.length, `Letter "${letter}" should reveal real benefit guide results`).toBeGreaterThan(letter.length);
        });
    }
});

test('Find an Adviser Traversal', async ({ page }) => {
    // 1 validation check + 4 real search permutations, each a full form submission - generous
    // margin over a normal ~1-2 minute run.
    test.setTimeout(3 * 60 * 1000);

    await test.step('Navigate to Find an Adviser (opens in the same tab)', async () => {
        await navigateToGetSupportLandingPage(page);
        const cards = await readGetSupportLandingCards(page);
        const card = cards.find((c) => c.heading === 'Find an adviser');
        expect(card, 'The "/get-support" landing page should expose a "Find an adviser" card').toBeTruthy();
        expect(card.href, 'The "Find an adviser" card should link to the external AdviceFinder tool').toContain('advicefinder.turn2us.org.uk');

        const cardLink = page.locator('.ctaRowItem a', { hasText: card.linkText }).first();
        await cardLink.click();
        await page.waitForLoadState('load').catch(() => { });

        await expect(page, 'The AdviceFinder tool should have a real title').toHaveTitle(/AdviceFinder|Find an Adviser/i);
        await expect(page.locator('h1').first(), 'The AdviceFinder tool should show a "Find an Adviser" H1').toHaveText(/Find an Adviser/i);

        // This external tool ALSO uses Cookiebot (unlike the Benefits Calculator/Grants Search/PIP
        // Helper tools, confirmed via direct probing 2026-09-24 to have none) - dismiss it before
        // interacting with the form.
        await waitForAndAcceptCookieBanner(page);
    });

    await test.step('Submitting with nothing filled shows real validation messages', async () => {
        await page.locator('button[type=submit]').click();
        await page.waitForLoadState('load').catch(() => { });

        const errors = await page.evaluate(() => Array.from(document.querySelectorAll('.errorMessage')).map((el) => el.textContent.trim()).filter(Boolean));
        expect(errors.length, 'Submitting with nothing filled should show real validation messages').toBeGreaterThan(0);
        expect(errors.some((message) => /topic/i.test(message)), 'A missing-topic validation message should be shown').toBe(true);
        expect(errors.some((message) => /postcode/i.test(message)), 'A missing-postcode validation message should be shown').toBe(true);
    });

    for (const search of FIND_AN_ADVISER_SEARCHES) {
        await test.step(`Search: Topic="${search.topicLabel}", Postcode="${search.postcode}", Distance="Up to ${search.distance} miles"`, async () => {
            await page.selectOption('#Filters_SelectedTopicCode', search.topicValue);
            await page.fill('#Filters_Postcode', search.postcode);
            await page.selectOption('#Filters_SelectedProximity', search.distance);
            await page.locator('button[type=submit]').click();
            await page.waitForLoadState('load').catch(() => { });

            const bodyText = await page.evaluate(() => document.body.innerText);
            expect(bodyText, `Searching Topic="${search.topicLabel}" near "${search.postcode}" should show a real "agencies found" result`).toMatch(/\d+\s+agenc(y|ies)\s+found/i);
        });
    }
});

}); // end test.describe('Get Support - Landing Page')

// ============================================================================
// Coverage notes - "Benefits Calculator - Your Situation Traversal"
// ============================================================================
// Card 3 of the Benefits Calculator landing page's feature-card component -
// "Your Situation (Opens in a new tab)", confirmed via direct probing
// 2026-09-23/24 to link to `https://staging.turn2us.org.uk/Your-Situation
// #A-Z`, which redirects to the SAME page already covered by
// 01-turn2us.homepage.spec.js-adjacent "Get Support - Information for your
// Situation Traversal" above (`/get-support/information-for-your-situation`)
// - confirmed real, not a mistake.
//
// That page lists 15 real "situation" cards (`.ctaRowItem`, each with an
// `a.button` link) - read fresh from the DOM every run, never hardcoded,
// since the list is CMS-managed. This test opens the page (in its own new
// tab, matching the card's real target="_blank"), then visits EVERY one of
// the 15 destination pages and, on each, verifies:
//   - Title, H1, and breadcrumb are all present and mutually consistent.
//     Confirmed via direct probing that these 3 don't always match
//     word-for-word (e.g. H1 "Support with the Cost of Living" vs
//     breadcrumb's final crumb "Cost of Living") but one is reliably a
//     case-insensitive substring of the other across every page checked -
//     verified generically that way rather than hardcoding 15 exact
//     patterns, matching this file's established "don't assume the label
//     matches the destination" convention (see the "Turn2us Grants
//     Programmes" -> "Apply for Grants" note above).
//   - The in-page navigation device (`.inPageNavigation a`, confirmed to
//     scroll-and-anchor to real `#`-hash section headings) works both
//     forward (clicking the LAST link) and backward (clicking the FIRST
//     link afterward) - both directions exercised on every page, per
//     Hector's "either moving forward or clicking a title backwards"
//     instruction (both is a superset of "either").
//   - The "Share" section shows exactly 3 real sharing options (confirmed:
//     a "Copy page link" button, a WhatsApp share link, a Facebook share
//     link - `div.container:has(> h2:text-is("Share")) li`).
//   - The standard footer and its "Back to top" control (reusing
//     `verifyFooterAndBackToTop()` from earlier in this file).
//
// No "no dead links" button check is included here (unlike the standard
// `runGetSupportPageTraversal`) - not part of what Hector asked for this
// sub-traversal, which is scoped to title/H1/breadcrumb + in-page nav +
// Share + footer only.
//
// This test is genuinely long (15 full page navigations, each with 2
// in-page-nav clicks and a footer/back-to-top round trip) - generous
// timeout accordingly. `expect.soft()` is used throughout the 3 per-page
// verify helpers below so one card's real defect doesn't stop the other 14
// from being checked in the same run.
//
// FINDINGS from the first full run (2026-09-24), reviewed and confirmed BY
// HECTOR AS ACCEPTED/NOT BUGS the same day - tracked below as known,
// named exceptions (`ACCEPTED_NAMING_MISMATCHES` /
// `ACCEPTED_NO_IN_PAGE_NAV_OR_SHARE`) rather than left as failing
// assertions, so the suite stays green while still catching anything NEW
// that shows up on a different card in a future run:
//   - "Energy and Water Bills": the `<title>` reads "...Energy and Water
//     Schemes | Turn2us" while the H1 and breadcrumb both read "...Energy
//     and Water Bills".
//   - "Studying": title "Studying (16+) | Turn2us" vs H1 "Studying (aged
//     16+)" - the title drops the word "aged".
//   - "Bringing up a child", "Disabled, ill or injured", "Work &
//     Unemployment", and "Immigration" genuinely have NEITHER an in-page
//     navigation device NOR a Share section. For the first 3, confirmed via
//     direct probing these are simply thinner content pages (only 1 real
//     `<h2>` section each). "Immigration" is the one exception that doesn't
//     fit that pattern (7 real `<h2>` sections - more than "Studying"'s 5,
//     which DOES get a nav) but is accepted as fine per Hector regardless.
// ============================================================================

// Confirmed with Hector (2026-09-24) as accepted, non-bug variances - see the coverage notes
// above for what was found on each and why. Named by card heading so a NEW card developing either
// issue in the future still fails loudly instead of silently passing.
//
// Membership is checked case-insensitively (via `hasCaseInsensitive` below) - confirmed via direct
// probing 2026-09-25 that the SAME "Your Situation" page's card headings can come back with
// slightly different capitalization depending on the entry point/session (e.g. "Energy and Water
// Bills" vs "Energy and water bills") despite being the exact same destination and the exact same
// underlying quirk, so an exact-case Set would otherwise flag a non-issue as a brand new finding.
const ACCEPTED_NAMING_MISMATCHES = new Set(['Energy and Water Bills', 'Studying', 'Are you listed on Advice Finder?', 'Grants - what you need to know']);
const ACCEPTED_NO_IN_PAGE_NAV_OR_SHARE = new Set(['Bringing up a child', 'Disabled, ill or injured', 'Work & Unemployment', 'Immigration']);

function hasCaseInsensitive(set, value) {
    const normalized = (value || '').trim().toLowerCase();
    for (const entry of set) {
        if (entry.trim().toLowerCase() === normalized) return true;
    }
    return false;
}

// One of `a` or `b` reliably contains the other across every situation destination page checked
// during exploration (confirmed via direct probing 2026-09-23/24) - a paraphrase-tolerant
// consistency check rather than assuming exact string equality between title/H1/breadcrumb.
function oneContainsTheOther(a, b) {
    const normalizedA = (a || '').trim().toLowerCase();
    const normalizedB = (b || '').trim().toLowerCase();
    if (!normalizedA || !normalizedB) return false;
    return normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA);
}

// expect.soft() is used throughout these 3 verify functions, not expect() - they run in a loop
// across 15 independent destination pages (see the test below), and one page's real defect
// shouldn't stop the other 14 from being checked, matching this workspace's established
// convention for exactly this kind of "many independent items in a loop" scenario (e.g. MCC's
// accordion sweep).
// `skipTitleCheck`: confirmed with Hector 2026-09-25 that on the "Your Situation" 15-card sweep
// specifically, the site's <title> tags are SEO-worded independently of the H1/breadcrumb on
// nearly every card - a systemic, accepted site-wide pattern rather than a per-page defect, so
// callers covering that sweep pass `true` to skip only the title-vs-H1/breadcrumb comparison
// (title is still checked for being non-empty, and H1-vs-breadcrumb consistency is still checked).
async function verifyTitleH1AndBreadcrumb(page, label, skipTitleCheck = false) {
    const title = (await page.title()).trim();
    expect.soft(title.length, `"${label}" should have a non-empty page title`).toBeGreaterThan(0);

    const h1Count = await page.locator('h1').count();
    expect.soft(h1Count, `"${label}" should have exactly one H1`).toBe(1);
    const h1Text = (await page.locator('h1').first().textContent().catch(() => '') || '').trim();
    expect.soft(h1Text.length, `"${label}" should have a non-empty H1`).toBeGreaterThan(0);

    const breadcrumbNav = page.locator('nav[aria-label="Breadcrumb"]');
    const breadcrumbVisible = await breadcrumbNav.isVisible().catch(() => false);
    expect.soft(breadcrumbVisible, `"${label}" should show a breadcrumb`).toBe(true);

    const currentCrumb = breadcrumbNav.locator('[aria-current="page"]').first();
    const crumbText = (await currentCrumb.textContent().catch(() => '') || '').trim();
    expect.soft(crumbText.length, `"${label}"'s current breadcrumb item should have real text`).toBeGreaterThan(0);

    if (!hasCaseInsensitive(ACCEPTED_NAMING_MISMATCHES, label)) {
        expect.soft(oneContainsTheOther(h1Text, crumbText), `"${label}"'s H1 ("${h1Text}") and breadcrumb ("${crumbText}") should be consistent with each other`).toBe(true);
        if (!skipTitleCheck) {
            expect.soft(oneContainsTheOther(title, crumbText) || oneContainsTheOther(title, h1Text), `"${label}"'s title ("${title}") should relate to its H1/breadcrumb`).toBe(true);
        }
    }
}

async function verifyInPageNavigationDevice(page, label) {
    if (hasCaseInsensitive(ACCEPTED_NO_IN_PAGE_NAV_OR_SHARE, label)) {
        return;
    }

    const navLinks = page.locator('.inPageNavigation a');
    const count = await navLinks.count();
    expect.soft(count, `"${label}" should show an in-page navigation device with at least 2 sections`).toBeGreaterThanOrEqual(2);
    if (count < 2) return;

    async function clickLinkAndVerifyAnchor(index, direction) {
        const link = navLinks.nth(index);
        const href = await link.getAttribute('href');
        const targetId = href.slice(1);

        await link.click();

        // Polled manually (not via expect.poll, which always throws hard on failure) so this can
        // still report via expect.soft() - the scroll itself can be browser-native smooth-
        // scrolling, so a single snapshot shortly after the click can catch it mid-animation under
        // slower conditions. Confirmed via direct probing that the same click reliably lands the
        // target in view once the scroll settles.
        let inView = false;
        for (let attempt = 0; attempt < 10 && !inView; attempt++) {
            inView = await page.evaluate((id) => {
                const el = document.getElementById(id);
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                return rect.top >= -80 && rect.top <= window.innerHeight * 0.75;
            }, targetId);
            if (!inView) await page.waitForTimeout(300);
        }
        expect.soft(inView, `"${label}": clicking the in-page nav link "${href}" (${direction}) should scroll its target section into view`).toBe(true);
        expect.soft(page.url(), `"${label}": clicking the in-page nav link "${href}" (${direction}) should update the URL hash`).toContain(href);
    }

    // Forward (down the page) then backward (back up) - exercises the device in both directions.
    await clickLinkAndVerifyAnchor(count - 1, 'forward');
    await clickLinkAndVerifyAnchor(0, 'backward');
}

async function verifyShareSection(page, label) {
    if (hasCaseInsensitive(ACCEPTED_NO_IN_PAGE_NAV_OR_SHARE, label)) {
        return;
    }

    const shareContainer = page.locator('div:has(> h2:text-is("Share"))').first();
    const shareVisible = await shareContainer.isVisible().catch(() => false);
    expect.soft(shareVisible, `"${label}" should show a "Share" section`).toBe(true);
    if (!shareVisible) return;

    const shareItemCount = await shareContainer.locator('li').count();
    expect.soft(shareItemCount, `"${label}"'s Share section should expose exactly 3 sharing options`).toBe(3);
}

test.describe('Get Support - Benefits Calculator', () => {
    test('Initial Page Load Tests', async ({ page }) => {
        const benefitsCalculatorDestination = GET_SUPPORT_DESTINATIONS.find((d) => d.name === 'Benefits Calculator');
        await runGetSupportPageTraversal(page, benefitsCalculatorDestination);
    });

    test('Feature Cards are Present', async ({ page }) => {
    await test.step('Navigate to the Benefits Calculator landing page', async () => {
        await navigateViaGetSupportMenu(page, 'Benefits Calculator');
    });

    await test.step('Verify the feature-card component has 3 cards', async () => {
        await expect(page.locator('.feature-card'), 'The Benefits Calculator landing page should show 3 feature cards').toHaveCount(3);
    });

    await test.step('Verify card 1 ("Use the Turn2us Benefits Calculator") is present', async () => {
        await expect(page.getByRole('link', { name: 'Use the Turn2us Benefits Calculator', exact: true }), 'Card 1\'s link should be visible').toBeVisible();
    });
});

// Confirmed via direct probing 2026-09-23: card 1's link and the page's own hero "Get Started"
// button share the exact same destination (/survey).
test('Use the Turn2us Benefits Calculator Traversal', async ({ page }) => {
    await test.step('Navigate to the Benefits Calculator landing page', async () => {
        await navigateViaGetSupportMenu(page, 'Benefits Calculator');
    });

    await test.step('Click "Use the Turn2us Benefits Calculator"', async () => {
        const card1Link = page.getByRole('link', { name: 'Use the Turn2us Benefits Calculator', exact: true });
        const expectedHref = await card1Link.getAttribute('href');

        const getStartedButton = page.getByRole('link', { name: 'Get Started', exact: true });
        expect(await getStartedButton.getAttribute('href'), 'Card 1 and the page\'s own "Get Started" button should share the same destination').toBe(expectedHref);

        await card1Link.click();
        await page.waitForLoadState('load').catch(() => { });
    });

    await test.step('Verify the wizard\'s first screen', async () => {
        // The page title does contain "Benefits Calculator" (the clicked-through name), but per
        // Hector's own instruction the H1 does NOT need to match it - the wizard's first real
        // screen has its own H1 ("Before We Begin"), which is expected and fine.
        await expect(page, 'The wizard entry page\'s title should still contain "Benefits Calculator"').toHaveTitle(/Benefits Calculator/i);
        await expect(page.locator('h1'), 'The wizard entry page should have exactly one H1').toHaveCount(1);
        await expect(page.locator('h1').first(), 'The wizard entry page should show a real H1').not.toHaveText('');
    });
});

// ============================================================================
// Coverage notes - "Benefits Calculator - Full Journey (Reference)"
// ============================================================================
// This is the FIRST deterministic, end-to-end walkthrough of the full
// Benefits Calculator wizard (~18 real screens), following the exact
// reference journey dictated by Hector from a manual walkthrough
// (2026-09-23/24) - see docs/benefits-calculator-journey.md
// It is a single fixed path (not a permutation sweep - that is
// separate future work per Hector's own phased plan). Every selector below
// was captured by live-probing the real DOM with a throwaway
// playwright-core script (screen by screen), not guessed from the text
// description, since this is a JS wizard where visual descriptions never
// match real markup precisely.
//
// Real site quirks/defects confirmed while building this test (documented
// here per this workspace's convention, rather than silently worked around):
//
//   - Duplicate `id` attributes: every question's help-text panel reuses the
//     SAME id as its own input/fieldset (e.g. both the postcode's real
//     `<input id="ClientPostcode">` and its `<div id="ClientPostcode">`
//     help-text panel share one id). This is invalid HTML (ids must be
//     unique) and a real a11y risk (aria-controls/label associations can
//     resolve to the wrong node), confirmed via direct DOM inspection across
//     many screens - not a one-off typo. Not turned into a failing assertion
//     here (it would prevent this reference journey from ever passing, and
//     every `.first()` in this test already deliberately targets the real
//     input over its help panel), but flagged here as a genuine, sitewide
//     defect worth a dev ticket.
//   - The council tax "Would you like us to use your address..." Yes option
//     has an `id`/`name` value that is itself a full sentence containing a
//     comma ("bandLookup_Yes, I would like to tell you my address") -
//     technically not a valid HTML4 id token, though modern browsers accept
//     it. Another sitewide markup-hygiene quirk, not a functional bug.
//   - The council tax "Change Band" control's "undo" depth is inconsistent:
//     from an already-selected address it sometimes returns straight to the
//     original "Look this up for me / Band A-I" choice in one click, and
//     other times needs a second click via an intermediate ADDRESS SEARCH
//     table first (confirmed via repeated live probing - both were observed
//     across different runs with identical inputs). Hector's original
//     walkthrough described a single "Change Band" click landing on "Band A"
//     directly. This test clicks "Change Band" up to twice, stopping as soon
//     as the top-level Band A option becomes available, so it tolerates
//     either real behaviour instead of assuming one.
//   - Real, expected postcode-specific data drift: Hector's original
//     walkthrough's postcode returned an address ("41 Barkers Lane"); the
//     same postcode used here (M335SH) currently returns different real
//     addresses ("1/2/3 Hockerley Close", all Band C) from the live address
//     lookup service. This is real backing-data variance, not a bug, which
//     is exactly why this test selects the first returned address generically
//     (by role, not by hardcoded address text) rather than asserting a
//     specific address name.
//   - Several fields that render as "required" in the markup are actually
//     conditionally hidden for this answer combination, and Playwright
//     correctly fails to click/fill them if attempted: "What is the
//     immigration status..." / "...right to reside" (only shown if the
//     household-citizenship question is answered "No" - answered "Yes" here
//     to keep the reference journey simple), "Are you registered blind?"
//     (only shown if "Do you consider yourself to have an illness or
//     disability?" = Yes), "Is this work 'permitted work'..." (only shown
//     for low incomes - not relevant at the reference journey's £50k
//     salary), and the rent "how many weeks/how many bedrooms" fields (not
//     applicable for the refuge/temporary-accommodation housing status used
//     here). All confirmed via live probing, not assumed.
//   - A modal ("Important information about your answer") appears after
//     entering the owned-property's value and must be dismissed via its
//     "Close" button before the form can proceed - a real, deliberate UX
//     interstitial, not a bug; exercised (and closed) below.
//
// Generous timeout: this is a genuinely long, ~18-screen SPA journey with
// real network waits between screens (postcode/address lookups, band
// lookups, page transitions) - 8 minutes gives realistic headroom without
// masking a real hang.
test('Full Journey (Reference)', async ({ page }) => {
    test.setTimeout(8 * 60 * 1000);

    // Selects a Yes/No (or similarly-suffixed) radio option via its label - the wizard consistently
    // renders `<input id="{field}_{value}"><label for="{field}_{value}">`, whether the suffix is
    // Yes/No or an index (e.g. "_0"). Confirmed via live probing across many screens.
    async function selectOption(fieldSuffix) {
        await page.locator(`label[for="${fieldSuffix}"]`).first().click();
        await page.waitForTimeout(200);
    }

    // Fills a text field by id and tabs out (some fields only commit/validate on blur).
    async function fillField(id, value) {
        await page.locator(`#${id}`).first().fill(value);
        await page.locator(`#${id}`).first().press('Tab');
        await page.waitForTimeout(200);
    }

    // A recurring "amount + Weekly/Monthly/Yearly" money pattern used throughout the wizard
    // (rent, income, pensions, etc.) - confirmed to always follow `{field}` (the £ amount input)
    // plus `{field}_{Period}` (a radio) across every money question in the tool.
    async function fillMoney(field, amount, period) {
        await fillField(field, String(amount));
        await selectOption(`${field}_${period}`);
    }

    // The wizard is a real SPA - "Next"/"Back" don't trigger full page loads, so we settle on
    // networkidle plus a short buffer rather than waitForLoadState('load').
    // Clicking Next/Back occasionally needs a retry: the wizard briefly keeps its Next button
    // disabled right after the last required answer is set (a real client-side validation-timing
    // quirk, confirmed via repeated live probing), so a click landing in that narrow window is
    // silently swallowed by the browser (disabled buttons don't fire click handlers even under
    // Playwright's `force: true`). Retrying against the current H1 text makes this deterministic
    // without masking a genuine navigation failure (which would still exhaust all retries).
    async function clickAndAwaitScreenChange(buttonName) {
        const previousH1 = await page.locator('h1').first().textContent().catch(() => null);
        for (let attempt = 0; attempt < 5; attempt++) {
            await page.locator(`button[name=${buttonName}]`).first().click({ force: true });
            await page.waitForLoadState('networkidle').catch(() => { });
            await page.waitForTimeout(700);
            const currentH1 = await page.locator('h1').first().textContent().catch(() => null);
            if (currentH1 !== previousH1) {
                return;
            }
            await page.waitForTimeout(500);
        }
    }
    async function clickNext() {
        await clickAndAwaitScreenChange('btnNext');
    }
    async function clickBack() {
        await clickAndAwaitScreenChange('btnBack');
    }

    await test.step('Navigate to the Benefits Calculator landing page and enter the wizard', async () => {
        await navigateViaGetSupportMenu(page, 'Benefits Calculator');
        await page.getByRole('link', { name: 'Use the Turn2us Benefits Calculator', exact: true }).click();
        await page.waitForLoadState('load').catch(() => { });
        await page.waitForSelector('h1', { timeout: 15000 }).catch(() => { });
    });

    await test.step('"Before We Begin" - exercise the validation-then-clear mechanic, then answer all 4 questions', async () => {
        await expect(page.locator('h1').first(), 'The wizard\'s first real screen should be "Before We Begin"').toHaveText(/Before We Begin/i);

        const requiredFields = ['ClientMemberHousehold', 'ClientPartnerStudent', 'ClientPartnerPrison', 'ClientPartnerHospital'];

        // Click Next with nothing answered - every required Yes/No question should be flagged.
        await page.locator('button[name=btnNext]').first().click({ force: true });
        await page.waitForTimeout(600);
        let invalidCount = await page.locator('.is-invalid').count();
        expect(invalidCount, 'Clicking Next with none of the 4 required questions answered should flag all of them as invalid').toBeGreaterThan(0);
        let unanswered = invalidCount / 2; // both the Yes and No label of each unanswered question get flagged
        expect(unanswered, 'All 4 required questions should be unanswered/invalid at this point').toBe(requiredFields.length);

        // Answer them one at a time, confirming the invalid count drops by exactly one question each time.
        const answers = { ClientMemberHousehold: 'Yes', ClientPartnerStudent: 'No', ClientPartnerPrison: 'No', ClientPartnerHospital: 'No' };
        for (const field of requiredFields) {
            await selectOption(`${field}_${answers[field]}`);
            invalidCount = await page.locator('.is-invalid').count();
            unanswered -= 1;
            expect(invalidCount / 2, `After answering "${field}", exactly one fewer question should remain unanswered/invalid`).toBe(unanswered);
        }
        expect(unanswered, 'All 4 required questions should be answered now').toBe(0);

        await clickNext();
    });

    await test.step('"Let\'s Get Started" - confirm Back preserves the previous screen\'s answers, then proceed', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Let\'s Get Started"').toHaveText(/Let's Get Started/i);

        await clickBack();
        await expect(page.locator('h1').first(), 'Back should return to "Before We Begin"').toHaveText(/Before We Begin/i);
        await expect(page.locator('label[for="ClientMemberHousehold_Yes"]'), 'The household-citizenship "Yes" answer should still be selected after Back').toHaveClass(/active/);
        await expect(page.locator('label[for="ClientPartnerHospital_No"]'), 'The partner-hospital "No" answer should still be selected after Back').toHaveClass(/active/);

        await clickNext();
        await expect(page.locator('h1').first(), 'Next should return to "Let\'s Get Started"').toHaveText(/Let's Get Started/i);
        await clickNext();
    });

    await test.step('"About You" - validation-first, fill postcode/partner/DOB, then edit the postcode via Back + "Change your answer"', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "About You"').toHaveText(/About You/i);

        await page.locator('button[name=btnNext]').first().click({ force: true });
        await page.waitForTimeout(600);
        expect(await page.locator('.is-invalid').count(), 'Clicking Next with the required "About You" fields empty should flag them as invalid').toBeGreaterThan(0);

        await fillField('ClientPostcode', 'M335SH');
        await selectOption('ClientLiveWithPartner_No');
        await fillField('ClientDob', '27/06/1981');
        await expect(page.locator('.is-invalid'), 'All "About You" validation should clear once the required fields are filled').toHaveCount(0);
        await clickNext();

        await expect(page.locator('h1').first(), 'The next screen should be "Current Benefits"').toHaveText(/Current Benefits/i);
        await clickBack();
        await expect(page.locator('h1').first(), 'Back should return to "About You"').toHaveText(/About You/i);

        const changeAnswerButtons = page.getByRole('button', { name: /Change your answer/i });
        await expect(changeAnswerButtons.first(), 'Previously-answered privacy-protected fields should show a "Change your answer" button after Back').toBeVisible();

        await changeAnswerButtons.first().click();
        await page.waitForTimeout(400);
        await expect(page.locator('#ClientPostcode').first(), 'The postcode field should be editable again after clicking its "Change your answer" button').toBeVisible();
        await page.locator('#ClientPostcode').first().fill('M336SH');
        await page.locator('#ClientPostcode').first().press('Tab');
        await page.waitForTimeout(300);
        await expect(page.locator('#ClientPostcode').first(), 'The postcode should now reflect the updated value').toHaveValue('M336SH');

        await clickNext();
        await expect(page.locator('h1').first(), 'Next should return to "Current Benefits"').toHaveText(/Current Benefits/i);
    });

    await test.step('"Current Benefits"', async () => {
        await clickNext();
        await selectOption('ClientPartnerReceivingBens_No');
        await clickNext();
    });

    await test.step('"Health"', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Health"').toHaveText(/^Health$/i);
        await clickNext();
        await expect(page.locator('h1').first(), 'The following screen should be "Your Health"').toHaveText(/Your Health/i);
        await selectOption('ClientSicknessDisability_No');
        await clickNext();
    });

    await test.step('"Caring For Someone" - another Back-preserves-state check', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Caring For Someone"').toHaveText(/Caring For Someone/i);

        await clickBack();
        await expect(page.locator('h1').first(), 'Back should return to "Your Health"').toHaveText(/Your Health/i);
        await expect(page.locator('label[for="ClientSicknessDisability_No"]'), 'The illness/disability "No" answer should still be selected after Back').toHaveClass(/active/);

        await clickNext();
        await expect(page.locator('h1').first(), 'Next should return to "Caring For Someone"').toHaveText(/Caring For Someone/i);
        await clickNext();
    });

    await test.step('"You As A Carer"', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "You As A Carer"').toHaveText(/You As A Carer/i);
        await selectOption('ClientCarer_No');
        await clickNext();
    });

    await test.step('"Children In Your Life"', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Children In Your Life"').toHaveText(/Children In Your Life/i);
        await clickNext();
        await expect(page.locator('h1').first(), 'The following screen should be "About Your Children"').toHaveText(/About Your Children/i);
        await selectOption('ClientIsApprovedFosterCarer_No');
        await selectOption('ClientHasChildren_No');
        await clickNext();
    });

    await test.step('"Your Home" -> "About Your Home" - temporary accommodation / staying in a refuge', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Your Home"').toHaveText(/Your Home/i);
        await clickNext();
        await expect(page.locator('h1').first(), 'The following screen should be "About Your Home"').toHaveText(/About Your Home/i);

        await selectOption('ClientHousingStatus_5'); // "I'm in temporary accommodation"
        await selectOption('ClientTempAccommStatus_1'); // "I am staying in a refuge"
        await clickNext();
    });

    await test.step('"Your Tenancy"', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Your Tenancy"').toHaveText(/Your Tenancy/i);
        await fillMoney('ClientRent', 900, 'Monthly');
        await clickNext();
    });

    await test.step('"Your Council Tax" - look up the band via postcode, then select Band A via the "Change Band" flow', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Your Council Tax"').toHaveText(/Your Council Tax/i);

        await selectOption('CouncilTaxExempt_No');
        await page.locator('label[for="Band_0"]').first().click(); // "Look this up for me"
        await page.waitForTimeout(300);
        await page.locator('label[for="bandLookup_Yes, I would like to tell you my address"]').first().click();
        await page.waitForTimeout(800);

        // Resilience: the live address-lookup service occasionally reports itself temporarily
        // unavailable ("Currently we cannot look up your council tax band...", confirmed seen once
        // during exploration). When that happens, fall back to entering the band manually via its
        // own "Enter band" button rather than failing the whole journey on a third-party outage.
        const addressRow = page.locator('table tbody tr').first();
        const rowAppeared = await addressRow.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
        if (rowAppeared) {
            await addressRow.getByRole('button', { name: 'Select' }).click();
            await page.waitForTimeout(500);
            await expect(page.locator('#councilTaxBand'), 'Selecting an address should populate a looked-up council tax band').not.toHaveValue('');

            // "Change Band" returns you toward the original "Look this up for me / Band A-I" choice -
            // confirmed via live probing that this can take either one or two clicks depending on
            // internal state (sometimes it lands on an intermediate address-search screen first).
            // Click it (up to twice) until the top-level "Band A" option is reachable.
            const topLevelBandA = page.locator('label[for="Band_1"]');
            for (let attempt = 0; attempt < 2; attempt++) {
                if (await topLevelBandA.first().isVisible().catch(() => false)) {
                    break;
                }
                await page.getByRole('button', { name: 'Change Band' }).first().click();
                await page.waitForTimeout(800);
            }
        } else {
            await page.getByRole('button', { name: 'Enter band' }).first().click();
            await page.waitForTimeout(500);
        }

        await page.locator('label[for="Band_1"]').first().click(); // "Band A"
        await page.waitForTimeout(300);
        await clickNext();
    });

    await test.step('"Money And Work" -> "Your Working Status" - Working, Employed + In the reserve forces, 40 hours/week', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Money And Work"').toHaveText(/Money And Work/i);
        await clickNext();
        await expect(page.locator('h1').first(), 'The following screen should be "Your Working Status"').toHaveText(/Your Working Status/i);

        await selectOption('BetterOffCalc_No');
        await selectOption('ClientWorking_0'); // "Working"
        await selectOption('ClientWorkStatus_0'); // "Employed"
        await selectOption('ClientWorkStatus_7'); // "In the reserve forces"
        await fillField('ClientWorkHours', '40');
        await clickNext();
    });

    await test.step('"Your Work Income" - employment 50000/Yearly, reserve forces 10000/Yearly, pension Yes 500/Monthly', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Your Work Income"').toHaveText(/Your Work Income/i);
        await fillMoney('ClientIncomeExpected', 50000, 'Yearly');
        await fillMoney('ClientIncomeExpectedReserveForces', 10000, 'Yearly');
        await selectOption('ClientPayingPension_Yes');
        await fillMoney('ClientPensionPayment', 500, 'Monthly');
        await clickNext();
    });

    await test.step('"Your War Pensions Income" - No', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Your War Pensions Income"').toHaveText(/Your War Pensions Income/i);
        await selectOption('ClientWarPension_No');
        await clickNext();
    });

    await test.step('"Non Work Income" - Yes, 300/Monthly', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Non Work Income"').toHaveText(/Non Work Income/i);
        await selectOption('ClientSpousalMaintenance_Yes');
        await fillMoney('ClientIncomeSpousalMaintenance', 300, 'Monthly');
        await clickNext();
    });

    await test.step('"Your Savings & Property" -> "The Property You Own" - Yes, £400,000, no mortgage, not occupied by a disregarded person', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Your Savings & Property"').toHaveText(/Your Savings & Property/i);
        await clickNext();
        await expect(page.locator('h1').first(), 'The following screen should be "The Property You Own"').toHaveText(/The Property You Own/i);

        await selectOption('ClientPropertyCommercial_Yes');
        await fillField('ClientPartnerPropertyValue', '400000');

        // A real "Important information about your answer" modal appears here and must be closed
        // before the rest of the form is interactable - see coverage notes above.
        const closeModalButton = page.getByRole('button', { name: 'Close' });
        await expect(closeModalButton.first(), 'The "Important information about your answer" modal should appear after entering the property value').toBeVisible();
        await closeModalButton.first().click();

        await selectOption('ClientPartnerPropertyMortgage_No');
        await selectOption('ClientPartnerPropertyLDisregard_No');
        await selectOption('ClientPartnerPropertySDisregard_No');

        const secondModal = page.getByRole('button', { name: 'Close' });
        if (await secondModal.first().isVisible().catch(() => false)) {
            await secondModal.first().click();
        }

        await clickNext();
    });

    await test.step('"Your Savings And Non-Property Assets" - £125,000', async () => {
        await expect(page.locator('h1').first(), 'The next screen should be "Your Savings And Non-Property Assets"').toHaveText(/Your Savings And Non-Property Assets/i);
        await fillField('ClientCurrentCapital', '125000');
        await clickNext();
    });

    await test.step('"Your Results" - reach the real results page', async () => {
        await expect(page.locator('h1').first(), 'The penultimate screen should be "Your Results"').toHaveText(/Your Results/i);

        // This final Next is a real page navigation (to a /result/... URL), not a same-page SPA
        // transition, and both the pre- and post-navigation screens share the same "Your Results"
        // H1 text - so the generic `clickNext()` (which waits for the H1 to change) can't detect
        // this transition. Click directly and wait for the URL instead.
        await page.locator('button[name=btnNext]').first().click({ force: true });
        await expect.poll(() => page.url(), {
            message: 'Submitting the final screen should navigate to a real /result/ URL',
        }).toMatch(/\/result\//);
        await page.waitForLoadState('networkidle').catch(() => { });
        await expect(page.locator('h1').first(), 'The real results page should also be headed "Your Results"').toHaveText(/Your Results/i);
    });

    await test.step('Verify the results page\'s buttons/links are not broken (Start Survey is only checked via request, not clicked through)', async () => {
        await verifyPageButtonsNotBroken(page);
    });

    await test.step('Verify the results page\'s footer and "Back to top" control', async () => {
        await verifyFooterAndBackToTop(page);
    });
});

// ============================================================================
// Coverage notes - "Benefits Calculator - Return to a Calculation Traversal"
// ============================================================================
// Card 2 of the Benefits Calculator landing page's feature-card component -
// "Return to a calculation" (a form: Calculation Reference + Postcode,
// "Find Calculation" button, `#index_token`/`#index_postcode`/`#btnFind`).
//
// A calculation reference only exists once you've progressed far enough into
// the wizard - confirmed via direct probing 2026-09-23, one first appears on
// the "Current Benefits" screen (the 4th real screen: Before We Begin ->
// Let's Get Started -> About You -> Current Benefits), displayed in a
// readonly `#token` input alongside a "Copy to clipboard" button. Per
// Hector's own instruction, this test runs just enough of the wizard to
// obtain a real reference (reusing the same mechanics/selectors as the Full
// Journey test above, but as its own small set of module-level helpers
// rather than reaching into that test's locally-scoped ones - keeps this
// test independent and avoids risking a regression in the already-verified
// Full Journey test), then comes back to the landing page to exercise card 2
// with that real reference.
//
// Confirmed via direct probing 2026-09-23:
//   - A valid reference + matching postcode navigates to a real
//     `/survey/{step}/{guid}` resume URL, landing back on whichever screen
//     was last active (here, "About You") with a real H1 - not necessarily
//     "About You" specifically if the wizard's flow changes, so this is
//     checked generically (a real H1, and navigation away from the landing
//     page) rather than hardcoded.
//   - An invalid/non-matching reference + postcode combination does NOT
//     navigate anywhere - it stays on the landing page and shows a real
//     inline error: `<div role="alert" class="alert alert-danger">No
//     calculation found with the provided reference and postcode.</div>`.
//     Covered here too, matching this workspace's "with and without
//     results"-style convention (e.g. the site search spec) even though not
//     explicitly requested - a natural, low-cost pairing with the valid case.
// ============================================================================

async function selectWizardOption(page, fieldSuffix) {
    await page.locator(`label[for="${fieldSuffix}"]`).first().click();
    await page.waitForTimeout(200);
}

async function fillWizardField(page, id, value) {
    await page.locator(`#${id}`).first().fill(value);
    await page.locator(`#${id}`).first().press('Tab');
    await page.waitForTimeout(200);
}

// Same retry-on-disabled-button mechanic as the Full Journey test above (see its own comment for
// why) - kept as its own copy here rather than shared, so this test stays independently correct.
async function clickWizardNext(page) {
    const previousH1 = await page.locator('h1').first().textContent().catch(() => null);
    for (let attempt = 0; attempt < 5; attempt++) {
        await page.locator('button[name=btnNext]').first().click({ force: true });
        await page.waitForLoadState('networkidle').catch(() => { });
        await page.waitForTimeout(700);
        const currentH1 = await page.locator('h1').first().textContent().catch(() => null);
        if (currentH1 !== previousH1) {
            return;
        }
        await page.waitForTimeout(500);
    }
}

// Runs just enough of the wizard (Before We Begin -> Let's Get Started -> About You) to reach
// "Current Benefits", where a real calculation reference first becomes available, and returns it
// along with the postcode used to generate it.
async function obtainRealCalculationReference(page) {
    await navigateViaGetSupportMenu(page, 'Benefits Calculator');
    await page.getByRole('link', { name: 'Use the Turn2us Benefits Calculator', exact: true }).click();
    await page.waitForLoadState('load').catch(() => { });
    await page.waitForSelector('h1', { timeout: 15000 }).catch(() => { });

    await selectWizardOption(page, 'ClientMemberHousehold_Yes');
    await selectWizardOption(page, 'ClientPartnerStudent_No');
    await selectWizardOption(page, 'ClientPartnerPrison_No');
    await selectWizardOption(page, 'ClientPartnerHospital_No');
    await clickWizardNext(page); // -> "Let's Get Started"
    await clickWizardNext(page); // -> "About You"

    const postcode = 'M335SH';
    await fillWizardField(page, 'ClientPostcode', postcode);
    await selectWizardOption(page, 'ClientLiveWithPartner_No');
    await fillWizardField(page, 'ClientDob', '27/06/1981');
    await clickWizardNext(page); // -> "Current Benefits"

    await expect(page.locator('h1').first(), 'The wizard should reach "Current Benefits" before a calculation reference is available').toHaveText(/Current Benefits/i);

    const referenceInput = page.locator('#token');
    await expect(referenceInput, 'The "Current Benefits" screen should show a real calculation reference').toBeVisible();
    const reference = await referenceInput.inputValue();
    expect(reference.length, 'The calculation reference should be a real, non-empty value').toBeGreaterThan(0);

    return { reference, postcode };
}

test('Return to a Calculation Traversal', async ({ page }) => {
    // Obtaining a real reference takes ~4 real wizard screens (with real network waits between
    // each), plus 2 more full page loads afterward to test both the valid and invalid "Find
    // Calculation" cases - generous margin over a normal ~30-40s run.
    test.setTimeout(3 * 60 * 1000);

    const { reference, postcode } = await test.step('Progress the wizard far enough to obtain a real calculation reference', async () => {
        return obtainRealCalculationReference(page);
    });

    await test.step('Navigate back to the Benefits Calculator landing page and verify card 2 is present', async () => {
        await navigateViaGetSupportMenu(page, 'Benefits Calculator');

        await expect(page.locator('#index_token'), 'The "Return to a calculation" card should show a Calculation Reference field').toBeVisible();
        await expect(page.locator('#index_postcode'), 'The "Return to a calculation" card should show a Postcode field').toBeVisible();
        await expect(page.locator('#btnFind'), 'The "Return to a calculation" card should show a "Find Calculation" button').toBeVisible();
    });

    await test.step('An invalid reference/postcode combination shows a real error and does not navigate', async () => {
        await page.locator('#index_token').fill('XXX-XXX-XXX');
        await page.locator('#index_postcode').fill('AA11AA');
        await page.locator('#btnFind').click();

        await expect(page.getByRole('alert'), 'An invalid reference/postcode combination should show a real "No calculation found" error').toContainText(/No calculation found/i);
        expect(page.url(), 'An invalid combination should not navigate away from the landing page').toBe('https://staging-beta-benefits-calculator.turn2us.org.uk/');
    });

    await test.step('A valid reference/postcode combination resumes the real saved calculation', async () => {
        await page.locator('#index_token').fill(reference);
        await page.locator('#index_postcode').fill(postcode);
        await page.locator('#btnFind').click();
        await page.waitForLoadState('load').catch(() => { });

        await expect.poll(() => page.url(), {
            message: 'A valid reference/postcode combination should resume the saved calculation at a real /survey/{step}/{guid} URL',
        }).toMatch(/\/survey\/\d+\/[0-9a-f-]{36}/i);

        await expect(page.locator('h1').first(), 'The resumed calculation should land on a real wizard screen with a visible H1').toBeVisible();
    });
});

test('Your Situation Traversal', async ({ page, context }) => {
    // 15 real destination pages, each with 2 in-page-nav clicks and a footer/back-to-top round
    // trip - a genuinely long, exhaustive sweep. Generous margin over a normal ~3-4 minute run.
    test.setTimeout(8 * 60 * 1000);

    const situationPage = await test.step('Open "Your Situation" from the Benefits Calculator landing page (opens in a new tab)', async () => {
        await navigateViaGetSupportMenu(page, 'Benefits Calculator');

        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            page.getByRole('link', { name: 'Your Situation', exact: false }).click(),
        ]);
        await popup.waitForLoadState('load').catch(() => { });

        await verifyTitleH1AndBreadcrumb(popup, 'Your Situation (landing page)', true);
        return popup;
    });

    const cards = await test.step('Read every real situation card fresh from the page', async () => {
        const items = await situationPage.evaluate(() => {
            const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
            return Array.from(document.querySelectorAll('.ctaRowItem')).map((item) => {
                const heading = item.querySelector('h2, h3, h4');
                const link = item.querySelector('a.button');
                return {
                    heading: normalize(heading?.textContent),
                    linkText: normalize(link?.textContent),
                    href: link?.getAttribute('href') || null,
                };
            }).filter((card) => card.href);
        });
        expect(items.length, 'The "Your Situation" page should expose at least one real situation card').toBeGreaterThan(0);
        return items;
    });

    const situationPageUrl = situationPage.url();

    for (const card of cards) {
        await test.step(`"${card.heading}" -> "${card.linkText}"`, async () => {
            await situationPage.goto(situationPageUrl, { waitUntil: 'domcontentloaded' });
            await situationPage.waitForLoadState('load').catch(() => { });

            const cardLink = situationPage.locator('.ctaRowItem a.button', { hasText: card.linkText }).first();
            await cardLink.click();
            await situationPage.waitForLoadState('load').catch(() => { });

            await test.step('Verify title, H1, and breadcrumb', async () => {
                await verifyTitleH1AndBreadcrumb(situationPage, card.heading, true);
            });

            await test.step('Verify the in-page navigation device (forward and backward)', async () => {
                await verifyInPageNavigationDevice(situationPage, card.heading);
            });

            await test.step('Verify the "Share" section (3 sharing options)', async () => {
                await verifyShareSection(situationPage, card.heading);
            });

            await test.step('Verify the footer and its "Back to top" control', async () => {
                await verifyFooterAndBackToTop(situationPage);
            });
        });
    }
});
}); // end test.describe('Get Support - Benefits Calculator')

// ============================================================================
// Coverage notes - "Grants Search" landing page
// ============================================================================
// Confirmed via direct probing 2026-09-25: this destination is a wholly separate app
// (`https://staging-grants-search.turn2us.org.uk/`, matching the Benefits Calculator/PIP Helper
// pattern of a dedicated sub-tool), with no Cookiebot on this one either.
//
// Page structure, top to bottom (read fresh from the DOM below, not hardcoded beyond the
// selectors/structure itself, since copy is CMS/content-managed):
//   1. Hero: H1, intro text, and a "Get Started" button (`#btnStartTitle`, -> `/survey`).
//   2. 3 "how it works" points (`.index-point-wrapper`).
//   3. A 3-slide testimonial carousel (`.carousel`) with:
//      - 3 roundel indicators (`.carousel-indicators button`) - the active one gets
//        `aria-current="true"` + class `active`, confirmed via direct probing to render visibly
//        darker (active: `rgb(0, 0, 0)`) than an inactive one (`rgb(148, 147, 147)`).
//      - A play/pause control (`.carousel-button`) - confirmed its accessible text is the same
//        static "play/pause" string in both states (a real, minor a11y quirk - the visible
//        state change is class-only: `btn-play` <-> `btn-pause`), so state is verified via that
//        class rather than by name. Clicking it starts autoplay (confirmed to rotate to a new
//        slide within ~5s); clicking it again (now showing `btn-pause`) stops the rotation.
//   4. 4 more "how grants work" info cards (`.index-cards .rules.card`).
//   5. A second "Get Started" button (`#btnStartTitle` again - confirmed via direct probing this
//      id is duplicated across the 2 buttons, a real, minor HTML-validity quirk not worth its own
//      failing assertion; matched here by role+name instead of by id).
//   6. The 3 feature-card equivalents ("Grants - what you need to know" / "Return to a grants
//      search" / "Your situation") - NOT covered by this test; per Hector 2026-09-25, these get
//      their own dedicated sub-traversal tests later, same pattern as Benefits Calculator's 3
//      feature cards.
// ============================================================================

test.describe('Get Support - Grants Search', () => {
    test('Initial Page Load Tests', async ({ page }) => {
        test.setTimeout(90 * 1000);
        const grantsSearchDestination = GET_SUPPORT_DESTINATIONS.find((d) => d.name === 'Grants Search');

        await test.step('Navigate to "Grants Search" via the "Get support" menu', async () => {
            await navigateViaGetSupportMenu(page, 'Grants Search');
        });

        await test.step('Verify the page title', async () => {
            await expect(page, `The title should match ${grantsSearchDestination.titlePattern}`).toHaveTitle(grantsSearchDestination.titlePattern);
        });

        await test.step('Verify exactly one H1, matching the expected name', async () => {
            await expect(page.locator('h1'), 'The page should have exactly one H1').toHaveCount(1);
            await expect(page.locator('h1').first(), `The H1 should match ${grantsSearchDestination.h1Pattern}`).toHaveText(grantsSearchDestination.h1Pattern);
        });

        await test.step('Verify the hero "Get Started" button', async () => {
            const heroGetStarted = page.getByRole('link', { name: 'Get Started', exact: true }).first();
            await expect(heroGetStarted, 'The hero "Get Started" button should be visible').toBeVisible();
            await expect(heroGetStarted, 'The hero "Get Started" button should link to the survey tool').toHaveAttribute('href', '/survey');
        });

        await test.step('Verify the "how it works" information points', async () => {
            const points = page.locator('.index-point-wrapper');
            await expect(points, 'The page should show 3 "how it works" points').toHaveCount(3);
            const texts = await points.locator('.index-point-text').allTextContents();
            for (const text of texts) {
                expect(text.trim().length, 'Each point should have real, non-empty text').toBeGreaterThan(0);
            }
        });

        await test.step('Verify the testimonial carousel', async () => {
            const indicators = page.locator('.carousel-indicators button');
            await expect(indicators, 'The carousel should show 3 slide indicators (roundels)').toHaveCount(3);
            await expect(page.locator('.carousel-inner .carousel-item'), 'The carousel should have 3 slides').toHaveCount(3);

            const activeIndicatorIndex = async () => {
                const states = await indicators.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-current') === 'true'));
                return states.indexOf(true);
            };
            const indicatorColor = async (index) => indicators.nth(index).evaluate((el) => getComputedStyle(el).backgroundColor);

            await expect.poll(activeIndicatorIndex, 'One roundel should be active by default').not.toBe(-1);

            await test.step('Clicking through each roundel updates the active state and its colour', async () => {
                for (let i = 0; i < 3; i++) {
                    await indicators.nth(i).click();
                    await expect.poll(activeIndicatorIndex, `Roundel ${i + 1} should become the active slide once clicked`).toBe(i);

                    const activeColor = await indicatorColor(i);
                    const inactiveColor = await indicatorColor((i + 1) % 3);
                    expect(activeColor, `The active roundel (${i + 1}) should be visually distinct from an inactive one`).not.toBe(inactiveColor);
                }
            });

            await test.step('The Play button starts automatic rotation, then changes to a Pause control', async () => {
                const beforeAutoplayIndex = await activeIndicatorIndex();
                const playButton = page.locator('.carousel-button');
                await expect(playButton, 'The carousel should expose a play/pause control').toBeVisible();
                await expect(playButton, 'The control should start in its "play" state').toHaveClass(/btn-play/);

                await playButton.click();
                await expect(playButton, 'Clicking the control should switch it to its "pause" state').toHaveClass(/btn-pause/);

                await expect.poll(activeIndicatorIndex, {
                    message: 'The carousel should automatically rotate to a different slide once playing',
                    timeout: 10000,
                }).not.toBe(beforeAutoplayIndex);
            });

            await test.step('Clicking Pause stops the automatic rotation', async () => {
                const playButton = page.locator('.carousel-button');
                await playButton.click();
                await expect(playButton, 'Clicking pause should switch the control back to its "play" state').toHaveClass(/btn-play/);

                const stoppedAtIndex = await activeIndicatorIndex();
                await page.waitForTimeout(6000);
                expect(await activeIndicatorIndex(), 'The carousel should stay on the same slide once paused').toBe(stoppedAtIndex);
            });
        });

        await test.step('Verify the "how grants work" information cards', async () => {
            const infoCards = page.locator('.index-cards .rules.card');
            await expect(infoCards, 'The page should show 4 "how grants work" information cards').toHaveCount(4);
            const headings = await infoCards.locator('h3').allTextContents();
            for (const heading of headings) {
                expect(heading.trim().length, 'Each information card should have a real heading').toBeGreaterThan(0);
            }
        });

        await test.step('Verify the second "Get Started" link further down the page', async () => {
            const secondGetStarted = page.getByRole('link', { name: 'Get Started', exact: true }).nth(1);
            await expect(secondGetStarted, 'A second "Get Started" link should be visible further down the page').toBeVisible();
            await expect(secondGetStarted, 'It should link to the same survey tool').toHaveAttribute('href', '/survey');
        });

        await test.step('Verify the page\'s buttons/links are not broken', async () => {
            await verifyPageButtonsNotBroken(page);
        });

        await test.step('Verify the footer and its "Back to top" control', async () => {
            await verifyFooterAndBackToTop(page);
        });
    });

    // Confirmed via direct probing 2026-09-25: this card's destination
    // (`https://www.turn2us.org.uk/get-support/apply-for-grants/grants-what-you-need-to-know`)
    // always resolves on the main LIVE site, even when reached from Staging's Grants Search tool -
    // there's no "staging" equivalent of this content page. Its 10-item accordion
    // (`.accordion__trigger` / `.accordion__panel`) allows multiple items open at once (confirmed:
    // opening a later item does NOT collapse an earlier one) - each trigger's chevron rotates via
    // CSS keyed off `aria-expanded` alone (the icon's own class stays the literal, static
    // "chevron-down" in both states - a minor a11y-adjacent quirk, so state is verified via
    // `aria-expanded`, not the icon's class). Below the accordion, a "Grants Search" heading +
    // "Search for grants" button (`href="https://grants-search.turn2us.org.uk/"`) leads back to
    // the SAME Grants Search landing page - but per Hector, that button's href always points at
    // the LIVE grants-search subdomain regardless of which environment we started from (since this
    // whole page is Live-only), so this step only confirms we land back on the Grants Search
    // landing page, not which environment it's on.
    //
    // FINDING from the first full run (2026-09-25), reviewed and confirmed BY HECTOR AS
    // ACCEPTED/NOT A BUG the same day - tracked in `ACCEPTED_NAMING_MISMATCHES` above: this page's
    // `<title>` ("Find out about applying for charitable grants | Turn2us") doesn't relate to its
    // H1/breadcrumb ("Grants - what you need to know") - the same category of naming quirk as
    // "Energy and Water Bills"/"Studying" elsewhere in this file.
    test('Grants - What You Need to Know Traversal', async ({ page, context }) => {
        test.setTimeout(2 * 60 * 1000);

        const destinationPage = await test.step('Open "Grants - what you need to know" from the Grants Search landing page (opens in a new tab)', async () => {
            await navigateViaGetSupportMenu(page, 'Grants Search');

            const card = page.locator('.index-links .card').filter({ has: page.locator('h3.p-title', { hasText: 'Grants - what you need to know' }) });
            const [popup] = await Promise.all([
                context.waitForEvent('page'),
                card.locator('.card-footer a').click(),
            ]);
            await popup.waitForLoadState('load').catch(() => { });
            await waitForAndAcceptCookieBanner(popup);
            return popup;
        });

        await test.step('Verify title, H1, and breadcrumb', async () => {
            await verifyTitleH1AndBreadcrumb(destinationPage, 'Grants - what you need to know');
        });

        const triggers = destinationPage.locator('.accordion__trigger');
        const panels = destinationPage.locator('.accordion__panel');

        await test.step('Verify the accordion starts fully collapsed', async () => {
            const states = await triggers.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-expanded')));
            expect(states.length, 'The page should show at least one accordion item').toBeGreaterThan(0);
            for (const state of states) {
                expect(state, 'Every accordion item should start collapsed').toBe('false');
            }
        });

        const itemCount = await triggers.count();

        await test.step('Expand every accordion item top to bottom, without collapsing previously opened ones', async () => {
            for (let i = 0; i < itemCount; i++) {
                await test.step(`Expand item ${i + 1}`, async () => {
                    await triggers.nth(i).click();
                    await expect(triggers.nth(i), `Item ${i + 1}'s trigger should report expanded`).toHaveAttribute('aria-expanded', 'true');
                    await expect(panels.nth(i), `Item ${i + 1}'s panel should become visible`).toBeVisible();

                    // This accordion allows multiple items open at once (confirmed via direct
                    // probing 2026-09-25), unlike a classic single-open accordion - every
                    // previously-expanded item should stay expanded.
                    for (let j = 0; j < i; j++) {
                        await expect(triggers.nth(j), `Item ${j + 1} should remain expanded after opening item ${i + 1}`).toHaveAttribute('aria-expanded', 'true');
                    }
                });
            }
        });

        await test.step('Verify every link is not broken (all accordion content now expanded/visible)', async () => {
            await verifyPageButtonsNotBroken(destinationPage);
        });

        await test.step('Collapse every accordion item bottom to top', async () => {
            for (let i = itemCount - 1; i >= 0; i--) {
                await test.step(`Collapse item ${i + 1}`, async () => {
                    await triggers.nth(i).click();
                    await expect(triggers.nth(i), `Item ${i + 1}'s trigger should report collapsed`).toHaveAttribute('aria-expanded', 'false');
                    await expect(panels.nth(i), `Item ${i + 1}'s panel should become hidden`).toBeHidden();
                });
            }
        });

        await test.step('The "Search for grants" button returns to the Grants Search landing page', async () => {
            await expect(destinationPage.getByRole('heading', { name: 'Grants Search', exact: true }), 'A "Grants Search" heading should introduce the "Search for grants" button').toBeVisible();

            const searchForGrantsButton = destinationPage.getByRole('link', { name: 'Search for grants', exact: true });
            await expect(searchForGrantsButton, 'The "Search for grants" button should be visible').toBeVisible();

            await searchForGrantsButton.click();
            await destinationPage.waitForLoadState('load').catch(() => { });

            await expect(destinationPage, 'Clicking "Search for grants" should return to the Grants Search landing page (Live, per the coverage notes above)').toHaveURL(/grants-search\.turn2us\.org\.uk/);
            await expect(destinationPage.locator('h1'), 'The Grants Search landing page should show its own H1').toHaveText(/Turn2us Grants Search/i);
        });

        await test.step('Verify the footer and its "Back to top" control', async () => {
            await verifyFooterAndBackToTop(destinationPage);
        });
    });

    // ========================================================================
    // Coverage notes - "Use the Turn2us Grants Search Traversal" (reference journey)
    // ========================================================================
    // A single, deterministic reference journey through the Grants Search survey tool (accessed
    // via either of the landing page's 2 "Get Started" links, both -> `/survey`), matching the
    // same approach as the Benefits Calculator's own "Full Journey (Reference)" test - one full,
    // fill-everything run dictated by Hector, with a separate "Skip this page" journey and further
    // varied journeys left as follow-ups, same pattern as the Benefits Calculator's ~10 deferred
    // worker journeys.
    //
    // Survey structure (confirmed via direct probing 2026-09-25), one page per `test.step`:
    //   1. "Before you start" - no fields, just a Next button (no "Skip this page" here).
    //   2. "About you" - the FIRST page with a "Skip this page" link. Age (number input), Gender
    //      (radio), Postcode (text) + 3 unrelated checkboxes. Values persist across Back/Next
    //      (confirmed).
    //   3. "Your current or previous occupation and industry" - a multi-select checkbox group.
    //      This is also the FIRST page where a "Your search reference" token appears at the
    //      bottom (a real, unique reference+postcode pair that can resume the search later - the
    //      same tool already covered by the "Return to a Calculation"-equivalent pattern
    //      elsewhere in this file for Benefits Calculator).
    //   4. "Your Health" - a Yes/No radio; selecting "Yes" reveals a health-condition multi-select
    //      (confirmed hidden/collapsed until Yes is chosen).
    //   5. "Your Religion" - multi-select.
    //   6. "Energy Providers" - multi-select.
    //   7. "Water Providers" - multi-select, then Next reaches the results page.
    //
    // Results page (`/result/{guid}`) - confirmed via direct probing 2026-09-25 to include, among
    // other things:
    //   - A "Your Grants Search Results" H1 + a real match count ("we've found N grants...").
    //   - An "Include Non Self Referral Grants?" Yes/No toggle switch.
    //   - 2 tabs: "Grants matched to you" (active by default) and "Shortlist" (empty until a grant
    //     is shortlisted).
    //   - Each grant is its own card with independently-toggleable sections ("Who is eligible?",
    //     sometimes "Other information", "How to apply", "Contact details") - NOT a shared
    //     accordion group (each button only ever controls its own single panel). Some grants' "How
    //     to apply" section has its own Yes/No eligibility questions gating a "Submit Answers"
    //     button - confirmed disabled until every question on that grant is answered.
    //   - "Add grant to Shortlist" (confirmed: moves/copies the grant into the "Shortlist" tab) and
    //     "Hide grant" per card.
    //   - A real, working paginated grant list (confirmed: 5 grants/page, "Page 2" shows different
    //     grants, `.page-item.active` moves, First/Previous links appear once off page 1).
    //   - Several more independently-collapsible info sections further down: "What you told us"
    //     (a full read-back of every answer given, each with a real "edit" link back to its
    //     originating survey page - confirmed values match exactly what was entered), "Email your
    //     search" (captcha + email, NOT submitted here - too fragile/side-effecting for this
    //     sweep), "Help us help others" (contains the "Start Survey" external link - deliberately
    //     NOT clicked, per Hector's explicit instruction), "Talk to an adviser - Warm Homes
    //     Network", "Food banks", "Food pantry", "Pet food bank" (and possibly more, CMS-managed).
    //     These are swept GENERICALLY below (by collecting every `.result-header`-style toggle
    //     button read fresh from the DOM) rather than hardcoded one by one, so a new section added
    //     later is covered automatically without needing this test updated.
    //
    // CONFIRMED DUPLICATE-ID QUIRK (2026-09-25): once a grant is shortlisted, the "Shortlist" tab
    // renders a full clone of that grant's card re-using the SAME element ids as the original in
    // "Grants matched to you" (e.g. `#btnWhoIsEligible_0` exists twice, one per tab) - the same
    // category of duplicate-id quirk already seen elsewhere in this app (`#btnStartTitle`). Every
    // grant-card locator below is scoped to `#result-tab-list-tabpane-g` (or `-s` for the
    // Shortlist tab) specifically to avoid Playwright strict-mode violations from this.
    //
    // Confirmed with Hector 2026-09-25 (checked manually on both Staging and Live): "Hide grant"
    // does NOT remove the grant from the list - it collapses that grant's content only, shows a
    // "Grant has been hidden" toast, and relabels its own button to "Unhide grant" (which restores
    // everything and shows "Grant has been unhidden"). Not a defect - this is the real, intended
    // behaviour, and the test below asserts it as such.
    // ========================================================================

    test('Use the Turn2us Grants Search Traversal', async ({ page }) => {
        test.setTimeout(6 * 60 * 1000);

        await test.step('Start the survey from the Grants Search landing page', async () => {
            await navigateViaGetSupportMenu(page, 'Grants Search');
            await page.getByRole('link', { name: 'Get Started', exact: true }).first().click();
            await page.waitForLoadState('networkidle').catch(() => { });
            await page.waitForSelector('main h1, main button', { timeout: 15000 }).catch(() => { });
        });

        await test.step('"Before you start" - no fields, just Next', async () => {
            await expect(page.locator('h1'), 'The first survey page should be "Before you start"').toHaveText('Before you start');
            await page.locator('button[name="btnNext"]').click();
            await page.waitForTimeout(800);
        });

        await test.step('"About you" - age, gender, postcode', async () => {
            await expect(page.locator('h1'), 'This page should be "About you"').toHaveText('About you');
            await expect(page.locator('button.skip-page'), 'This is the first page with a "Skip this page" control').toBeVisible();

            await page.locator('input#QuestionAge').fill('43');
            await page.locator('label[for="QuestionGender_0"]').click();
            await page.locator('input#QuestionPostcode').fill('M335SH');
            await page.locator('#btnNext').click();
            await page.waitForTimeout(800);
        });

        await test.step('Click Back to confirm the details just entered are retained, then Next again', async () => {
            await page.locator('#btnBack').click();
            await page.waitForTimeout(800);

            await expect(page.locator('h1'), 'Back should have returned to "About you"').toHaveText('About you');
            await expect(page.locator('input#QuestionAge'), 'Age should still be 43 after Back').toHaveValue('43');
            await expect(page.locator('input#QuestionPostcode'), 'Postcode should still be M335SH after Back').toHaveValue('M335SH');
            await expect(page.locator('#QuestionGender_0'), 'Gender (Male) should still be selected after Back').toBeChecked();

            await page.locator('#btnNext').click();
            await page.waitForTimeout(800);
        });

        await test.step('"Your current or previous occupation and industry" - multi-select + first sight of the search reference', async () => {
            await expect(page.locator('h1'), 'This page should be about occupation/industry').toHaveText('Your current or previous occupation and industry');

            await page.locator('label[for="QuestionOccupation_7"]').click(); // Engineering
            await page.locator('label[for="QuestionOccupation_21"]').click(); // PR, Marketing and Sales
            await page.locator('label[for="QuestionOccupation_5"]').click(); // Broadcast Media

            const tokenInput = page.locator('input#token');
            await expect(tokenInput, 'A real search reference token should be shown by this page').toBeVisible();
            await expect(tokenInput, 'The search reference should have a real, non-empty value').not.toHaveValue('');

            await page.locator('#btnNext').click();
            await page.waitForTimeout(800);
        });

        await test.step('"Your Health" - Yes reveals a health-condition multi-select', async () => {
            await expect(page.locator('h1'), 'This page should be "Your Health"').toHaveText('Your Health');

            const conditionsGroup = page.locator('fieldset', { has: page.locator('legend', { hasText: 'Select from any disabilities' }) });
            await expect(conditionsGroup, 'Health conditions should be hidden before answering Yes/No').toBeHidden();

            await page.locator('label[for="QuestionHealth_0"]').click(); // Yes
            await expect(conditionsGroup, 'Health conditions should appear once "Yes" is selected').toBeVisible();

            await page.locator('label[for="QuestionHealthCondition_2"]').click(); // Blood disorders
            await page.locator('label[for="QuestionHealthCondition_17"]').click(); // Injury
            await page.locator('label[for="QuestionHealthCondition_28"]').click(); // Polio

            await page.locator('#btnNext').click();
            await page.waitForTimeout(800);
        });

        await test.step('"Your Religion" - multi-select', async () => {
            await expect(page.locator('h1'), 'This page should be "Your Religion"').toHaveText('Your Religion');
            await page.locator('label[for="QuestionReligion_2"]').click(); // Christian
            await page.locator('label[for="QuestionReligion_3"]').click(); // Church of England
            await page.locator('#btnNext').click();
            await page.waitForTimeout(800);
        });

        await test.step('"Energy Providers" - multi-select', async () => {
            await expect(page.locator('h1'), 'This page should be "Energy Providers"').toHaveText('Energy Providers');
            await page.locator('label[for="QuestionEnergy_5"]').click(); // OVO Energy Fund
            await page.locator('#btnNext').click();
            await page.waitForTimeout(800);
        });

        await test.step('"Water Providers" - multi-select, then reach the results page', async () => {
            await expect(page.locator('h1'), 'This page should be "Water Providers"').toHaveText('Water Providers');
            await page.locator('label[for="QuestionWater_13"]').click(); // Thames Water
            await page.locator('#btnNext').click();
            await page.waitForLoadState('networkidle').catch(() => { });
            await page.waitForSelector('.loader-background', { state: 'detached', timeout: 20000 }).catch(() => { });
            await page.waitForTimeout(1000);
        });

        const resultsTab = page.locator('#result-tab-list-tabpane-g');

        await test.step('Verify the results page header and grant match count', async () => {
            await expect(page.locator('h1'), 'The results page should show its own H1').toHaveText('Your Grants Search Results');
            const countBlurb = page.locator('p', { hasText: 'grants that you may be eligible for' }).first();
            await expect(countBlurb, 'The results page should report a real grant match count').toBeVisible();
            await expect(countBlurb, 'The match count should be a real, non-zero number').toHaveText(/we've found \d+ grants/i);

            await resultsTab.locator('.grant-title').first().waitFor({ state: 'visible', timeout: 20000 });
        });

        await test.step('Verify "What you told us" reflects every answer given', async () => {
            await page.locator('#btnWorkSection').click();
            await expect(page.locator('#btnWorkSection'), 'The section should report itself expanded').toHaveAttribute('aria-expanded', 'true');

            const workSection = page.locator('#workSection');
            const expectedAnswers = [
                '43', 'Male', 'M335SH',
                'Engineering', 'PR, Marketing and Sales', 'Broadcast Media',
                'Yes', 'Blood disorders', 'Injury', 'Polio',
                'Christian', 'Church of England',
                'OVO Energy Fund', 'Thames Water',
            ];
            for (const answer of expectedAnswers) {
                await expect(workSection, `"What you told us" should read back "${answer}"`).toContainText(answer);
            }

            const editLinks = workSection.locator('a', { hasText: 'edit' });
            const editLinkCount = await editLinks.count();
            expect(editLinkCount, 'Every answer category should have its own "edit" link back to the relevant survey page').toBeGreaterThan(0);
            for (let i = 0; i < editLinkCount; i++) {
                await expect(editLinks.nth(i), `Edit link ${i + 1} should point back at a real survey page`).toHaveAttribute('href', /\/survey\/\d+\//);
            }

            await page.locator('#btnWorkSection').click(); // collapse again
        });

        await test.step('Every other collapsible info section on the results page toggles open and closed (excluding "Start Survey", per Hector)', async () => {
            // `.result-header` (not `.section-header` alone) scopes this to the standalone info
            // sections only - confirmed via direct probing 2026-09-25 that grant-card accordion
            // buttons (Who is eligible?/How to apply?/Contact details) share the `.section-header`
            // class but never `.result-header`, so this deliberately excludes them (they're
            // covered by their own dedicated step below instead).
            //
            // `#btnSectionFeedback` ("Was this page helpful?") is also deliberately excluded -
            // confirmed via direct probing 2026-09-25 that, unlike every other section here,
            // clicking ITS header does NOT toggle `aria-expanded`/reveal its panel; the feedback
            // form is instead revealed by clicking one of its 2 thumbs-up/thumbs-down icons, a
            // genuinely different interaction model not covered by this generic header-click
            // sweep.
            const toggleButtons = page.locator('button.result-header:not(#btnSectionFeedback)');
            const toggleCount = await toggleButtons.count();
            expect(toggleCount, 'The results page should show at least one collapsible info section').toBeGreaterThan(0);

            for (let i = 0; i < toggleCount; i++) {
                const button = toggleButtons.nth(i);
                const label = (await button.innerText()).trim().split('\n')[0];
                await test.step(`"${label}" section toggles`, async () => {
                    const wasExpanded = (await button.getAttribute('aria-expanded')) === 'true';
                    // Scoped by `aria-labelledby` matching the BUTTON's own (unique) id rather
                    // than by the panel's own id/aria-controls value - confirmed via direct
                    // probing 2026-09-25 that this page has a genuine duplicate-id quirk
                    // (`id="emailSection"` is reused by 2 unrelated panels, "Email your search"
                    // and a separate "Anything wrong with this page?" widget), the same category
                    // of quirk already seen elsewhere in this app (`#btnStartTitle`).
                    const buttonId = await button.getAttribute('id');
                    const panel = buttonId ? page.locator(`[aria-labelledby="${buttonId}"]`) : null;

                    await button.click();
                    await expect(button, `"${label}" should flip its expanded state`).toHaveAttribute('aria-expanded', wasExpanded ? 'false' : 'true');
                    if (panel) {
                        if (wasExpanded) {
                            await expect(panel, `"${label}"'s panel should hide once collapsed`).toBeHidden();
                        } else {
                            await expect(panel, `"${label}"'s panel should show once expanded`).toBeVisible();
                        }
                    }

                    // Restore original state so later steps see a predictable starting point.
                    await button.click();
                    await expect(button, `"${label}" should flip back to its original state`).toHaveAttribute('aria-expanded', wasExpanded ? 'true' : 'false');
                });
            }
        });

        await test.step('The first grant\'s sections toggle, and its eligibility questions gate "Submit Answers"', async () => {
            const whoIsEligible = resultsTab.locator('#btnWhoIsEligible_0');
            await whoIsEligible.click();
            await expect(whoIsEligible, 'The "Who is eligible?" section should expand').toHaveAttribute('aria-expanded', 'true');
            await expect(resultsTab.locator('#whoIsEligible_0'), 'Its panel should become visible').toBeVisible();

            const howToApply = resultsTab.locator('#btnHowToApply_0');
            await howToApply.click();
            await expect(howToApply, 'The "How to apply" section should expand').toHaveAttribute('aria-expanded', 'true');

            const howToApplyPanel = resultsTab.locator('#howToApply_0');
            const submitButton = howToApplyPanel.getByRole('button', { name: 'Submit Answers' });
            const eligibilityQuestions = howToApplyPanel.locator('.radio-group');
            const questionCount = await eligibilityQuestions.count();

            if (questionCount > 0) {
                await expect(submitButton, '"Submit Answers" should start disabled before every question is answered').toBeDisabled();
                for (let i = 0; i < questionCount; i++) {
                    await eligibilityQuestions.nth(i).locator('label').first().click();
                }
                await expect(submitButton, '"Submit Answers" should become enabled once every eligibility question is answered').toBeEnabled();
            }
        });

        await test.step('The "Include Non Self Referral Grants?" toggle switches state', async () => {
            const toggle = page.locator('.toggle-button');
            const before = await toggle.getAttribute('aria-checked');
            await toggle.click();
            await expect(toggle, 'The toggle should flip its checked state').toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
            await toggle.click(); // restore
            await expect(toggle, 'The toggle should flip back to its original state').toHaveAttribute('aria-checked', before);
        });

        await test.step('"Hide grant" collapses a grant\'s content and can be undone with "Unhide grant"', async () => {
            // Confirmed with Hector 2026-09-25 (checked on both Staging and Live): "Hide grant"
            // does NOT remove the grant from the list - the card's TITLE stays, but its
            // description content collapses (`.bottom30.collapse show` loses the `show` class),
            // a "Grant has been hidden" toast appears, and the button itself relabels to "Unhide
            // grant" (confirmed via direct probing to restore everything when clicked again,
            // showing a "Grant has been unhidden" toast).
            const secondCard = resultsTab.locator('.field.card:has(.grant-title)').nth(1);
            const hiddenGrantTitle = (await secondCard.locator('.grant-title').innerText()).trim();
            const collapsingContent = secondCard.locator('.bottom30.collapse').first();

            await secondCard.getByRole('button', { name: 'Hide grant', exact: true }).click();
            await expect(page.getByText('Grant has been hidden', { exact: false }), 'A "Grant has been hidden" confirmation should appear').toBeVisible();
            await expect(secondCard.getByRole('button', { name: 'Unhide grant', exact: true }), 'The button should relabel to "Unhide grant"').toBeVisible();
            await expect(collapsingContent, `"${hiddenGrantTitle}"'s content should collapse once hidden`).not.toHaveClass(/show/);
            await expect(resultsTab.locator('.grant-title', { hasText: hiddenGrantTitle }), 'The grant\'s title should still be listed (only its content collapses)').toBeVisible();

            await secondCard.getByRole('button', { name: 'Unhide grant', exact: true }).click();
            await expect(page.getByText('Grant has been unhidden', { exact: false }), 'A "Grant has been unhidden" confirmation should appear').toBeVisible();
            await expect(secondCard.getByRole('button', { name: 'Hide grant', exact: true }), 'The button should relabel back to "Hide grant"').toBeVisible();
            await expect(collapsingContent, `"${hiddenGrantTitle}"'s content should reappear once unhidden`).toHaveClass(/show/);
        });

        await test.step('Pagination moves between pages of grants', async () => {
            const page1Titles = await resultsTab.locator('.grant-title').allInnerTexts();

            await resultsTab.locator('.pagination .page-link', { hasText: /^2$/ }).click();
            await page.waitForTimeout(1000);

            await expect(resultsTab.locator('.pagination .page-item.active'), 'Page 2 should now be the active page').toContainText('2');
            const page2Titles = await resultsTab.locator('.grant-title').allInnerTexts();
            expect(page2Titles, 'Page 2 should show different grants than page 1').not.toEqual(page1Titles);

            await resultsTab.locator('.pagination .page-link', { hasText: 'First' }).click();
            await page.waitForTimeout(1000);
            await expect(resultsTab.locator('.pagination .page-item.active'), 'Clicking "First" should return to page 1').toContainText('1');
        });

        await test.step('"Add grant to Shortlist" moves a grant into the Shortlist tab', async () => {
            const firstGrantTitle = (await resultsTab.locator('.grant-title').first().innerText()).trim();

            await resultsTab.locator('button[name="btnShortlist"].star').first().click();
            await page.waitForTimeout(500);

            await page.locator('#result-tab-list-tab-s').click();
            const shortlistTab = page.locator('#result-tab-list-tabpane-s');
            await expect(shortlistTab, 'The shortlisted grant should appear in the Shortlist tab').toContainText(firstGrantTitle);

            await page.locator('#result-tab-list-tab-g').click();
        });
    });

    // Progresses the survey just far enough (through "About you") to reach the "Your current or
    // previous occupation and industry" page, where a real search reference token first appears -
    // mirrors `obtainRealCalculationReference()`'s role for the Benefits Calculator above.
    async function obtainRealGrantsSearchReference(page) {
        await navigateViaGetSupportMenu(page, 'Grants Search');
        await page.getByRole('link', { name: 'Get Started', exact: true }).first().click();
        await page.waitForLoadState('networkidle').catch(() => { });
        await page.waitForSelector('main h1, main button', { timeout: 15000 }).catch(() => { });

        await page.locator('button[name="btnNext"]').click(); // "Before you start" -> "About you"
        await page.waitForTimeout(800);

        const postcode = 'M335SH';
        await page.locator('input#QuestionAge').fill('43');
        await page.locator('label[for="QuestionGender_0"]').click();
        await page.locator('input#QuestionPostcode').fill(postcode);
        await page.locator('#btnNext').click(); // "About you" -> occupation
        await page.waitForTimeout(800);

        await expect(page.locator('h1'), 'The wizard should reach the occupation page before a search reference is available').toHaveText('Your current or previous occupation and industry');

        const referenceInput = page.locator('input#token');
        await expect(referenceInput, 'The occupation page should show a real search reference').toBeVisible();
        const reference = await referenceInput.inputValue();
        expect(reference.length, 'The search reference should be a real, non-empty value').toBeGreaterThan(0);

        return { reference, postcode };
    }

    // Confirmed via direct probing 2026-09-25: same functionality as the Benefits Calculator's
    // own "Return to a Calculation" card - only the page's own title/labels differ ("Return to a
    // grants search" / "Search Reference" instead of "Return to a calculation" / "Calculation
    // Reference"). An invalid reference/postcode shows a real "Reference and/or postcode not
    // found." alert without navigating away; a valid one resumes the real saved search at a
    // `/survey/{step}/{guid}` URL (confirmed: not necessarily the exact step the reference was
    // captured on - it resumed at "About you" here despite the token being read from the
    // occupation page - a minor, non-actionable nuance, not asserted on specifically).
    test('Return to a Grants Search Traversal', async ({ page }) => {
        test.setTimeout(2 * 60 * 1000);

        const { reference, postcode } = await test.step('Progress the survey far enough to obtain a real search reference', async () => {
            return obtainRealGrantsSearchReference(page);
        });

        await test.step('Navigate back to the Grants Search landing page and verify card 2 is present', async () => {
            await navigateViaGetSupportMenu(page, 'Grants Search');

            await expect(page.locator('#index_token'), 'The "Return to a grants search" card should show a Search Reference field').toBeVisible();
            await expect(page.locator('#index_postcode'), 'The "Return to a grants search" card should show a Postcode field').toBeVisible();
            await expect(page.getByRole('button', { name: 'Find search', exact: true }), 'The "Return to a grants search" card should show a "Find search" button').toBeVisible();
        });

        await test.step('An invalid reference/postcode combination shows a real error and does not navigate', async () => {
            await page.locator('#index_token').fill('XXX-XXX-XXX');
            await page.locator('#index_postcode').fill('AA11AA');
            await page.getByRole('button', { name: 'Find search', exact: true }).click();

            await expect(page.getByRole('alert'), 'An invalid reference/postcode combination should show a real "not found" error').toContainText(/not found/i);
            expect(page.url(), 'An invalid combination should not navigate away from the landing page').toBe('https://staging-grants-search.turn2us.org.uk/');
        });

        await test.step('A valid reference/postcode combination resumes the real saved search', async () => {
            await page.locator('#index_token').fill(reference);
            await page.locator('#index_postcode').fill(postcode);
            await page.getByRole('button', { name: 'Find search', exact: true }).click();
            await page.waitForLoadState('load').catch(() => { });

            await expect.poll(() => page.url(), {
                message: 'A valid reference/postcode combination should resume the saved search at a real /survey/{step}/{guid} URL',
            }).toMatch(/\/survey\/\d+\/[0-9a-f-]{36}/i);

            await expect(page.locator('h1').first(), 'The resumed search should land on a real wizard screen with a visible H1').toBeVisible();
        });
    });

    // Confirmed via direct probing 2026-09-25: this card's destination
    // (`https://www.turn2us.org.uk/Your-Situation`) is the exact SAME page already covered by the
    // Benefits Calculator's own "Your Situation Traversal" above - same content, same 15 real
    // situation cards, same in-page nav/Share/footer behaviour. This test is otherwise identical
    // to that one, just reached via the Grants Search landing page's own card instead.
    test('Your Situation Traversal', async ({ page, context }) => {
        test.setTimeout(8 * 60 * 1000);

        const situationPage = await test.step('Open "Your situation" from the Grants Search landing page (opens in a new tab)', async () => {
            await navigateViaGetSupportMenu(page, 'Grants Search');

            const [popup] = await Promise.all([
                context.waitForEvent('page'),
                page.getByRole('link', { name: 'Your situation', exact: false }).click(),
            ]);
            await popup.waitForLoadState('load').catch(() => { });

            await verifyTitleH1AndBreadcrumb(popup, 'Your Situation (landing page)', true);
            return popup;
        });

        const cards = await test.step('Read every real situation card fresh from the page', async () => {
            const items = await situationPage.evaluate(() => {
                const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
                return Array.from(document.querySelectorAll('.ctaRowItem')).map((item) => {
                    const heading = item.querySelector('h2, h3, h4');
                    const link = item.querySelector('a.button');
                    return {
                        heading: normalize(heading?.textContent),
                        linkText: normalize(link?.textContent),
                        href: link?.getAttribute('href') || null,
                    };
                }).filter((card) => card.href);
            });
            expect(items.length, 'The "Your Situation" page should expose at least one real situation card').toBeGreaterThan(0);
            return items;
        });

        const situationPageUrl = situationPage.url();

        for (const card of cards) {
            await test.step(`"${card.heading}" -> "${card.linkText}"`, async () => {
                await situationPage.goto(situationPageUrl, { waitUntil: 'domcontentloaded' });
                await situationPage.waitForLoadState('load').catch(() => { });

                const cardLink = situationPage.locator('.ctaRowItem a.button', { hasText: card.linkText }).first();
                await cardLink.click();
                await situationPage.waitForLoadState('load').catch(() => { });

                await test.step('Verify title, H1, and breadcrumb', async () => {
                    await verifyTitleH1AndBreadcrumb(situationPage, card.heading, true);
                });

                await test.step('Verify the in-page navigation device (forward and backward)', async () => {
                    await verifyInPageNavigationDevice(situationPage, card.heading);
                });

                await test.step('Verify the "Share" section (3 sharing options)', async () => {
                    await verifyShareSection(situationPage, card.heading);
                });

                await test.step('Verify the footer and its "Back to top" control', async () => {
                    await verifyFooterAndBackToTop(situationPage);
                });
            });
        }
    });

    // Confirmed via direct probing 2026-09-25: clicking "Skip this page" on every one of the 6
    // skippable pages (every page except "Before you start", which has no skip control) reaches
    // the results page with genuinely ZERO matched grants - a real, distinct "no results" state
    // (`"Sorry, we have not been able to match your responses to any grants."`, with a "New
    // Search" link back to `/survey/` and suggested next steps), rather than an error or an empty
    // crash. This is deliberately a LIGHTER check than "Use the Turn2us Grants Search Traversal"
    // above per Hector - the full accordion/toggle/shortlist/pagination sweep is already covered
    // there with real matched grants, so this test only confirms the skip path itself works and
    // lands somewhere real and sensible, not a re-run of that same deep investigation.
    test('Skip Every Page Traversal', async ({ page }) => {
        test.setTimeout(2 * 60 * 1000);

        await test.step('Start the survey from the Grants Search landing page', async () => {
            await navigateViaGetSupportMenu(page, 'Grants Search');
            await page.getByRole('link', { name: 'Get Started', exact: true }).first().click();
            await page.waitForLoadState('networkidle').catch(() => { });
            await page.waitForSelector('main h1, main button', { timeout: 15000 }).catch(() => { });
        });

        await test.step('"Before you start" has no "Skip this page" control - just Next', async () => {
            await expect(page.locator('h1'), 'The first survey page should be "Before you start"').toHaveText('Before you start');
            await expect(page.locator('button.skip-page'), '"Before you start" should NOT show a "Skip this page" control').toBeHidden();
            await page.locator('button[name="btnNext"]').click();
            await page.waitForTimeout(800);
        });

        const expectedPages = [
            'About you',
            'Your current or previous occupation and industry',
            'Your Health',
            'Your Religion',
            'Energy Providers',
            'Water Providers',
        ];

        for (const expectedH1 of expectedPages) {
            await test.step(`"${expectedH1}" - click "Skip this page"`, async () => {
                await expect(page.locator('h1'), `This page should be "${expectedH1}"`).toHaveText(expectedH1, { timeout: 15000 });
                const skipButton = page.locator('button.skip-page');
                await expect(skipButton, `"${expectedH1}" should show a "Skip this page" control`).toBeVisible();
                await skipButton.click();
                await page.waitForLoadState('networkidle').catch(() => { });
                await page.waitForTimeout(1000);
            });
        }

        await test.step('Reach the results page in a real, distinct "no grants matched" state', async () => {
            await page.waitForLoadState('networkidle').catch(() => { });
            await page.waitForSelector('.loader-background', { state: 'detached', timeout: 20000 }).catch(() => { });
            await page.waitForTimeout(1000);

            await expect(page.locator('h1'), 'The results page should show its own H1').toHaveText('Your Grants Search Results');

            const resultsTab = page.locator('#result-tab-list-tabpane-g');
            await expect(resultsTab, 'A real "no grants matched" message should be shown').toContainText(/have not been able to match your responses to any grants/i);
            await expect(resultsTab.locator('.grant-title'), 'No grant cards should be listed when nothing matched').toHaveCount(0);

            const newSearchLink = resultsTab.getByRole('link', { name: 'New Search', exact: true });
            await expect(newSearchLink, 'A "New Search" link should be offered to start over').toBeVisible();
            await expect(newSearchLink, 'The "New Search" link should point back at a fresh survey').toHaveAttribute('href', '/survey/');
        });
    });
}); // end test.describe('Get Support - Grants Search')

// ============================================================================
// Coverage notes - "Turn2us PIP Helper" landing page
// ============================================================================
// Confirmed via direct probing 2026-09-28: a separate app on its own subdomain
// (`https://staging-pip.turn2us.org.uk/`), matching the Benefits Calculator/Grants Search
// pattern. Structure, top to bottom:
//   - Hero: H1 (see the H1 sr-only-expansion note above), intro text, a "Get Started" button
//     (-> `/how-do-you-start-your-claim`) and a "View Stages" BUTTON (not a link) that just
//     smooth-scrolls the page down to the stages list below (confirmed: no navigation, no URL
//     change - `window.scrollY` increases).
//   - An intro video using the **Plyr** player (wrapping a Vimeo iframe) - confirmed via direct
//     probing: the play control is `button[data-plyr="play"]`, whose `aria-pressed` attribute and
//     the player container's own class (`.plyr` gains `plyr--playing`, loses `plyr--paused`) both
//     flip on click, matching this workspace's established "verify real state change" convention
//     for custom play/pause controls (e.g. Grants Search's carousel play/pause).
//   - TWO "Download Video Transcript" buttons exist in the DOM with near-identical text - CONFIRMED
//     REAL QUIRK: the first (inside a `.transcript-link.no-print` wrapper) renders at 0×0 (genuinely
//     invisible, not just visually hidden for a11y - no `sr-only` class), while the second (inside
//     `.transcript-link.pad-bottom20`, styled pink) is the real, visible, interactive one users
//     actually see and click. This test only interacts with the visible one. Clicking it triggers a
//     real file download (confirmed filename `"Claiming PIP.txt"`) - captured via Playwright's
//     `download` event and never saved anywhere on this machine, per Hector's explicit instruction.
//   - H2 "What do you want to know about PIP?" with 6 numbered stage links (`.stage-button`), each
//     to its own real destination, plus a "Get Started Here" button sharing stage 1's destination.
//   - "Sign up to track your progress": external privacy-policy/adviser-account links plus Sign
//     up/Login buttons pointing at the main site's `/myturn2us` auth flows - covered generically by
//     `verifyPageButtonsNotBroken()` below rather than asserted individually.
//   - 4 static feature blurbs (Co-produced/Confidential/Accessible/Wellbeing focused), then the
//     standard footer/back-to-top.
// ============================================================================

test.describe('Get Support - Turn2us PIP Helper', () => {
    test('Initial Page Load Tests', async ({ page }) => {
        test.setTimeout(60000);
        const pipHelperDestination = GET_SUPPORT_DESTINATIONS.find((d) => d.name === 'Turn2us PIP Helper');

        await test.step('Navigate to "Turn2us PIP Helper" via the "Get support" menu', async () => {
            await navigateViaGetSupportMenu(page, 'Turn2us PIP Helper');
        });

        await test.step('Verify the page title and H1', async () => {
            await expect(page, `The title should match ${pipHelperDestination.titlePattern}`).toHaveTitle(pipHelperDestination.titlePattern);
            await expect(page.locator('h1'), 'The page should have exactly one H1').toHaveCount(1);
            await expect(page.locator('h1').first(), `The H1 should match ${pipHelperDestination.h1Pattern}`).toContainText(pipHelperDestination.h1Pattern);
        });

        await test.step('Verify the hero "Get Started" button', async () => {
            const getStarted = page.locator('#get-started');
            await expect(getStarted, 'The hero "Get Started" button should be visible').toBeVisible();
            await expect(getStarted, 'It should link to the first stage').toHaveAttribute('href', '/how-do-you-start-your-claim');
        });

        await test.step('"View Stages" anchors down to the 6 stage links and the 2 "Get Started" buttons (no navigation)', async () => {
            const urlBefore = page.url();
            const scrollBefore = await page.evaluate(() => window.scrollY);

            await page.locator('button', { hasText: 'View Stages' }).click();
            await page.waitForTimeout(500);

            const scrollAfter = await page.evaluate(() => window.scrollY);
            expect(scrollAfter, '"View Stages" should scroll the page down').toBeGreaterThan(scrollBefore);
            expect(page.url(), '"View Stages" should not navigate away').toBe(urlBefore);

            const stageLinks = page.locator('a.stage-button');
            await expect(stageLinks, 'The 6 stage links should be present').toHaveCount(6);
            for (let i = 0; i < 6; i++) {
                await expect(stageLinks.nth(i), `Stage link ${i + 1} should be scrolled into view`).toBeInViewport();
            }

            // "Get Started Here" sits just below the 6 stage links (after the "Don't know where
            // to start?" text) - confirmed via direct probing 2026-09-28 that it doesn't always
            // fit in the same viewport as all 6 links at once, so this checks visibility (not
            // strict in-viewport) to avoid an assertion that depends on exact viewport height.
            const getStartedHere = page.locator('a', { hasText: 'Get Started Here' });
            await expect(getStartedHere, 'The "Get Started Here" button should be present in the same anchored-to section').toBeVisible();

            // Confirmed via direct probing 2026-09-28: the hero "Get Started" button, stage link 1
            // ("Check if you're eligible and start a claim"), and "Get Started Here" all point at
            // the exact same destination - the first of the 6 stages, which is covered by the
            // "What Do You Want to Know Traversal" being built next.
            const stage1Href = await stageLinks.first().getAttribute('href');
            expect(stage1Href, 'Stage 1\'s link should point at the "start your claim" destination').toBe('/how-do-you-start-your-claim');
            await expect(page.locator('#get-started'), 'The hero "Get Started" button should share stage 1\'s destination').toHaveAttribute('href', stage1Href);
            await expect(getStartedHere, 'The "Get Started Here" button should share stage 1\'s destination').toHaveAttribute('href', stage1Href);
        });

        await test.step('Verify the intro video (Plyr/Vimeo) play control', async () => {
            const videoFrame = page.locator('iframe[src*="vimeo" i]').first();
            await expect(videoFrame, 'The intro video should be a real Vimeo embed').toBeVisible();

            // Confirmed via direct probing 2026-09-28: the custom Plyr player (with its own
            // play/pause control) only mounts at wider (desktop) viewports - tablet/mobile widths
            // get a bare Vimeo iframe instead, with no `.plyr`/`data-plyr` controls in the DOM at
            // all (Vimeo's own native in-iframe controls take over instead, which Playwright can't
            // reach across the cross-origin embed). So the play/pause interaction is only
            // exercised when the Plyr wrapper is actually present.
            const playButton = page.locator('button[data-plyr="play"]').first();
            const plyrMounted = await playButton.isVisible().catch(() => false);
            if (!plyrMounted) {
                return;
            }

            const player = page.locator('.plyr').first();

            await expect(playButton, 'The play control should start unpressed (paused)').toHaveAttribute('aria-pressed', 'false');
            await expect(player, 'The player should start in a paused state').toHaveClass(/plyr--paused/);

            await playButton.click();
            await expect(playButton, 'Clicking play should mark the control as pressed').toHaveAttribute('aria-pressed', 'true');
            await expect(player, 'The player should report itself playing').toHaveClass(/plyr--playing/);

            await playButton.click();
            await expect(playButton, 'Clicking it again should un-press the control (pause)').toHaveAttribute('aria-pressed', 'false');
        });

        await test.step('"Download Video Transcript" triggers a real file download (not saved anywhere)', async () => {
            const downloadButton = page.locator('.transcript-link.pad-bottom20 button.download-link').first();
            await expect(downloadButton, 'The visible "Download Video Transcript" button should be present').toBeVisible();

            const [download] = await Promise.all([
                page.waitForEvent('download'),
                downloadButton.click(),
            ]);
            expect(download.suggestedFilename(), 'The download should be a real .txt transcript file').toMatch(/\.txt$/i);
            await download.cancel();
        });

        await test.step('Verify the "What do you want to know about PIP?" stage links', async () => {
            await expect(page.getByRole('heading', { name: 'What do you want to know about PIP?', level: 2 }), 'The stages section should show its own H2').toBeVisible();

            const stageLinks = page.locator('a.stage-button');
            await expect(stageLinks, 'The page should show 6 numbered stage links').toHaveCount(6);

            const hrefs = await stageLinks.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
            for (const href of hrefs) {
                expect(href, 'Every stage link should have a real, non-empty destination').toBeTruthy();
            }

            const getStartedHere = page.locator('a', { hasText: 'Get Started Here' });
            await expect(getStartedHere, 'The "Get Started Here" button should be visible').toBeVisible();
            await expect(getStartedHere, 'It should share stage 1\'s destination').toHaveAttribute('href', hrefs[0]);
        });

        await test.step('Verify the page\'s buttons/links are not broken', async () => {
            await verifyPageButtonsNotBroken(page);
        });

        await test.step('Verify the footer and its "Back to top" control', async () => {
            await verifyFooterAndBackToTop(page);
        });
    });

    // ========================================================================
    // Coverage notes - "What Do You Want to Know Traversal" (stage 1 + stage 2 reference journey)
    // ========================================================================
    // Confirmed via direct probing 2026-09-28. Stage 1 (`/how-do-you-start-your-claim`) and stage 2
    // (`/how-do-you-prepare-for-your-pip-form`) share the same template:
    //   - A breadcrumb reading "Home > <stage title>" (the stage title itself is NOT a real link -
    //     it's an `<a href="#" role="button">` wrapping the H1, purely decorative).
    //   - A left sidebar (`nav[aria-label="Claim steps navigation"]`) with a real "Home" link
    //     (-> `/`, the PIP Helper landing page) plus several `button.sidebar-links` that each
    //     smooth-scroll to a section further down the SAME page (not real anchors/navigation) -
    //     "Make me feel better" (last one) scrolls all the way to the bottom, where the page's
    //     SECOND video lives. A "Back"/"Next stage" pair at the very bottom of the sidebar
    //     navigates between the 3 real stage URLs.
    //   - 2 real videos per stage page, both using the same Plyr/Vimeo pattern as the landing
    //     page's own intro video (see `Initial Page Load Tests` above for the same
    //     desktop-only-Plyr / mobile-bare-iframe caveat).
    //   - A "Don't lose your progress" sign-up/login modal that appears exactly once per session,
    //     the first time a real "commit" action happens on EACH stage (confirmed: triggered by the
    //     first eligibility-question answer on stage 1, and by the Overview -> descriptor-1
    //     transition on stage 2) - closed via its own "Close the popup" button, never Sign up/Login.
    //   - Every one of these stage pages also carries the SAME "Things to Know" /"Your Rights"/
    //     "Tips"/"Positive stories"/"Get support"/"Your checklist"/"Make me feel better" universal
    //     sections seen on the landing page, including a "Your checklist" list of plain checkboxes
    //     (no `id`, matched by their label text) whose checked state persists correctly across
    //     every subsequent step of the SAME stage (confirmed via direct probing).
    //   - Every heading/label throughout has its own speaker ("read aloud") button - confirmed via
    //     direct probing that clicking one populates its paired (previously empty-`src`) `<audio>`
    //     element with a real generated MP3 URL and swaps its icon from `buttonSpeakerOff` to
    //     `buttonSpeakerOn` - verified generically on one instance rather than every single one.
    //
    // Stage 1's own "Quickly check if you're eligible to claim PIP" question chain (all real
    // `radio-group` fieldsets, confirmed field names in order): `WorkingAge` (Yes/No) ->
    // `LivingInUk` -> `Nationality` -> `PastPresence` -> `AlreadyGettingBenefits` ->
    // `TerminalIllness` -> `HaveHealthConditionTwelveMonths`. Confirmed via direct probing that
    // neither a "No" nor a "Yes" answer on the final question reveals any extra page content - the
    // sidebar's own "Next stage" control is always present regardless, so answering "Yes" here (the
    // real, positive path Hector dictated) is simply the natural way to continue into stage 2.
    //
    // Stage 2's "Overview" section has its own `PipConditionsQuestion` (10-item health-condition
    // multi-select), a `FluctuatingCondition` dropdown, and a `ProsthesisQuestion` Yes/No, followed
    // by a `.descriptors-navigation` "Next" button that begins the real PIP descriptor sequence
    // (confirmed distinct from the sidebar's own "Next stage" button, which merely contains the
    // substring "Next" too - `.descriptors-navigation button` is used throughout to avoid
    // accidentally matching the wrong one). That sequence is:
    //   1. A combined box-select page: `PipSelector` (10 daily-living activities) + `PipSelectorMob`
    //      (exactly 2 mobility activities, "Going out"/"Moving around") - Hector selected "Eating
    //      and drinking"/"Preparing food"/"Reading" (daily living) + "Moving around" (mobility).
    //   2. One individual Yes/No descriptor page per selected activity, in DOM order regardless of
    //      click order - confirmed real question counts: "Preparing food" (10), "Eating and
    //      drinking" (9), "Reading" (exactly 2, matching Hector's "yes to both").
    //   3. "Moving around" - starts with a SINGLE gating question
    //      (`PipMbActivityMovingCheck`); answering "Yes" progressively reveals
    //      `PipMbActivityMovingStandTwo` -> `PipMbActivityMovingBalance` -> a genuinely different
    //      question type, a distance DROPDOWN (`select#PipMbActivityMovingBalanceDistance_1`,
    //      confirmed real option "Over 200 metres").
    //   4. The Results screen - a real PIP award estimate, a "Download results (PDF, ~300 KB)"
    //      button (`#download01`, confirmed via direct probing to trigger a real `download` event
    //      with filename "Turn2us - PIP Helper Result.pdf" - captured and cancelled here, never
    //      saved to disk, per Hector's explicit instruction), the SAME universal sections as every
    //      other stage page (checklist state still correctly persisted), and the sidebar's own
    //      "Back"/"Next stage" pair (confirmed: "Back" -> stage 1, "Next stage" -> stage 3,
    //      "Fill in your PIP form" - NOT clicked here, deliberately left for the separate "Filling
    //      PIP Traversal" Hector asked to build on a later day).
    // ========================================================================

    // Waits briefly for the modal's fade-in (confirmed via direct probing it doesn't appear
    // instantly on the triggering click) rather than checking visibility immediately, which would
    // otherwise miss it and leave it blocking the next click a moment later.
    async function closePipSignupModalIfPresent(page) {
        const closeButton = page.getByRole('button', { name: 'Close the popup' });
        const appeared = await closeButton.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
        if (appeared) {
            await closeButton.click();
            await page.waitForTimeout(400);
        }
    }

    // Confirmed via direct probing 2026-09-28: at mobile widths, the whole "Claim steps
    // navigation" sidebar (Home link, section-anchor buttons, Back/Next stage) collapses behind a
    // hamburger toggle (`.navbar-toggler button`) - must be opened before any sidebar element can
    // be interacted with. No-ops if the sidebar is already expanded (desktop/tablet).
    async function openPipSidebarMenuIfCollapsed(page) {
        const homeLink = page.locator('a.home-link');
        const alreadyOpen = await homeLink.isVisible().catch(() => false);
        if (!alreadyOpen) {
            await page.locator('.navbar-toggler button').click();
            await page.waitForTimeout(400);
        }
    }

    async function clickPipDescriptorNext(page) {
        await page.locator('.descriptors-navigation button', { hasText: 'Next' }).first().click();
        await page.waitForTimeout(700);
        await closePipSignupModalIfPresent(page);
    }

    // Clicks every currently-unanswered "Yes" radio in the page's visible descriptor question
    // fieldsets - used for the bulk "select Yes to all" pages (Preparing food/Eating and
    // drinking/Reading), where the exact field names aren't individually meaningful to assert on.
    async function answerAllPipDescriptorQuestionsYes(page) {
        for (let guard = 0; guard < 20; guard++) {
            const yesLabels = page.locator('.radio-group label', { hasText: /^Yes$/ });
            const total = await yesLabels.count();
            let clickedAny = false;
            for (let i = 0; i < total; i++) {
                const label = yesLabels.nth(i);
                const alreadyChecked = await label.evaluate((el) => {
                    const input = document.getElementById(el.getAttribute('for'));
                    return input ? input.getAttribute('aria-checked') === 'true' : true;
                });
                if (!alreadyChecked) {
                    await label.click();
                    clickedAny = true;
                }
            }
            await page.waitForTimeout(300);
            if (!clickedAny) break;
        }
    }

    test('What Do You Want to Know Traversal', async ({ page }) => {
        test.setTimeout(6 * 60 * 1000);

        await test.step('Open stage 1 from the "What do you want to know about PIP?" section', async () => {
            await navigateViaGetSupportMenu(page, 'Turn2us PIP Helper');
            const stageOneLink = page.locator('a.stage-button').first();
            await stageOneLink.waitFor({ state: 'visible', timeout: 15000 });
            await stageOneLink.click();
            await page.waitForLoadState('networkidle').catch(() => { });
            await page.waitForSelector('h1', { timeout: 15000 }).catch(() => { });
            await page.waitForTimeout(1000);

            await expect(page, 'The URL should be stage 1\'s real destination').toHaveURL(/\/how-do-you-start-your-claim/);
            await expect(page.locator('h1'), 'Stage 1 should show its own H1').toContainText(/Check if you're eligible and start a claim/i);
        });

        await test.step('Verify the "Home > ..." breadcrumb', async () => {
            const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
            await expect(breadcrumb, 'The breadcrumb should show "Home" and the current stage').toContainText(/Home/);
            await expect(breadcrumb, 'The breadcrumb should also show the current stage').toContainText(/Check if you're eligible and start a claim/i);

            // Confirmed via direct probing 2026-09-28: on mobile (Pixel 7) widths specifically, the
            // "Home" breadcrumb link collapses to a genuine 0x0 bounding box (real quirk, not a
            // deliberate a11y hiding technique - no `sr-only` class) despite `display`/`visibility`
            // both reporting normal - so its clickability is only asserted where it actually has a
            // real size on screen.
            const homeLink = breadcrumb.getByRole('link', { name: 'Home', exact: true });
            const homeLinkBox = await homeLink.boundingBox().catch(() => null);
            if (homeLinkBox && homeLinkBox.width > 0 && homeLinkBox.height > 0) {
                await expect(homeLink, 'The breadcrumb\'s "Home" link should be visible').toBeVisible();
            }
        });

        await test.step('Sidebar "Home" returns to the PIP Helper landing page', async () => {
            await openPipSidebarMenuIfCollapsed(page);
            await page.locator('a.home-link').click();
            await page.waitForLoadState('networkidle').catch(() => { });
            await expect(page, '"Home" should return to the PIP Helper landing page').toHaveURL('https://staging-pip.turn2us.org.uk/');
            await page.goBack();
            await page.waitForLoadState('networkidle').catch(() => { });
            await expect(page, 'Navigating back should return to stage 1').toHaveURL(/\/how-do-you-start-your-claim/);
        });

        await test.step('Every other sidebar link anchors within the page (no navigation)', async () => {
            await openPipSidebarMenuIfCollapsed(page);
            const urlBefore = page.url();
            const sidebarLinks = page.locator('.sidebar-links');
            const count = await sidebarLinks.count();
            expect(count, 'The sidebar should show several section links').toBeGreaterThan(0);

            for (let i = 0; i < count; i++) {
                const link = sidebarLinks.nth(i);
                const label = await link.getAttribute('aria-label');
                await test.step(`"${label}" anchors within the page`, async () => {
                    await openPipSidebarMenuIfCollapsed(page);
                    const scrollBefore = await page.evaluate(() => window.scrollY);
                    await link.click();
                    await page.waitForTimeout(500);
                    const scrollAfter = await page.evaluate(() => window.scrollY);
                    expect(scrollAfter, `"${label}" should scroll the page`).not.toBe(scrollBefore);
                    expect(page.url(), `"${label}" should not navigate away`).toBe(urlBefore);
                });
            }

            // "Make me feel better" (the last sidebar link) - confirmed via direct probing this
            // anchors all the way to the bottom of the page, where the page's SECOND video lives.
            const scrollHeight = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
            const scrollNow = await page.evaluate(() => window.scrollY);
            expect(scrollNow, '"Make me feel better" should land near the very bottom of the page').toBeGreaterThan(scrollHeight * 0.7);
            await expect(page.locator('.plyr, iframe[src*="vimeo" i]').last(), 'The second video should be visible near the bottom').toBeVisible();
        });

        await test.step('Verify both intro videos (Plyr/Vimeo) on this page', async () => {
            const playButtons = page.locator('button[data-plyr="play"]');
            const plyrCount = await playButtons.count();
            // Confirmed via direct probing 2026-09-28: same desktop-only Plyr caveat as the
            // landing page - tablet/mobile widths render bare Vimeo iframes with no Plyr controls.
            if (plyrCount === 0) {
                await expect(page.locator('iframe[src*="vimeo" i]'), 'Both videos should still be real Vimeo embeds').toHaveCount(2);
                return;
            }

            expect(plyrCount, 'The page should show exactly 2 video players').toBe(2);
            for (let i = 0; i < plyrCount; i++) {
                const playButton = playButtons.nth(i);
                const player = page.locator('.plyr').nth(i);
                await playButton.click();
                await expect(player, `Video ${i + 1} should report itself playing`).toHaveClass(/plyr--playing/);
                await playButton.click();
                await expect(player, `Video ${i + 1} should report itself paused again`).not.toHaveClass(/plyr--playing/);
            }
        });

        await test.step('A speaker ("read aloud") button populates its audio element and swaps its icon', async () => {
            const speakerButton = page.locator('button.speaker').first();
            const audio = page.locator('audio').first();
            await expect(audio, 'The audio element should start empty').toHaveAttribute('src', '');

            await speakerButton.click({ force: true });
            await expect(audio, 'Clicking the speaker should populate a real audio source').not.toHaveAttribute('src', '');
            await expect(speakerButton.locator('svg'), 'The icon should swap to its "on" state').toHaveAttribute('id', 'buttonSpeakerOn');
        });

        await test.step('Select a country', async () => {
            await page.selectOption('#select-country', 'England');
            await expect(page.locator('#select-country'), 'England should be selected').toHaveValue('England');
        });

        await test.step('"Start your claim by phone/post/online" accordions expand and collapse', async () => {
            const accordionButtons = page.locator('button.expand-link');
            const count = await accordionButtons.count();
            expect(count, 'The page should show the 3 "start your claim" accordions').toBe(3);

            for (let i = 0; i < count; i++) {
                const button = accordionButtons.nth(i);
                const label = (await button.locator('.accordion-text-style').innerText()).trim();
                const wasExpanded = (await button.getAttribute('aria-expanded')) === 'true';

                await test.step(`"${label}" expands`, async () => {
                    if (!wasExpanded) {
                        await button.click();
                    }
                    await expect(button, `"${label}" should report itself expanded`).toHaveAttribute('aria-expanded', 'true');
                    await expect(button.locator('.accordion-toggle-text'), `"${label}"'s toggle text should read "Hide"`).toHaveText('Hide');
                });
            }

            for (let i = 0; i < count; i++) {
                const button = accordionButtons.nth(i);
                const label = (await button.locator('.accordion-text-style').innerText()).trim();

                await test.step(`"${label}" collapses`, async () => {
                    await button.click();
                    await expect(button, `"${label}" should report itself collapsed`).toHaveAttribute('aria-expanded', 'false');
                    await expect(button.locator('.accordion-toggle-text'), `"${label}"'s toggle text should read "Show"`).toHaveText('Show');
                });
            }

            // Confirmed via direct probing 2026-09-28: the real "Start your claim" external link
            // (inside the "phone" accordion) always points at the LIVE gov.uk site, unaffected by
            // this being a Staging journey - matched by href only, never navigated to.
            await expect(page.locator('#pip-claim-start'), 'The real "Start your claim" link should point at the live gov.uk site').toHaveAttribute('href', 'https://www.gov.uk/pip/how-to-claim');
        });

        await test.step('"Quickly check if you\'re eligible to claim PIP" - the eligibility question chain', async () => {
            await page.locator('label[for="WorkingAge_0"]').click(); // Yes
            await closePipSignupModalIfPresent(page);

            await page.locator('label[for="LivingInUk_0"]').click(); // Yes
            await page.locator('label[for="Nationality_0"]').click(); // Yes
            await page.locator('label[for="PastPresence_0"]').click(); // Yes
            await page.locator('label[for="AlreadyGettingBenefits_1"]').click(); // No
            await page.locator('label[for="TerminalIllness_1"]').click(); // No

            // Confirmed via direct probing 2026-09-28: neither answer to this final question
            // reveals any further content - selecting "Yes" (the real path forward) is simply how
            // this reference journey continues into the rest of stage 1/into stage 2.
            await page.locator('label[for="HaveHealthConditionTwelveMonths_0"]').click(); // Yes
            await expect(page.locator('#HaveHealthConditionTwelveMonths_0'), 'The final question should register as answered').toBeChecked();
        });

        await test.step('Sidebar "Next stage" moves to stage 2, and "Back" returns to stage 1', async () => {
            await openPipSidebarMenuIfCollapsed(page);
            await page.locator('button.sidebar-navigation-next').click();
            await page.waitForLoadState('networkidle').catch(() => { });
            await page.waitForTimeout(1000);
            await expect(page, 'Should now be on stage 2').toHaveURL(/\/how-do-you-prepare-for-your-pip-form/);

            await openPipSidebarMenuIfCollapsed(page);
            await page.locator('button.sidebar-navigation-prev').click();
            await page.waitForLoadState('networkidle').catch(() => { });
            await page.waitForTimeout(1000);
            await expect(page, '"Back" should return to stage 1').toHaveURL(/\/how-do-you-start-your-claim/);

            // Return to stage 2 to continue the reference journey.
            await openPipSidebarMenuIfCollapsed(page);
            await page.locator('button.sidebar-navigation-next').click();
            await page.waitForLoadState('networkidle').catch(() => { });
            await page.waitForTimeout(1000);
        });

        await test.step('Stage 2 Overview - health conditions, fluctuating condition, and prosthesis', async () => {
            await expect(page.locator('h1'), 'Stage 2 should show its own H1').toContainText(/Check what PIP award you're likely to get/i);

            await page.locator('label[for="PipConditionsQuestion_0"]').click(); // I have a learning disability
            await page.locator('label[for="PipConditionsQuestion_3"]').click(); // I have a mental health problem
            await page.selectOption('#FluctuatingCondition_1', 'I am always affected the same');
            await page.locator('label[for="ProsthesisQuestion_1"]').click(); // No
        });

        await test.step('Smoke-check links and the checklist checkbox toggle before continuing', async () => {
            await verifyPageButtonsNotBroken(page);

            const firstChecklistItem = page.locator('label.checkmark-container').first();
            await firstChecklistItem.click();
            await expect(firstChecklistItem.locator('input'), 'Clicking a checklist item should check it').toBeChecked();
            await firstChecklistItem.click();
            await expect(firstChecklistItem.locator('input'), 'Clicking it again should uncheck it').not.toBeChecked();
        });

        await test.step('Continue to the box-select descriptor page', async () => {
            await clickPipDescriptorNext(page);
        });

        await test.step('Select the daily living and mobility activities', async () => {
            await page.locator('label[for="PipSelector_1"]').click(); // Eating and drinking
            await page.locator('label[for="PipSelector_0"]').click(); // Preparing food
            await page.locator('label[for="PipSelector_7"]').click(); // Reading
            await page.locator('label[for="PipSelectorMob_1"]').click(); // Moving around

            await expect(page.locator('.descriptors-navigation button', { hasText: 'Next' }), 'The Next control should now target the first selected activity').toHaveAttribute('aria-label', /Preparing food/);
        });

        let persistentChecklistLabel;

        await test.step('"Preparing food" - answer every question Yes, then mark a checklist item to check persistence', async () => {
            await clickPipDescriptorNext(page);
            await expect(page.locator('legend', { hasText: 'Do you need to use any kind of aid to help you cook' }), 'Should now be on the "Preparing food" descriptor page').toBeVisible();

            await answerAllPipDescriptorQuestionsYes(page);

            persistentChecklistLabel = page.locator('label.checkmark-container').first();
            await persistentChecklistLabel.click();
            await expect(persistentChecklistLabel.locator('input'), 'The checklist item should now be checked').toBeChecked();
        });

        await test.step('"Eating and drinking" - answer every question Yes, checklist state persists', async () => {
            await clickPipDescriptorNext(page);
            await expect(page.locator('legend', { hasText: 'Do you need to wear dentures' }), 'Should now be on the "Eating and drinking" descriptor page').toBeVisible();
            await expect(persistentChecklistLabel.locator('input'), 'The checklist item should still be checked on this new page').toBeChecked();

            await answerAllPipDescriptorQuestionsYes(page);
        });

        await test.step('"Reading" - exactly 2 questions, both Yes, checklist state persists', async () => {
            await clickPipDescriptorNext(page);
            await expect(page.locator('legend', { hasText: 'Have you been recommended aids to use to help you when reading' }), 'Should now be on the "Reading" descriptor page').toBeVisible();
            await expect(page.locator('.radio-group label', { hasText: /^Yes$/ }), 'This page should have exactly 2 Yes/No questions').toHaveCount(2);
            await expect(persistentChecklistLabel.locator('input'), 'The checklist item should still be checked on this new page').toBeChecked();

            await answerAllPipDescriptorQuestionsYes(page);
        });

        await test.step('"Moving around" - answering Yes reveals further questions, ending in a distance dropdown', async () => {
            await clickPipDescriptorNext(page);
            await expect(page.locator('legend', { hasText: 'Does your disability or health condition cause you any difficulties with the physical act of standing or walking' }), 'Should now be on the "Moving around" descriptor page').toBeVisible();
            await expect(persistentChecklistLabel.locator('input'), 'The checklist item should still be checked on this new page').toBeChecked();

            await page.locator('label[for="PipMbActivityMovingCheck_0"]').click(); // Yes
            await page.locator('label[for="PipMbActivityMovingStandTwo_0"]').click(); // Yes
            await page.locator('label[for="PipMbActivityMovingBalance_0"]').click(); // Yes

            const distanceDropdown = page.locator('#PipMbActivityMovingBalanceDistance_1');
            await expect(distanceDropdown, 'Answering Yes should reveal the walking-distance dropdown').toBeVisible();
            await distanceDropdown.selectOption('Over 200 metres');
            await expect(distanceDropdown, '"Over 200 metres" should be selected').toHaveValue('Over 200 metres');
        });

        await test.step('Reach the results page', async () => {
            await clickPipDescriptorNext(page);
            await expect(page.getByRole('heading', { name: 'Your Results', exact: false }), 'The results page should show its own heading').toBeVisible();
            await expect(persistentChecklistLabel.locator('input'), 'The checklist item should still be checked on the results page').toBeChecked();
        });

        await test.step('"Download results (PDF)" triggers a real file download (not saved anywhere)', async () => {
            const downloadButton = page.locator('#download01');
            await expect(downloadButton, 'The PDF download button should be visible').toBeVisible();

            const [download] = await Promise.all([
                page.waitForEvent('download'),
                downloadButton.click(),
            ]);
            expect(download.suggestedFilename(), 'The download should be a real PIP Helper result PDF').toMatch(/\.pdf$/i);
            await download.cancel();
        });

        await test.step('Verify the sidebar\'s "Back" (stage 1) and "Next stage" (stage 3) controls, without following Next stage', async () => {
            await expect(page.locator('button.sidebar-navigation-prev'), '"Back" should point at stage 1').toHaveAttribute('aria-label', /1\. Check if you're eligible and start a claim/i);
            await expect(page.locator('button.sidebar-navigation-next'), '"Next stage" should point at stage 3, "Fill in your PIP form" - left for the "Filling PIP Traversal" to be built separately').toHaveAttribute('aria-label', /3\. Fill in your PIP form/i);
        });
    });
}); // end test.describe('Get Support - Turn2us PIP Helper')

// Grouped under a `test.describe()` per destination (one per real "Get support" submenu item)
// so the Test Explorer nests every related test under its own destination, per Hector's request
// 2026-09-25 - "Benefits Calculator", "Grants Search", and "Turn2us PIP Helper" each get their own
// describe above (with their Initial Page Load Tests test plus all of their sub-traversals nested
// inside), so they're skipped here to avoid a duplicate.
for (const destination of GET_SUPPORT_DESTINATIONS) {
    if (destination.name === 'Benefits Calculator' || destination.name === 'Grants Search' || destination.name === 'Turn2us PIP Helper') {
        continue;
    }

    test.describe(`Get Support - ${destination.name}`, () => {
        test('Initial Page Load Tests', async ({ page }) => {
            await runGetSupportPageTraversal(page, destination);
        });
    });
}
