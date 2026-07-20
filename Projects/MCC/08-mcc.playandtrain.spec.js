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
// Coverage notes - "Play & Train" meganav section (4th top-level menu item)
// ============================================================================
// Scope: every item under "Play & Train" - Vitality Performance Centre,
// Cricket Coaching, Private Hire, Cricket Equipment Shop, HOAM Coffee Shop
// (also tested thinly from the Visit Lord's menu in
// 05-mcc.visitlords.spec.js, since it's a duplicate meganav entry - full
// depth lives here), and Fitness and Health.
//
// Tests in this file (6 total):
//   - Vitality Performance Centre Traversal
//   - Cricket Coaching Traversal
//   - Private Hire Traversal
//   - Cricket Equipment Shop Traversal (also reachable from the Shop menu -
//     see 10-mcc.shop.spec.js, which duplicates this same destination
//     deliberately, per Hector)
//   - HOAM Coffee Shop Traversal
//   - Fitness and Health Traversal
//
// Environment status: this whole section was originally built Live-only
// because "Play & Train" was entirely absent from UAT2's meganav (confirmed
// 404 on all 6 destination URLs as of 2026-07-13). Re-verified 2026-07-17,
// as part of the Live -> UAT2 content sync: **the whole section is now
// fully present on UAT2 too** (menu item, all 6 URLs return 200) - every
// test's presence-gating navigation (try the real meganav first, skip if
// not found) meant this file needed zero code changes to start running for
// real there.
//
// Confirmed CURRENT defects, present on BOTH Live and UAT2, left as
// deliberately failing assertions (not worked around):
//   - Cricket Equipment Shop and Fitness and Health both show the generic
//     sitewide fallback <title> ("The Home of Cricket") instead of a
//     page-specific one.
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

async function waitForAndDismissPreferenceCenter(page) {
    const preferenceCenterBackdrop = page.locator('.onetrust-pc-dark-filter').first();
    const appeared = await preferenceCenterBackdrop.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false);
    if (appeared) {
        await dismissCookieOverlayIfPresent(page);
    }
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

    if (await desktopSponsorsLink.isVisible().catch(() => false)) {
        await desktopSponsorsLink.scrollIntoViewIfNeeded();
        const naturalWidth = await desktopSponsorsLink.locator('img').first().evaluate((img) => img.naturalWidth);
        expect(naturalWidth, 'The sponsors logo image should load with real dimensions (0 means it failed to load)').toBeGreaterThan(0);
    } else {
        await expect(mobileSponsorsLink, 'A "View our partners" link should be present on mobile/tablet').toBeVisible();
    }

    const footer = page.locator('footer.footer').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'The standard MCC footer should be visible at the bottom of the page').toBeVisible();
}

