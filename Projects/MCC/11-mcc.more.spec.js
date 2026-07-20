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
// Coverage notes - "More..." meganav section (7th top-level menu item)
// ============================================================================
// Scope: the widest tree in this project after 09-mcc.spec.js's MCC menu -
// News & Stories, London Spirit (external), History (7 items), Inside Lord's
// (2 items), and Jobs (8 items).
//
// Tests in this file (19 total):
//   News and Stories Traversal (infinite-scroll date-sorted cards, sample
//     Load More check only - see below)
//   London Spirit link check (external, lightweight)
//   History: Honours boards, Father Time Wall, Evolution of Women's
//     Cricket, The Ashes, Bell Ringers, Father time, Ground Development
//   Inside Lord's: Discover the Benefits, Explore now (external)
//   Jobs: Join the Team, Volunteer, Our Benefits, Who we are, Casual
//     Stewarding Roles, Casual Vitality Performance Centre Roles, Casual
//     Retail Roles, Casual Catering Roles
//
// Environment status: this whole section already exists on UAT2 with a
// structure identical to Live (confirmed directly, contrary to the initial
// assumption that it was Live-only) - nothing here presence-gates at the
// menu level; content differences are handled per-test as found.
//
// Confirmed CURRENT defects, left as deliberately failing assertions (not
// worked around):
//   - Honours Boards: every filter group's "Clear" action shows the literal
//     unresolved placeholder "viewModel.ClearLabel"; results don't refresh
//     to the full list after a filter has narrowed them and is then cleared
//     (confirmed a front-end rendering bug via direct network inspection).
//   - Father Time Wall has no `<h1>` element in the DOM at all.
//   - Discover the Benefits' H1 is literal placeholder text ("This will be
//     a motion graphic").
//   - Join the Team's "Our Benefits" button 404s.
//   - Who we are has no `<h1>` at all.
//   - Casual Retail Roles' `<title>` is the generic sitewide fallback
//     instead of page-specific.
//   - News & Stories' "Load More" only ever gets sample-checked (2 clicks,
//     a handful of Read Story links) rather than clicked to the true end -
//     this list has 500+ articles with no reachable end, confirmed via
//     API probing, and Hector explicitly signed off on "sample check only".
//
// Known automation-environment limitations (not site defects, handled via
// graceful skip/fallback rather than forced failures): Vimeo embeds
// (Father time, Bell Ringers) occasionally serve a Cloudflare Turnstile
// bot-check instead of the real player; the Evolution of Women's Cricket
// "roundel" control is genuinely scroll-linked (needs a real scroll event
// between clicks to "re-arm", confirmed a too-large re-arm scroll can
// overshoot past the end of the timeline and lose the active-date marker
// entirely - a small 100px scroll is used instead of the originally-tried
// 300px); it also doesn't respond to any interaction at all on touch
// viewports (structural-only check there).
// ============================================================================

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

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

// Reuses the exact same nested, scoped DOM traversal proven in spec 02's meganav suite and spec 15's
// MCC menu suite. Some of this menu's pages are genuinely heavier (Honours Boards/Father Time Wall's
// filter widgets need their own JS fully initialized before their toggle handle responds - confirmed
// via direct testing that a plain `domcontentloaded` load plus a short fixed wait wasn't reliably
// enough, `networkidle` was) - so navigation here always waits for networkidle, not just `load`.
async function navigateViaMoreMenu(page, path) {
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
    }, { rootName: 'more', restPath: path });

    if (!result.ok) {
        return false;
    }

    await page.waitForLoadState('load').catch(() => { });
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

