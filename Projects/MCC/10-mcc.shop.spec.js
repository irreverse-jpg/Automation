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
// Coverage notes - "Shop" meganav section (6th top-level menu item)
// ============================================================================
// Scope: all 3 items under "Shop" - Lord's Store, Cricket Equipment Shop, and
// London Spirit Store. Per Hector: Lord's Store and Cricket Equipment Shop
// each get a full traversal; London Spirit Store is deliberately left as a
// lightweight working-link check only, since it heads to a completely
// separate external storefront (store.londonspirit.com).
//
// Tests in this file (3 total):
//   - Lord's Store Traversal (full depth)
//   - Cricket Equipment Shop Traversal (full depth - the exact same
//     destination page already covered by 08-mcc.playandtrain.spec.js's own
//     Cricket Equipment Shop traversal, reached via a different meganav
//     path - built here too as its own traversal per Hector's explicit
//     request for 2 full traversals from this menu)
//   - London Spirit Store link check (external, lightweight)
//
// Environment status (re-verified 2026-07-17, as part of the Live -> UAT2
// content sync): both full traversals now reach real content on UAT2 -
// previously Cricket Equipment Shop redirected back to the homepage there.
// Both now show real, page-specific titles on UAT2 too where relevant. Also
// fixed a genuine test-code bug found during this re-verification: UAT2's
// Shop menu currently labels this item "Lord's Performance Centre Shop"
// instead of "Cricket Equipment Shop" - the old label-only substring match
// silently reported "not found" instead of reaching the page.
// `navigateViaShopMenu` now also matches by href substring
// (`cricket-equipment-shop`, stable across the label wording) as a fallback,
// so this survives future label changes without needing constant updates.
//
// Confirmed CURRENT defect, present on BOTH Live and UAT2 (same family
// already documented via the Play & Train traversal to this same page):
//   - Cricket Equipment Shop's <title> is the generic sitewide fallback
//     ("The Home of Cricket") instead of page-specific.
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

    await desktopSponsorsLink.scrollIntoViewIfNeeded().catch(() => { });
    if (await desktopSponsorsLink.isVisible().catch(() => false)) {
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
// MCC menu suite - each level located via `:scope > ul.meganav__list` relative to its own parent
// `<li>`, dispatching clicks directly on the located DOM node.
async function openMenuIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);

    const mainLevel = page.locator('.meganav .mainLevel').first();
    if (await mainLevel.isVisible().catch(() => false)) {
        return;
    }

    const hamburger = page.locator('.header__hamburger').first();
    await clickWithCookieGuard(page, hamburger);
    await expect(page.locator('.meganav .mainLevel').first(), 'The meganav should be visible').toBeVisible();
}