// Confirmed real UI facts: the top-level "Play & Train" meganav link is a bare `href="#"` (JS-driven
// reveal, not a real navigation), and OneTrust's Privacy Preference Center backdrop can flash open
// asynchronously right after a fresh page load and block the hover/click - dismissed first, same
// technique already documented elsewhere in this project for meganav-driven navigation.
// Desktop renders the meganav bar directly; tablet/mobile collapse the entire thing behind a
// `.header__hamburger` icon (confirmed the same way spec 02's meganav suite already documents this) -
// it has to be opened first there, and both the root item and its submenu items need a JS-dispatched
// click rather than a real pointer click, since the touch layout is a vertical accordion where an
// already-open section pushes later items down the page (a real click can land on the
// now-shifted-away element).
async function navigateViaPlayAndTrainMenu(page, submenuText) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);

    const isDesktopMeganav = !(await page.locator('.header__hamburger').first().isVisible().catch(() => false));
    if (!isDesktopMeganav) {
        const hamburger = page.locator('.header__hamburger').first();
        await clickWithCookieGuard(page, hamburger);
        await page.locator('.meganav .mainLevel').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
    }

    // Confirmed real DOM fact: several meganav links (including this menu's own top-level entry and
    // at least one of its submenu items) have a hidden duplicate elsewhere in the DOM - filtering to
    // `:visible` before `.first()` avoids resolving to the wrong (zero-size, non-interactable) copy.
    const topLevelLink = page.locator('.meganav a:visible', { hasText: /play\s*(&|and)\s*train/i }).first();
    if ((await topLevelLink.count()) === 0) {
        return false;
    }

    await topLevelLink.scrollIntoViewIfNeeded();
    if (isDesktopMeganav) {
        await topLevelLink.hover();
        await page.waitForTimeout(400);
        await clickWithCookieGuard(page, topLevelLink);
    } else {
        await topLevelLink.evaluate((el) => el.click());
    }
    await page.waitForTimeout(400);

    const submenuLink = page.locator('.meganav a:visible', { hasText: submenuText }).first();
    if ((await submenuLink.count()) === 0) {
        return false;
    }

    await submenuLink.scrollIntoViewIfNeeded();
    if (isDesktopMeganav) {
        await clickWithCookieGuard(page, submenuLink);
    } else {
        await submenuLink.evaluate((el) => el.click());
    }
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndDismissPreferenceCenter(page);
    await dismissCookieOverlayIfPresent(page);
    return true;
}

// Same single-open `.inlineAccordion__itemHandle` component already documented for Debentures/
// Seasonal Suites/Old Clock Tower Club forms and the Conferences and Events Capacity Overview
// accordion (opening a new item auto-collapses whichever one was previously open). Uses expect.soft()
// given each of these 3 "hub" pages carries 9 FAQ items - enough that one malformed item shouldn't
// blank out coverage of the rest, matching this project's established convention for larger accordion
// sets. Same click-race already documented for this accordion family elsewhere in this project (specs
// 08/12/13) is guarded against with a settle pause before every click.
async function testSingleOpenAccordion(page, labels) {
    for (const label of labels) {
        await test.step(`Expand and collapse "${label}"`, async () => {
            const header = page.locator('.inlineAccordion__itemHandle:visible', { hasText: label }).first();
            await header.scrollIntoViewIfNeeded();

            await dismissCookieOverlayIfPresent(page);
            await page.waitForTimeout(300);
            await header.evaluate((el) => el.click());
            expect.soft(await header.evaluate((el) => el.className.includes('collapsed')), `"${label}" should show the expanded (-) state after clicking`).toBe(false);

            // The "collapsed" class itself flips instantly on click, but the content's own visibility
            // can lag slightly behind it (same real timing gap already documented for this accordion
            // family in spec 12) - waited on explicitly rather than checked immediately.
            const targetSelector = await header.getAttribute('data-target');
            await page.locator(targetSelector).waitFor({ state: 'visible', timeout: 3000 }).catch(() => { });
            expect.soft(await page.locator(targetSelector).isVisible(), `"${label}"'s content should be visible once expanded`).toBe(true);

            await page.waitForTimeout(400);
            await header.evaluate((el) => el.click());
            expect.soft(await header.evaluate((el) => el.className.includes('collapsed')), `"${label}" should return to the collapsed (+) state after clicking again`).toBe(true);
        });
    }
}

// Confirmed hover mechanism for `.ctaTile--panel` cards (same variant/technique already documented on
// Tours & Museum, spec 09): the generic `.ctaTile:hover` box-shadow rule applies, while the image-zoom
// rule is deliberately overridden to a no-op for this variant - so box-shadow is the real, observable
// effect to check, not image scale.
async function verifyPanelCardHover(cardLocator) {
    const before = await cardLocator.evaluate((el) => getComputedStyle(el).boxShadow);
    await cardLocator.hover();
    await cardLocator.page().waitForTimeout(300);
    const after = await cardLocator.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(after, 'The card should visually change (box-shadow) on hover').not.toBe(before);
}

