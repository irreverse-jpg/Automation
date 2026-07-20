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
// Coverage notes - "Tickets" meganav section (2nd top-level menu item)
// ============================================================================
// Scope: every item under "Tickets" - Buy Tickets, Matchday Hospitality,
// Men's Internationals, London Spirit, and Help and Information's own
// 2nd-level submenu (Digital Ticketing FAQs, Download the Lord's App,
// Refund Scheme). Consolidates what used to be a standalone ad-hoc file
// (Men's Internationals) into the one-file-per-top-level-menu-item
// convention (see 11-more.spec.js for the reference shape). Test order in
// this file matches the real meganav expand order top-to-bottom.
//
// Tests in this file (7 total):
//   - Buy Tickets Traversal (external ticketing platform, same-tab)
//   - Matchday Hospitality Traversal (thin - full depth lives in
//     07-mcc.hospitalityandexperiences.spec.js, since this page is also a
//     Hospitality & Experiences menu item and is tested in full there)
//   - Men's Internationals Traversal (full depth)
//   - London Spirit Traversal (external, /matches - a DIFFERENT URL from
//     the "London Spirit" link tested under the "More..." menu in
//     11-more.spec.js, which points at the site root instead)
//   - Help and Information - Digital Ticketing FAQs Traversal (thin - full
//     depth lives in 05-mcc.visitlords.spec.js under Matchday Information)
//   - Help and Information - Download the Lord's App Traversal (thin - full
//     depth also lives in 05-mcc.visitlords.spec.js)
//   - Help and Information - England v New Zealand Refund Scheme Traversal
//     (full depth, new page with no prior coverage)
//
// Environment status (re-verified 2026-07-14, as part of the Live -> UAT2
// content sync): Men's Internationals, previously confirmed 404ing on UAT2,
// now returns 200 there too - the presence-gate is now a defensive fallback
// rather than an expected skip. Matchday Hospitality's title is also now
// identical (real, page-specific) on both environments. No env branching
// needed for any test in this file.
//
// Confirmed CURRENT defects, left as deliberately failing assertions (not
// worked around):
//   - UAT2-only, same defect family as 05-mcc.visitlords.spec.js: Men's
//     Internationals, Digital Ticketing FAQs, "Dowload the Lord's App" [sic,
//     real live typo], and the Refund Scheme all have hrefs hardcoded to the
//     absolute Live production domain despite the markup's own
//     data-external="false", silently redirecting UAT2 visitors to Live.
//     NOT affected: Matchday Hospitality (a genuine relative path) and Buy
//     Tickets/London Spirit (correctly external on both environments by
//     design).
//
// Known follow-up, not yet built: UAT2's Tickets meganav currently exposes
// an extra "Women's Internationals" item that Live's menu does not have
// (both point at the same page, which now works on both environments - see
// 13-mcc.womensinternationals.spec.js). Flagged rather than silently folded
// in since it's inconsistent between environments.
// ============================================================================

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function buildExpectedUrl(baseURL, path) {
    return new URL(path, baseURL).toString();
}

