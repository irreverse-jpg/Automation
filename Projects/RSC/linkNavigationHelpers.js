// ============================================================================
// Shared link/card/button navigation-verification helpers, used by every
// "Traversal" test in this project's menu-section specs (05-08 and onward).
//
// What this checks, per page: every real navigable link/button in the main
// content area actually goes somewhere valid - not just that the element
// exists. Two tiers, by design (added 2026-07-22 per explicit instruction):
//   - Card links: sampled (max 6 - first, last, and a spread across the
//     middle) when a page has more than 6 cards, since some pages in this
//     project have 500+ cards (e.g. Publishing's product catalogues,
//     Standards' find-accredited-courses) and full coverage there would be
//     impractical. All cards are checked when a page has 6 or fewer.
//   - Every other real link/button in main content: checked in full, no
//     sampling - these are typically far fewer per page (in-page anchor
//     jumps, mailto/tel, and javascript: links are excluded up front since
//     they aren't real page-to-page navigation).
//
// Excluded by design (already covered by their own dedicated tests
// elsewhere, re-testing them here would be redundant and slower):
//   - Anything inside <header>, <nav>, #mainnav, or <footer> - the
//     meganav/homepage/footer specs already cover header and footer links.
//   - JotForm lightbox trigger buttons (`[class*="lightbox-"]`) - the
//     contact-form specs already drive these through their own modal-open
//     flow; clicking them here would just open the same modal redundantly.
//   - Accordion toggle buttons (`.accordion-button`) and select2/sort
//     comboboxes (`[role="combobox"]`) - these don't navigate anywhere,
//     they toggle in-page state, and are covered by their own accordion/
//     sort tests where relevant.
//   - The OneTrust cookie banner's own buttons.
// ============================================================================

// [class*="ot-cookies"] excludes OneTrust's dynamically-rendered per-site cookie-list table
// (found on /help-and-legal/cookies, confirmed 2026-07-24) - it renders one link per actual
// cookie found scanning the site (164 on Live at time of writing) to a third-party lookup
// site (cookiepedia.co.uk), all outside any .card - so with no sampling tier for "other links"
// they were all checked individually, ballooning a single page's runtime well past the
// 600s-per-test budget. These links don't reflect this project's own content, so they're
// excluded outright rather than sampled.
const EXCLUDED_ANCESTOR_SELECTOR = 'header, nav, #mainnav, footer, [id*="onetrust"], [class*="ot-cookies"], .accordion-button, [role="combobox"], .select2-container';

