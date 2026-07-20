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
// Coverage notes - "MCC" meganav section (5th top-level menu item)
// ============================================================================
// Scope: the full "MCC" tree - The Club (9 items: About us, Our History, How
// to Join, Female Playing Membership, MCC Honorary Life Members, MCC
// Committees, Reciprocal Arrangements, Women and Girls, Cowdrey Lecture),
// Cricket (4 items: MCC Cricket, MCC Fixtures, Overseas Tours, MCC &
// Wormsley), 4 direct-link items (MCC Foundation, Barclays Knight-Stokes
// Cup, In the Community, The Laws of Cricket), and Heritage & Collections (7
// items: Heritage Trail, 50 Objects, Previous Exhibitions from Lord's, What
// we do, Who we work with, Research Enquiry, Search the collection) - 24
// traversals in total, each presence-gating individually via the real
// meganav navigation rather than gating the whole file.
//
// Environment status (re-verified 2026-07-17, as part of the Live -> UAT2
// content sync): every destination in this section now returns 200 on
// UAT2 too - previously 8 of them 404'd there as of 2026-07-13 (Female
// Playing Membership, MCC Committees, MCC Fixtures, MCC & Wormsley,
// Barclays Knight-Stokes Cup, Heritage Trail, 50 Objects, Previous
// Exhibitions From Lord's). All 24 tests now run for real on both
// environments (the presence-gates just stopped triggering, no code
// change needed there). Also fixed: the page-title check previously
// branched on UAT2 showing a generic sitewide fallback - re-verified this
// whole section now shows real, page-specific titles on UAT2 too, so both
// environments share one assertion. Also fixed (a genuine test-code bug,
// not a site issue): several video/card hover interactions could be
// intercepted by the OneTrust preference-center backdrop flashing open
// mid-test - `dismissCookieOverlayIfPresent(page)` is now called
// immediately before every `.hover()` in this file, and the Vimeo
// Cloudflare-Turnstile-block skip (already used in 11-more.spec.js) was
// ported in too.
//
// Confirmed CURRENT defects, present on BOTH Live and UAT2, left as
// deliberately failing assertions (not worked around):
//   - Our History's "Committees" button links to `/mcc/the-club/committees`
//     (missing the real page's GUID slug suffix) - 404s. The real page
//     lives at `/mcc/the-club/committees-d206c8c068698080edd7ec8ea01df789`.
//   - The Laws of Cricket's "Buy Now" button 404s
//     (store.lords.org/products/mcc-the-laws-of-cricket-2017-code-official).
//   - Previous Exhibitions from Lord's "Click Here" button 404s
//     (/lords/lord-s-experience/new-tours).
// ============================================================================

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function isUatEnvironment(baseURL) {
    return /uat/i.test(new URL(baseURL).hostname);
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

    const preferenceCenterBackdrop = page.locator('.onetrust-pc-dark-filter').first();
    if (await preferenceCenterBackdrop.isVisible().catch(() => false)) {
        await page.waitForTimeout(600);
        const closeButton = page.locator('#close-pc-btn-handler').first();
        await closeButton.click({ timeout: 3000 }).catch(() => closeButton.click({ force: true, timeout: 3000 }).catch(() => { }));
        await preferenceCenterBackdrop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
    }
}

async function waitForAndAcceptCookieBanner(page) {
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

    // Scrolled into view before the visibility check (not after) - on some of this file's longer
    // pages the link's own container needed a real scroll before isVisible() would resolve true.
    await desktopSponsorsLink.scrollIntoViewIfNeeded().catch(() => { });
    let desktopLinkVisible = await desktopSponsorsLink.isVisible().catch(() => false);
    if (!desktopLinkVisible) {
        // Confirmed via repeated re-runs: a single scroll+check right after page-load/scroll settle
        // isn't always enough (a genuine render-timing flake, not tied to any specific page) - retry
        // the scroll once more before falling back to the mobile-only footer button.
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

// Reuses the same hamburger/dispatched-click technique already proven for Play & Train (spec 14) and
// spec 02's own meganav suite - desktop hovers/real-clicks through the bar; tablet/mobile open the
// hamburger first and dispatch clicks directly (the touch nav is a vertical accordion where an
// already-open section pushes later items down the page, so a real pointer click can miss). Accepts a
// 1-, 2- or 3-item path (e.g. ["MCC Foundation"] or ["The Club", "About us"]).
async function openMenuIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);

    const mainLevel = page.locator('.meganav .mainLevel').first();
    if (await mainLevel.isVisible().catch(() => false)) {
        return;
    }

    const hamburger = page.locator('.header__hamburger').first();
    await clickWithCookieGuard(page, hamburger);
    await expect(page.locator('.meganav .mainLevel').first(), 'The MCC meganav should be visible').toBeVisible();
}