async function dismissCookieOverlayIfPresent(page) {
    const acceptTargets = [
        page.locator('#onetrust-accept-btn-handler').first(),
        page.getByRole('button', { name: /accept|allow all|yes, allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
        page.getByRole('link', { name: /allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
    ];

    for (const candidate of acceptTargets) {
        if (await candidate.isVisible().catch(() => false)) {
            await candidate.click({ timeout: 3000 }).catch(() => { });
        }
    }

    const overlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    if (await overlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }

    // OneTrust's "Privacy Preference Center" modal is a different UI from the main consent banner
    // and can flash open asynchronously - observed specifically right after navigating via a meganav
    // click-through, even when consent was already accepted earlier in the session. Escape does not
    // close it; it has its own dedicated close button.
    const preferenceCenterBackdrop = page.locator('.onetrust-pc-dark-filter').first();
    if (await preferenceCenterBackdrop.isVisible().catch(() => false)) {
        await page.waitForTimeout(600);
        const closeButton = page.locator('#close-pc-btn-handler').first();
        await closeButton.click({ timeout: 3000 }).catch(() => closeButton.click({ force: true, timeout: 3000 }).catch(() => { }));
        await preferenceCenterBackdrop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
    }
}

// OneTrust's "Privacy Preference Center" modal can flash open asynchronously after a navigation - not
// just meganav click-throughs, also confirmed after ordinary external-link-then-goBack() navigations -
// even when consent was already accepted earlier in the session. A single instant isVisible() check
// races it; wait explicitly.
async function waitForAndDismissPreferenceCenter(page) {
    const backdrop = page.locator('.onetrust-pc-dark-filter').first();
    const appeared = await backdrop.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false);

    if (appeared) {
        await page.waitForTimeout(600);
        const closeButton = page.locator('#close-pc-btn-handler').first();
        await closeButton.click({ timeout: 3000 }).catch(() => closeButton.click({ force: true, timeout: 3000 }).catch(() => { }));
        await backdrop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
    }
}

async function waitForAndAcceptCookieBanner(page) {
    // OneTrust injects the consent banner (and its full-page dark backdrop) asynchronously via GTM,
    // often after `load`. A single instant visibility check races the banner and misses it, leaving
    // the backdrop blocking clicks on later steps, so wait for the accept button before moving on.
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }

    await dismissCookieOverlayIfPresent(page);
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isBlockedByOverlay = message.includes('intercepts pointer events') || message.includes('cookie');

        if (!isBlockedByOverlay) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

async function verifySponsorsAndFooter(page) {
    const desktopSponsorsLink = page.locator('.footer__partners a[href*="/information/sponsors"]').first();
    const mobileSponsorsLink = page.locator('.footerButton__button[href*="/information/sponsors"]').first();

    await desktopSponsorsLink.scrollIntoViewIfNeeded().catch(() => { });
    let desktopLinkVisible = await desktopSponsorsLink.isVisible().catch(() => false);
    if (!desktopLinkVisible) {
        // Confirmed via repeated re-runs that a single scroll+check right after page-load/scroll
        // settle isn't always enough (genuine render-timing flake, not tied to any specific page) -
        // retry the scroll once more before falling back to the mobile-only footer button.
        await desktopSponsorsLink.scrollIntoViewIfNeeded().catch(() => { });
        await page.waitForTimeout(500);
        desktopLinkVisible = await desktopSponsorsLink.isVisible().catch(() => false);
    }

    if (desktopLinkVisible) {
        const naturalWidth = await desktopSponsorsLink.locator('img').first().evaluate((img) => img.naturalWidth);
        expect(naturalWidth, 'The sponsors logo image should load with real dimensions (0 means it failed to load)').toBeGreaterThan(0);
    } else {
        await expect(mobileSponsorsLink, 'A "View our partners" link should be present on mobile/tablet').toBeVisible();
    }

    const footer = page.locator('footer.footer').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'The standard MCC footer should be visible at the bottom of the page').toBeVisible();
}

// Reuses the exact same nested, scoped DOM traversal proven in spec 02's meganav suite, spec 05's Visit
// Lord's suite, spec 15's MCC menu suite, and spec 17's More menu suite - walks an arbitrary-depth path
// array (e.g. ['Help and Information', 'Digital Ticketing FAQs'] is a 3-level walk: Tickets -> Help and
// Information -> Digital Ticketing FAQs).
async function navigateViaTicketsMenu(page, path) {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAndAcceptCookieBanner(page);

    const isDesktopMeganav = !(await page.locator('.header__hamburger').first().isVisible().catch(() => false));
    if (!isDesktopMeganav) {
        const hamburger = page.locator('.header__hamburger').first();
        await clickWithCookieGuard(page, hamburger);
        await page.locator('.meganav .mainLevel').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
    }

    const result = await page.evaluate(({ rootName, restPath }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);

        const mainLevel = document.querySelector('.meganav .mainLevel');
        let items = directChildItems(mainLevel);
        let item = items.find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent).toLowerCase().startsWith(rootName));
        if (!item) {
            return { ok: false };
        }

        for (const name of restPath) {
            item.querySelector(':scope > a.meganav__link').click();
            const sub = item.querySelector(':scope > ul.meganav__list');
            items = directChildItems(sub);
            const next = items.find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent) === name);
            if (!next) {
                return { ok: false };
            }
            item = next;
        }

        item.querySelector(':scope > a.meganav__link').click();
        return { ok: true };
    }, { rootName: 'tickets', restPath: path });

    if (!result.ok) {
        return false;
    }

    await page.waitForLoadState('load').catch(() => { });
    // A single waitForLoadState('load') fired right after the evaluate()-driven click can occasionally
    // resolve against the still-current (pre-navigation) document if the navigation hasn't actually
    // taken effect yet by that point - same race already worked around in 05-mcc.visitlords.spec.js's
    // identically-shaped helper, most visibly on the (confirmed real, UAT2-only) menu items whose href
    // is hardcoded to Live's domain, where the resulting cross-origin navigation can take a moment
    // longer to actually land than a same-origin one. A short poll on document.readyState is more
    // robust than a single point-in-time check. This does NOT mask the cross-origin redirect defect
    // itself - callers still land on whatever URL the click actually produced, and any URL/host
    // assertion downstream still fails correctly if that's the wrong environment.
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 8000 }).catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    return true;
}

