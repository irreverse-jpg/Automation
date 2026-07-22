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
// Coverage notes - rsc.org homepage ("/")
// ============================================================================
// Scope: the homepage only - hero/title, scroll behaviour, header utility
// links, key body CTAs, and skip links. No language switcher - RSC is
// English-only, unlike PBS/Withers. The main mega-nav (Membership,
// Publishing, etc.) and site search are deliberately NOT covered here -
// they get their own dedicated specs (02-rsc.meganav.spec.js,
// 04-rsc.search.spec.js) per project convention, since the mega-nav in
// particular needs its own dropdown-interaction investigation (see notes
// below) that doesn't belong in the homepage file.
//
// Tests in this file:
//   1. Homepage - Homepage Loads
//      Loads "/", accepts the OneTrust cookie banner (confirmed present but
//      asynchronous - see note below), and checks title + hero H1.
//   2. Homepage - Scrolling Through the Page
//      Scrolls to the footer, back to the top, and to the middle.
//   3. Homepage - Navigate to Various Pages from the Header Links
//      Clicks each header utility link (Donate, Join us, Sign In, Members'
//      Area, Journals, Books) and confirms it lands on the expected URL,
//      then returns to the homepage. Sign In redirects through an external
//      SSO provider with a session-specific token, so only "navigated away
//      from the homepage" is asserted for it, not a fixed final URL.
//      Members' Area/Journals/Books are external cross-domain links that
//      are entirely absent on the mobile viewport (not even inside the
//      hamburger menu, though tablet is wide enough to still show them) -
//      expected to fail on mobile rather than being scoped desktop-only.
//   4. Homepage - Navigate to Various Pages from the Body Links
//      Follows the "Become a member" and "All articles" CTAs, plus whatever
//      article card is currently rendered first in the rotating "Latest
//      news" feed (deliberately not asserting which article, since it's
//      rotating content) - confirming URL on each destination, then back.
//   5. Homepage - Skip Links
//      Discovers skip link(s) live via keyboard Tab and verifies each
//      navigates to its target. RSC has
//      two: "Skip to menu" and "Skip to main content"). KNOWN FINDING
//      (2026-07-20, real, not test flakiness): "Skip to menu" fails on
//      tablet/mobile viewports - its target (#mainnav) is hidden behind the
//      hamburger toggle at those breakpoints, so activating the skip link
//      has no visible effect for a keyboard user who hasn't opened the menu.
//      "Skip to main content" passes on all 3 viewports.
//
// IMPORTANT - the top-level mega-nav links (Membership, Publishing, etc.) do NOT navigate on
// click - each one has aria-haspopup="menu" and JS intercepts the click to open its dropdown
// instead of following the href (confirmed 2026-07-20). That's why they're excluded from the
// header-links test above in favour of the utility links (Donate/Join us/Sign In), which do
// navigate normally. The dropdown-open interaction itself (a `.selected` class toggle, not
// simple :hover) needs dedicated investigation in the meganav spec.
//
// IMPORTANT cookie-banner correction (2026-07-20): an initial pass of this
// site incorrectly concluded there was no OneTrust banner, based on a static
// page fetch. There IS one - it's injected asynchronously (confirmed to
// appear within ~8s) and its darkening overlay intercepts pointer events
// until dismissed, which silently breaks hover/click interactions lower on
// the page if not waited for properly. Always use
// waitForAndAcceptCookieBanner() below rather than a same-tick isVisible()
// check.
// ============================================================================

