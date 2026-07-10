const { test, expect } = require('@playwright/test');

// This spec covers the Plan Your Day core page (/lords/match-day/plan-your-day). Some checks are
// environment-aware (UAT2 vs Live render a couple of things differently) - see the individual
// helpers/steps below for what varies and why.

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function isUatEnvironment(baseURL) {
    return /uat/i.test(new URL(baseURL).hostname);
}

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

    const preferenceCenterBackdrop = page.locator('.onetrust-pc-dark-filter').first();
    if (await preferenceCenterBackdrop.isVisible().catch(() => false)) {
        // See waitForAndDismissPreferenceCenter below - the backdrop's own fade-in can still be
        // intercepting its close button at the instant this reactive check fires.
        await page.waitForTimeout(600);
        const closeButton = page.locator('#close-pc-btn-handler').first();
        await closeButton.click({ timeout: 3000 }).catch(() => closeButton.click({ force: true, timeout: 3000 }).catch(() => { }));
        await preferenceCenterBackdrop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
    }
}

// OneTrust's "Privacy Preference Center" modal (a different UI from the main consent banner) can
// flash open asynchronously after a navigation - not just meganav click-throughs, also confirmed
// after ordinary external-link-then-goBack() navigations - even when consent was already accepted
// earlier in the session. A single instant isVisible() check races it; wait explicitly.
async function waitForAndDismissPreferenceCenter(page) {
    const backdrop = page.locator('.onetrust-pc-dark-filter').first();
    const appeared = await backdrop.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false);

    if (appeared) {
        // The backdrop fades in (a CSS transition) and sits above its own close button while doing
        // so, so a click attempted the instant it appears gets intercepted by the still-animating
        // backdrop itself - let it settle, then force the click as a safety net either way.
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

async function openPage(page, path) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
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

// Content-area links only - excludes the meganav (which also has an unrelated "Volunteer" link
// under Jobs) and the footer, so ordinal indexing matches the actual visual top-to-bottom order.
function contentLinksByText(page, pattern) {
    return page.locator('a:not(header a):not(footer a):not(.meganav a)').filter({ hasText: pattern });
}

async function verifySponsorsAndFooter(page) {
    // The sponsors logo strip is a single image inside a single link to /information/sponsors (not
    // several individually-clickable icons - traversal into that destination is separate future
    // work). On UAT2 that image is currently broken (fails to load, naturalWidth stays 0) - left as
    // a deliberate failing assertion, not worked around, until the site fixes it. Only applies on
    // desktop; tablet/mobile show a plain "View our partners" text link instead with no image to check.
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

// Unlike the Getting To Lord's travel accordions (which can all be open simultaneously), this
// component only ever keeps one item open at a time - opening a new item auto-collapses whichever
// one was previously open. Confirmed via direct testing: there's no `data-parent` attribute in the
// markup (which is what native Bootstrap collapse normally uses for this), so the single-open
// behavior here must be driven by the page's own custom JS instead - worth remembering if a future
// accordion on this site behaves unexpectedly, since the markup alone doesn't reveal which mode it's in.
async function testSingleOpenAccordionBlock(page, { headerSelector, labels }) {
    let previousItem = null;

    for (const label of labels) {
        await test.step(`Open ${label}`, async () => {
            const header = page.locator(headerSelector, { hasText: label }).first();
            await header.scrollIntoViewIfNeeded();
            await expect(header, `${label} should start collapsed (showing the + state)`).toHaveClass(/collapsed/);

            await dismissCookieOverlayIfPresent(page);
            await page.waitForTimeout(400);
            await header.evaluate((el) => el.click());
            await expect(header, `${label} should show the expanded (-) state after clicking`).not.toHaveClass(/collapsed/);

            const targetSelector = await header.getAttribute('data-target');
            await expect(page.locator(targetSelector), `${label}'s content should be visible once expanded`).toBeVisible();

            if (previousItem) {
                await expect(previousItem.header, `${previousItem.label} should auto-collapse once ${label} opens`).toHaveClass(/collapsed/);
                await expect(page.locator(previousItem.targetSelector), `${previousItem.label}'s content should hide once ${label} opens`).toBeHidden();
            }

            previousItem = { header, label, targetSelector };
        });
    }

    await test.step(`Close ${previousItem.label} (self-toggle)`, async () => {
        await dismissCookieOverlayIfPresent(page);
        await page.waitForTimeout(400);
        await previousItem.header.evaluate((el) => el.click());
        await expect(previousItem.header, `${previousItem.label} should return to the collapsed (+) state after clicking again`).toHaveClass(/collapsed/);
        await expect(page.locator(previousItem.targetSelector), `${previousItem.label}'s content should be hidden once collapsed`).toBeHidden();
    });
}

// Clicks an accordion header and confirms its collapsed/expanded state actually toggled, retrying
// once if not. The Food & Drink page has far more accordion blocks in play at once than any other
// page in this project (dozens, vs a handful elsewhere) and a plain 400ms settle delay (reliable
// everywhere else) was observed to occasionally still not be enough here - the click can land while a
// neighbouring block's own transition is mid-reflow and get silently ignored, same family of timing
// race as Bootstrap's collapse.js issue documented on the Getting To Lord's accordions.
async function clickAccordionHeaderReliably(page, header) {
    const wasCollapsed = await header.evaluate((el) => el.classList.contains('collapsed'));

    await dismissCookieOverlayIfPresent(page);
    await page.waitForTimeout(600);
    await header.evaluate((el) => el.click());
    await page.waitForTimeout(300);

    const toggled = await header.evaluate((el) => el.classList.contains('collapsed')).catch(() => wasCollapsed);
    if (toggled === wasCollapsed) {
        await page.waitForTimeout(400);
        await header.evaluate((el) => el.click());
    }
}

// Index-based sibling of testSingleOpenAccordionBlock, for pages where the accordion items
// themselves aren't a small, stable, hand-writable list (the Food & Drink outlets accordions list
// dozens of vendor names that differ completely between UAT2 and Live, and some names repeat across
// different blocks on the same page, e.g. "West Cornwall Pasty Co." appears in two separate UAT2
// blocks - text-based `hasText` matching would collide there). Takes a `blockLocator` scoping every
// lookup to one specific accordion container, so identical labels in other blocks can't interfere.
async function testAccordionBlockByIndex(page, blockLocator) {
    const headers = blockLocator.locator('.inlineAccordion__itemHandle:visible');
    const itemCount = await headers.count();
    let previousItem = null;

    for (let index = 0; index < itemCount; index += 1) {
        const header = headers.nth(index);
        const label = (await header.textContent()).trim();

        await test.step(`Open "${label}"`, async () => {
            // Soft assertions throughout this step, deliberately: with dozens of items in play on
            // this page (unlike the small hand-counted accordions elsewhere in this file), one
            // malformed item shouldn't abort coverage of every item after it - a real instance of
            // this was found and confirmed on Live ("Harris Garden Bar"'s data-target points at an
            // id that doesn't exist anywhere in the DOM, so its trigger is permanently non-functional
            // - a genuine broken accordion item in the CMS content, not a test timing issue).
            await header.scrollIntoViewIfNeeded();
            expect.soft(await header.evaluate((el) => el.classList.contains('collapsed')), `"${label}" should start collapsed (showing the + state)`).toBe(true);

            await clickAccordionHeaderReliably(page, header);

            const targetSelector = await header.getAttribute('data-target');
            const targetExists = (await page.locator(targetSelector).count()) > 0;
            expect.soft(targetExists, `"${label}"'s data-target ("${targetSelector}") should point at a real element in the DOM`).toBe(true);

            if (targetExists) {
                await expect.soft(header, `"${label}" should show the expanded (-) state after clicking`).not.toHaveClass(/collapsed/);
                await expect.soft(page.locator(targetSelector), `"${label}"'s content should be visible once expanded`).toBeVisible();
            }

            if (previousItem) {
                await expect.soft(previousItem.header, `"${previousItem.label}" should auto-collapse once "${label}" opens`).toHaveClass(/collapsed/);
                await expect.soft(page.locator(previousItem.targetSelector), `"${previousItem.label}"'s content should hide once "${label}" opens`).toBeHidden();
            }

            previousItem = { header, label, targetSelector };
        });
    }

    if (!previousItem) {
        return;
    }

    await test.step(`Close "${previousItem.label}" (self-toggle)`, async () => {
        await clickAccordionHeaderReliably(page, previousItem.header);
        await expect.soft(previousItem.header, `"${previousItem.label}" should return to the collapsed (+) state after clicking again`).toHaveClass(/collapsed/);
        await expect.soft(page.locator(previousItem.targetSelector), `"${previousItem.label}"'s content should be hidden once collapsed`).toBeHidden();
    });
}

// Discovers every accordion block on the page dynamically (no hardcoded vendor/outlet names, since
// the Food & Drink page's outlet list is completely different - both in content and in how many
// blocks/items exist - between UAT2 and Live, and will keep changing as outlets rotate). Blocks
// nested inside a "tabccordion" (see below) are skipped here since testFoodDrinkTabAccordions
// already exercises them via their own Food/Drinks tab switch.
async function testAllStandaloneAccordionBlocks(page) {
    const allBlocks = page.locator('.inlineAccordion');
    const blockCount = await allBlocks.count();

    for (let index = 0; index < blockCount; index += 1) {
        const block = allBlocks.nth(index);
        const isInsideTabAccordion = await block.evaluate((el) => Boolean(el.closest('.tabccordion')));
        if (isInsideTabAccordion) {
            continue;
        }

        const itemCount = await block.locator('.inlineAccordion__itemHandle:visible').count();
        if (itemCount === 0) {
            // A handful of these containers render with zero visible items (confirmed via direct
            // inspection - likely an unused/hidden responsive-duplicate slot, same family of harmless
            // CMS template noise as the empty placeholder accordion panes found elsewhere in this
            // project) - nothing to test.
            continue;
        }

        await test.step(`Accordion block ${index + 1} (${itemCount} item${itemCount === 1 ? '' : 's'})`, async () => {
            await testAccordionBlockByIndex(page, block);
        });
    }
}

// "tabccordion" components (Live-only so far, per Hector: "eventually we will also have this in
// UAT2") pair a Food/Drinks Bootstrap tab switch with a separate accordion nested inside each tab
// pane - confirmed there are 5 of these on Live's Food & Drink page, each holding its own Food-tab
// accordion and Drinks-tab accordion. On environments without this component the locator simply
// resolves to zero elements and this is a no-op.
async function testFoodDrinkTabAccordions(page) {
    const tabAccordions = page.locator('.tabccordion:visible');
    const tabGroupCount = await tabAccordions.count();

    for (let index = 0; index < tabGroupCount; index += 1) {
        const tabGroup = tabAccordions.nth(index);

        await test.step(`Food/Drinks tab group ${index + 1}`, async () => {
            const foodTab = tabGroup.locator('.tabccordion__tabs a', { hasText: /^Food$/i }).first();
            const drinksTab = tabGroup.locator('.tabccordion__tabs a', { hasText: /^Drinks$/i }).first();

            await foodTab.scrollIntoViewIfNeeded();
            await expect(foodTab, 'The Food tab should be active by default').toHaveClass(/active/);
            await expect(tabGroup.locator('.tabccordion__item.active').first(), 'The Food pane should be visible by default').toBeVisible();

            await test.step('Test the Food tab\'s accordion', async () => {
                await testAccordionBlockByIndex(page, tabGroup.locator('.tabccordion__item.active .inlineAccordion').first());
            });

            await dismissCookieOverlayIfPresent(page);
            await page.waitForTimeout(400);
            await drinksTab.evaluate((el) => el.click());
            await expect(drinksTab, 'The Drinks tab should become active after clicking').toHaveClass(/active/);
            await expect(foodTab, 'The Food tab should no longer be active').not.toHaveClass(/active/);
            await expect(tabGroup.locator('.tabccordion__item.active').first(), 'The Drinks pane should be visible after switching').toBeVisible();

            await test.step('Test the Drinks tab\'s accordion', async () => {
                await testAccordionBlockByIndex(page, tabGroup.locator('.tabccordion__item.active .inlineAccordion').first());
            });

            // Leave the tab group back in its default (Food) state, matching the convention
            // elsewhere in this file of returning interactive components to how they started.
            await dismissCookieOverlayIfPresent(page);
            await page.waitForTimeout(400);
            await foodTab.evaluate((el) => el.click());
            await expect(foodTab, 'The Food tab should be active again after switching back').toHaveClass(/active/);
        });
    }
}

// The Food & Drink hero's "View Gallery" overlay is a Slick-carousel lightbox (main image +
// synced thumbnail strip, each with its own prev/next arrow pair). Confirmed via direct testing:
// on UAT2 the overlay opens but has zero images configured yet (Hector: "we have not yet set
// images") - the gallery is otherwise fully wired up on Live with 10 real images. Rather than fail
// on UAT2's empty state, this verifies the overlay opens and closes cleanly there and skips the
// carousel assertions; where images are present, it clicks through the main image carousel to the
// end and back. A hasty 400ms settle delay between clicks was observed to silently swallow every
// other click here (Slick's own animation guard, same family of issue as Bootstrap's collapse.js
// timing race found earlier in this project) - confirmed 800ms is reliable instead.
async function testFoodDrinkGallery(page) {
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

    // Confirmed via direct testing: the thumbnail strip container isn't rendered at all on tablet/
    // mobile viewports (not just CSS-hidden - `.gallery-modal__thumbnails` is absent from the DOM
    // entirely there), a deliberate responsive simplification for narrower screens, not a defect.
    // Only verify it where it actually exists.
    const thumbnailsContainerCount = await modal.locator('.gallery-modal__thumbnails').count();
    if (thumbnailsContainerCount > 0) {
        const thumbnailCount = await modal.locator('.gallery-modal__thumbnails img').count();
        expect(thumbnailCount, 'The thumbnail strip should mirror the main image count').toBe(imageCount);
        await expect(modal.locator('.gallery-modal__thumbnails .slick-prev'), 'The thumbnail strip should have its own previous arrow').toBeAttached();
        await expect(modal.locator('.gallery-modal__thumbnails .slick-next'), 'The thumbnail strip should have its own next arrow').toBeAttached();
    }

    const mainNext = modal.locator('.gallery-modal__items .slick-next');
    const mainPrev = modal.locator('.gallery-modal__items .slick-prev');

    await expect(mainPrev, 'The previous arrow should start disabled').toHaveAttribute('aria-disabled', 'true');
    await expect(mainNext, 'The next arrow should start enabled').toHaveAttribute('aria-disabled', 'false');

    let clicks = 0;
    while ((await mainNext.getAttribute('aria-disabled')) === 'false' && clicks < imageCount + 2) {
        await mainNext.click();
        await page.waitForTimeout(800);
        clicks += 1;

        if (clicks === 1) {
            await expect(mainPrev, 'The previous arrow should become enabled after the first click').toHaveAttribute('aria-disabled', 'false');
        }
    }

    expect(clicks, 'Clicking through the gallery should not run away without reaching the end').toBeLessThan(imageCount + 2);
    await expect(mainNext, 'The next arrow should become disabled once the last image is reached').toHaveAttribute('aria-disabled', 'true');
    await expect(mainPrev, 'The previous arrow should remain enabled at the end of the gallery').toHaveAttribute('aria-disabled', 'false');

    await closeButton.click();
    await expect(modal, 'The gallery overlay should close').toBeHidden();
}

// The "<year> International Fixtures" section (a `.whatsOnRow` Swiper carousel of fixture cards,
// plus a "View all fixtures" button) is the exact same shared component on both the What To Bring
// and What To Wear pages - same card-hover zoom, same arrow reveal-on-hover behaviour, same
// touch-viewport limitations, same hardcoded absolute "View all fixtures" URL. See the original
// investigation notes in project memory for why touch viewports are skipped and why a plain 400ms
// settle delay isn't used here.
async function testInternationalFixturesSection(page) {
    // The year in this heading is whatever season is currently live (UAT2 currently shows 2025,
    // Live currently shows 2026) - match the stable part of the text only, not the year itself.
    const fixturesHeading = page.getByRole('heading', { level: 2, name: /international fixtures/i }).first();
    await fixturesHeading.scrollIntoViewIfNeeded();
    await expect(fixturesHeading, 'The page should show a "<year> International Fixtures" heading').toBeVisible();

    const swiperWrap = page.locator('.whatsOnRow__swiperWrap').first();
    const cards = page.locator('.whatsOnRow__item');
    const cardCount = await cards.count();
    expect(cardCount, 'The fixtures carousel should show at least one fixture card').toBeGreaterThan(0);

    // Both the card zoom-on-hover effect and the arrow reveal-on-hover behaviour described here
    // are mouse-only interactions with no touch equivalent - and on touch viewports this Swiper
    // carousel was observed to behave fundamentally differently anyway (tablet needed far more
    // than the number of clicks Live's card count should require to reach the end, and mobile's
    // "next" arrow never disabled at all after 40+ clicks - it relies on swipe gestures instead,
    // not a disable-at-the-end button pair). Only exercise the hover/click interaction on desktop.
    const projectUse = test.info().project.use;
    const isTouchDevice = Boolean(projectUse.isMobile || projectUse.hasTouch);

    if (!isTouchDevice) {
        await test.step('Verify the card hover effect', async () => {
            const firstCard = cards.first();
            const backgroundBefore = await firstCard.evaluate((el) => getComputedStyle(el.querySelector('.ctaTile__background')).transform);
            await firstCard.hover();
            await expect.poll(
                () => firstCard.evaluate((el) => getComputedStyle(el.querySelector('.ctaTile__background')).transform),
                { message: 'Hovering a fixture card should trigger a visible transform effect' },
            ).not.toBe(backgroundBefore);
        });

        const prevArrow = page.locator('.whatsOnRow__swiperArrow--prev').first();
        const nextArrow = page.locator('.whatsOnRow__swiperArrow--next').first();
        const arrowOpacity = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).opacity));

        await swiperWrap.hover();
        await page.waitForTimeout(300);

        await expect.poll(() => arrowOpacity(prevArrow), {
            message: 'The previous arrow should stay hidden at the start of the carousel',
        }).toBeLessThan(0.5);

        const nextOpacityAtStart = await arrowOpacity(nextArrow);

        if (nextOpacityAtStart < 0.5) {
            // Too few cards to overflow the visible area (currently the case on UAT2, which only has
            // 4 fixtures) - the carousel is structurally present but genuinely has nothing to scroll
            // to, matching what was manually confirmed on the site. Nothing further to click here.
            expect(cardCount, 'If the carousel reports no usable next arrow, it should be because there are too few cards to scroll').toBeLessThanOrEqual(4);
        } else {
            // Enough cards to scroll (currently the case on Live) - click through to the end, then
            // verify the arrows swap: previous becomes the only usable control once there's nothing
            // left to reveal on the right.
            await nextArrow.evaluate((el) => el.click());
            await swiperWrap.hover();
            await expect.poll(() => arrowOpacity(prevArrow), {
                message: 'The previous arrow should appear after the first click on next',
            }).toBeGreaterThan(0.5);

            let clicks = 1;
            while ((await arrowOpacity(nextArrow)) > 0.5 && clicks < 20) {
                await nextArrow.evaluate((el) => el.click());
                await swiperWrap.hover();
                await page.waitForTimeout(200);
                clicks += 1;
            }

            expect(clicks, 'Clicking through the carousel should not run away without reaching the end').toBeLessThan(20);
            await expect.poll(() => arrowOpacity(nextArrow), {
                message: 'The next arrow should disappear once the last fixture is reached',
            }).toBeLessThan(0.5);
            await expect.poll(() => arrowOpacity(prevArrow), {
                message: 'The previous arrow should remain usable at the end of the carousel',
            }).toBeGreaterThan(0.5);
        }
    }

    const viewAllButton = page.locator('a', { hasText: /^View all fixtures$/i }).first();
    await viewAllButton.scrollIntoViewIfNeeded();

    // This is a hardcoded absolute production URL, identical on both environments (same pattern
    // already seen for other absolute-URL buttons in this suite) - it opens in the same tab.
    await clickWithCookieGuard(page, viewAllButton);
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);

    await expect(page, 'View All Fixtures should navigate to the Vitality Blast fixtures page').toHaveURL('https://www.lords.org/lords/match-day/fixtures-and-results?type=vitality-blast');

    await page.goBack();
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndDismissPreferenceCenter(page);
    await dismissCookieOverlayIfPresent(page);
}