// Reuses the exact same nested, scoped DOM traversal already proven in spec 02's meganav suite - each
// level is located via `:scope > ul.meganav__list` relative to its own parent `<li>`, which sidesteps
// both the hidden-duplicate-link issue (spec 14) and any hover-timing flakiness, since every click is
// dispatched directly on the located DOM node rather than relying on Playwright's own hover/visibility
// choreography. Accepts a 1-, 2- or 3-item path (e.g. ["MCC Foundation"] or ["The Club", "About us"]).
async function navigateViaMCCMenu(page, path) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    await openMenuIfPresent(page);

    const result = await page.evaluate(({ rootName, restPath }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);

        const mainLevel = document.querySelector('.meganav .mainLevel');
        let items = directChildItems(mainLevel);
        let item = items.find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent) === rootName);
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
    }, { rootName: 'MCC', restPath: path });

    if (!result.ok) {
        return false;
    }

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);

    // Confirmed real environment quirk: one of this menu's destinations ("In the Community") redirects
    // to an auth-stage.lords.org SAML login flow on UAT2 rather than showing real content - a genuine
    // login-gated difference from Live, not something a QA click-through can get past. Detected here
    // by checking against the site's own known hosts exactly (a loose `.includes('lords.org')` check
    // was tried first and wrongly matched "auth-stage.lords.org" too, since that hostname also
    // contains the substring "lords.org").
    const currentHost = new URL(page.url()).host;
    const knownSiteHosts = ['www.lords.org', 'lords.org', 'lords-uat2.hosted.positive.co.uk'];
    if (!knownSiteHosts.includes(currentHost)) {
        return 'auth-redirect';
    }

    return true;
}

// Same proven ytm-skin play/fullscreen/pause sequence used throughout this project. Some of this
// file's videos have a decorative "video-row__play-btn" overlay (`[data-fitvids-play]`) sitting on
// top of the real ytm play button that never disappears and always intercepts a plain pointer click -
// confirmed via direct testing that a force click on the real button still genuinely starts playback
// despite the overlay, so `force: true` is used here rather than fighting the overlay.
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

    await dismissCookieOverlayIfPresent(page);
    await videoIframe.hover();
    await videoFrame.getByRole('button', { name: 'Enter full screen' }).click({ timeout: 5000 });
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
        message: 'The page should enter full screen after clicking the full screen control',
    }).toBe(true);
    await page.waitForTimeout(1000);

    await dismissCookieOverlayIfPresent(page);
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

// Same proven Vimeo control-bar pattern from the Accessibility page (spec 06) - class-fragment
// buttons ("PlayButton"/"FullscreenButton") survive Vimeo's own build-hash suffixes. Desktop-only,
// same confirmed touch-viewport unreliability already documented there.
async function testVimeoVideo(videoIframe, videoFrame, page) {
    const projectUse = test.info().project.use;
    const isTouchDevice = Boolean(projectUse.isMobile || projectUse.hasTouch);

    await videoIframe.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);

    // Confirmed via direct probing (same as 11-more.spec.js): Vimeo's own embed occasionally serves a
    // Cloudflare Turnstile bot-check instead of the real player, which an automated browser can never
    // pass - an inherent automation limitation of the video host, not a site defect, so it's skipped
    // gracefully rather than forced into a failure.
    const turnstileBlocked = await videoFrame.locator('#error:not(.hidden), #turnstile-wrapper').first().isVisible().catch(() => false);
    if (turnstileBlocked) {
        return;
    }

    const playPauseButton = videoFrame.locator('button[class*="PlayButton"]').first();
    const fullscreenButton = videoFrame.locator('button[class*="FullscreenButton"]').first();

    if (isTouchDevice) {
        await expect(playPauseButton, 'The video\'s play control should be visible').toBeVisible();
        return;
    }

    await dismissCookieOverlayIfPresent(page);
    await videoIframe.hover();
    await page.waitForTimeout(500);
    await playPauseButton.click({ timeout: 10000 });
    await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => !video.paused).catch(() => false), {
        message: 'The video should start playing once the play button is clicked',
    }).toBe(true);

    await dismissCookieOverlayIfPresent(page);
    await videoIframe.hover();
    await page.waitForTimeout(500);
    await fullscreenButton.click({ timeout: 10000 });
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
        message: 'The page should enter full screen after clicking the full screen control',
    }).toBe(true);
    await page.waitForTimeout(1000);

    await dismissCookieOverlayIfPresent(page);
    await videoIframe.hover();
    await page.waitForTimeout(500);
    await fullscreenButton.click({ timeout: 10000 });
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
        message: 'The page should leave full screen after clicking full screen again',
    }).toBe(false);
    await page.waitForTimeout(1000);

    await dismissCookieOverlayIfPresent(page);
    await videoIframe.hover();
    await page.waitForTimeout(500);
    await playPauseButton.click({ timeout: 10000 });
    await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => video.paused).catch(() => false), {
        message: 'The video should pause when clicked again',
    }).toBe(true);
}