function isRealHref(href) {
    return Boolean(href) && !/^(#|mailto:|tel:|javascript:)/i.test(href);
}

// Collects every distinct, real (non-anchor, non-mailto/tel) navigable link in
// main content, split into card links (sampled elsewhere if >6) and all other
// links/buttons (checked in full). Runs in-page via page.evaluate for speed.
async function collectNavigableElements(page) {
    return page.evaluate((excludedSelector) => {
        const main = document.querySelector('main') || document.body;
        const isExcluded = (el) => Boolean(el.closest(excludedSelector));
        const isRealHref = (href) => Boolean(href) && !/^(#|mailto:|tel:|javascript:)/i.test(href);

        const seenHrefs = new Set();
        const cardLinks = [];
        const otherLinks = [];

        const allAnchors = Array.from(main.querySelectorAll('a[href]'));
        for (const a of allAnchors) {
            if (isExcluded(a)) continue;
            // Confirmed real cause of false-positive "broken link" failures 2026-07-22: links
            // inside a COLLAPSED Bootstrap accordion panel (or any other display:none ancestor,
            // e.g. an inactive tab) are present in the DOM but not visible/clickable without an
            // extra expand step first - that's the accordion test's job, not this check's.
            // offsetParent is null for any element (or ancestor) with display:none, so this
            // catches collapsed-accordion content generically without hardcoding Bootstrap's
            // specific class names.
            if (a.offsetParent === null) continue;
            // Some wysiwyg content has stray empty <a href="..."> tags with no text/visible
            // content (zero rendered size) - offsetParent alone doesn't catch these since they
            // still participate in layout, just at 0x0. Confirmed 2026-07-22 on a real page.
            const rect = a.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const href = a.getAttribute('href');
            if (!isRealHref(href)) continue;
            if (seenHrefs.has(href)) continue;
            seenHrefs.add(href);

            const entry = {
                href,
                text: (a.textContent || '').trim().slice(0, 80),
                target: a.getAttribute('target') || null,
            };
            if (a.closest('.card')) {
                cardLinks.push(entry);
            } else {
                otherLinks.push(entry);
            }
        }

        // Real navigable buttons (not lightbox/accordion/combobox triggers, already excluded
        // above) are rare in this codebase but included for completeness - e.g. a button with
        // an onclick-driven navigation. None currently identified with an href to follow, so
        // this collects them by visible text only for a presence/enabled sanity check rather
        // than a navigation check (a button has no href to navigate to on its own).
        const otherButtons = Array.from(main.querySelectorAll('button'))
            .filter((b) => !isExcluded(b))
            .map((b) => ({ text: (b.textContent || '').trim().slice(0, 80) }));

        return { cardLinks, otherLinks, otherButtons };
    }, EXCLUDED_ANCESTOR_SELECTOR);
}

// First, last, and an even spread across the middle - same sampling pattern
// already used for this project's accordion tests.
function sampleUpToSix(items) {
    if (items.length <= 6) return items;
    const indexes = new Set([0, items.length - 1]);
    for (let i = 1; i <= 4; i += 1) {
        indexes.add(Math.floor((items.length - 1) * (i / 5)));
    }
    return Array.from(indexes).sort((a, b) => a - b).map((i) => items[i]);
}

const ERROR_PAGE_PATTERNS = [/404/i, /cannot find that page/i, /page not found/i];

async function isErrorPage(page) {
    const title = await page.title().catch(() => '');
    const h1 = await page.locator('h1').first().innerText().catch(() => '');
    return ERROR_PAGE_PATTERNS.some((pattern) => pattern.test(title) || pattern.test(h1));
}

// Clicks one collected link and verifies it lands somewhere real (not a 404/error page,
// and the page actually loaded). Opens the source page fresh first so every check starts
// from clean state, then clicks by exact href+text match (more robust than an index, since
// dedup already guarantees each href is unique on the page).
async function verifyLinkNavigates(page, { sourceUrl, openSourcePage, waitForAndAcceptCookieBanner }, link) {
    await openSourcePage(page, sourceUrl);

    // Scoped to main - the hidden #mainnav (present on every page, revealed only on click)
    // frequently contains an <a> with the exact same href+text as a body/card link (e.g. a
    // "Funding" meganav item alongside a "Funding" content card) - an unscoped page-wide
    // locator can silently resolve to that hidden nav copy instead of the visible one.
    // ":visible" is also required within main itself: some pages render two elements with the
    // identical href+text (e.g. a responsive "initial"/hidden CTA variant alongside the real
    // visible one) - without it, .first() can resolve to the hidden duplicate even though
    // collectNavigableElements() correctly identified the visible one. Confirmed 2026-07-22.
    const locator = page.locator('main').locator(`a[href="${link.href}"]:visible`, { hasText: link.text || undefined }).first();
    await locator.scrollIntoViewIfNeeded().catch(() => { });

    if (link.target === '_blank') {
        const popupPromise = page.context().waitForEvent('page', { timeout: 15000 });
        await locator.click({ timeout: 10000, noWaitAfter: true });
        const popup = await popupPromise;
        await popup.waitForLoadState('load', { timeout: 20000 }).catch(() => { });
        await popup.waitForTimeout(500);

        const popupUrl = popup.url();
        const looksLikeError = await isErrorPage(popup);
        await popup.close().catch(() => { });

        return { ok: !looksLikeError && popupUrl !== 'about:blank' && popupUrl !== sourceUrl, landedUrl: popupUrl };
    }

    // noWaitAfter: some links open a JS widget in-place (e.g. a live-chat launcher) rather than
    // causing a real page navigation, and some external SSO destinations (members.rsc.org) take
    // long enough that Playwright's own built-in post-click navigation wait times out even
    // though the click itself succeeded - confirmed 2026-07-22. Decoupling the click from that
    // wait and doing our own explicit (catchable) waitForLoadState below avoids both false
    // failures.
    await locator.click({ timeout: 15000, noWaitAfter: true });
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    await page.waitForTimeout(300);

    const landedUrl = page.url();
    const looksLikeError = await isErrorPage(page);

    if (landedUrl === sourceUrl) {
        // No real navigation happened - can legitimately occur for JS widget launchers (e.g. a
        // live-chat console link) that open in-place rather than navigating the page. Treat as
        // ok only if an iframe matching the link's own hostname actually appeared, confirming
        // the widget loaded rather than the click silently doing nothing. Confirmed 2026-07-22
        // on a "live chat" link (five9.eu chat console).
        const linkHostname = (() => {
            try { return new URL(link.href, sourceUrl).hostname; } catch { return null; }
        })();
        const widgetLoaded = linkHostname
            ? await page.locator(`iframe[src*="${linkHostname}"]`).count() > 0
            : false;
        return { ok: !looksLikeError && widgetLoaded, landedUrl };
    }

    return { ok: !looksLikeError, landedUrl };
}

// The main entry point: call from a Traversal test's own test.step. Requires the caller's
// own openPage()/waitForAndAcceptCookieBanner() helpers so this file has no dependency on
// any one spec's cookie-banner selector conventions.
async function verifyPageLinksNavigateCorrectly(page, sourceUrl, { openPage, waitForAndAcceptCookieBanner, expect, test }) {
    const { cardLinks, otherLinks } = await collectNavigableElements(page);
    const sampledCardLinks = sampleUpToSix(cardLinks);

    const toCheck = [...otherLinks, ...sampledCardLinks];

    for (const link of toCheck) {
        await test.step(`Link "${link.text || link.href}" (${link.href}) should navigate correctly`, async () => {
            const result = await verifyLinkNavigates(
                page,
                { sourceUrl, openSourcePage: openPage, waitForAndAcceptCookieBanner },
                link,
            );
            expect(result.ok, `Clicking "${link.text || link.href}" should navigate to a valid, working page (landed on ${result.landedUrl})`).toBe(true);
        });
    }

    // Leave the caller on a clean, freshly-loaded copy of the source page for whatever
    // comes after this step (e.g. the footer-visibility check).
    await openPage(page, sourceUrl);
}

module.exports = {
    collectNavigableElements,
    sampleUpToSix,
    verifyPageLinksNavigateCorrectly,
    isErrorPage,
};