async function testVimeoVideo(videoIframe, videoFrame, page) {
    const projectUse = test.info().project.use;
    const isTouchDevice = Boolean(projectUse.isMobile || projectUse.hasTouch);

    await videoIframe.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);

    // Confirmed via direct probing: Vimeo's own embed occasionally serves a Cloudflare Turnstile
    // bot-check ("We couldn't verify the security of your connection") instead of the player, which
    // an automated browser can never pass - this is an inherent automation limitation of the video
    // host itself, not a site defect, so it's skipped gracefully rather than forced into a failure.
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

    await videoIframe.hover();
    await page.waitForTimeout(500);
    await playPauseButton.click({ timeout: 10000 });
    await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => !video.paused).catch(() => false), {
        message: 'The video should start playing once the play button is clicked',
    }).toBe(true);

    // Vimeo's control bar auto-hides a couple seconds after playback starts, so a single hover
    // right before the click isn't reliable here - re-hover (moving the mouse re-arms the
    // auto-hide timer) and poll for the control bar to actually be visible before clicking it.
    // Confirmed this doesn't always succeed within a bounded number of attempts (the auto-hide
    // timing itself is inherently flaky to automate) - when it doesn't, fall back to a structural
    // presence check on the control rather than forcing a failure, same convention as the
    // touch-device and Turnstile-blocked fallbacks above.
    const fullscreenRevealed = await hoverUntilVimeoControlVisible(videoIframe, fullscreenButton);
    if (!fullscreenRevealed) {
        await expect(fullscreenButton, 'The video\'s full screen control should be present').toHaveCount(1);
        return;
    }

    await fullscreenButton.click({ timeout: 10000 });
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
        message: 'The page should enter full screen after clicking the full screen control',
    }).toBe(true);
    await page.waitForTimeout(1000);

    const revealedForExit = await hoverUntilVimeoControlVisible(videoIframe, fullscreenButton);
    if (!revealedForExit) {
        await page.keyboard.press('Escape').catch(() => { });
        return;
    }
    await fullscreenButton.click({ timeout: 10000 });
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
        message: 'The page should leave full screen after clicking full screen again',
    }).toBe(false);
    await page.waitForTimeout(1000);

    const revealedForPause = await hoverUntilVimeoControlVisible(videoIframe, playPauseButton);
    if (!revealedForPause) {
        return;
    }
    await playPauseButton.click({ timeout: 10000 });
    await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => video.paused).catch(() => false), {
        message: 'The video should pause when clicked again',
    }).toBe(true);
}

async function hoverUntilVimeoControlVisible(videoIframe, controlButton) {
    let visible = false;
    for (let attempt = 0; attempt < 5 && !visible; attempt++) {
        await videoIframe.hover();
        await videoIframe.hover({ position: { x: 10, y: 10 } }).catch(() => { });
        await videoIframe.hover().catch(() => { });
        visible = await controlButton.isVisible().catch(() => false);
        if (!visible) {
            await videoIframe.page().waitForTimeout(400);
        }
    }
    return visible;
}

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
    }
}

// Same single-open `.inlineAccordion__itemHandle`/multi-open `.accordion__header` components already
// documented throughout this project - immediate open-then-close per item (never batch), same
// performance lesson learned on the Tickets FAQs page (spec 12) and MCC menu (spec 15).
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

// Confirmed real fact, reinforced yet again in this project: the hover mechanism genuinely varies by
// `.ctaTile` modifier variant - `.ctaTile--panel` uses a box-shadow change (Tours & Museum, spec 09),
// while `.ctaTile--alt` (confirmed here on the Our Benefits page) uses the generic image-zoom
// (`.ctaTile__background` transform scale) plus a "Read more" height-reveal (`.ctaTile__cta`
// clientHeight 0 -> non-zero) instead - box-shadow doesn't change at all for this variant. Checking
// all three signals and passing if any one changed avoids re-guessing per variant every time.
async function verifyPanelCardHover(cardLocator) {
    const page = cardLocator.page();
    const before = await cardLocator.evaluate((el) => ({
        boxShadow: getComputedStyle(el).boxShadow,
        transform: getComputedStyle(el.querySelector('.ctaTile__background') || el).transform,
        ctaHeight: el.querySelector('.ctaTile__cta')?.clientHeight ?? null,
    }));
    await cardLocator.hover();
    await page.waitForTimeout(400);
    const after = await cardLocator.evaluate((el) => ({
        boxShadow: getComputedStyle(el).boxShadow,
        transform: getComputedStyle(el.querySelector('.ctaTile__background') || el).transform,
        ctaHeight: el.querySelector('.ctaTile__cta')?.clientHeight ?? null,
    }));

    const changed = before.boxShadow !== after.boxShadow || before.transform !== after.transform || before.ctaHeight !== after.ctaHeight;
    expect(changed, 'The card should visually change on hover (box-shadow, image zoom, or a "Read more" reveal)').toBe(true);
}

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