async function clickContentLinkAndVerify(page, { link, label, expectedPath, baseURL, expectedHeading }) {
    await link.scrollIntoViewIfNeeded();
    await clickWithCookieGuard(page, link);
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);

    await expect(page, `"${label}" should navigate to ${expectedPath}`).toHaveURL(buildExpectedUrl(baseURL, expectedPath));

    const statusCheck = await page.request.get(page.url());
    expect(statusCheck.status(), `"${label}" destination should not return an error status`).toBeLessThan(400);

    if (expectedHeading) {
        await expect(page.locator('h1').first(), `"${label}" destination should show the expected H1`).toHaveText(expectedHeading);
    }

    await page.goBack();
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndDismissPreferenceCenter(page);
    await dismissCookieOverlayIfPresent(page);
}

test('Plan Your Day - Initial Page Checks', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Open the Plan Your Day page', async () => {
        await openPage(page, '/lords/match-day/plan-your-day');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Plan Your Day heading').toHaveText(/Plan Your Day/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        // UAT2 uses one generic document title sitewide ("Lords MCC (UAT)"), so there's nothing
        // page-specific to match there. Live sets a real per-page title, so match against the H1
        // text instead of a fixed string - keeps this working if the exact title wording changes.
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should contain the page name').toHaveTitle(/plan your day/i);
        }
    });

    await test.step('Verify the "Coming to Lord\'s?" heading', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /coming to lord/i }).first(), 'The page should show the Coming to Lord\'s? heading').toBeVisible();
    });

    const videoIframe = page.locator('iframe.embed-responsive-item').first();
    const videoFrame = page.frameLocator('iframe.embed-responsive-item').first();

    await test.step('Play the YouTube video', async () => {
        await videoIframe.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        await videoFrame.locator('.ytmCuedOverlayPlayButton').click({ timeout: 15000 });
        await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => !video.paused).catch(() => false), {
            message: 'The video should start playing once the play button is clicked',
        }).toBe(true);
    });

    await test.step('Enter and exit full screen while the video plays', async () => {
        // The player's control bar auto-hides a couple of seconds after the mouse stops moving over
        // it, so hover again immediately before each control interaction rather than once up front.
        await videoIframe.hover();
        await videoFrame.getByRole('button', { name: 'Enter full screen' }).click({ timeout: 5000 });
        await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
            message: 'The page should enter full screen after clicking the full screen control',
        }).toBe(true);
        // Let the fullscreen transition/animation fully settle before interacting again - exiting
        // too soon after entering was observed to silently no-op.
        await page.waitForTimeout(1000);

        await videoIframe.hover();
        await page.waitForTimeout(300);
        await videoFrame.getByRole('button', { name: /exit full ?screen/i }).click({ timeout: 5000 });
        await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
            message: 'The page should leave full screen after clicking full screen again',
        }).toBe(false);
    });

    await test.step('Click the video to pause it', async () => {
        // Let the layout settle after exiting full screen before clicking - the video element's
        // position/size is mid-reflow for a moment right after the transition.
        await page.waitForTimeout(1000);
        await videoFrame.locator('video').first().click({ force: true, timeout: 5000 });
        await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => video.paused).catch(() => false), {
            message: 'The video should pause when clicked',
        }).toBe(true);
    });

    await test.step('Verify the iOS and Android download links', async () => {
        // Link text/labelling differs between UAT2 ("Download iOS"/"Download Android") and Live
        // (icon-only badges with no text) - match by destination URL instead of visible text so
        // this works unchanged in either environment.
        const iosLink = page.locator('a[href*="apps.apple.com"]').first();
        const androidLink = page.locator('a[href*="play.google.com"]').first();

        await iosLink.scrollIntoViewIfNeeded();
        await expect(iosLink, 'An iOS App Store link should be present').toBeVisible();
        await expect(androidLink, 'A Google Play Store link should be present').toBeVisible();
    });

    await test.step('Verify the "Your Day at Lord\'s" heading and panels reveal on scroll', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /your day at lord/i }).first(), 'The page should show the Your Day at Lord\'s heading').toBeVisible();

        const tiles = page.locator('.fadeCtaTile__tile:visible');
        const tileCount = await tiles.count();
        expect(tileCount, 'The Your Day at Lord\'s section should expose at least one panel').toBeGreaterThan(0);

        await tiles.last().scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);

        for (let index = 0; index < tileCount; index += 1) {
            await expect(tiles.nth(index), `Panel ${index + 1} should reveal (fade in) once scrolled into view`).toHaveClass(/fadeCtaTile__tile--fadeIn/);
        }
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Plan Your Day - Things To Do Traversal', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await test.step('Open Plan Your Day and navigate to Things to do', async () => {
        await openPage(page, '/lords/match-day/plan-your-day');

        const thingsToDoLink = page.locator('.fadeCtaTile__tile:visible a.ctaTile__link[href="/lords/match-day/plan-your-day/things-to-do"]').first();
        await thingsToDoLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, thingsToDoLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Clicking Things to do should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/match-day/plan-your-day/things-to-do'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Things to Do heading').toHaveText(/Things to Do/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should at least contain the page name').toHaveTitle(/things to do/i);
        }
    });

    await test.step('Verify the Activities heading', async () => {
        await expect(page.getByRole('heading', { level: 4, name: /^Activities$/i }).first(), 'The page should show the Activities heading').toBeVisible();
    });

    await test.step('Verify the MCC Museum CTA and follow its Read More link', async () => {
        await expect(page.getByRole('heading', { level: 5, name: /mcc museum/i }).first(), 'The MCC Museum heading should be visible').toBeVisible();

        // The raw href is the vanity path "/mcc/heritage-collections/about-the-team", which
        // server-side redirects to "/mcc/heritage-collections/what-we-do" - assert the final
        // (redirected) URL, same convention as other vanity redirects already found in this suite.
        await clickContentLinkAndVerify(page, {
            link: contentLinksByText(page, /read more/i).nth(0),
            label: 'MCC Museum Read More',
            expectedPath: '/mcc/heritage-collections/what-we-do',
            baseURL,
            expectedHeading: /what we do/i,
        });
    });

    await test.step('Verify the "Get close to the players" heading', async () => {
        await expect(page.getByRole('heading', { level: 4, name: /get close to the players/i }).first(), 'The page should show the Get close to the players heading').toBeVisible();
    });

    await test.step('Verify the Bell Ringers heading and follow its Read More link', async () => {
        await expect(page.getByRole('heading', { level: 4, name: /^Bell Ringers$/i }).first(), 'The Bell Ringers heading should be visible').toBeVisible();

        await clickContentLinkAndVerify(page, {
            link: contentLinksByText(page, /read more/i).nth(1),
            label: 'Bell Ringers Read More',
            expectedPath: '/lords/our-history/bell-ringers',
            baseURL,
            expectedHeading: /five-minute bell/i,
        });
    });

    await test.step('Verify the Food & Drink CTA and follow its Read More link', async () => {
        await expect(page.getByRole('heading', { level: 5, name: /food & drink/i }).first(), 'The Food & Drink heading should be visible').toBeVisible();

        // Same vanity-redirect pattern: the raw href is "/lords/match-day/plan-your-day/food-drink",
        // which redirects to "/lords/match-day/food-drink" - assert the final URL.
        await clickContentLinkAndVerify(page, {
            link: contentLinksByText(page, /read more/i).nth(2),
            label: 'Food & Drink Read More',
            expectedPath: '/lords/match-day/food-drink',
            baseURL,
            // UAT2's destination H1 reads "Food & Drink"; Live's reads "Food and Drink" - tolerate both.
            expectedHeading: /food (&|and) drink/i,
        });
    });

    await test.step('Verify the Happy To Help heading and follow its Volunteer link', async () => {
        await expect(page.getByRole('heading', { level: 4, name: /happy to help/i }).first(), 'The Happy To Help heading should be visible').toBeVisible();

        // Known defect, kept as a real target rather than swapped out: this link 404s on UAT2 -
        // see project memory. Same "surface, don't mask" convention as other defects in this suite.
        await clickContentLinkAndVerify(page, {
            link: contentLinksByText(page, /^volunteer$/i).first(),
            label: 'Happy To Help Volunteer',
            expectedPath: '/mcc/careers/volunteer',
            baseURL,
        });
    });

    await test.step('Verify the recurring "Your Day at Lord\'s" section is present', async () => {
        // The link cards here are the same ones covered by "Initial Page Checks" - traversing each
        // of those is separate, already-planned future work, not repeated here.
        await expect(page.getByRole('heading', { level: 2, name: /your day at lord/i }).first(), 'The page should show the Your Day at Lord\'s heading').toBeVisible();
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Plan Your Day - What To Bring Traversal', async ({ page, context, baseURL }) => {
    test.setTimeout(90000);

    await test.step('Open Plan Your Day and navigate to What to Bring', async () => {
        await openPage(page, '/lords/match-day/plan-your-day');

        const whatToBringLink = page.locator('.fadeCtaTile__tile:visible a.ctaTile__link[href="/lords/match-day/plan-your-day/what-to-bring"]').first();
        await whatToBringLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, whatToBringLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Clicking What to Bring should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/match-day/plan-your-day/what-to-bring'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the What to Bring heading').toHaveText(/What to Bring/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should contain the page name').toHaveTitle(/what to bring/i);
        }
    });

    await test.step('Follow the Frequently Asked Questions button', async () => {
        const faqButton = page.locator('a.button', { hasText: /frequently asked questions/i }).first();
        await faqButton.scrollIntoViewIfNeeded();

        await clickContentLinkAndVerify(page, {
            link: faqButton,
            label: 'Frequently Asked Questions',
            expectedPath: '/lords/match-day/plan-your-day/faqs',
            baseURL,
            expectedHeading: /Match Day FAQs/i,
        });
    });

    await test.step('Follow the Match Day Essentials Buy Now button', async () => {
        const essentialsHeading = page.getByRole('heading', { level: 5, name: /match day essentials/i }).first();
        await essentialsHeading.scrollIntoViewIfNeeded();
        await expect(essentialsHeading, 'The Match Day Essentials heading should be visible').toBeVisible();

        // Raw href is the vanity path "/online-store" opened in a new tab (target="_blank"). Where it
        // redirects genuinely differs by environment - not just a same-site vanity path like other
        // redirects in this suite: UAT2 redirects internally to "/store/online-store", while Live
        // redirects out to the separate storefront domain "store.lords.org".
        const buyNowButton = page.locator('a.button', { hasText: /^Buy Now$/i }).first();
        await buyNowButton.scrollIntoViewIfNeeded();

        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, buyNowButton),
        ]);
        await popup.waitForLoadState('load').catch(() => { });

        if (isUatEnvironment(baseURL)) {
            await expect(popup, 'Buy Now should open the store page on UAT2').toHaveURL(buildExpectedUrl(baseURL, '/store/online-store'));
            await expect(popup.locator('h1').first(), 'The UAT2 store page should show the expected H1').toHaveText(/Online Store/i);
        } else {
            expect(new URL(popup.url()).host, 'Buy Now should open the live storefront domain').toBe('store.lords.org');
        }

        await popup.close();
    });

    await test.step('Verify the recurring "Your Day at Lord\'s" section is present', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /your day at lord/i }).first(), 'The page should show the Your Day at Lord\'s heading').toBeVisible();
    });

    await test.step('Verify the International Fixtures heading, carousel, and View All Fixtures button', async () => {
        await testInternationalFixturesSection(page);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Plan Your Day - Getting To Lord\'s Traversal', async ({ page, context, baseURL }) => {
    test.setTimeout(90000);

    await test.step('Open Plan Your Day and navigate to Getting to Lord\'s', async () => {
        await openPage(page, '/lords/match-day/plan-your-day');

        const gettingHereLink = page.locator('.fadeCtaTile__tile:visible a.ctaTile__link[href="/lords/visit-us/how-to-get-here"]').first();
        await gettingHereLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, gettingHereLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Clicking Getting to Lord\'s should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/visit-us/how-to-get-here'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the How to Get to Lord\'s heading').toHaveText(/How to Get to Lord/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should contain the page name').toHaveTitle(/how to get here/i);
        }
    });

    await test.step('Follow the TFL Live button and back', async () => {
        const tflLiveButton = page.locator('a.button', { hasText: /^TFL Live$/i }).first();
        await tflLiveButton.scrollIntoViewIfNeeded();
        await expect(tflLiveButton, 'The TFL Live button should be visible').toBeVisible();

        await clickWithCookieGuard(page, tflLiveButton);
        await page.waitForLoadState('load').catch(() => { });
        expect(new URL(page.url()).host, 'TFL Live should navigate to the TfL status site').toBe('tfl.gov.uk');

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenter(page);
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Going back from TFL Live should restore the Getting to Lord\'s page').toHaveURL(buildExpectedUrl(baseURL, '/lords/visit-us/how-to-get-here'));
    });

    await test.step('Follow the Ground Map button and back', async () => {
        const groundMapButton = page.locator('a.button', { hasText: /^Ground Map$/i }).first();
        await groundMapButton.scrollIntoViewIfNeeded();

        await clickContentLinkAndVerify(page, {
            link: groundMapButton,
            label: 'Ground Map button',
            expectedPath: '/lords/visit-us/ground-map',
            baseURL,
        });
    });

    const accordionLabels = ['By Underground', 'By Bus', 'By Train', 'By Road', 'By Bike'];

    // Each accordion expansion/collapse pushes all later content up or down the page, shifting
    // every subsequent header's screen position - a real pointer click was observed to
    // intermittently miss (click registers but Bootstrap's toggle silently doesn't fire) once
    // several sections above it had already changed height. Dispatching the click directly on the
    // element sidesteps that layout-position dependency entirely (same pattern used for other
    // layout-shifting toggles elsewhere in this project's specs).
    await test.step('Expand every travel accordion in order', async () => {
        for (const label of accordionLabels) {
            await test.step(`Expand ${label}`, async () => {
                const header = page.locator('.accordion__header:visible', { hasText: label }).first();
                await header.scrollIntoViewIfNeeded();
                await expect(header, `${label} should start collapsed (showing the + state)`).toHaveClass(/collapsed/);

                await dismissCookieOverlayIfPresent(page);
                // Bootstrap's collapse.js guards against re-triggering while a previous panel's
                // expand/collapse transition is still animating - a click fired too soon after the
                // prior one is silently ignored. Give it a moment to settle first.
                await page.waitForTimeout(400);
                await header.evaluate((el) => el.click());
                await expect(header, `${label} should show the expanded (-) state after clicking`).not.toHaveClass(/collapsed/);

                const targetSelector = await header.getAttribute('data-target');
                await expect(page.locator(targetSelector), `${label}'s content should be visible once expanded`).toBeVisible();
            });
        }
    });

    await test.step('Collapse every travel accordion in reverse order', async () => {
        for (const label of [...accordionLabels].reverse()) {
            await test.step(`Collapse ${label}`, async () => {
                const header = page.locator('.accordion__header:visible', { hasText: label }).first();
                await header.scrollIntoViewIfNeeded();
                await expect(header, `${label} should still be expanded before collapsing`).not.toHaveClass(/collapsed/);

                await dismissCookieOverlayIfPresent(page);
                await page.waitForTimeout(400);
                await header.evaluate((el) => el.click());
                await expect(header, `${label} should return to the collapsed (+) state after clicking again`).toHaveClass(/collapsed/);

                const targetSelector = await header.getAttribute('data-target');
                await expect(page.locator(targetSelector), `${label}'s content should be hidden once collapsed`).toBeHidden();
            });
        }
    });

    await test.step('Verify the Sustainable Travel heading and the Lord\'s Google Map embed', async () => {
        const heading = page.getByRole('heading', { level: 2, name: /sustainable travel/i }).first();
        await heading.scrollIntoViewIfNeeded();
        await expect(heading, 'The page should show the Sustainable Travel heading').toBeVisible();

        const map = page.locator('iframe[src*="google.com/maps"]').first();
        await expect(map, 'A Google Map embed should be present').toBeAttached();
        const mapSrc = await map.getAttribute('src');
        expect(mapSrc, 'The Google Map embed should be focused on Lord\'s').toContain('lords');
    });

    await test.step('Follow the TFL Journey Planner Click Here link', async () => {
        const heading = page.getByRole('heading', { level: 5, name: /tfl journey planner/i }).first();
        await heading.scrollIntoViewIfNeeded();
        await expect(heading, 'The page should show the TFL Journey Planner heading').toBeVisible();

        const clickHereButton = page.getByRole('link', { name: /click here/i }).first();
        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, clickHereButton),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'Click Here should open the TfL journey planner in a new tab').toBe('tfl.gov.uk');
        await popup.close();
    });

    await test.step('Verify the recurring "Your Day at Lord\'s" section is present', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /your day at lord/i }).first(), 'The page should show the Your Day at Lord\'s heading').toBeVisible();
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Plan Your Day - Accessibility Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Open Plan Your Day and navigate to Accessibility', async () => {
        await openPage(page, '/lords/match-day/plan-your-day');

        const accessibilityLink = page.locator('.fadeCtaTile__tile:visible a.ctaTile__link[href="/lords/match-day/plan-your-day/accessibility"]').first();
        await accessibilityLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, accessibilityLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Clicking Accessibility should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/match-day/plan-your-day/accessibility'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Accessibility heading').toHaveText(/Accessibility/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should contain the page name').toHaveTitle(/accessibility/i);
        }
    });

    // Same Bootstrap `collapsed` class / `data-target` convention as the Getting To Lord's travel
    // accordions, just under a different component class name (`.inlineAccordion__itemHandle`
    // instead of `.accordion__header`) - but this one is single-open, not multi-open (see the helper
    // above), so each block is verified as one continuous open-in-order chain rather than an
    // independent expand-all/collapse-all pass. Two independent accordion blocks, back to back with
    // no heading between them.
    await test.step('Open through the Access & Facilities accordion block', async () => {
        await testSingleOpenAccordionBlock(page, {
            headerSelector: '.inlineAccordion__itemHandle:visible',
            labels: ['Access', 'Facilities', 'Lifts', 'Signage', 'British Sign Language', 'Parking', 'Assistance Dogs'],
        });
    });

    await test.step('Open through the Tickets & Seating accordion block', async () => {
        await testSingleOpenAccordionBlock(page, {
            headerSelector: '.inlineAccordion__itemHandle:visible',
            labels: ['Tickets', 'Wheelchair areas', 'Audio commentary', 'Picturepath', 'Sensory Room'],
        });
    });

    await test.step('Verify the General Information PDF link', async () => {
        const heading = page.getByRole('heading', { level: 5, name: /^General Information$/i }).first();
        await heading.scrollIntoViewIfNeeded();
        await expect(heading, 'The page should show the General Information heading').toBeVisible();

        // Raw href/filename differ by environment (UAT2 serves it from /getmedia/..., Live from
        // /getattachment/... with a different filename) - same "don't click real downloads, verify
        // the resource instead" convention as the Fixtures and Results Download Calendar/Print
        // Fixtures links, since clicking a real PDF download is non-deterministic in headless Chromium.
        const pdfLink = page.locator('a', { hasText: /general information access statement/i }).first();
        await expect(pdfLink, 'A General Information Access Statement PDF link should be present').toBeVisible();
        expect(await pdfLink.getAttribute('target'), 'The PDF link should open in a new tab').toBe('_blank');

        const href = await pdfLink.getAttribute('href');
        const pdfResponse = await page.request.get(buildExpectedUrl(baseURL, href));
        expect(pdfResponse.status(), 'The PDF link should not return an error status').toBeLessThan(400);
        expect(pdfResponse.headers()['content-type'], 'The linked resource should be a real PDF').toContain('application/pdf');
    });

    await test.step('Verify the Accessibility Group heading and video', async () => {
        const heading = page.getByRole('heading', { level: 2, name: /accessibility group/i }).first();
        await heading.scrollIntoViewIfNeeded();
        await expect(heading, 'The page should show the Accessibility Group heading').toBeVisible();

        // Unlike the Initial Page Checks video (a YouTube embed), this one is a genuine Vimeo embed
        // (same iframe.embed-responsive-item wrapper convention, but player.vimeo.com instead of
        // youtube.com) - same video on both environments (Vimeo ID 849053855). Its own control bar
        // buttons don't carry stable aria-labels, but each does carry a stable (non-hashed) class
        // fragment ("PlayButton"/"FullscreenButton" survive Vimeo's own build hash suffixes).
        const videoIframe = page.locator('iframe.embed-responsive-item[src*="vimeo"]').first();
        const videoFrame = page.frameLocator('iframe.embed-responsive-item[src*="vimeo"]').first();
        await videoIframe.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1500);

        const playPauseButton = videoFrame.locator('button[class*="PlayButton"]').first();
        const fullscreenButton = videoFrame.locator('button[class*="FullscreenButton"]').first();

        // Confirmed via direct testing: touch viewports show this Vimeo player's control bar
        // permanently (there's no hover state to reveal it, same as the What To Bring carousel
        // arrows), but real interaction is genuinely unreliable there for two distinct reasons - on
        // tablet, clicking Play intermittently doesn't register (~50% of runs); on mobile, the
        // player's internal layout doesn't match its visually-scaled iframe box closely enough for
        // Playwright to compute real click coordinates, so even locating the fullscreen button
        // throws "element is outside of the viewport". Same call as the carousel: verify structural
        // presence on touch, exercise the full play/fullscreen/pause interaction on desktop only.
        const projectUse = test.info().project.use;
        const isTouchDevice = Boolean(projectUse.isMobile || projectUse.hasTouch);

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

        await videoIframe.hover();
        await page.waitForTimeout(500);
        await fullscreenButton.click({ timeout: 10000 });
        await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
            message: 'The page should enter full screen after clicking the full screen control',
        }).toBe(true);
        await page.waitForTimeout(1000);

        await videoIframe.hover();
        await page.waitForTimeout(500);
        await fullscreenButton.click({ timeout: 10000 });
        await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), {
            message: 'The page should leave full screen after clicking full screen again',
        }).toBe(false);
        await page.waitForTimeout(1000);

        await videoIframe.hover();
        await page.waitForTimeout(500);
        await playPauseButton.click({ timeout: 10000 });
        await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => video.paused).catch(() => false), {
            message: 'The video should pause when clicked again',
        }).toBe(true);
    });

    await test.step('Verify the Persons Living with Dementia heading is present', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /persons living with dementia/i }).first(), 'The page should show the Persons Living with Dementia heading').toBeVisible();
    });

    await test.step('Verify the recurring "Your Day at Lord\'s" section is present', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /your day at lord/i }).first(), 'The page should show the Your Day at Lord\'s heading').toBeVisible();
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Plan Your Day - Food & Drink Traversal', async ({ page, baseURL }) => {
    test.setTimeout(240000);

    await test.step('Open Plan Your Day and navigate to Food & drink', async () => {
        await openPage(page, '/lords/match-day/plan-your-day');

        const foodDrinkLink = page.locator('.fadeCtaTile__tile:visible a.ctaTile__link[href="/lords/match-day/food-drink"]').first();
        await foodDrinkLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, foodDrinkLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Clicking Food & drink should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/match-day/food-drink'));
    });

    await test.step('Verify the H1', async () => {
        // UAT2's H1 reads "Food and Drink"; Live's reads "Food and Drink" too, but tolerate the
        // "&"/"and" variance already seen on the Things To Do traversal's Food & Drink destination.
        await expect(page.locator('h1').first(), 'The page should show the Food and Drink heading').toHaveText(/food (&|and) drink/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should contain the page name').toHaveTitle(/food and drink/i);
        }
    });

    await test.step('Follow the Explore Matchday Hampers button', async () => {
        const hampersButton = page.locator('a.button--primary', { hasText: /explore matchday hampers/i }).first();
        await hampersButton.scrollIntoViewIfNeeded();
        await expect(hampersButton, 'The Explore Matchday Hampers button should be visible').toBeVisible();

        // Raw href differs completely by environment here - not just a redirect, a genuinely
        // different slug/domain by design ("/lords/match-day/food-drink/picnic-hampers" on UAT2 vs
        // the absolute "https://www.lords.org/lords/match-day/food-drink/picnic-hampers-lord-s" on
        // Live). Per Hector: Live's destination is the real, finished page, but UAT2's is currently
        // a placeholder - so UAT2 only needs to prove the link doesn't 404, while Live is held to the
        // full "lands on a real Picnic Hampers page" standard.
        const startHost = new URL(page.url()).host;
        await clickWithCookieGuard(page, hampersButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).host, 'Explore Matchday Hampers should stay on the same site').toBe(startHost);

        const statusCheck = await page.request.get(page.url());
        expect(statusCheck.status(), 'Explore Matchday Hampers destination should not return an error status').toBeLessThan(400);

        if (!isUatEnvironment(baseURL)) {
            await expect(page.locator('h1').first(), 'The Matchday Hampers destination should show a Picnic Hampers heading').toHaveText(/picnic hampers/i);
        }

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenter(page);
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Going back should restore the Food & drink page').toHaveURL(buildExpectedUrl(baseURL, '/lords/match-day/food-drink'));
    });

    await test.step('Follow the View Gallery button and test the overlay', async () => {
        await testFoodDrinkGallery(page);
    });

    await test.step('Verify the Food and Drink Outlets heading', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /food and drink outlets/i }).first(), 'The page should show the Food and Drink Outlets heading').toBeVisible();
    });

    // The order and content of everything between here and "Your Day at Lord's" differs completely
    // between UAT2 and Live (different outlets, different stands/gates, different section headings)
    // per Hector - deliberately not asserting on any of that text/imagery. The one thing worth
    // testing regardless of layout is the accordions, discovered dynamically rather than by a
    // hardcoded outlet list (see the helpers above for why).
    await test.step('Test the Food/Drinks tab-accordion groups (where present)', async () => {
        await testFoodDrinkTabAccordions(page);
    });

    await test.step('Test the remaining standalone accordion blocks', async () => {
        await testAllStandaloneAccordionBlocks(page);
    });

    await test.step('Verify the recurring "Your Day at Lord\'s" section is present', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /your day at lord/i }).first(), 'The page should show the Your Day at Lord\'s heading').toBeVisible();
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Plan Your Day - Ground Map Traversal', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await test.step('Open Plan Your Day and navigate to Ground map', async () => {
        await openPage(page, '/lords/match-day/plan-your-day');

        const groundMapLink = page.locator('.fadeCtaTile__tile:visible a.ctaTile__link[href="/lords/visit-us/ground-map"]').first();
        await groundMapLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, groundMapLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Clicking Ground map should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/visit-us/ground-map'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Ground Map heading').toHaveText(/ground map/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should contain the page name').toHaveTitle(/ground map/i);
        }
    });

    await test.step('Verify the ground map image loads', async () => {
        // Content-area only - excludes the OneTrust preference center's own logo images, which also
        // happen to sit outside header/footer/meganav and would otherwise be picked up here too.
        const mapImage = page.locator('img:not(header img):not(footer img):not(.meganav img):not(#onetrust-consent-sdk img)').first();
        await mapImage.scrollIntoViewIfNeeded();
        const naturalWidth = await mapImage.evaluate((img) => img.naturalWidth);
        expect(naturalWidth, 'The ground map image should load with real dimensions').toBeGreaterThan(0);
    });

    await test.step('Follow the How to Get Here button', async () => {
        const howToGetHereButton = page.locator('a.button', { hasText: /how to get here/i }).first();
        await howToGetHereButton.scrollIntoViewIfNeeded();

        await clickContentLinkAndVerify(page, {
            link: howToGetHereButton,
            label: 'How to Get Here',
            expectedPath: '/lords/visit-us/how-to-get-here',
            baseURL,
            expectedHeading: /How to Get to Lord/i,
        });
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Plan Your Day - What To Wear Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Open Plan Your Day and navigate to What to wear', async () => {
        await openPage(page, '/lords/match-day/plan-your-day');

        const whatToWearLink = page.locator('.fadeCtaTile__tile:visible a.ctaTile__link[href="/lords/match-day/plan-your-day/what-to-wear"]').first();
        await whatToWearLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, whatToWearLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Clicking What to wear should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/match-day/plan-your-day/what-to-wear'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the What to Wear heading').toHaveText(/What to Wear/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should contain the page name').toHaveTitle(/what to wear/i);
        }
    });

    await test.step('Verify the Dress Regulations heading, text, and image', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /dress regulations/i }).first(), 'The page should show the Dress Regulations heading').toBeVisible();
        await expect(page.locator('h5:not(.meganav h5)').first(), 'The page should show the dress regulations intro text').toBeVisible();

        const dressRegulationsImage = page.locator('img:not(header img):not(footer img):not(.meganav img):not(#onetrust-consent-sdk img)').first();
        await dressRegulationsImage.scrollIntoViewIfNeeded();
        const naturalWidth = await dressRegulationsImage.evaluate((img) => img.naturalWidth);
        expect(naturalWidth, 'The dress regulations image should load with real dimensions').toBeGreaterThan(0);
    });

    await test.step('Verify there is exactly one accordion block below Dress Regulations', async () => {
        // Confirmed real content defect on UAT2 (per Hector): the accordion block that belongs below
        // the Dress Regulations image is duplicated - an identical second copy (same 5 items:
        // Hospitality/Debentures/Pavilion/Members' Friends' Enclosures/Restaurants) is incorrectly
        // also rendered earlier, between the intro text and the image, where nothing should be.
        // Live only ever has the one, correctly-placed block. Deliberately left failing on UAT2
        // rather than relaxed to `toBeGreaterThan(0)` - same "surface, don't mask" convention as
        // every other confirmed defect in this project. Soft, so the rest of the page (including
        // testing the accordion(s) themselves) still gets exercised even while this fails.
        const accordionBlockCount = await page.locator('.inlineAccordion').count();
        expect.soft(accordionBlockCount, 'There should be exactly one accordion block on this page (a duplicate is a known UAT2 defect)').toBe(1);
    });

    await test.step('Test the accordion block(s)', async () => {
        await testAllStandaloneAccordionBlocks(page);
    });

    await test.step('Verify the recurring "Your Day at Lord\'s" section is present', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /your day at lord/i }).first(), 'The page should show the Your Day at Lord\'s heading').toBeVisible();
    });

    await test.step('Verify the International Fixtures heading, carousel, and View All Fixtures button', async () => {
        await testInternationalFixturesSection(page);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});