async function testYouTubeVideo(videoIframe, videoFrame, page) {
    await videoIframe.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    const playButton = videoFrame.locator('.ytmCuedOverlayPlayButton').first();
    if ((await playButton.count()) === 0) {
        return;
    }

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

async function testPageVideos(page) {
    const youTubeCount = await page.locator('iframe[src*="youtube"]').count();
    if (youTubeCount === 0) {
        return;
    }

    const visibleYouTube = page.locator('iframe[src*="youtube"]:visible').first();
    if ((await visibleYouTube.count()) > 0) {
        const videoFrame = page.frameLocator('iframe[src*="youtube"]:visible').first();
        await testYouTubeVideo(visibleYouTube, videoFrame, page);
    }
}

// Same single-open `.inlineAccordion__itemHandle`/multi-open `.accordion__header` components already
// documented throughout this project - immediate open-then-close per item (never batch), same
// performance lesson learned on the Tickets FAQs page and MCC menu.
async function testAccordionItemsImmediately(page, labels) {
    for (const label of labels) {
        await test.step(`Expand and collapse "${label}"`, async () => {
            const header = page.locator('.accordion__header:visible, .inlineAccordion__itemHandle:visible', { hasText: label }).first();
            await header.scrollIntoViewIfNeeded();

            await dismissCookieOverlayIfPresent(page);
            await page.waitForTimeout(300);
            await header.evaluate((el) => el.click());
            let expandedInTime = true;
            try {
                await expect.poll(() => header.evaluate((el) => el.className.includes('collapsed')), { timeout: 3000 }).toBe(false);
            } catch (error) {
                expandedInTime = false;
            }
            expect.soft(expandedInTime, `"${label}" should show the expanded state after clicking`).toBe(true);

            const targetSelector = await header.getAttribute('data-target');
            await page.locator(targetSelector).waitFor({ state: 'visible', timeout: 3000 }).catch(() => { });
            expect.soft(await page.locator(targetSelector).isVisible(), `"${label}"'s content should be visible once expanded`).toBe(true);

            await page.waitForTimeout(600);
            await header.evaluate((el) => el.click());
            let collapsedInTime = true;
            try {
                await expect.poll(() => header.evaluate((el) => el.className.includes('collapsed')), { timeout: 3000 }).toBe(true);
            } catch (error) {
                collapsedInTime = false;
            }
            if (!collapsedInTime) {
                await page.waitForTimeout(600);
                await header.evaluate((el) => el.click());
                try {
                    await expect.poll(() => header.evaluate((el) => el.className.includes('collapsed')), { timeout: 3000 }).toBe(true);
                    collapsedInTime = true;
                } catch (error) {
                    collapsedInTime = false;
                }
            }
            expect.soft(collapsedInTime, `"${label}" should return to the collapsed state after clicking again`).toBe(true);
        });
    }
}

async function testPageAccordion(page) {
    const labels = await page.locator('.accordion__header:visible, .inlineAccordion__itemHandle:visible').evaluateAll((els) => els.map((el) => el.textContent.trim()));
    if (labels.length === 0) {
        return;
    }
    await testAccordionItemsImmediately(page, labels);
}

async function verifyButtonsNotBroken(page, baseURL) {
    const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('a.button'))
        .filter((a) => !a.closest('header') && !a.closest('.meganav') && !a.closest('footer'))
        .map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })));

    for (const button of buttons) {
        if (!button.href || button.href === '#') {
            continue;
        }

        await test.step(`"${button.text}" button`, async () => {
            if (button.href.startsWith('mailto:')) {
                expect(button.href, `"${button.text}"'s mailto should contain a real-looking email address`).toMatch(/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/i);
                return;
            }
            if (button.href.startsWith('tel:')) {
                expect(button.href, `"${button.text}"'s tel link should contain a real-looking phone number`).toMatch(/^tel:\+?[\d\s]+$/i);
                return;
            }

            const targetUrl = new URL(button.href, baseURL).toString();
            let response;
            try {
                response = await page.request.get(targetUrl);
            } catch (error) {
                expect(false, `"${button.text}"'s link (${targetUrl}) should be reachable: ${error.message}`).toBe(true);
                return;
            }
            const status = response.status();
            expect(status, `"${button.text}"'s link (${targetUrl}) should not be a dead/not-found link`).not.toBe(404);
            expect(status, `"${button.text}"'s link (${targetUrl}) should not return a server error`).toBeLessThan(500);
        });
    }
}