const HEADER_UTILITY_LINKS = [
    { name: 'Donate', hrefPath: '/donations' },
    { name: 'Join us', hrefPath: '/membership' },
    // Sign In's own href is /Account/Logon, but that endpoint immediately redirects to an
    // external SSO provider (id-staging.rsc.org on QA) with a session-specific state token, so
    // there's no stable final URL to assert on - only that clicking it navigates away from the
    // homepage. Confirmed 2026-07-20.
    { name: 'Sign In', hrefPath: '/Account/Logon', expectRedirectAway: true },
    // External, cross-domain utility links. Confirmed 2026-07-20: none of these 3 are present on
    // the mobile viewport at all - not even inside the "Toggle navigation" hamburger menu (tablet
    // is wide enough to keep the desktop layout for this particular utility bar and passes fine).
    // Expected to fail on mobile specifically rather than being scoped desktop-only, per this
    // project's convention of surfacing real viewport behaviour as-is.
    // Members' Area is a login-gated destination - it redirects to an access/apply page with
    // session query params rather than landing on a stable URL. Confirmed 2026-07-20. Its label
    // also has confirmed environment drift - QA renders "Members' Area", Live renders
    // "Members' area" (lowercase "area") - matched case-insensitively below since the link itself
    // is otherwise identical, so this is a cosmetic content nit rather than something worth
    // failing the test over.
    { name: /^Members'\s*Area$/i, displayName: "Members' Area", hrefPath: 'https://members.rsc.org/', expectRedirectAway: true },
    // Journals' own href has confirmed environment drift too - QA points to the specific
    // /en/journals path, Live points at the bare pubs.rsc.org root. Matched by origin only
    // (matchOrigin below) rather than exact path, since the exact destination isn't stable across
    // environments but the domain it should send users to is.
    { name: 'Journals', hrefPath: 'https://pubs.rsc.org/en/journals', matchOrigin: true },
    { name: 'Books', hrefPath: 'https://books.rsc.org/books' },
];

function buildExpectedUrl(baseURL, path) {
    return new URL(path, baseURL).toString();
}

// The OneTrust banner is injected asynchronously via GTM - a same-tick isVisible()
// check races it and misses it, leaving its dark overlay blocking clicks/hover
// lower on the page. Wait for the accept button before moving on.
async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

// Below the "lg" breakpoint, the header collapses behind a "Toggle navigation" hamburger button -
// the utility links (Donate/Join us/Sign In) are present in the DOM but hidden (d-none d-lg-block)
// until it's opened. Confirmed 2026-07-20 on tablet/mobile viewports.
async function openMobileMenuIfPresent(page) {
    const toggleButton = page.getByRole('button', { name: 'Toggle navigation' });
    if (await toggleButton.isVisible().catch(() => false)) {
        await toggleButton.click();
        await page.waitForTimeout(300);
    }
}

async function waitForHomepageContent(page) {
    await expect(page.locator('h1').first(), 'Homepage should show its hero heading').toBeVisible();
}

// Body content (card copy, news articles) changes between environments/releases and over time,
// so rather than hardcoding every card we walk the main content area collecting whatever
// internal links are actually rendered and sample from those at runtime.
async function collectRandomBodyLinks(page, baseURL, { excludeHrefPaths = [], count = 4 } = {}) {
    const origin = new URL(baseURL).origin;

    const links = await page.evaluate(() => {
        const main = document.querySelector('main, #content, [role="main"]') || document.body;
        const isExcluded = (el) => el.closest('header, footer, nav, #mainnav, [class*="cookie"], #onetrust-consent-sdk');
        return Array.from(main.querySelectorAll('a[href]'))
            .filter((a) => a.offsetParent !== null && !isExcluded(a))
            .map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim() }));
    });

    const wellFormedHrefPattern = new RegExp(`^(/(?!/)|${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`);
    const candidates = links
        .filter((link) => link.href && wellFormedHrefPattern.test(link.href))
        .map((link) => {
            const resolved = new URL(link.href, baseURL);
            return { hrefPath: `${resolved.pathname}${resolved.search}`, label: link.text || resolved.pathname, origin: resolved.origin };
        })
        .filter((link) => link.origin === origin && !excludeHrefPaths.includes(link.hrefPath));

    const deduped = [...new Map(candidates.map((link) => [link.hrefPath, link])).values()];
    return deduped.slice(0, count);
}

test('Homepage - Homepage Loads', async ({ page }) => {
    test.setTimeout(30000);

    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await waitForHomepageContent(page);
    });

    await test.step('Verify homepage title', async () => {
        await expect(page, 'Homepage should load with the expected RSC title').toHaveTitle(/Royal Society of Chemistry/i);
    });

    await test.step('Verify hero heading', async () => {
        const h1 = page.locator('h1').first();
        await expect(h1, 'Homepage hero heading should have meaningful text').not.toHaveText('');
        expect((await h1.textContent())?.trim().length, 'Homepage hero heading should have meaningful text').toBeGreaterThan(5);
    });
}, 30000);