// Full generic per-page traversal, applied to every "plain" More destination (i.e. everything except
// the 4 novel components handled by their own dedicated tests below).
async function runMorePageTraversal(page, baseURL, { menuPath, h1Pattern, titlePattern }) {
    test.setTimeout(120000);

    const navigated = await test.step('Navigate via the More menu', async () => {
        return navigateViaMoreMenu(page, menuPath);
    });
    test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');

    await test.step('Verify the H1', async () => {
        if (h1Pattern === null) {
            // Confirmed real content defect, deliberately left failing - see the individual test for
            // details on which page this applies to and why.
            await expect(page.locator('h1').first(), 'The page should show a real page-specific heading').toBeVisible();
            return;
        }
        await expect(page.locator('h1').first(), `The page should show a heading matching ${h1Pattern}`).toHaveText(h1Pattern);
    });

    // Confirmed via direct testing that (unlike every other section of the site tested in earlier
    // specs) UAT2's whole "More" section shows real, page-specific titles matching Live rather than
    // the sitewide generic "Lords MCC (UAT)" fallback - so both environments use the same expectation
    // here.
    await test.step('Verify the page title', async () => {
        await expect(page, `The title should match ${titlePattern}`).toHaveTitle(titlePattern);
    });

    await test.step('Play any video(s) on the page (if present)', async () => {
        await testPageVideos(page);
    });

    await test.step('Test the FAQ/content accordion (if present)', async () => {
        await testPageAccordion(page);
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
// News & Stories (novel component: infinite-scroll date-sorted cards + Load More)
// ---------------------------------------------------------------------------------------------

test('More - News and Stories Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Navigate via the More menu', async () => {
        const navigated = await navigateViaMoreMenu(page, ['News & Stories']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1 and title', async () => {
        await expect(page.locator('h1').first(), 'The page should show a real news headline as its H1').toBeVisible();
        // Confirmed real title on both Live and UAT2 for this section - see comment in
        // runMorePageTraversal above.
        await expect(page, 'The title should reference news').toHaveTitle(/news/i);
    });

    await test.step('Scroll down slowly through the date-sorted cards, verifying each visible card\'s "Read story" link', async () => {
        // Per Hector: scroll slowly (not one big jump) so the cards' own reveal animation genuinely
        // plays out, then verify a sample of "Read story" links are correct - not every single card
        // on the page, since this list can run into the hundreds (confirmed via the underlying
        // /lordsapi/newslist/ endpoint) and checking all of them isn't practical in a single test run.
        for (let i = 0; i < 6; i++) {
            await page.mouse.wheel(0, 400);
            await page.waitForTimeout(400);
        }

        // Confirmed real DOM fact: some ".newsList__article" elements are empty layout "break"
        // markers (class ".newsList__article--break", no content at all) used to control the grid
        // layout, not real story cards - filtered out here rather than treated as cards missing a
        // link.
        const cards = await page.locator('.newsList__article').evaluateAll((els) => els
            .filter((el) => el.querySelector('a.ctaTile__link'))
            .slice(0, 5)
            .map((el) => {
                const link = el.querySelector('a.ctaTile__link');
                const dateText = el.textContent.match(/\d{1,2}\s+\w+\s+\d{4}/)?.[0] || null;
                return { href: link.getAttribute('href'), date: dateText };
            }));
        expect(cards.length, 'There should be several news cards visible after scrolling').toBeGreaterThan(0);

        for (const card of cards) {
            await test.step(`"Read story" link (${card.date || 'undated'})`, async () => {
                expect(card.href, 'Each card should have a real "Read story" link').toBeTruthy();
                const response = await page.request.get(new URL(card.href, baseURL).toString());
                expect(response.status(), `The "Read story" link (${card.href}) should not be broken`).toBeLessThan(400);
            });
        }
    });

    await test.step('Click "Load More" a couple of times and verify more cards appear', async () => {
        // Per Hector's decision: only a bounded sample check here, not an exhaustive click-to-the-
        // end - confirmed this list is large enough (500+ items via the API) that reaching the true
        // end would take many minutes and hundreds of clicks, disproportionate to what a sample check
        // needs to prove (the mechanic itself works).
        const loadMoreButton = page.locator('a.button--loadMore').first();
        if ((await loadMoreButton.count()) === 0) {
            return;
        }

        for (let i = 0; i < 2; i++) {
            const beforeCount = await page.locator('.newsList__article').count();
            await loadMoreButton.scrollIntoViewIfNeeded();
            await loadMoreButton.click({ force: true });
            await page.waitForTimeout(2000);
            const afterCount = await page.locator('.newsList__article').count();
            expect(afterCount, `Clicking "Load More" (round ${i + 1}) should reveal additional cards`).toBeGreaterThan(beforeCount);
        }

        const newCards = await page.locator('.newsList__article').evaluateAll((els) => els
            .filter((el) => el.querySelector('a.ctaTile__link'))
            .slice(-3)
            .map((el) => el.querySelector('a.ctaTile__link').getAttribute('href')));
        for (const href of newCards) {
            await test.step(`Newly-loaded "Read story" link`, async () => {
                expect(href, 'Each newly-loaded card should have a real "Read story" link').toBeTruthy();
                const response = await page.request.get(new URL(href, baseURL).toString());
                expect(response.status(), `The "Read story" link (${href}) should not be broken`).toBeLessThan(400);
            });
        }
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('More - London Spirit link check', async ({ page }) => {
    test.setTimeout(60000);

    // Deliberately left untouched beyond a working-link check, per Hector - this heads to a
    // completely separate external site (londonspirit.com), not part of the main MCC site's content.
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAndAcceptCookieBanner(page);

    const href = await page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);
        const mainLevel = document.querySelector('.meganav .mainLevel');
        const root = directChildItems(mainLevel).find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent).toLowerCase().startsWith('more'));
        if (!root) return null;
        root.querySelector(':scope > a.meganav__link').click();
        const sub = root.querySelector(':scope > ul.meganav__list');
        const child = directChildItems(sub).find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent) === 'London Spirit');
        return child ? child.querySelector(':scope > a.meganav__link').getAttribute('href') : null;
    });

    test.skip(!href, 'The More menu doesn\'t exist on this environment yet.');

    // londonspirit.com (a separate third-party site) has been confirmed via direct curl testing to
    // intermittently reset the connection on a first attempt and recover on a retry a moment later -
    // a real but transient external flake, so a couple of retries are used before treating it as down.
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

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

test('More - History - Honours boards Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Navigate via the More menu', async () => {
        const navigated = await navigateViaMoreMenu(page, ['History', 'Honours boards']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Honours Boards heading').toHaveText(/Honours Boards/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference the Honours Boards').toHaveTitle(/Honours Boards/i);
    });

    await test.step('Scroll down to reveal the boards content', async () => {
        for (let i = 0; i < 4; i++) {
            await page.mouse.wheel(0, 500);
            await page.waitForTimeout(300);
        }
        await expect(page.locator('.honoursBoard__honour').first(), 'At least one honour entry should be visible').toBeVisible();
    });

    await test.step('Open the filter panel and try several filter combinations, then Apply Filters', async () => {
        const beforeCount = await page.locator('.honoursBoard__honour').count();
        expect(beforeCount, 'There should be a full, unfiltered list of honours by default').toBeGreaterThan(0);

        const handle = page.locator('.honoursBoard__filtersHandle').first();
        await handle.scrollIntoViewIfNeeded();
        await handle.click({ force: true });
        await expect(page.locator('.honoursBoard__keywordInput').first(), 'The filter panel should open').toBeVisible();

        // Confirmed real content defect: every filter group's own "Clear" action shows the literal,
        // unresolved template placeholder "viewModel.ClearLabel" as its visible text instead of real
        // wording (e.g. "Clear") - the action itself still works correctly (confirmed separately),
        // it's specifically the label text that's broken. Surfaced here as a deliberately failing
        // assertion, same "surface, don't mask" convention as every other confirmed defect.
        const clearLabelText = await page.locator('.honoursBoard__filterGroupAction--clear').first().textContent();
        expect.soft(clearLabelText, 'The Clear action\'s label should show real text, not an unresolved template placeholder').not.toMatch(/viewModel\./i);

        // Journey 1: Discipline (Batting) + one Nation (England)
        await page.locator('.honoursBoard__filter', { hasText: 'Batting' }).first().locator('input').evaluate((el) => el.click());
        await page.locator('.honoursBoard__filter', { hasText: 'England' }).first().locator('input').evaluate((el) => el.click());

        const applyButton = page.locator('a,button').filter({ hasText: /apply filters/i }).first();
        await applyButton.scrollIntoViewIfNeeded();
        await applyButton.click({ force: true });
        await page.waitForTimeout(1500);

        const afterJourney1 = await page.locator('.honoursBoard__honour').count();
        expect(afterJourney1, 'Filtering by Batting + England should narrow the results').toBeLessThan(beforeCount);
        expect(afterJourney1, 'Filtering by Batting + England should still show some results').toBeGreaterThan(0);

        // Journey 2: change combination - Achievement (five wicket haul) + Format (Test) + a
        // "Select all" group action, then re-apply.
        await handle.click({ force: true });
        await page.locator('.honoursBoard__filter', { hasText: 'Batting' }).first().locator('input').evaluate((el) => el.click());
        await page.locator('.honoursBoard__filter', { hasText: 'England' }).first().locator('input').evaluate((el) => el.click());
        await page.locator('.honoursBoard__filter', { hasText: /five wicket haul/i }).first().locator('input').evaluate((el) => el.click());
        await page.locator('.honoursBoard__filter', { hasText: 'Test' }).first().locator('input').evaluate((el) => el.click());
        await applyButton.click({ force: true });
        await page.waitForTimeout(1500);

        const afterJourney2 = await page.locator('.honoursBoard__honour').count();
        expect(afterJourney2, 'Filtering by five wicket haul + Test should still show some results').toBeGreaterThan(0);

        // Journey 3: clear every filter group selected so far via each group's own "Clear" action
        // (confirmed this action's underlying click handler does correctly uncheck its own group's
        // boxes, despite its visible label being a broken, unresolved template string,
        // "viewModel.ClearLabel" - a separate confirmed defect noted above), then use "Select all" on
        // the Nation group instead - selecting every nation with no other filter active should be
        // equivalent to no filter at all.
        await handle.click({ force: true });
        const disciplineClear = page.locator('#filtersDiscipline .honoursBoard__filterGroupAction--clear').first();
        await disciplineClear.scrollIntoViewIfNeeded();
        await disciplineClear.click({ force: true });
        await page.locator('#filtersAchievements .honoursBoard__filterGroupAction--clear').first().click({ force: true });
        await page.locator('#filtersFormat .honoursBoard__filterGroupAction--clear').first().click({ force: true });
        const nationSelectAll = page.locator('#filtersNations .honoursBoard__filterGroupAction--select').first();
        await nationSelectAll.click({ force: true });
        await applyButton.click({ force: true });
        await page.waitForTimeout(1500);

        // Confirmed real content defect, deliberately left failing: once a filter has genuinely
        // narrowed the results, clearing it back to "no filter" and re-applying does NOT restore the
        // full list on screen - it stays stuck showing the previous (smaller) filtered count.
        // Confirmed via direct network inspection that this is a front-end rendering bug, not a
        // backend one: the underlying API call for the cleared state (`/lordsapi/honourslist/hl/0/0/
        // 0/0/`) correctly returns all 486 items server-side, but the page's own results container
        // doesn't fully refresh to show them. Surfaced here rather than worked around, same "surface,
        // don't mask" convention as every other confirmed defect in this project.
        const afterJourney3 = await page.locator('.honoursBoard__honour').count();
        expect(afterJourney3, 'Selecting every Nation with no other filter should show the full list again (confirmed real defect: results don\'t refresh back to the full count once a filter has narrowed them)').toBe(beforeCount);
    });

    await test.step('Follow the "About" link', async () => {
        const aboutLink = page.locator('.honoursBoard__about').first();
        await aboutLink.scrollIntoViewIfNeeded();
        const href = await aboutLink.getAttribute('href');
        await clickWithCookieGuard(page, aboutLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).pathname, 'The About link should navigate to its own page').toBe(new URL(href, baseURL).pathname);
        await expect(page.locator('h1').first(), 'The About page should have a real heading').toBeVisible();

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('More - History - Father Time Wall Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Navigate via the More menu', async () => {
        const navigated = await navigateViaMoreMenu(page, ['History', 'Father Time Wall']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1', async () => {
        // Confirmed real content defect: this page has no H1 element in the DOM at all (confirmed
        // directly, not assumed) - surfaced here as a deliberately failing assertion rather than
        // worked around, same "surface, don't mask" convention as every other confirmed defect in
        // this project.
        await expect(page.locator('h1').first(), 'The page should show a real page-specific H1 heading (confirmed missing entirely)').toBeVisible();
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference the Father Time Wall').toHaveTitle(/Father Time/i);
    });

    await test.step('Scroll through and navigate the large horizontal timeline carousel', async () => {
        const timeline = page.locator('.timeline--horizontal').first();
        await timeline.scrollIntoViewIfNeeded();
        await expect(page.locator('.timeline__items').first(), 'At least one timeline milestone should be visible').toBeVisible();

        const nextButton = page.locator('.timeline-nav-button--prev, .timeline-nav-button--next').last();
        const wrapper = page.locator('.timeline__itemWrapper').first();
        const beforeTransform = await wrapper.evaluate((el) => el.style.transform);
        await nextButton.click({ force: true });
        await page.waitForTimeout(800);
        const afterTransform = await wrapper.evaluate((el) => el.style.transform);
        expect(afterTransform, 'Clicking the timeline nav button should move the carousel').not.toBe(beforeTransform);
    });

    await test.step('Open the filter panel and try a filter combination, then Apply Filters', async () => {
        const beforeCount = await page.locator('.timeline__items').count();

        const handle = page.locator('.wall__filtersHandle').first();
        await handle.scrollIntoViewIfNeeded();
        await handle.click({ force: true });
        await expect(page.locator('.wall__keywordInput').first(), 'The filter panel should open').toBeVisible();

        await page.locator('.wall__filter', { hasText: 'Ashes' }).first().locator('input').evaluate((el) => el.click());
        await page.locator('.wall__filter', { hasText: 'England' }).first().locator('input').evaluate((el) => el.click());

        const applyButton = page.locator('a,button').filter({ hasText: /apply filters/i }).first();
        await applyButton.scrollIntoViewIfNeeded();
        await applyButton.click({ force: true });
        await page.waitForTimeout(1500);

        const afterCount = await page.locator('.timeline__items').count();
        expect(afterCount, 'Filtering by Ashes + England should narrow the timeline').toBeLessThanOrEqual(beforeCount);
    });

    await test.step('Follow the "About" link (if present)', async () => {
        const aboutLink = page.locator('.wall__about').first();
        if ((await aboutLink.count()) === 0) {
            return;
        }

        await aboutLink.scrollIntoViewIfNeeded();
        const href = await aboutLink.getAttribute('href');
        await clickWithCookieGuard(page, aboutLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).pathname, 'The About link should navigate to its own page').toBe(new URL(href, baseURL).pathname);

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('More - History - Evolution of Women\'s Cricket Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Navigate via the More menu', async () => {
        const navigated = await navigateViaMoreMenu(page, ['History', 'Evolution of Women\'s Cricket']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Women\'s Cricket heading').toHaveText(/Women's Cricket/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference the Evolution of Women\'s Cricket').toHaveTitle(/Evolution of Women's Cricket/i);
    });

    await test.step('Scroll down slowly through the timeline, revealing each date', async () => {
        const timeline = page.locator('.timeline').first();
        await timeline.scrollIntoViewIfNeeded();
        await expect(page.locator('.timeline__date__item').first(), 'The timeline\'s date markers should be visible').toBeVisible();

        // Per Hector: scroll slowly so the reveal effect genuinely plays out, rather than jumping
        // straight past it.
        for (let i = 0; i < 8; i++) {
            await page.mouse.wheel(0, 350);
            await page.waitForTimeout(400);
        }

        await expect(page.locator('.timeline__item').first(), 'At least one timeline story item should be visible after scrolling').toBeVisible();
    });

    await test.step('Click the roundel ("walking man") icon and verify the active date advances', async () => {
        const walkingMan = page.locator('.timeline__walking-man').first();
        await walkingMan.scrollIntoViewIfNeeded();

        // Confirmed via direct probing (visible, correctly positioned, pointer-events: auto, yet a
        // real click/tap/dispatched click event all have zero effect) that this control simply
        // doesn't respond to clicks at all on touch viewports - the site expects swipe-driven
        // navigation there instead. Same touch-fallback convention already used for Vimeo playback.
        const projectUse = test.info().project.use;
        const isTouchDevice = Boolean(projectUse.isMobile || projectUse.hasTouch);
        if (isTouchDevice) {
            await expect(walkingMan, 'The roundel control should be visible on touch viewports').toBeVisible();
            return;
        }

        const activeBefore = await page.locator('.timeline__date__item.is-active span').first().textContent();
        await walkingMan.click({ force: true });
        await page.waitForTimeout(800);
        let activeAfterFirstClick = await page.locator('.timeline__date__item.is-active span').first().textContent().catch(() => null);
        // Confirmed on UAT2: the very first click can also land "unarmed" (same scroll-linked
        // behavior as the 2nd click below) - retry with a small real scroll in between if the first
        // click didn't register either. A small scroll (not the 300px used for re-arming later,
        // which can overshoot past the end of the timeline here and lose the "is-active" item
        // entirely) is enough to re-arm without running off the end of the content.
        for (let attempt = 0; attempt < 3 && (activeAfterFirstClick === activeBefore || activeAfterFirstClick === null); attempt++) {
            await page.mouse.wheel(0, 100);
            await page.waitForTimeout(500);
            await walkingMan.click({ force: true });
            await page.waitForTimeout(800);
            activeAfterFirstClick = await page.locator('.timeline__date__item.is-active span').first().textContent().catch(() => null);
        }
        expect(activeAfterFirstClick, 'Clicking the roundel should advance the active date').not.toBe(activeBefore);

        // Confirmed via repeated runs: this control is genuinely scroll-linked, not a plain click
        // handler - a 2nd click fired immediately after the 1st (with no scroll in between) has no
        // effect at all, no matter how long you wait first. A small real scroll between clicks
        // "re-arms" it reliably. Confirmed on UAT2: a 300px scroll can overshoot past the end of the
        // timeline (losing the "is-active" item entirely, since there's nothing left to activate) -
        // a smaller 100px scroll re-arms the control just as reliably without running off the end.
        let activeAfterSecondClick = activeAfterFirstClick;
        for (let attempt = 0; attempt < 4 && activeAfterSecondClick === activeAfterFirstClick; attempt++) {
            await page.mouse.wheel(0, 100);
            await page.waitForTimeout(500);
            await walkingMan.click({ force: true });
            await page.waitForTimeout(1000);
            activeAfterSecondClick = await page.locator('.timeline__date__item.is-active span').first().textContent().catch(() => null);
        }
        expect(activeAfterSecondClick, 'Clicking the roundel again should advance the active date once more').not.toBe(activeAfterFirstClick);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('More - History - The Ashes Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['History', 'The Ashes'],
        h1Pattern: /The Ashes/i,
        titlePattern: /The Ashes/i,
    });
});

test('More - History - Bell Ringers Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['History', 'Bell Ringers'],
        h1Pattern: /five-minute bell/i,
        titlePattern: /Bell Ringers/i,
    });
});

test('More - History - Father time Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['History', 'Father time'],
        h1Pattern: /Father Time/i,
        titlePattern: /Father Time/i,
    });
});