async function navigateViaShopMenu(page, baseURL, submenuName, hrefHint) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    await openMenuIfPresent(page);

    // Matched by label substring OR href substring (whichever hits) - confirmed real environment
    // quirk: UAT2's equivalent of "Lord's Store" is labelled "Lord's shop" (a different word, not just
    // casing), and as of 2026-07-17 UAT2's "Cricket Equipment Shop" item is labelled "Lord's Performance
    // Centre Shop" instead - a label-only match on "cricket equipment" no longer finds it there at all.
    // The href (`cricket-equipment-shop`) stays stable across both wordings, so matching on either the
    // label or the href makes this resilient to label drift instead of needing constant updates.
    const result = await page.evaluate(({ rootName, childName, hrefHint }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);
        const matchesChild = (el) => {
            const link = el.querySelector(':scope > a.meganav__link');
            const labelMatch = normalize(link?.textContent).includes(childName);
            const hrefMatch = hrefHint && (link?.getAttribute('href') || '').toLowerCase().includes(hrefHint);
            return labelMatch || hrefMatch;
        };

        const mainLevel = document.querySelector('.meganav .mainLevel');
        const root = directChildItems(mainLevel).find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent) === rootName);
        if (!root) {
            return { ok: false };
        }

        root.querySelector(':scope > a.meganav__link').click();
        const sub = root.querySelector(':scope > ul.meganav__list');
        const child = directChildItems(sub).find(matchesChild);
        if (!child) {
            return { ok: false };
        }

        const link = child.querySelector(':scope > a.meganav__link');
        return { ok: true, href: link.getAttribute('href'), target: link.getAttribute('target') };
    }, { rootName: 'shop', childName: submenuName.toLowerCase(), hrefHint: (hrefHint || '').toLowerCase() });

    if (!result.ok) {
        return { status: 'not-found' };
    }

    if (result.target === '_blank') {
        const [popup] = await Promise.all([
            page.context().waitForEvent('page'),
            page.evaluate(({ rootName, childName, hrefHint }) => {
                const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);
                const matchesChild = (el) => {
                    const link = el.querySelector(':scope > a.meganav__link');
                    const labelMatch = normalize(link?.textContent).includes(childName);
                    const hrefMatch = hrefHint && (link?.getAttribute('href') || '').toLowerCase().includes(hrefHint);
                    return labelMatch || hrefMatch;
                };
                const mainLevel = document.querySelector('.meganav .mainLevel');
                const root = directChildItems(mainLevel).find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent) === rootName);
                const sub = root.querySelector(':scope > ul.meganav__list');
                const child = directChildItems(sub).find(matchesChild);
                child.querySelector(':scope > a.meganav__link').click();
            }, { rootName: 'shop', childName: submenuName.toLowerCase(), hrefHint: (hrefHint || '').toLowerCase() }),
        ]);
        return { status: 'popup', popup, href: result.href };
    }

    const rootLink = page.locator('.meganav a:visible', { hasText: /^Shop$/i }).first();
    await rootLink.scrollIntoViewIfNeeded().catch(() => { });
    await page.evaluate(({ rootName, childName, hrefHint }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);
        const matchesChild = (el) => {
            const link = el.querySelector(':scope > a.meganav__link');
            const labelMatch = normalize(link?.textContent).includes(childName);
            const hrefMatch = hrefHint && (link?.getAttribute('href') || '').toLowerCase().includes(hrefHint);
            return labelMatch || hrefMatch;
        };
        const mainLevel = document.querySelector('.meganav .mainLevel');
        const root = directChildItems(mainLevel).find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent) === rootName);
        root.querySelector(':scope > a.meganav__link').click();
        const sub = root.querySelector(':scope > ul.meganav__list');
        const child = directChildItems(sub).find(matchesChild);
        child.querySelector(':scope > a.meganav__link').click();
    }, { rootName: 'shop', childName: submenuName.toLowerCase(), hrefHint: (hrefHint || '').toLowerCase() });

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);

    // Confirmed real environment quirk per Hector: one of these two menu options currently just
    // redirects back to the site's own homepage on UAT2 (content not yet synced from Live) - detected
    // generically here (landed back on "/" instead of the expected destination) so the calling test
    // can skip gracefully rather than asserting against a homepage it didn't intend to reach.
    const landedPath = new URL(page.url()).pathname;
    if (landedPath === '/' || landedPath === '') {
        return { status: 'redirects-home' };
    }

    return { status: 'ok' };
}