// Tests every video found on the page - the first genuinely VISIBLE one fully (play/fullscreen/
// pause), any remaining ones only structurally (a real iframe with a non-empty src) to keep runtime
// reasonable on pages with several embeds (e.g. Female Playing Membership has 4). Confirmed real
// content fact: on some pages every video is embedded inside a currently-collapsed FAQ accordion
// answer (`.inlineAccordion__itemContent.collapse`, `display:none`) - not testable interactively
// until that specific item is expanded, which this generic per-page check has no reliable way to
// know in advance, so it's skipped gracefully rather than forced through a long timeout.
async function testPageVideos(page) {
    const youTubeCount = await page.locator('iframe[src*="youtube"]').count();
    const vimeoCount = await page.locator('iframe[src*="vimeo"]').count();

    if (youTubeCount === 0 && vimeoCount === 0) {
        return;
    }

    const visibleYouTube = page.locator('iframe[src*="youtube"]:visible').first();
    const visibleVimeo = page.locator('iframe[src*="vimeo"]:visible').first();

    if ((await visibleYouTube.count()) > 0) {
        const videoFrame = page.frameLocator('iframe[src*="youtube"]:visible').first();
        await testYouTubeVideo(visibleYouTube, videoFrame, page);
    } else if ((await visibleVimeo.count()) > 0) {
        const videoFrame = page.frameLocator('iframe[src*="vimeo"]:visible').first();
        await testVimeoVideo(visibleVimeo, videoFrame, page);
    } else {
        return;
    }

    const totalVideos = youTubeCount + vimeoCount;
    if (totalVideos > 1) {
        const remainingSrcs = await page.locator('iframe[src*="youtube"], iframe[src*="vimeo"]').evaluateAll((els) => els.slice(1).map((el) => el.getAttribute('src')));
        for (const src of remainingSrcs) {
            expect(src, 'Every additional video on the page should have a real embed src').toBeTruthy();
        }
    }
}