// Per Hector's instruction to confirm "no 404 for cards linking to pages": every `.ctaTile--panel`
// card on these pages links to a real destination (some internal, some external, e.g. the digital
// coaching platform) - verified via a direct request rather than a full click-through-and-back cycle
// for each one, since these hub pages can carry several cards each and a full traversal into every
// single destination isn't what was asked for here (only the immediate submenu pages get their own
// traversal). Also checks each card's hover effect while iterating, per Hector's other explicit ask.
async function verifyCardsNotBrokenWithHover(page, baseURL) {
    const cards = await page.locator('.ctaTile--panel').evaluateAll((els) => els.map((el) => ({
        title: el.querySelector('.ctaTile__title')?.textContent.trim(),
        href: el.querySelector('a.ctaTile__link')?.getAttribute('href'),
    })));
    expect(cards.length, 'There should be at least one card on this page').toBeGreaterThan(0);

    for (const card of cards) {
        await test.step(`"${card.title}" card`, async () => {
            const cardLocator = page.locator('.ctaTile--panel', { hasText: card.title }).first();
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

// Same proven ytm-skin play/fullscreen/pause sequence already used successfully across this project
// (most recently Conferences and Events, spec 13, itself adapted from Tours & Museum, spec 09).
async function testYouTubeVideo(page) {
    const videoIframe = page.locator('iframe[src*="youtube"]').first();
    if ((await videoIframe.count()) === 0) {
        return;
    }

    const videoFrame = page.frameLocator('iframe[src*="youtube"]').first();
    await videoIframe.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    const playButton = videoFrame.locator('.ytmCuedOverlayPlayButton').first();
    if ((await playButton.count()) === 0) {
        return;
    }

    await playButton.click({ timeout: 15000 });
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

test('Play and Train - Vitality Performance Centre Traversal', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Navigate via the Play & Train menu', async () => {
        const navigated = await navigateViaPlayAndTrainMenu(page, 'Vitality Performance Centre');
        test.skip(!navigated, 'The Play & Train menu doesn\'t exist on this environment yet - confirmed absent on UAT2 as of 2026-07-13, present on Live.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Vitality Performance Centre heading').toHaveText(/Vitality Performance Centre/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference the Vitality Performance Centre').toHaveTitle(/Vitality Performance Centre/i);
    });

    await test.step('Play the intro YouTube video (if present)', async () => {
        await testYouTubeVideo(page);
    });

    await test.step('Test the FAQ accordion', async () => {
        const labels = await page.locator('.inlineAccordion__itemHandle:visible').evaluateAll((els) => els.map((el) => el.textContent.trim()));
        expect(labels.length, 'There should be at least one FAQ item').toBeGreaterThan(0);
        await testSingleOpenAccordion(page, labels);
    });

    await test.step('Verify the cards linking to the other Play & Train pages (hover effect + no 404s)', async () => {
        await verifyCardsNotBrokenWithHover(page, baseURL);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Play and Train - Cricket Coaching Traversal', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Navigate via the Play & Train menu', async () => {
        const navigated = await navigateViaPlayAndTrainMenu(page, 'Cricket Coaching');
        test.skip(!navigated, 'The Play & Train menu doesn\'t exist on this environment yet - confirmed absent on UAT2 as of 2026-07-13, present on Live.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Cricket Coaching heading').toHaveText(/Cricket Coaching/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference Cricket Coaching').toHaveTitle(/Cricket Coaching/i);
    });

    await test.step('Test the FAQ accordion', async () => {
        const labels = await page.locator('.inlineAccordion__itemHandle:visible').evaluateAll((els) => els.map((el) => el.textContent.trim()));
        expect(labels.length, 'There should be at least one FAQ item').toBeGreaterThan(0);
        await testSingleOpenAccordion(page, labels);
    });

    await test.step('Verify the cards linking to the coaching sub-pages (hover effect + no 404s)', async () => {
        await verifyCardsNotBrokenWithHover(page, baseURL);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Play and Train - Private Hire Traversal', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Navigate via the Play & Train menu', async () => {
        const navigated = await navigateViaPlayAndTrainMenu(page, 'Private Hire');
        test.skip(!navigated, 'The Play & Train menu doesn\'t exist on this environment yet - confirmed absent on UAT2 as of 2026-07-13, present on Live.');
    });

    await test.step('Verify the H1', async () => {
        // Confirmed real content fact: the menu label reads "Private Hire" but the destination
        // page's own H1/title both read "Private Bookings" - a genuine, harmless naming difference
        // between the nav label and the page content, not a bug.
        await expect(page.locator('h1').first(), 'The page should show the Private Bookings heading').toHaveText(/Private Bookings/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference Private Bookings').toHaveTitle(/Private Bookings/i);
    });

    await test.step('Test the FAQ accordion', async () => {
        const labels = await page.locator('.inlineAccordion__itemHandle:visible').evaluateAll((els) => els.map((el) => el.textContent.trim()));
        expect(labels.length, 'There should be at least one FAQ item').toBeGreaterThan(0);
        await testSingleOpenAccordion(page, labels);
    });

    await test.step('Verify the cards linking to the private hire sub-pages (hover effect + no 404s)', async () => {
        await verifyCardsNotBrokenWithHover(page, baseURL);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Play and Train - Cricket Equipment Shop Traversal', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Navigate via the Play & Train menu', async () => {
        const navigated = await navigateViaPlayAndTrainMenu(page, 'Cricket Equipment Shop');
        test.skip(!navigated, 'The Play & Train menu doesn\'t exist on this environment yet - confirmed absent on UAT2 as of 2026-07-13, present on Live.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Cricket Equipment heading').toHaveText(/Cricket Equipment/i);
    });

    await test.step('Verify the page title', async () => {
        // Confirmed real content defect on Live: this page's <title> is the generic sitewide
        // fallback ("The Home of Cricket") rather than anything page-specific - a real, missing
        // custom-title gap, surfaced here as a deliberately failing assertion rather than worked
        // around, same "surface, don't mask" convention as every other confirmed defect in this
        // project.
        await expect(page, 'The title should be specific to the Cricket Equipment Shop, not the generic sitewide fallback').toHaveTitle(/Cricket Equipment/i);
    });

    await test.step('Play the intro YouTube video (if present)', async () => {
        await testYouTubeVideo(page);
    });

    await test.step('Follow the "Lord\'s Store" button', async () => {
        const storeButton = page.locator('a.button', { hasText: /Lord's Store/i }).first();
        await storeButton.scrollIntoViewIfNeeded();
        const href = await storeButton.getAttribute('href');
        await clickWithCookieGuard(page, storeButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).host, 'Lord\'s Store should navigate to the store subdomain').toBe(new URL(href).host);

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenter(page);
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Follow the View Gallery button and test the overlay', async () => {
        const galleryButton = page.locator('a.button--gallery', { hasText: /view gallery/i }).first();
        await galleryButton.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, galleryButton);

        const modal = page.locator('.gallery-modal.is-visible').first();
        await expect(modal, 'The gallery overlay should open').toBeVisible();

        const closeButton = modal.locator('.gallery-modal__close').first();
        const imageCount = await modal.locator('.gallery-modal__items img').count();

        if (imageCount === 0) {
            await closeButton.click();
            await expect(modal, 'The gallery overlay should close').toBeHidden();
            return;
        }

        const thumbnailsContainerCount = await modal.locator('.gallery-modal__thumbnails').count();
        if (thumbnailsContainerCount > 0) {
            const thumbnailCount = await modal.locator('.gallery-modal__thumbnails img').count();
            expect(thumbnailCount, 'The thumbnail strip should mirror the main image count').toBe(imageCount);
        }

        const mainNext = modal.locator('.gallery-modal__items .slick-next');
        const mainPrev = modal.locator('.gallery-modal__items .slick-prev');

        await expect(mainPrev, 'The previous arrow should start disabled').toHaveAttribute('aria-disabled', 'true');

        let clicks = 0;
        while ((await mainNext.getAttribute('aria-disabled')) === 'false' && clicks < imageCount + 2) {
            await mainNext.click();
            await page.waitForTimeout(800);
            clicks += 1;
        }

        expect(clicks, 'Clicking through the gallery should not run away without reaching the end').toBeLessThan(imageCount + 2);
        await expect(mainNext, 'The next arrow should become disabled once the last image is reached').toHaveAttribute('aria-disabled', 'true');
        await expect(mainPrev, 'The previous arrow should remain enabled at the end of the gallery').toHaveAttribute('aria-disabled', 'false');

        await closeButton.click();
        await expect(modal, 'The gallery overlay should close').toBeHidden();
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Play and Train - HOAM Coffee Shop Traversal', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Navigate via the Play & Train menu', async () => {
        const navigated = await navigateViaPlayAndTrainMenu(page, 'HOAM Coffee Shop');
        test.skip(!navigated, 'The Play & Train menu doesn\'t exist on this environment yet - confirmed absent on UAT2 as of 2026-07-13, present on Live.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the HOAM Coffee Shop heading').toHaveText(/HOAM Coffee Shop/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference the HOAM Coffee Shop').toHaveTitle(/HoAM|Coffee Shop/i);
    });

    await test.step('Verify the page body content', async () => {
        // This is the simplest page in this file - no video, accordion, cards, or even a body image
        // were found here (confirmed directly, not assumed - the only "image" on this page is the
        // sponsors logo in the footer) - just wysiwyg text content describing the coffee shop.
        const bodyText = await page.locator('.oneColumnContentRow__wysiwyg, .wysiwyg').first().textContent();
        expect(bodyText.toLowerCase(), 'The page should describe HoAM').toContain('hoam');
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Play and Train - Fitness and Health Traversal', async ({ page, context }) => {
    test.setTimeout(120000);

    await test.step('Navigate via the Play & Train menu', async () => {
        const navigated = await navigateViaPlayAndTrainMenu(page, 'Fitness and Health');
        test.skip(!navigated, 'The Play & Train menu doesn\'t exist on this environment yet - confirmed absent on UAT2 as of 2026-07-13, present on Live.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Fitness and Health heading').toHaveText(/Fitness and Health/i);
    });

    await test.step('Verify the page title', async () => {
        // Same confirmed real content defect as the Cricket Equipment Shop page - the <title> here is
        // also the generic sitewide fallback rather than page-specific, surfaced the same way.
        await expect(page, 'The title should be specific to Fitness and Health, not the generic sitewide fallback').toHaveTitle(/Fitness (and|&) Health/i);
    });

    await test.step('Verify the "Lord\'s Performance Centre Gym" section and its Fit With Me buttons', async () => {
        await expect(page.getByRole('heading', { name: /Lord's Performance Centre Gym/i }).first(), 'The gym section heading should be visible').toBeVisible();

        const buttons = await page.locator('a.button[href*="fitwithme"]').evaluateAll((els) => els.map((el) => el.textContent.trim()));
        expect(buttons.length, 'There should be at least one Fit With Me button').toBeGreaterThan(0);

        for (const buttonText of buttons) {
            await test.step(`"${buttonText}" button`, async () => {
                const button = page.locator('a.button[href*="fitwithme"]', { hasText: buttonText }).first();
                await button.scrollIntoViewIfNeeded();
                const href = await button.getAttribute('href');

                const [popup] = await Promise.all([
                    context.waitForEvent('page'),
                    clickWithCookieGuard(page, button),
                ]);
                await popup.waitForLoadState('domcontentloaded').catch(() => { });
                expect(new URL(popup.url()).host, `${buttonText} should open the external Fit With Me site`).toBe(new URL(href).host);
                await popup.close();
            });
        }
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});