// Same proven ytm-skin play/fullscreen/pause sequence used throughout this project.
async function testYouTubeVideo(page) {
    const videoIframe = page.locator('iframe[src*="youtube"]:visible').first();
    if ((await videoIframe.count()) === 0) {
        return;
    }

    const videoFrame = page.frameLocator('iframe[src*="youtube"]:visible').first();
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

test('Shop - Lord\'s Store Traversal', async ({ page, context, baseURL }) => {
    test.setTimeout(120000);

    const nav = await test.step('Navigate via the Shop menu', async () => {
        return navigateViaShopMenu(page, baseURL, 'lord\'s');
    });

    test.skip(nav.status === 'not-found', 'This menu item doesn\'t exist on this environment yet.');
    test.skip(nav.status === 'redirects-home', 'This menu item currently redirects back to the homepage on this environment (content not yet synced from Live as of 2026-07-13).');

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Lord\'s Shop heading').toHaveText(/Lord's Shop/i);
    });

    // Re-verified 2026-07-17: UAT2 now shows the real, page-specific title here too (previously the
    // generic sitewide fallback) - both environments use the same assertion, no env branching needed.
    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference the Lord\'s Shop').toHaveTitle(/Lord's Shop/i);
    });

    await test.step('Follow the "Shop online" / "Shop Here" buttons to the external storefront', async () => {
        const buttons = await page.locator('a.button[href*="store.lords.org"]').evaluateAll((els) => els.map((el) => el.textContent.trim()));
        expect(buttons.length, 'There should be at least one button linking to the external storefront').toBeGreaterThan(0);

        const button = page.locator('a.button[href*="store.lords.org"]').first();
        await button.scrollIntoViewIfNeeded();
        const href = await button.getAttribute('href');

        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, button),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'The button should open the external storefront').toBe(new URL(href).host);
        await popup.close();
    });

    await test.step('Verify the "Welcome to Inside Lord\'s" subscription CTAs', async () => {
        await expect(page.getByRole('heading', { name: /Welcome to Inside Lord's/i }).first(), 'The Inside Lord\'s heading should be visible').toBeVisible();

        const subscribeButton = page.locator('a.button', { hasText: /subscribe now/i }).first();
        await subscribeButton.scrollIntoViewIfNeeded();
        const href = await subscribeButton.getAttribute('href');

        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, subscribeButton),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'Subscribe Now should open the external Inside Lord\'s site').toBe(new URL(href).host);
        await popup.close();
    });

    await test.step('Play any video(s) on the page (if present)', async () => {
        await testYouTubeVideo(page);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Shop - Cricket Equipment Shop Traversal', async ({ page, context, baseURL }) => {
    test.setTimeout(120000);

    const nav = await test.step('Navigate via the Shop menu', async () => {
        return navigateViaShopMenu(page, baseURL, 'cricket equipment', 'cricket-equipment-shop');
    });

    test.skip(nav.status === 'not-found', 'This menu item doesn\'t exist on this environment yet.');
    test.skip(nav.status === 'redirects-home', 'This menu item currently redirects back to the homepage on this environment (content not yet synced from Live as of 2026-07-13).');

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Cricket Equipment heading').toHaveText(/Cricket Equipment/i);
    });

    // Confirmed real content defect on BOTH Live and UAT2 (also documented via the Play & Train
    // traversal to this same page, spec 08): this page's <title> is the generic sitewide fallback
    // ("The Home of Cricket") rather than page-specific - surfaced as a deliberately failing assertion.
    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should be specific to the Cricket Equipment Shop, not the generic sitewide fallback').toHaveTitle(/Cricket Equipment/i);
    });

    await test.step('Play any video(s) on the page (if present)', async () => {
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
        if ((await galleryButton.count()) === 0) {
            return;
        }

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

        await closeButton.click();
        await expect(modal, 'The gallery overlay should close').toBeHidden();
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Shop - London Spirit Store link check', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    // Deliberately left untouched beyond a working-link check, per Hector - this heads to a
    // completely separate external storefront (store.londonspirit.com), not part of the main MCC
    // site's own content.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    await openMenuIfPresent(page);

    const href = await page.evaluate(() => {
        // Lowercased and matched via substring (not exact equality) on purpose: confirmed real
        // environment quirk - UAT2's equivalent of "Lord's Store" is currently labelled "Lord's shop"
        // (a different word, "shop" not "Store", not just different casing) even though it points at
        // the exact same destination - matching on the stable "lord's" keyword bridges this.
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);
        const mainLevel = document.querySelector('.meganav .mainLevel');
        const root = directChildItems(mainLevel).find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent) === 'shop');
        if (!root) return null;
        root.querySelector(':scope > a.meganav__link').click();
        const sub = root.querySelector(':scope > ul.meganav__list');
        const child = directChildItems(sub).find((el) => normalize(el.querySelector(':scope > a.meganav__link')?.textContent) === 'london spirit store');
        return child ? child.querySelector(':scope > a.meganav__link').getAttribute('href') : null;
    });

    test.skip(!href, 'The Shop menu doesn\'t exist on this environment yet.');

    const response = await page.request.get(href).catch((error) => {
        throw new Error(`The London Spirit Store link (${href}) could not be reached at all: ${error.message}`);
    });
    expect(response.status(), 'The London Spirit Store link should be working').toBeLessThan(400);
});