test('Homepage - Scrolling Through the Page', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await waitForHomepageContent(page);
    });

    await test.step('Scroll to the footer', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(page.getByRole('contentinfo'), 'Scrolling to the bottom should reveal the footer').toBeVisible();
    });

    await test.step('Scroll back to the top', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), {
            message: 'Scrolling back to the top should return the viewport to the top edge of the page',
        }).toBeLessThanOrEqual(5);
    });

    await test.step('Scroll to the middle of the page', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), {
            message: 'Scrolling to the middle should move the page away from the top position',
        }).toBeGreaterThan(0);
    });
});

test('Homepage - Navigate to Various Pages from the Header Links', async ({ page, baseURL }) => {
    // 120s, not 60s: this loop does 6 full navigate-and-return cycles (2 of them external SSO
    // redirects), and 60s was confirmed too tight against Live's slower response times in the
    // footer spec's equivalent test (2026-07-21) - once the test timeout fires mid-loop, Playwright
    // tears down the page and the next step throws a misleading "page has been closed" error that
    // looks like a real crash. Same fix applied here pre-emptively.
    test.setTimeout(120000);

    const homepageUrl = buildExpectedUrl(baseURL, '/');

    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await waitForHomepageContent(page);
        await openMobileMenuIfPresent(page);
    });

    for (const target of HEADER_UTILITY_LINKS) {
        const label = target.displayName || target.name;

        await test.step(`Navigate to ${label}`, async () => {
            const nameOption = typeof target.name === 'string' ? { name: target.name, exact: true } : { name: target.name };
            const link = page.getByRole('link', nameOption).first();
            await expect(link, `Header link "${label}" should be visible`).toBeVisible();

            if (target.matchOrigin) {
                const actualHref = await link.getAttribute('href');
                expect(new URL(actualHref).origin, `Header link "${label}" should point to the ${new URL(target.hrefPath).origin} domain`).toBe(new URL(target.hrefPath).origin);
            } else {
                await expect(link, `Header link "${label}" should point to ${target.hrefPath}`).toHaveAttribute('href', target.hrefPath);
            }

            await link.click();

            if (target.expectRedirectAway) {
                await expect.poll(() => page.url(), {
                    message: `"${label}" should navigate away from the homepage`,
                }).not.toBe(homepageUrl);
            } else if (target.matchOrigin) {
                await expect.poll(() => new URL(page.url()).origin, {
                    message: `"${label}" should navigate to the ${new URL(target.hrefPath).origin} domain`,
                }).toBe(new URL(target.hrefPath).origin);
            } else {
                await expect(page, `"${label}" should navigate to ${target.hrefPath}`).toHaveURL(buildExpectedUrl(baseURL, target.hrefPath));
            }

            await page.goto('/', { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await waitForAndAcceptCookieBanner(page);
            await expect(page, `Returning to the homepage after ${label} should restore the homepage URL`).toHaveURL(homepageUrl);
            await waitForHomepageContent(page);
            await openMobileMenuIfPresent(page);
        });
    }
});