// Full generic per-page traversal, applied to the brand-new gap page that doesn't have any hard-won
// novel-component logic of its own yet (England v New Zealand - Refund Scheme) - same shape as
// 05-mcc.visitlords.spec.js's runVisitLordsPageTraversal / 17-more.spec.js's runMorePageTraversal.
async function runTicketsPageTraversal(page, baseURL, { menuPath, h1Pattern, titlePattern }) {
    test.setTimeout(120000);

    const navigated = await test.step('Navigate via the Tickets menu', async () => {
        return navigateViaTicketsMenu(page, menuPath);
    });
    test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), `The page should show a heading matching ${h1Pattern}`).toHaveText(h1Pattern);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, `The title should match ${titlePattern}`).toHaveTitle(titlePattern);
    });

    await test.step('Play any video(s) on the page (if present)', async () => {
        await testPageVideos(page);
    });

    await test.step('Test the FAQ/content accordion (if present)', async () => {
        await testPageAccordion(page);
    });

    await test.step('Verify the buttons on the page (no 404s, if present)', async () => {
        await verifyButtonsNotBroken(page, baseURL);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
}

// ===============================================================================================
// Buy Tickets (new - zero existing coverage before this file)
// ===============================================================================================

test('Tickets - Buy Tickets Traversal', async ({ page }) => {
    test.setTimeout(60000);

    // Buy Tickets heads to a completely separate external ticketing platform (tickets.lords.org),
    // confirmed via the live markup to be target="_self" (same tab), so this is verified via a real
    // same-tab navigation + host check rather than a popup wait - matching this project's established
    // "lightweight external-link" convention for the same-tab case (see 17-more.spec.js's "More -
    // Inside Lord's - Explore now Traversal"). A plain page.request.get() against this host was
    // confirmed via direct testing to return 403 (the platform's own bot-protection rejecting a bare
    // API-style request) even though a real browser navigation lands there successfully - so a host
    // check via real navigation is used here instead of a status-code check.
    const navigated = await navigateViaTicketsMenu(page, ['Buy Tickets']);
    test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');

    await expect.poll(() => new URL(page.url()).host, { message: 'The menu should navigate to the external Buy Tickets platform' }).toBe('tickets.lords.org');
});

// ===============================================================================================
// Matchday Hospitality (thin duplicate-destination check - full depth lives elsewhere, see the
// test's own comment)
// ===============================================================================================

test('Tickets - Matchday Hospitality Traversal', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    // Intentionally thin - full depth (including the onward-card forms for Debentures, Seasonal
    // Suites, and Old Clock Tower Club) lives in the upcoming 07-mcc.hospitalityandexperiences.spec.js,
    // which doesn't exist yet at the time this file was built. This test only confirms the Tickets
    // menu's own path lands on the right page.
    await test.step('Navigate via the Tickets menu', async () => {
        const navigated = await navigateViaTicketsMenu(page, ['Matchday Hospitality']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify it lands on the Matchday Hospitality page', async () => {
        // This item's own href is a genuine relative path (/hospitality/matchday-packages, 301s to
        // /lords/match-day/premium-seating/hospitality) - unlike several of this menu's sibling items,
        // it is NOT affected by the hardcoded-absolute-domain defect documented at the top of this
        // file, so this assertion holds on both environments.
        await expect(page, 'The menu should land on the Matchday Hospitality page').toHaveURL(buildExpectedUrl(baseURL, '/lords/match-day/premium-seating/hospitality'));
        await expect(page.locator('h1').first(), 'The page should show the Match Day Hospitality heading').toHaveText(/Match Day Hospitality/i);
    });
});

// ===============================================================================================
// Men's Internationals (ported from the old 11-mcc.mensinternationals.spec.js, unchanged in content
// - only the entry navigation now goes via the Tickets menu instead of a direct goto)
// ===============================================================================================

test('Tickets - Men\'s Internationals Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Navigate via the Tickets menu', async () => {
        const navigated = await navigateViaTicketsMenu(page, ['Men\'s Internationals']);
        // Defensive fallback only - confirmed via direct re-testing (2026-07-14) that
        // /tickets/mens-internationals now returns 200 on both Live and UAT2 (previously confirmed
        // 404ing on UAT2 as of 2026-07-10), so this shouldn't actually skip anymore.
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1 and hero statement', async () => {
        // Confirmed real content facts: same pattern as the Women's Internationals sibling page -
        // two genuine h1-level headings in the hero, a short recurring title and a page-specific
        // statement heading right below it.
        await expect(page.locator('h1').nth(0), 'The page should show the Men\'s Test Cricket heading').toHaveText(/Men's Test Cricket/i);
        await expect(page.locator('h1').nth(1), 'The page should show the summer statement heading').toContainText(/international cricket fixtures/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference men\'s international cricket').toHaveTitle(/men/i);
    });

    // Confirmed real content fact (same as the Women's Internationals sibling): the only "Buy
    // tickets" button on this page is the sitewide persistent header/meganav CTA, not a page-specific
    // hero button - not worth testing separately here since it's global site chrome (also hidden
    // behind the hamburger menu on tablet/mobile), not this page's own content.
    await test.step('Follow the "England v Pakistan Test Match" anchor link and its own Buy tickets now button', async () => {
        const anchorLink = page.locator('a[href="#anchor-1"]').first();
        await anchorLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, anchorLink);
        await expect(page, 'Clicking the anchor link should update the URL hash').toHaveURL(/#anchor-1$/);

        await expect(page.getByRole('heading', { name: /England v Pakistan/i }).first(), 'The England v Pakistan heading should be visible').toBeVisible();

        // Confirmed real content fact: unlike the other two match sections below, this is the only
        // one of the 3 with its own dedicated "Buy tickets now" button - the other two currently
        // have no ticket-purchase CTA of their own (presumably not yet on sale).
        const buyTicketsNowButton = page.locator('a.button', { hasText: /^Buy tickets now$/i }).first();
        await buyTicketsNowButton.scrollIntoViewIfNeeded();
        const href = await buyTicketsNowButton.getAttribute('href');

        const [popup] = await Promise.all([
            page.context().waitForEvent('page'),
            clickWithCookieGuard(page, buyTicketsNowButton),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'Buy tickets now should open the external ticketing site').toBe(new URL(href).host);
        await popup.close();
    });

    await test.step('Follow the "England v India ODI" anchor link', async () => {
        const anchorLink = page.locator('a[href="#anchor-2"]').first();
        await anchorLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, anchorLink);
        await expect(page, 'Clicking the anchor link should update the URL hash').toHaveURL(/#anchor-2$/);

        await expect(page.getByRole('heading', { name: /England v India ODI/i }).first(), 'The England v India ODI heading should be visible').toBeVisible();
    });

    await test.step('Follow the "England v New Zealand Test Match" anchor link', async () => {
        const anchorLink = page.locator('a[href="#anchor-3"]').first();
        await anchorLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, anchorLink);
        await expect(page, 'Clicking the anchor link should update the URL hash').toHaveURL(/#anchor-3$/);

        await expect(page.getByRole('heading', { name: /England v New Zealand/i }).first(), 'The England v New Zealand heading should be visible').toBeVisible();
    });

    await test.step('Verify the "All Fixtures" carousel and its card hover effect', async () => {
        // Same shared `.whatsOnRow` Swiper.js "what's on" component already documented elsewhere in
        // this project (Plan Your Day and Women's Internationals).
        await expect(page.getByRole('heading', { name: /All Fixtures/i }).first(), 'The All Fixtures heading should be visible').toBeVisible();

        const wrap = page.locator('.whatsOnRow__swiperWrap').first();
        await wrap.scrollIntoViewIfNeeded();
        const firstCard = page.locator('.whatsOnRow__item').first();
        await expect(firstCard, 'At least one fixture card should be visible').toBeVisible();

        const before = await firstCard.locator('.ctaTile__background').first().evaluate((el) => getComputedStyle(el).transform);
        await firstCard.hover();
        await page.waitForTimeout(400);
        const after = await firstCard.locator('.ctaTile__background').first().evaluate((el) => getComputedStyle(el).transform);
        expect(after, 'The fixture card should visually change (zoom) on hover').not.toBe(before);

        const viewAllFixturesButton = page.locator('a.button', { hasText: /View all fixtures/i }).first();
        await viewAllFixturesButton.scrollIntoViewIfNeeded();
        const href = await viewAllFixturesButton.getAttribute('href');
        await clickWithCookieGuard(page, viewAllFixturesButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).pathname, 'View all fixtures should navigate to the Fixtures and Results page').toBe(new URL(href).pathname);

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenter(page);
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

// ===============================================================================================
// London Spirit (new - zero existing coverage before this file)
// ===============================================================================================

test('Tickets - London Spirit Traversal', async ({ page }) => {
    test.setTimeout(60000);

    // London Spirit under THIS menu (https://www.londonspirit.com/matches) is a genuinely different
    // destination from the "London Spirit" link tested under the "More..." menu in
    // 17-more.spec.js (https://www.londonspirit.com/, the site root) - confirmed via direct DOM
    // inspection of both menus' hrefs, so this is real, non-duplicate coverage, not a re-test of the
    // same link. Confirmed via the live markup to be target="_blank" (opens a new tab), so - matching
    // 17-more.spec.js's "More - London Spirit link check" convention for the new-tab case - this is
    // verified via a plain page.request.get() status check on the extracted href rather than a popup
    // wait, deliberately not deep-testing a third-party site.
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAndAcceptCookieBanner(page);

    const href = await page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);
        const mainLevel = document.querySelector('.meganav .mainLevel');
        const root = directChildItems(mainLevel).find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent).toLowerCase().startsWith('tickets'));
        if (!root) return null;
        root.querySelector(':scope > a.meganav__link').click();
        const sub = root.querySelector(':scope > ul.meganav__list');
        const child = directChildItems(sub).find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent) === 'London Spirit');
        return child ? child.querySelector(':scope > a.meganav__link').getAttribute('href') : null;
    });

    test.skip(!href, 'The Tickets menu doesn\'t exist on this environment yet.');

    expect(new URL(href).pathname, 'This menu\'s London Spirit link should point at /matches, not the site root').toBe('/matches');

    // londonspirit.com (a separate third-party site) has been confirmed via direct testing (see
    // 17-more.spec.js) to intermittently reset the connection on a first attempt and recover on a
    // retry a moment later - a real but transient external flake, so a couple of retries are used
    // before treating it as down.
    let response;
    let lastError;
    for (let attempt = 0; attempt < 5 && !response; attempt++) {
        response = await page.request.get(href).catch((error) => {
            lastError = error;
            return null;
        });
        if (!response) {
            await page.waitForTimeout(1500);
        }
    }
    if (!response) {
        throw new Error(`The London Spirit link (${href}) could not be reached after 5 attempts: ${lastError?.message}`);
    }
    expect(response.status(), 'The London Spirit link should be working').toBeLessThan(400);
});