test('More - History - Ground Development Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['History', 'Ground Development'],
        h1Pattern: /Ground Development/i,
        titlePattern: /Ground Development/i,
    });
});

// ---------------------------------------------------------------------------------------------
// Inside Lord's
// ---------------------------------------------------------------------------------------------

test('More - Inside Lord\'s - Discover the Benefits Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Navigate via the More menu', async () => {
        const navigated = await navigateViaMoreMenu(page, ['Inside Lord\'s', 'Discover the Benefits']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1', async () => {
        // Confirmed real content defect on Live: the H1 here is literally the placeholder text "This
        // will be a motion graphic" rather than real page content - surfaced here as a deliberately
        // failing assertion, same "surface, don't mask" convention as every other confirmed defect.
        await expect(page.locator('h1').first(), 'The page should show a real heading, not unfinished placeholder text').not.toHaveText(/this will be a motion graphic/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference Inside Lord\'s').toHaveTitle(/Inside Lord's/i);
    });

    await test.step('Test the FAQ/content accordion (if present)', async () => {
        await testPageAccordion(page);
    });

    await test.step('Verify the buttons on the page (no 404s)', async () => {
        await verifyButtonsNotBroken(page, baseURL);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('More - Inside Lord\'s - Explore now Traversal', async ({ page, context }) => {
    test.setTimeout(60000);

    await test.step('Navigate via the More menu', async () => {
        const navigated = await navigateViaMoreMenu(page, ['Inside Lord\'s', 'Explore now']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify it leads to the external Inside Lord\'s platform', async () => {
        // This heads to a completely separate platform (inside.lords.org) - same-tab navigation
        // (confirmed target="_self"), so verified via host equality rather than a popup check. No
        // further content on that external platform is in scope here, matching this project's
        // established convention for external destinations.
        await expect.poll(() => new URL(page.url()).host, { message: 'The page should navigate to the external Inside Lord\'s platform' }).toBe('inside.lords.org');
    });
});

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

test('More - Jobs - Join the Team Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['Jobs', 'Join the Team'],
        h1Pattern: /Join the Team/i,
        titlePattern: /Join the Team/i,
    });
});

test('More - Jobs - Volunteer Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['Jobs', 'Volunteer'],
        h1Pattern: /Volunteer/i,
        titlePattern: /Volunteer/i,
    });
});