test('Homepage - Navigate to Various Pages from the Body Links', async ({ page, baseURL }) => {
    // Same 60s->120s fix as the Header Links test above - 3 full navigate-and-return cycles was
    // confirmed too tight for Live's slower response times (2026-07-21).
    test.setTimeout(120000);

    const homepageUrl = buildExpectedUrl(baseURL, '/');

    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await waitForHomepageContent(page);
    });

    await test.step('Navigate to Membership via the "Become a member" card', async () => {
        const link = page.getByRole('link', { name: 'Become a member', exact: true }).first();
        await expect(link, 'The "Become a member" card link should be visible').toBeVisible();
        await link.click();
        await expect(page, 'The "Become a member" card should navigate to /membership').toHaveURL(buildExpectedUrl(baseURL, '/membership'));

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await expect(page, 'Returning to the homepage should restore the homepage URL').toHaveURL(homepageUrl);
        await waitForHomepageContent(page);
    });

    await test.step('Navigate to the news listing via "All articles"', async () => {
        const link = page.getByRole('link', { name: 'All articles', exact: true }).first();
        await expect(link, 'The "All articles" link should be visible').toBeVisible();
        await link.click();
        await expect(page, 'The "All articles" link should navigate to /news').toHaveURL(buildExpectedUrl(baseURL, '/news'));

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await expect(page, 'Returning to the homepage should restore the homepage URL').toHaveURL(homepageUrl);
        await waitForHomepageContent(page);
    });

    let firstArticleLink = null;
    await test.step('Discover the first rendered news article card', async () => {
        const candidates = await collectRandomBodyLinks(page, baseURL, { excludeHrefPaths: ['/news'], count: 10 });
        firstArticleLink = candidates.find((c) => /^\/news\//.test(c.hrefPath)) || null;
        expect(firstArticleLink, 'Homepage should render at least one /news/... article card').toBeTruthy();
    });

    await test.step('Navigate to the first rendered article card', async () => {
        // Some cards render an absolute href (https://.../news/...) rather than a relative one,
        // so match on the path suffix rather than an exact attribute value.
        const link = page.locator(`a[href$="${firstArticleLink.hrefPath}"]:visible`).first();
        await expect(link, `Article card "${firstArticleLink.label}" should be visible`).toBeVisible();
        await link.click();
        await expect(page, `Article card "${firstArticleLink.label}" should navigate to ${firstArticleLink.hrefPath}`).toHaveURL(buildExpectedUrl(baseURL, firstArticleLink.hrefPath));

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await expect(page, 'Returning to the homepage should restore the homepage URL').toHaveURL(homepageUrl);
        await waitForHomepageContent(page);
    });
});

// Skip link(s) are discovered live via keyboard Tab rather than hardcoded, since sites differ on how
// many exist and what they're labelled (e.g. "Skip to content" vs "Skip to main content"/"Skip to menu").
// Missing a skip link entirely is a real accessibility gap, so this test is expected to fail on sites
// that don't have one rather than being skipped. RSC exposes two as of 2026-07-20: "Skip to menu"
// (#mainnav) and "Skip to main content" (#content).
test('Homepage - Skip Links', async ({ page }) => {
    test.setTimeout(60000);

    async function tabToNextLink() {
        await page.keyboard.press('Tab');
        return page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el.tagName !== 'A') return null;
            return { text: (el.textContent || '').trim(), href: el.getAttribute('href') || '' };
        });
    }

    const skipLinks = await test.step('Discover skip links via keyboard Tab', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        const links = [];
        const seenHrefs = new Set();
        for (let i = 0; i < 8; i++) {
            const info = await tabToNextLink();
            if (info && /skip to/i.test(info.text) && info.href.startsWith('#') && !seenHrefs.has(info.href)) {
                seenHrefs.add(info.href);
                links.push(info);
            }
        }
        return links;
    });

    expect(skipLinks.length, 'Homepage should expose at least one "Skip to..." link reachable via keyboard Tab').toBeGreaterThan(0);

    for (const skipLink of skipLinks) {
        await test.step(`Verify "${skipLink.text}" navigates to its target`, async () => {
            await page.goto('/', { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await waitForAndAcceptCookieBanner(page);

            let matched = false;
            for (let i = 0; i < 8 && !matched; i++) {
                const info = await tabToNextLink();
                if (info && info.href === skipLink.href) matched = true;
            }
            expect(matched, `Should be able to Tab back to the "${skipLink.text}" skip link`).toBeTruthy();

            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);

            expect(page.url(), `Activating "${skipLink.text}" should update the URL to include ${skipLink.href}`).toContain(skipLink.href);

            const targetId = skipLink.href.slice(1);
            await expect(page.locator(`#${targetId}`), `Skip link target "${skipLink.href}" should exist on the page`).toBeAttached();
        });
    }
});