// ===============================================================================================
// Help and Information (nested menu) - Digital Ticketing FAQs and Download the Lord's App are thin
// duplicate-destination checks (full depth for both lives in 05-mcc.visitlords.spec.js, see each
// test's own comment); England v New Zealand - Refund Scheme is new, full-depth coverage.
// ===============================================================================================

test('Tickets - Help and Information - Digital Ticketing FAQs Traversal', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    // Intentionally thin - full depth (all 4 anchor-linked FAQ sections and their accordions) lives in
    // 05-mcc.visitlords.spec.js's "Visit Lord's - Matchday Information - Digital Ticketing FAQs
    // Traversal", reached there via a different menu path (Visit Lord's -> Matchday information ->
    // Digital ticketing FAQs) to the same /lords-tickets/faqs destination. This test only confirms the
    // Tickets menu's own path lands on the right page.
    await test.step('Navigate via the Tickets menu', async () => {
        const navigated = await navigateViaTicketsMenu(page, ['Help and Information', 'Digital Ticketing FAQs']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify it lands on the Digital Ticketing FAQs page', async () => {
        // Confirmed real content defect on UAT2 only (2026-07-14): this menu item's own href is
        // hardcoded to the absolute Live production domain rather than a relative path (confirmed via
        // direct DOM inspection - the link even carries data-external="false", i.e. the site itself
        // doesn't think this leaves the site), so navigating here on UAT2 silently lands the visitor
        // on Live instead - part of the same defect family documented at the top of this file. Left
        // failing here rather than worked around.
        await expect(page, 'The menu should navigate to the Digital Ticketing FAQs page (confirmed real UAT2-only defect: this menu item\'s href is hardcoded to Live\'s domain)').toHaveURL(buildExpectedUrl(baseURL, '/lords-tickets/faqs'));
        await expect(page.locator('h1').first(), 'The page should show the Digital Ticketing FAQs heading').toHaveText(/Digital Ticketing FAQs/i);
        await expect(page, 'The title should reference ticketing FAQs').toHaveTitle(/FAQ/i);
    });
});