// Same single-open `.inlineAccordion__itemHandle`/multi-open `.accordion__header` components already
// documented throughout this project. Deliberately opens and closes each item immediately, one at a
// time (never batch-expands a whole section before collapsing it) - the same real ~17-minute
// performance disaster documented for the Tickets FAQs page (spec 12) reproduces on any accordion with
// a large item count if items are left open simultaneously, and this file has some very large ones
// (Overseas Tours: 37 items). expect.soft() throughout so one malformed item can't blank out coverage
// of the rest.
async function testAccordionItemsImmediately(page, labels) {
    for (const label of labels) {
        await test.step(`Expand and collapse "${label}"`, async () => {
            const header = page.locator('.accordion__header:visible, .inlineAccordion__itemHandle:visible', { hasText: label }).first();
            await header.scrollIntoViewIfNeeded();

            await dismissCookieOverlayIfPresent(page);
            await page.waitForTimeout(300);
            await header.evaluate((el) => el.click());
            // Polled rather than checked once immediately - confirmed a real, occasional timing gap
            // on mobile emulation where the class toggle lags slightly behind the click itself, same
            // family of race already documented for this accordion component elsewhere in this
            // project (specs 08/12/13/14).
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

            // Confirmed via repeated runs: a fixed ~400ms settle before the 2nd click isn't always
            // enough - items whose content is taller (e.g. ones with an embedded video) appear to
            // need a longer transition-settle time before the widget accepts another toggle. A single
            // retry (click again after a longer wait) resolved every case seen so far.
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

// Confirmed hover mechanism for `.ctaTile--panel` cards (Tours & Museum, spec 09): the generic
// `.ctaTile:hover` box-shadow rule applies, image-zoom is overridden to a no-op for this variant.
async function verifyPanelCardHover(cardLocator) {
    const before = await cardLocator.evaluate((el) => getComputedStyle(el).boxShadow);
    await dismissCookieOverlayIfPresent(cardLocator.page());
    await cardLocator.hover();
    await cardLocator.page().waitForTimeout(300);
    const after = await cardLocator.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(after, 'The card should visually change (box-shadow) on hover').not.toBe(before);
}

// Per Hector's "no 404 for cards linking to pages" instruction (carried over from spec 14) - every
// ctaTile card's link is verified via a direct request rather than a full click-through-and-back cycle
// for each one (several of these pages carry many cards, e.g. Heritage Trail has 20), and each card's
// hover effect is checked while iterating.
async function verifyCardsNotBrokenWithHover(page, baseURL) {
    const cards = await page.locator('.ctaTile--panel, .ctaTile--alt').evaluateAll((els) => els.map((el) => ({
        title: el.querySelector('.ctaTile__title')?.textContent.trim(),
        href: el.querySelector('a.ctaTile__link')?.getAttribute('href'),
    })));

    for (const card of cards) {
        if (!card.href) {
            continue;
        }
        await test.step(`"${card.title}" card`, async () => {
            const cardLocator = page.locator('.ctaTile--panel, .ctaTile--alt', { hasText: card.title }).first();
            await cardLocator.scrollIntoViewIfNeeded();
            await verifyPanelCardHover(cardLocator);

            const response = await page.request.get(new URL(card.href, baseURL).toString()).catch((error) => {
                throw new Error(`"${card.title}"'s link (${card.href}) could not be reached at all: ${error.message}`);
            });
            const status = response.status();
            expect(status, `"${card.title}"'s link (${card.href}) should not be a dead/not-found link`).not.toBe(404);
            expect(status, `"${card.title}"'s link (${card.href}) should not return a server error`).toBeLessThan(500);
        });
    }
}

// Same shared `.whatsOnRow` Swiper "what's on" component already documented on the Plan Your Day and
// Internationals pages - card zoom on hover, nav arrows revealed on wrap hover.
async function verifyWhatsOnRowIfPresent(page) {
    const wrap = page.locator('.whatsOnRow__swiperWrap').first();
    if ((await wrap.count()) === 0) {
        return;
    }

    await wrap.scrollIntoViewIfNeeded();
    const firstCard = page.locator('.whatsOnRow__item').first();
    if ((await firstCard.count()) === 0) {
        return;
    }

    const before = await firstCard.locator('.ctaTile__background').first().evaluate((el) => getComputedStyle(el).transform);
    await dismissCookieOverlayIfPresent(firstCard.page());
    await firstCard.hover();
    await page.waitForTimeout(400);
    const after = await firstCard.locator('.ctaTile__background').first().evaluate((el) => getComputedStyle(el).transform);
    expect(after, 'The carousel card should visually change (zoom) on hover').not.toBe(before);
}

// Per Hector's "no 404" instruction applied to plain buttons too, not just cards - every real button
// on the page (excluding header/footer/meganav chrome) is verified via a direct request. mailto:/tel:
// links are format-checked instead of requested (a real mail/phone handoff isn't a browser request).
// Network-level failures (DNS, unreachable host) are caught and turned into a clean failed assertion
// rather than an uncaught exception, same convention as the Conferences and Events brochure-link fix
// (spec 13) - some of these buttons point at third-party domains (app stores, donation platforms,
// Google Docs) that could plausibly be unreachable for reasons outside this site's control.
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

async function pageExists(page, path) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => null);
    return !!response && response.status() < 400;
}

// Full generic per-page traversal, applied identically to every MCC destination in this file - each
// test just supplies its own menu path, expected H1, and title keyword, then this runs whatever
// content actually exists on the page (video/accordion/cards/buttons/whatsOnRow are all detected and
// tested dynamically, not hardcoded per page).
async function runMCCPageTraversal(page, baseURL, { menuPath, h1Pattern, titlePattern, skip404Path }) {
    test.setTimeout(180000);

    const navResult = await test.step('Navigate via the MCC menu', async () => {
        if (skip404Path) {
            const exists = await pageExists(page, skip404Path);
            if (!exists) {
                return 'not-found';
            }
        }
        return navigateViaMCCMenu(page, menuPath);
    });

    test.skip(navResult === false, 'This menu path doesn\'t exist on this environment yet.');
    test.skip(navResult === 'not-found', 'This page doesn\'t exist on this environment yet - confirmed 404 on UAT2 as of 2026-07-13, present on Live.');
    test.skip(navResult === 'auth-redirect', 'This destination redirects to an auth login flow on this environment (confirmed UAT2-only quirk as of 2026-07-13) - content can\'t be verified behind a login wall.');

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), `The page should show a heading matching ${h1Pattern}`).toHaveText(h1Pattern);
    });

    // Re-verified 2026-07-17: UAT2 now shows real, page-specific titles across this whole section too
    // (previously the generic sitewide "Lords MCC (UAT)" fallback) - both environments use the same
    // assertion now, no env branching needed.
    await test.step('Verify the page title', async () => {
        await expect(page, `The title should match ${titlePattern}`).toHaveTitle(titlePattern);
    });

    await test.step('Play any video(s) on the page (if present)', async () => {
        await testPageVideos(page);
    });

    await test.step('Test the FAQ/content accordion (if present)', async () => {
        await testPageAccordion(page);
    });

    await test.step('Verify the "what\'s on" style carousel (if present)', async () => {
        await verifyWhatsOnRowIfPresent(page);
    });

    await test.step('Verify the cards linking onward to other pages (hover effect + no 404s, if present)', async () => {
        await verifyCardsNotBrokenWithHover(page, baseURL);
    });

    await test.step('Verify the buttons on the page (no 404s, if present)', async () => {
        await verifyButtonsNotBroken(page, baseURL);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
}

// ---------------------------------------------------------------------------------------------
// The Club
// ---------------------------------------------------------------------------------------------

test('MCC - The Club - About us Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['The Club', 'About us'],
        h1Pattern: /About Us/i,
        titlePattern: /About Us/i,
    });
});