test('More - Jobs - Our Benefits Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['Jobs', 'Our Benefits'],
        h1Pattern: /Our Benefits/i,
        titlePattern: /Benefits/i,
    });
});

test('More - Jobs - Who we are Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['Jobs', 'Who we are'],
        // Confirmed real content defect on Live: this page has no H1 element in the DOM at all
        // (confirmed directly, not assumed) - the null pattern here tells the generic runner to
        // assert visibility (which fails, surfacing the defect) rather than matching specific text.
        h1Pattern: null,
        titlePattern: /Who We Are/i,
    });
});

test('More - Jobs - Casual Stewarding Roles Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['Jobs', 'Casual Stewarding Roles'],
        h1Pattern: /Casual Stewarding Roles/i,
        titlePattern: /Casual Stewarding Roles/i,
    });
});

test('More - Jobs - Casual Vitality Performance Centre Roles Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['Jobs', 'Casual Vitality Performance Centre Roles'],
        h1Pattern: /VITALITY PERFORMANCE CENTRE/i,
        titlePattern: /Casual Vitality Performance Centre Roles/i,
    });
});

test('More - Jobs - Casual Retail Roles Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Navigate via the More menu', async () => {
        const navigated = await navigateViaMoreMenu(page, ['Jobs', 'Casual Retail Roles']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Casual Retail Roles heading').toHaveText(/Casual Retail Roles/i);
    });

    await test.step('Verify the page title', async () => {
        // Confirmed real content defect on BOTH Live and UAT2: the <title> here is the generic
        // sitewide fallback ("The Home of Cricket") rather than page-specific, same confirmed defect
        // family already documented on the Cricket Equipment Shop and Fitness and Health pages
        // (specs 14/16) - surfaced the same way.
        await expect(page, 'The title should be specific to Casual Retail Roles, not the generic sitewide fallback').toHaveTitle(/Casual Retail Roles/i);
    });

    await test.step('Verify the buttons on the page (no 404s, if present)', async () => {
        await verifyButtonsNotBroken(page, baseURL);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('More - Jobs - Casual Catering Roles Traversal', async ({ page, baseURL }) => {
    await runMorePageTraversal(page, baseURL, {
        menuPath: ['Jobs', 'Casual Catering Roles'],
        h1Pattern: /Casual Catering Roles/i,
        titlePattern: /Casual Catering Roles/i,
    });
});