test('Tickets - Help and Information - Download the Lord\'s App Traversal', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    // Intentionally thin - full depth lives in 05-mcc.visitlords.spec.js's "Visit Lord's - Matchday
    // Information - Download the Lord's App Traversal", reached there via a different menu path (Visit
    // Lord's -> Matchday information -> Download the Lord's App) to the same
    // /lords-tickets/the-lords-app destination. Note the live label under THIS menu path has a genuine
    // typo ("Dowload the Lord's App") - the menuPath below matches that exact live text.
    await test.step('Navigate via the Tickets menu', async () => {
        const navigated = await navigateViaTicketsMenu(page, ['Help and Information', 'Dowload the Lord\'s App']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify it lands on the Download the Lord\'s App page', async () => {
        // Confirmed real content defect on UAT2 only (2026-07-14): same hardcoded-absolute-domain
        // defect family documented at the top of this file - this menu item's href is hardcoded to
        // Live's domain despite data-external="false". Left failing here rather than worked around.
        await expect(page, 'The menu should navigate to the Download the Lord\'s App page (confirmed real UAT2-only defect: this menu item\'s href is hardcoded to Live\'s domain)').toHaveURL(buildExpectedUrl(baseURL, '/lords-tickets/the-lords-app'));
        await expect(page.locator('h1').first(), 'The page should show The Lord\'s App heading').toHaveText(/The Lord's App/i);
        await expect(page, 'The title should reference The Lord\'s App').toHaveTitle(/The Lord's App/i);
    });
});

test('Tickets - Help and Information - England v New Zealand Refund Scheme Traversal', async ({ page, baseURL }) => {
    await runTicketsPageTraversal(page, baseURL, {
        menuPath: ['Help and Information', 'England v New Zealand - Refund Scheme'],
        h1Pattern: /Refund Scheme/i,
        titlePattern: /Refund Policy/i,
    });
});