test('MCC - The Club - Our History Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['The Club', 'Our History'],
        h1Pattern: /Our History/i,
        titlePattern: /Our History/i,
    });
});

test('MCC - The Club - How to Join Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['The Club', 'How to Join'],
        h1Pattern: /How to join MCC/i,
        titlePattern: /How To Join MCC/i,
    });
});

test('MCC - The Club - Female Playing Membership Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['The Club', 'Female Playing Membership'],
        h1Pattern: /Female Playing Membership/i,
        titlePattern: /Female Playing Membership/i,
        skip404Path: '/mcc/the-club/female-playing-membership',
    });
});

test('MCC - The Club - MCC Honorary Life Members Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['The Club', 'MCC Honorary Life Members'],
        h1Pattern: /MCC Honorary Life Members/i,
        titlePattern: /MCC Honorary Life Members/i,
    });
});

test('MCC - The Club - MCC Committees Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['The Club', 'MCC Committees'],
        // Confirmed real content quirk: the H1 here reads "MCC Committee" (singular, with trailing
        // whitespace), not "MCC Committees" as the menu label and title both say - matched loosely.
        h1Pattern: /MCC Committee/i,
        titlePattern: /MCC Committees/i,
        skip404Path: '/mcc/the-club/committees-d206c8c068698080edd7ec8ea01df789',
    });
});

test('MCC - The Club - Reciprocal Arrangements Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['The Club', 'Reciprocal Arrangements'],
        h1Pattern: /Reciprocal Arrangements/i,
        titlePattern: /Reciprocal Arrangements/i,
    });
});

test('MCC - The Club - Women and Girls Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['The Club', 'Women and Girls'],
        h1Pattern: /Women and Girls/i,
        titlePattern: /Women (&|and) Girls/i,
    });
});

test('MCC - The Club - Cowdrey Lecture Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['The Club', 'Cowdrey Lecture'],
        h1Pattern: /Cowdrey Lecture/i,
        titlePattern: /Cowdrey Lecture/i,
    });
});

// ---------------------------------------------------------------------------------------------
// Cricket
// ---------------------------------------------------------------------------------------------

test('MCC - Cricket - MCC Cricket Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Cricket', 'MCC Cricket'],
        h1Pattern: /MCC Cricket/i,
        titlePattern: /MCC Cricket/i,
    });
});

test('MCC - Cricket - MCC Fixtures Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Cricket', 'MCC Fixtures'],
        // Confirmed real content quirk: this H1 reads just "Fixtures" (with trailing whitespace) -
        // this page reuses the same Fixtures and Results component already deeply tested in spec 05
        // (fixturesList__switch tabs, in-page nav, month filters), so this traversal deliberately
        // keeps to the generic checks rather than re-testing that component's own behaviour again.
        h1Pattern: /Fixtures/i,
        titlePattern: /MCC Cricket Fixtures/i,
        skip404Path: '/mcc/mcc-cricket/fixtures-and-results',
    });
});

test('MCC - Cricket - Overseas Tours Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Cricket', 'Overseas Tours'],
        // Confirmed real content quirk: the menu label reads "Overseas Tours" but the page's own H1
        // reads "MCC Touring Programme" - a genuine, harmless naming difference, not a bug.
        h1Pattern: /MCC Touring Programme/i,
        titlePattern: /Overseas Tours/i,
    });
});

test('MCC - Cricket - MCC & Wormsley Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Cricket', 'MCC & Wormsley'],
        h1Pattern: /MCC (&|and) Wormsley/i,
        titlePattern: /Wormsley/i,
        skip404Path: '/mcc/mcc-cricket/wormsley',
    });
});

// ---------------------------------------------------------------------------------------------
// Direct pages (no second-level submenu)
// ---------------------------------------------------------------------------------------------

test('MCC - MCC Foundation Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['MCC Foundation'],
        h1Pattern: /MCC Foundation/i,
        titlePattern: /Transforming lives through cricket/i,
    });
});

test('MCC - Barclays Knight-Stokes Cup Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Barclays Knight-Stokes Cup'],
        h1Pattern: /Barclays Knight-Stokes Cup/i,
        titlePattern: /Barclays Knight-Stokes Cup/i,
        skip404Path: '/mcc/barclays-knight-stokes-cup',
    });
});

test('MCC - In the Community Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['In the Community'],
        h1Pattern: /MCC in the Community/i,
        titlePattern: /MCC In The Community/i,
    });
});

test('MCC - The Laws of Cricket Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['The Laws of Cricket'],
        h1Pattern: /The Laws of Cricket/i,
        titlePattern: /About the Laws of Cricket/i,
    });
});

// ---------------------------------------------------------------------------------------------
// Heritage & Collections
// ---------------------------------------------------------------------------------------------

test('MCC - Heritage & Collections - Heritage Trail Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Heritage & Collections', 'Heritage Trail'],
        h1Pattern: /Lord's Heritage Trail/i,
        titlePattern: /Heritage Trail/i,
        skip404Path: '/mcc/heritage-collections/heritage-trail',
    });
});

test('MCC - Heritage & Collections - 50 Objects Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Heritage & Collections', '50 Objects'],
        h1Pattern: /50 Objects Exhibition/i,
        titlePattern: /50 Objects/i,
        skip404Path: '/mcc/heritage-collections/50-objects',
    });
});

test('MCC - Heritage & Collections - Previous Exhibitions from Lord\'s Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Heritage & Collections', 'Previous Exhibitions from Lord\'s'],
        h1Pattern: /Previous Exhibitions From Lord's/i,
        titlePattern: /Latest From Lord's/i,
        skip404Path: '/mcc/heritage-collections/previous-from-lord-s',
    });
});

test('MCC - Heritage & Collections - What we do Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Heritage & Collections', 'What we do'],
        h1Pattern: /What we do/i,
        titlePattern: /What We Do/i,
    });
});

test('MCC - Heritage & Collections - Who we work with Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Heritage & Collections', 'Who we work with'],
        h1Pattern: /Who We Work With/i,
        titlePattern: /Who We Work With/i,
    });
});

test('MCC - Heritage & Collections - Research Enquiry Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Heritage & Collections', 'Research Enquiry'],
        h1Pattern: /Research Enquiry/i,
        titlePattern: /Research Enquiry/i,
    });
});

test('MCC - Heritage & Collections - Search the collection Traversal', async ({ page, baseURL }) => {
    await runMCCPageTraversal(page, baseURL, {
        menuPath: ['Heritage & Collections', 'Search the collection'],
        h1Pattern: /Search the Collections/i,
        titlePattern: /Search The Collections/i,
    });
});
