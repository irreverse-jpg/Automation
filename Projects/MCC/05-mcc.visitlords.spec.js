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
// Coverage notes - "Visit Lord's" meganav section (1st top-level menu item)
// ============================================================================
// Scope: every page reachable under "Visit Lord's" - Matchday information (its
// own 3rd-level submenu), Fixtures and results, How to get here, Tours and
// Museum, Lord's Tavern, HOAM Coffee Shop, and Contact us. Consolidates what
// used to be four separate ad-hoc files (Fixtures and Results, Plan Your Day +
// its onward cards, Tours & Museum + its 12 card traversals, and Tickets FAQs)
// into the one-file-per-top-level-menu-item convention (see 11-more.spec.js
// for the reference shape). Test order in this file matches the real meganav
// expand order top-to-bottom.
//
// Tests in this file (32 total):
//   Matchday information:
//     - England v India ODI Matchday Guide Traversal
//     - Plan your day Traversal, plus 7 onward-card sub-traversals reached
//       from that page (Things To Do, What To Bring, Accessibility,
//       Food & Drink, Ground Map, What To Wear)
//     - Digital Ticketing FAQs Traversal
//     - Download the Lord's App Traversal
//   Fixtures and Results Traversal, plus 4 sibling tests covering month
//     sections/in-page nav, calendar/print downloads, the Results tab, and
//     the Results filters
//   How to get here Traversal (reached via its own onward card from Plan
//     Your Day - see the note in that test)
//   Tours and Museum Traversal, plus 12 sibling card traversals (Guided
//     Tours, Private and Group Tours, England v India Women's Test Match,
//     Players' Dining Experience, Hosted Players' Dining Experience, Lord's
//     Ultimate Collection, Father Time Wall Plaque, Ultra India VIP
//     Experience, The Australian Special, Lord's Sensory Tour, Lord's
//     Virtual Tour, Lord's Tour Gift Voucher)
//   Lord's Tavern Traversal
//   HOAM Coffee Shop Traversal (thin - full depth lives in
//     08-mcc.playandtrain.spec.js, since this page is also a Play & Train
//     menu item and is tested in full there)
//   Contact us Traversal
//
// Environment status (re-verified 2026-07-14, as part of the Live -> UAT2
// content sync): UAT2's meganav tree for this section is now identical to
// Live's, and the vast majority of previously-documented UAT2 gaps are
// RESOLVED - real per-page titles (not the old generic fallback), the What
// To Bring "Buy Now" redirect, the Food & Drink hampers destination, the
// What To Wear duplicate-accordion defect, the full Tours & Museum content,
// and the Tickets FAQs 404 have all been confirmed fixed. Both environments
// now share the same assertions with no env branching needed for any of these.
//
// Confirmed CURRENT defects, left as deliberately failing assertions (not
// worked around):
//   - UAT2-only, sitewide pattern: several menu items/cards throughout this
//     section have hrefs hardcoded to the absolute Live production domain
//     despite the markup's own data-external="false", silently redirecting
//     UAT2 visitors to Live when clicked. Affects: the "Tours and Museum"/
//     "Lord's Tavern"/"HOAM Coffee Shop" meganav items, every "Matchday
//     information" child, 3 of the 12 Tours & Museum cards, and Food &
//     Drink's "Explore Matchday Hampers" button. Inconsistent item-by-item
//     (sibling items right next to these use correct relative paths), so
//     it's CMS content, not a blanket environment issue.
//   - `/mcc/careers/volunteer` (Things To Do's "Happy To Help" Volunteer
//     link) 404s on BOTH Live and UAT2.
//   - The MCC Museum "Read More" link (Things To Do) points at a
//     web.archive.org snapshot instead of the live site.
//   - Harris Garden Bar's accordion item (Food & Drink) has a broken
//     `data-target` pointing at a nonexistent element - permanently
//     non-functional.
//   - The Australian Special's "Book Now" button is wrapped in an Outlook
//     safelink instead of a real booking URL.
// ============================================================================

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

// Confirmed via computed style on the in-page navigation's ::before accent bar - NOT the link's own
// text colour (which is #007bff on both states and is not the indicator). Active is red, inactive is
// a dark navy/purple, not the "#007bff purple" originally assumed - see project memory for detail.
const IN_PAGE_NAV_ACTIVE_BORDER_COLOR = 'rgb(255, 50, 40)';
const IN_PAGE_NAV_INACTIVE_BORDER_COLOR = 'rgb(30, 0, 70)';

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

async function openPage(page, path) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
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

// Content-area links only - excludes the meganav (which also has an unrelated "Volunteer" link under
// Jobs) and the footer, so ordinal indexing matches the actual visual top-to-bottom order.
function contentLinksByText(page, pattern) {
    return page.locator('a:not(header a):not(footer a):not(.meganav a)').filter({ hasText: pattern });
}

// Reuses the exact same nested, scoped DOM traversal proven in spec 02's meganav suite, spec 15's MCC
// menu suite, and spec 17's More menu suite - walks an arbitrary-depth path array (e.g. ['Matchday
// information', 'Plan your day'] is a 3-level walk: Visit Lord's -> Matchday information -> Plan your
// day).
async function navigateViaVisitLordsMenu(page, path) {
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
    }, { rootName: 'visit lord', restPath: path });

    if (!result.ok) {
        return false;
    }

    await page.waitForLoadState('load').catch(() => { });
    // A single waitForLoadState('load') fired right after the evaluate()-driven click can
    // occasionally resolve against the still-current (pre-navigation) document if the navigation
    // hasn't actually taken effect yet by that point - confirmed via a real intermittent failure
    // during re-verification, most visibly on the (confirmed real, UAT2-only) menu items whose href
    // is hardcoded to Live's domain, where the resulting cross-origin navigation can take a moment
    // longer to actually land than a same-origin one. A short poll on document.readyState is more
    // robust than a single point-in-time check, same race already worked around elsewhere in this
    // file (e.g. selectFilterAndWait's Promise.all). This does NOT mask the cross-origin redirect
    // defect itself - callers still land on whatever URL the click actually produced, and any
    // URL/host assertion downstream still fails correctly if that's the wrong environment.
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 8000 }).catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    return true;
}

// ---------------------------------------------------------------------------------------------
// Generic helpers reused for the brand-new gap traversals (England v India ODI Matchday Guide,
// Download the Lord's App, Lord's Tavern, Contact us), same shape as spec 17's runMorePageTraversal.
// ---------------------------------------------------------------------------------------------

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

// Full generic per-page traversal, applied to the brand-new gap pages that don't have any hard-won
// novel-component logic of their own yet - same shape as spec 17's runMorePageTraversal.
async function runVisitLordsPageTraversal(page, baseURL, { menuPath, h1Pattern, titlePattern }) {
    test.setTimeout(120000);

    const navigated = await test.step('Navigate via the Visit Lord\'s menu', async () => {
        return navigateViaVisitLordsMenu(page, menuPath);
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

// ---------------------------------------------------------------------------------------------
// Plan Your Day specific helpers (ported unchanged from the old 06-mcc.planyourday.spec.js)
// ---------------------------------------------------------------------------------------------

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
// nested inside a "tabccordion" (see below) are skipped here since testFoodDrinkTabAccordions already
// exercises them via their own Food/Drinks tab switch.
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

// The Food & Drink hero's "View Gallery" overlay is a Slick-carousel lightbox (main image + synced
// thumbnail strip, each with its own prev/next arrow pair). Clicks through the main image carousel to
// the end and back where images are configured, otherwise verifies the overlay opens/closes cleanly.
// A hasty 400ms settle delay between clicks was observed to silently swallow every other click here
// (Slick's own animation guard, same family of issue as Bootstrap's collapse.js timing race found
// elsewhere in this project) - confirmed 800ms is reliable instead.
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

// The "<year> International Fixtures" section (a `.whatsOnRow` Swiper carousel of fixture cards, plus
// a "View all fixtures" button) is the exact same shared component on both the What To Bring and What
// To Wear pages - same card-hover zoom, same arrow reveal-on-hover behaviour, same touch-viewport
// limitations, same hardcoded absolute "View all fixtures" URL.
async function testInternationalFixturesSection(page) {
    // The year in this heading is whatever season is currently live - match the stable part of the
    // text only, not the year itself.
    const fixturesHeading = page.getByRole('heading', { level: 2, name: /international fixtures/i }).first();
    await fixturesHeading.scrollIntoViewIfNeeded();
    await expect(fixturesHeading, 'The page should show a "<year> International Fixtures" heading').toBeVisible();

    const swiperWrap = page.locator('.whatsOnRow__swiperWrap').first();
    const cards = page.locator('.whatsOnRow__item');
    const cardCount = await cards.count();
    expect(cardCount, 'The fixtures carousel should show at least one fixture card').toBeGreaterThan(0);

    // Both the card zoom-on-hover effect and the arrow reveal-on-hover behaviour described here are
    // mouse-only interactions with no touch equivalent - and on touch viewports this Swiper carousel
    // was observed to behave fundamentally differently anyway (tablet needed far more than the number
    // of clicks Live's card count should require to reach the end, and mobile's "next" arrow never
    // disabled at all after 40+ clicks - it relies on swipe gestures instead, not a disable-at-the-
    // end button pair). Only exercise the hover/click interaction on desktop.
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
            // Too few cards to overflow the visible area - the carousel is structurally present but
            // genuinely has nothing to scroll to, matching what was manually confirmed on the site.
            // Nothing further to click here.
            expect(cardCount, 'If the carousel reports no usable next arrow, it should be because there are too few cards to scroll').toBeLessThanOrEqual(4);
        } else {
            // Enough cards to scroll - click through to the end, then verify the arrows swap:
            // previous becomes the only usable control once there's nothing left to reveal on the right.
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

// ---------------------------------------------------------------------------------------------
// Tours & Museum specific helpers (ported unchanged from the old 09-mcc.toursandmuseum.spec.js)
// ---------------------------------------------------------------------------------------------

async function waitForAndDismissPreferenceCenterToursMuseum(page) {
    // Kept as a distinctly-named alias only where the original file called it inline right after
    // the Tours & Museum card traversals' own goBack() - functionally identical to
    // waitForAndDismissPreferenceCenter above, so the shared implementation is reused directly
    // instead of duplicating it under a second name.
    await waitForAndDismissPreferenceCenter(page);
}

// Same multi-open accordion component already documented on the Getting To Lord's page - confirmed
// here too: 20 headers exist in the DOM but only 6 are visible (the rest are unused hidden template
// slots, same harmless CMS noise already documented elsewhere in this project). Unlike the generic
// testAccordionItemsImmediately used for the new gap pages, Tours & Museum's own 6 items are expanded
// fully in order first, then collapsed fully in reverse order (ported unchanged, non-soft assertions).
async function expandThenCollapseAccordionsBatch(page, labels) {
    for (const label of labels) {
        await test.step(`Expand ${label}`, async () => {
            const header = page.locator('.accordion__header:visible', { hasText: label }).first();
            await header.scrollIntoViewIfNeeded();
            await expect(header, `${label} should start collapsed (showing the + state)`).toHaveClass(/collapsed/);

            await dismissCookieOverlayIfPresent(page);
            await page.waitForTimeout(400);
            await header.evaluate((el) => el.click());
            await expect(header, `${label} should show the expanded (-) state after clicking`).not.toHaveClass(/collapsed/);

            const targetSelector = await header.getAttribute('data-target');
            await expect(page.locator(targetSelector), `${label}'s content should be visible once expanded`).toBeVisible();
        });
    }

    for (const label of [...labels].reverse()) {
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
}

// Finds the "Tours and Experiences" card by its title (case-insensitive, since Live renders these in
// all-caps CSS text-transform but the underlying text/UAT2 casing may differ) and returns its "Find
// out more"/"Buy Now"/etc CTA link.
function findToursCardLink(page, title) {
    const card = page.locator('.ctaTile--panel', { hasText: title }).first();
    return card.locator('a.ctaTile__link').first();
}

// ---------------------------------------------------------------------------------------------
// Fixtures and Results specific helpers (ported unchanged from the old 05-mcc.fixturesandresults.spec.js)
// ---------------------------------------------------------------------------------------------

function monthSectionHeadings(page) {
    return page.locator('h2.sectionTitle');
}

async function getMonthSectionTexts(page) {
    const texts = await monthSectionHeadings(page).allInnerTexts();
    return texts.map((text) => text.trim().toLowerCase());
}

function inPageNavLinks(page) {
    return page.locator('.inPageNavigation__link');
}

async function getInPageNavLabels(page) {
    const labels = await inPageNavLinks(page).locator('.inPageNavigation__label').allInnerTexts();
    return labels.map((label) => label.trim().toLowerCase());
}

async function getActiveInPageNavIndex(page) {
    return page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('.inPageNavigation__link'));
        return links.findIndex((link) => link.classList.contains('inPageNavigation__link--active'));
    });
}

async function getInPageNavBorderColor(page, index) {
    return page.evaluate((idx) => {
        const link = document.querySelectorAll('.inPageNavigation__link')[idx];
        return window.getComputedStyle(link, '::before').borderLeftColor;
    }, index);
}

async function scrollToMonthSection(page, index) {
    // The scroll-spy only flips the active in-page nav item once the section's marker crosses the
    // top of the viewport - scrollIntoViewIfNeeded()'s default "nearest" alignment doesn't reliably
    // cross that threshold, so force the marker to the very top of the viewport instead.
    await page.locator('.inPageNavigationSection').nth(index).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(500);
}

async function clickInPageNavItem(page, index) {
    // The topmost in-page nav item(s) can end up rendered behind the sticky meganav header depending
    // on scroll position (confirmed via a real "subtree intercepts pointer events" failure during
    // test authoring - a genuine overlap, same family as the search-box overlap noted elsewhere) -
    // dispatch the click on the element directly so this test isn't flaky depending on exactly
    // where the widget lands on screen.
    await inPageNavLinks(page).nth(index).evaluate((el) => el.click());
    await page.waitForTimeout(600);
}

async function verifyAttachmentLink(page, locator, { linkLabel, expectedContentTypeSubstring }) {
    await expect(locator, `"${linkLabel}" link should be visible`).toBeVisible();
    const href = await locator.getAttribute('href');
    expect(href, `"${linkLabel}" link should have an href`).toBeTruthy();

    const response = await page.request.get(new URL(href, page.url()).toString());
    expect(response.status(), `"${linkLabel}" destination should not return an error status`).toBeLessThan(400);
    expect(response.headers()['content-type'] || '', `"${linkLabel}" destination should serve the expected content type`).toContain(expectedContentTypeSubstring);
}

function filterSelect(page, index) {
    return page.locator('.filters select.filters__filter').nth(index);
}

async function openFiltersIfCollapsed(page) {
    // Below the desktop breakpoint the filter selects sit inside a collapsed panel behind a
    // "Filters" handle - on desktop that same panel is already visually open.
    const firstSelect = filterSelect(page, 0);
    if (await firstSelect.isVisible().catch(() => false)) {
        return;
    }

    const handle = page.locator('.filters__mobileHandle').first();
    await clickWithCookieGuard(page, handle);
    await expect(firstSelect, 'The filters panel should reveal its selects once expanded').toBeVisible();
}

async function selectFilterAndWait(page, selectLocator, label) {
    // Every filter selection is a full page navigation, which re-collapses the filters panel on
    // tablet/mobile - re-open it before each selection, not just once up front.
    await openFiltersIfCollapsed(page);

    // selectOption() triggers the filter's onChange navigation, but page.waitForLoadState('load')
    // called *after* it can resolve immediately against the still-current (pre-navigation) page if
    // the navigation hasn't started yet - racing ahead into the next selection before this one's
    // navigation actually lands. Pairing the wait with the action via Promise.all avoids that.
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'load' }),
        selectLocator.selectOption({ label }),
    ]);
    await dismissCookieOverlayIfPresent(page);
}

// ---------------------------------------------------------------------------------------------
// Tickets FAQs specific helpers (ported unchanged from the old 12-mcc.ticketsfaqs.spec.js)
// ---------------------------------------------------------------------------------------------

// Same multi-open accordion component already documented on Getting To Lord's and Tours & Museum -
// confirmed here too (opening a later item does not collapse an earlier one). Given this page has
// ~31 visible FAQ items (an order of magnitude more than most other accordions in this project),
// every assertion here uses expect.soft() so one malformed item can't abort testing every item queued
// up after it. Deliberately opens and closes each item immediately, one at a time, rather than
// expanding a whole section's items first and only collapsing them afterwards (that "expand-all-
// then-collapse-all" shape was tried first and reproduced a genuine ~17-minute runtime on Live - with
// several tall FAQ answers left open simultaneously, the page grows very tall and every subsequent
// scrollIntoViewIfNeeded has to fight much larger, still-settling reflows). Never letting more than
// one item be open at a time keeps the page's height (and thus scroll cost) roughly constant.
async function expandThenCollapseAccordionsImmediately(page, labels) {
    for (const label of labels) {
        await test.step(`Expand and collapse ${label}`, async () => {
            const header = page.locator('.accordion__header:visible', { hasText: label }).first();
            await header.scrollIntoViewIfNeeded();
            expect.soft(await header.evaluate((el) => el.className.includes('collapsed')), `${label} should start collapsed (showing the + state)`).toBe(true);

            await dismissCookieOverlayIfPresent(page);
            await header.evaluate((el) => el.click());
            expect.soft(await header.evaluate((el) => el.className.includes('collapsed')), `${label} should show the expanded (-) state after clicking`).toBe(false);

            const targetSelector = await header.getAttribute('data-target');
            expect.soft(await page.locator(targetSelector).isVisible(), `${label}'s content should be visible once expanded`).toBe(true);

            // This accordion's own collapse JS silently swallows a click fired while its expand
            // transition is still settling (same family of race already documented for Slick
            // carousels and Bootstrap collapse.js elsewhere in this project) - confirmed here too via
            // a real run where several items' 2nd click had no effect at all without this pause.
            await page.waitForTimeout(400);
            await header.evaluate((el) => el.click());
            expect.soft(await header.evaluate((el) => el.className.includes('collapsed')), `${label} should return to the collapsed (+) state after clicking again`).toBe(true);
            await page.locator(targetSelector).waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
            expect.soft(await page.locator(targetSelector).isVisible(), `${label}'s content should be hidden once collapsed`).toBe(false);
        });
    }
}

// Discovers the FAQ items belonging to one anchor-linked section only, so each section's accordion is
// expanded/collapsed independently rather than all 31 at once - scoped between this anchor and the
// next one (or end of the accordion block if it's the last section), confirmed via direct inspection
// that all of a section's items sit contiguously in document order between its own anchor and the next.
async function faqLabelsBetweenAnchors(page, fromAnchorId, toAnchorId) {
    return page.evaluate(({ fromAnchorId, toAnchorId }) => {
        const from = document.getElementById(fromAnchorId);
        const to = toAnchorId ? document.getElementById(toAnchorId) : null;
        const headers = Array.from(document.querySelectorAll('.accordion__header')).filter((el) => el.offsetParent !== null);
        return headers
            .filter((h) => {
                const afterFrom = !!(from.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
                const beforeTo = !to || !!(h.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING);
                return afterFrom && beforeTo;
            })
            .map((h) => h.textContent.trim());
    }, { fromAnchorId, toAnchorId });
}

// ===============================================================================================
// Matchday information
// ===============================================================================================

test('Visit Lord\'s - Matchday Information - England v India ODI Matchday Guide Traversal', async ({ page, baseURL }) => {
    await runVisitLordsPageTraversal(page, baseURL, {
        menuPath: ['Matchday information', 'England v India ODI Matchday Guide'],
        h1Pattern: /Coming to England v India ODI/i,
        titlePattern: /England v India ODI/i,
    });
});

test('Visit Lord\'s - Matchday Information - Plan your day Traversal', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Navigate via the Visit Lord\'s menu', async () => {
        const navigated = await navigateViaVisitLordsMenu(page, ['Matchday information', 'Plan your day']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Plan Your Day heading').toHaveText(/Plan Your Day/i);
    });

    await test.step('Verify the page title', async () => {
        // Confirmed via direct re-testing (2026-07-14): UAT2 now shows the same real, page-specific
        // title as Live (previously the generic sitewide "Lords MCC (UAT)" fallback) - single
        // assertion covers both environments.
        await expect(page, 'The title should contain the page name').toHaveTitle(/plan your day/i);
    });

    await test.step('Verify the "Coming to Lord\'s?" heading', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /coming to lord/i }).first(), 'The page should show the Coming to Lord\'s? heading').toBeVisible();
    });

    const videoIframe = page.locator('iframe.embed-responsive-item').first();
    const videoFrame = page.frameLocator('iframe.embed-responsive-item').first();

    await test.step('Play the YouTube video', async () => {
        await videoIframe.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        // Confirmed via direct re-testing: since this entry test now arrives here via a meganav
        // click-through (navigateViaVisitLordsMenu) rather than a single direct goto, the OneTrust
        // "Privacy Preference Center" backdrop can still be mid-fade-in/re-appear at the exact
        // moment this step runs, intercepting the click - same family of race already documented on
        // waitForAndDismissPreferenceCenter. Guard the click explicitly rather than relying on the
        // one dismissal already done earlier in navigation.
        await dismissCookieOverlayIfPresent(page);
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

test('Visit Lord\'s - Plan Your Day - Things To Do Traversal', async ({ page, baseURL }) => {
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

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should at least contain the page name').toHaveTitle(/things to do/i);
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

        // Confirmed real content defect, re-verified directly on 2026-07-14: this link now 404s on
        // BOTH Live and UAT2 (previously only documented as a UAT2-only defect in project memory -
        // that appears to have since spread to Live too, or Live was never actually checked directly).
        // Kept as a real target rather than swapped out, same "surface, don't mask" convention as
        // every other confirmed defect in this project.
        await clickContentLinkAndVerify(page, {
            link: contentLinksByText(page, /^volunteer$/i).first(),
            label: 'Happy To Help Volunteer',
            expectedPath: '/mcc/careers/volunteer',
            baseURL,
        });
    });

    await test.step('Verify the recurring "Your Day at Lord\'s" section is present', async () => {
        // The link cards here are the same ones covered by the Plan Your Day traversal above -
        // traversing each of those is separate, already-planned future work, not repeated here.
        await expect(page.getByRole('heading', { level: 2, name: /your day at lord/i }).first(), 'The page should show the Your Day at Lord\'s heading').toBeVisible();
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Plan Your Day - What To Bring Traversal', async ({ page, context, baseURL }) => {
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

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/what to bring/i);
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

        // Raw href is the vanity path "/online-store" opened in a new tab (target="_blank"), which
        // 301-redirects internally to "/store/online-store" before finally landing on the separate
        // storefront domain "store.lords.org". Confirmed via direct re-testing (2026-07-14) that this
        // redirect chain and final destination are now identical on BOTH environments (previously
        // UAT2 stopped at the internal "/store/online-store" page instead of continuing out to the
        // external storefront) - single assertion covers both.
        const buyNowButton = page.locator('a.button', { hasText: /^Buy Now$/i }).first();
        await buyNowButton.scrollIntoViewIfNeeded();

        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, buyNowButton),
        ]);
        await popup.waitForLoadState('load').catch(() => { });

        expect(new URL(popup.url()).host, 'Buy Now should open the live storefront domain').toBe('store.lords.org');

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

test('Visit Lord\'s - Plan Your Day - Accessibility Traversal', async ({ page, baseURL }) => {
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

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/accessibility/i);
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

        // Unlike the Plan Your Day video (a YouTube embed), this one is a genuine Vimeo embed (same
        // iframe.embed-responsive-item wrapper convention, but player.vimeo.com instead of
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

test('Visit Lord\'s - Plan Your Day - Food & Drink Traversal', async ({ page, baseURL }) => {
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

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/food and drink/i);
    });

    await test.step('Follow the Explore Matchday Hampers button', async () => {
        const hampersButton = page.locator('a.button--primary', { hasText: /explore matchday hampers/i }).first();
        await hampersButton.scrollIntoViewIfNeeded();
        await expect(hampersButton, 'The Explore Matchday Hampers button should be visible').toBeVisible();

        // Confirmed via direct re-testing (2026-07-14) that the Picnic Hampers page's own CONTENT is
        // now the same real, finished page on both environments (previously UAT2's destination was a
        // placeholder). However, this button's own href is a separate, still-real, UAT2-only defect:
        // confirmed via direct DOM inspection that it's hardcoded to the absolute Live production
        // domain (https://www.lords.org/...) rather than a relative path, so clicking it on UAT2
        // silently navigates the visitor off the UAT2 environment onto Live production (landing on
        // the same content, just the wrong environment) - part of the same defect family documented
        // at the top of this file. Left failing here rather than worked around.
        const startHost = new URL(page.url()).host;
        await clickWithCookieGuard(page, hampersButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).host, 'Explore Matchday Hampers should stay on the same site (confirmed real UAT2-only defect: this button\'s href is hardcoded to Live\'s domain)').toBe(startHost);

        const statusCheck = await page.request.get(page.url());
        expect(statusCheck.status(), 'Explore Matchday Hampers destination should not return an error status').toBeLessThan(400);
        await expect(page.locator('h1').first(), 'The Matchday Hampers destination should show a Picnic Hampers heading').toHaveText(/picnic hampers/i);

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

test('Visit Lord\'s - Plan Your Day - Ground Map Traversal', async ({ page, baseURL }) => {
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

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/ground map/i);
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

test('Visit Lord\'s - Plan Your Day - What To Wear Traversal', async ({ page, baseURL }) => {
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

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/what to wear/i);
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
        // Confirmed via direct re-testing (2026-07-14) that the previously-documented UAT2 defect
        // here (a duplicated accordion block incorrectly also rendered between the intro text and
        // the image) is now fixed - both environments show exactly one, correctly-placed block.
        const accordionBlockCount = await page.locator('.inlineAccordion').count();
        expect(accordionBlockCount, 'There should be exactly one accordion block on this page').toBe(1);
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

test('Visit Lord\'s - Matchday Information - Digital Ticketing FAQs Traversal', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Navigate via the Visit Lord\'s menu', async () => {
        // Confirmed via direct re-testing (2026-07-14) that /lords-tickets/faqs now returns 200 on
        // UAT2 too (previously confirmed 404ing there as of 2026-07-10) - no presence-gating needed
        // anymore, but the menu path itself is still the source of truth, so test.skip() is kept as
        // a defensive fallback in case a given environment's menu tree doesn't expose it yet.
        const navigated = await navigateViaVisitLordsMenu(page, ['Matchday information', 'Digital ticketing FAQs']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Digital Ticketing FAQs heading').toHaveText(/Digital Ticketing FAQs/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference ticketing FAQs').toHaveTitle(/FAQ/i);
    });

    await test.step('Follow the "Getting started" anchor link and test its FAQ accordion', async () => {
        const anchorLink = page.locator('a[href="#anchor-1"]').first();
        await anchorLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, anchorLink);
        await expect(page, 'Clicking the anchor link should update the URL hash').toHaveURL(/#anchor-1$/);

        await expect(page.getByRole('heading', { name: /The Lord's App: Getting started/i }).first(), 'The Getting started heading should be visible').toBeVisible();

        const labels = await faqLabelsBetweenAnchors(page, 'anchor-1', 'anchor-2');
        expect(labels.length, 'There should be at least one FAQ item in the Getting Started section').toBeGreaterThan(0);
        await expandThenCollapseAccordionsImmediately(page, labels);
    });

    await test.step('Follow the "Finding your tickets" anchor link and test its FAQ accordion', async () => {
        const anchorLink = page.locator('a[href="#anchor-2"]').first();
        await anchorLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, anchorLink);
        await expect(page, 'Clicking the anchor link should update the URL hash').toHaveURL(/#anchor-2$/);

        await expect(page.getByRole('heading', { name: /Finding your tickets in the lord's app/i }).first(), 'The Finding your tickets heading should be visible').toBeVisible();

        const labels = await faqLabelsBetweenAnchors(page, 'anchor-2', 'anchor-3');
        expect(labels.length, 'There should be at least one FAQ item in the Finding your tickets section').toBeGreaterThan(0);
        await expandThenCollapseAccordionsImmediately(page, labels);
    });

    await test.step('Follow the "Sharing tickets" anchor link, its "how to" cards, and its FAQ accordion', async () => {
        const anchorLink = page.locator('a[href="#anchor-3"]').first();
        await anchorLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, anchorLink);
        await expect(page, 'Clicking the anchor link should update the URL hash').toHaveURL(/#anchor-3$/);

        await expect(page.getByRole('heading', { name: /Sharing tickets in the lord's app/i }).first(), 'The Sharing tickets heading should be visible').toBeVisible();

        // Confirmed real content facts: 3 "how to" guide cards (How to Distribute by Email, How to
        // Forward by App (F&F), How to set up Friends and Family), each linking to its own dedicated
        // guide page - checked here as encountered, before moving on to the FAQ items below them.
        const cards = await page.locator('.ctaTile', { has: page.locator('.ctaTile__title') }).evaluateAll((els) => els.map((el) => ({
            title: el.querySelector('.ctaTile__title')?.textContent.trim(),
            href: el.querySelector('a.ctaTile__link')?.getAttribute('href'),
        })));
        expect(cards.length, 'There should be at least one "how to" guide card').toBeGreaterThan(0);

        for (const card of cards) {
            await test.step(`"${card.title}" card`, async () => {
                const cardLink = page.locator('.ctaTile', { hasText: card.title }).first().locator('a.ctaTile__link').first();
                await cardLink.scrollIntoViewIfNeeded();
                await clickWithCookieGuard(page, cardLink);
                await page.waitForLoadState('load').catch(() => { });
                await dismissCookieOverlayIfPresent(page);

                expect(new URL(page.url()).pathname, `${card.title} should navigate to its own guide page`).toBe(new URL(card.href, baseURL).pathname);
                await expect(page.locator('h1').first(), `${card.title}'s destination page should have a real heading`).toBeVisible();

                await page.goBack();
                await page.waitForLoadState('load').catch(() => { });
                await dismissCookieOverlayIfPresent(page);
            });
        }

        const labels = await faqLabelsBetweenAnchors(page, 'anchor-3', 'anchor-4');
        expect(labels.length, 'There should be at least one FAQ item in the Sharing tickets section').toBeGreaterThan(0);
        await expandThenCollapseAccordionsImmediately(page, labels);
    });

    await test.step('Follow the "General ticketing FAQs" anchor link and test its FAQ accordion', async () => {
        const anchorLink = page.locator('a[href="#anchor-4"]').first();
        await anchorLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, anchorLink);
        await expect(page, 'Clicking the anchor link should update the URL hash').toHaveURL(/#anchor-4$/);

        await expect(page.getByRole('heading', { name: /General Ticketing Queries/i }).first(), 'The General Ticketing Queries heading should be visible').toBeVisible();

        const labels = await faqLabelsBetweenAnchors(page, 'anchor-4', null);
        expect(labels.length, 'There should be at least one FAQ item in the General Ticketing Queries section').toBeGreaterThan(0);
        await expandThenCollapseAccordionsImmediately(page, labels);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Matchday Information - Download the Lord\'s App Traversal', async ({ page, baseURL }) => {
    await runVisitLordsPageTraversal(page, baseURL, {
        menuPath: ['Matchday information', 'Download the Lord\'s App'],
        h1Pattern: /The Lord's App/i,
        titlePattern: /The Lord's App/i,
    });
});

// ===============================================================================================
// Fixtures and results
// ===============================================================================================

test('Visit Lord\'s - Fixtures and Results Traversal', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    await test.step('Navigate via the Visit Lord\'s menu', async () => {
        const navigated = await navigateViaVisitLordsMenu(page, ['Fixtures and results']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('.standardHeader__title'), 'The page should show the Fixtures & Results heading').toHaveText(/Fixtures\s*&\s*Results/i);
    });

    await test.step('Verify the hero Buy Tickets CTA', async () => {
        const buyTickets = page.locator('.standardHeader').getByRole('link', { name: /buy tickets/i });
        await expect(buyTickets, 'The hero should show a Buy Tickets button').toBeVisible();

        await clickWithCookieGuard(page, buyTickets);
        // This is a same-tab (target="_self") navigation, so a single waitForLoadState('load')
        // fired right after the click can occasionally resolve against the still-current
        // (pre-navigation) page if the navigation hasn't actually started yet - confirmed via a
        // real intermittent failure during re-verification where the host briefly still read the
        // Fixtures and Results page's own host. Polling the host is more robust than a single
        // point-in-time check here, same race already worked around via Promise.all elsewhere in
        // this file (e.g. selectFilterAndWait).
        await expect.poll(() => new URL(page.url()).host, {
            message: 'Buy Tickets should navigate to the Lord\'s ticketing site',
        }).toBe('tickets.lords.org');

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Going back from Buy Tickets should restore the Fixtures and Results page').toHaveURL(buildExpectedUrl(baseURL, '/lords/match-day/fixtures-and-results'));
    });

    await test.step('Scroll down and verify the standard footer is present', async () => {
        const footer = page.locator('footer.footer').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The standard MCC footer should be visible at the bottom of the page').toBeVisible();
    });
});

test('Visit Lord\'s - Fixtures and Results - Fixtures Month Sections and In-Page Navigation', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open the Fixtures and Results page (Fixtures tab)', async () => {
        await openPage(page, '/lords/match-day/fixtures-and-results');
    });

    let monthCount;
    await test.step('Verify the in-page navigation months match the on-page month sections', async () => {
        const sectionMonths = await getMonthSectionTexts(page);
        const navLabels = await getInPageNavLabels(page);

        expect(sectionMonths.length, 'The Fixtures tab should list at least one month section').toBeGreaterThan(0);
        expect(navLabels, 'The in-page navigation should list the same months, in the same order, as the page sections').toEqual(sectionMonths);
        monthCount = sectionMonths.length;
    });

    await test.step('Scroll through each month section and verify the in-page nav highlights it', async () => {
        for (let index = 0; index < monthCount; index += 1) {
            await scrollToMonthSection(page, index);
            expect(await getActiveInPageNavIndex(page), `Scrolling to month section ${index} should activate the matching in-page nav item`).toBe(index);
            expect(await getInPageNavBorderColor(page, index), `The active in-page nav item should render its focus (red) accent colour`).toBe(IN_PAGE_NAV_ACTIVE_BORDER_COLOR);

            if (index > 0) {
                expect(await getInPageNavBorderColor(page, index - 1), `A previously-focused in-page nav item should return to its non-focus colour`).toBe(IN_PAGE_NAV_INACTIVE_BORDER_COLOR);
            }
        }
    });

    await test.step('Scroll back up through each month section', async () => {
        for (let index = monthCount - 1; index >= 0; index -= 1) {
            await scrollToMonthSection(page, index);
            expect(await getActiveInPageNavIndex(page), `Scrolling back up to month section ${index} should activate the matching in-page nav item`).toBe(index);
        }
    });

    await test.step('Use the in-page navigation device to jump between months', async () => {
        for (let index = 0; index < monthCount; index += 1) {
            await clickInPageNavItem(page, index);
            expect(await getActiveInPageNavIndex(page), `Clicking in-page nav item ${index} should activate it`).toBe(index);
        }
    });
});

test('Visit Lord\'s - Fixtures and Results - Download Calendar and Print Fixtures', async ({ page }) => {
    await test.step('Open the Fixtures and Results page', async () => {
        await openPage(page, '/lords/match-day/fixtures-and-results');
    });

    await test.step('Verify Download Calendar resolves to a real calendar file, without downloading it', async () => {
        // Checked via a direct HTTP request rather than clicking - clicking this in headless
        // Chromium triggers a real file download, which we don't want to save to disk.
        await verifyAttachmentLink(page, page.locator('a.fixturesList__link--calendar'), {
            linkLabel: 'Download Calendar',
            expectedContentTypeSubstring: 'text/calendar',
        });
    });

    await test.step('Verify Print Fixtures resolves to a real PDF, without opening/downloading it', async () => {
        // Same reasoning as above - and empirically, clicking this link in headless Chromium
        // doesn't navigate or emit a trackable "download" event at all (confirmed non-deterministic
        // during test authoring), so a request-level check is also the only reliable way to verify it.
        await verifyAttachmentLink(page, page.locator('a.fixturesList__link--print'), {
            linkLabel: 'Print Fixtures',
            expectedContentTypeSubstring: 'application/pdf',
        });
    });
});

test('Visit Lord\'s - Fixtures and Results - Switch to Results and Verify Month Sections', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    await test.step('Open the Fixtures and Results page', async () => {
        await openPage(page, '/lords/match-day/fixtures-and-results');
    });

    const fixturesTab = page.locator('a.fixturesList__switch', { hasText: 'Fixtures' });
    const resultsTab = page.locator('a.fixturesList__switch', { hasText: 'Results' });

    await test.step('Verify Fixtures is selected by default', async () => {
        await expect(fixturesTab, 'Fixtures should be the pre-selected tab on load').toHaveClass(/fixturesList__switch--active/);
        await expect(resultsTab, 'Results should not be selected on load').not.toHaveClass(/fixturesList__switch--active/);
    });

    await test.step('Click Results and verify the focus state moves', async () => {
        await clickWithCookieGuard(page, resultsTab);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).searchParams.get('display'), 'Selecting Results should update the display query param').toBe('results');
        await expect(page.locator('a.fixturesList__switch', { hasText: 'Results' }), 'Results should become the selected tab').toHaveClass(/fixturesList__switch--active/);
        await expect(page.locator('a.fixturesList__switch', { hasText: 'Fixtures' }), 'Fixtures should lose the selected state').not.toHaveClass(/fixturesList__switch--active/);
    });

    // The Results tab can list many months' worth of history (one entry per month with results,
    // going back several years) with non-unique visible labels (e.g. several "September" entries
    // distinguished only by their target, not their text) - sampling the first few here is enough
    // to confirm the same section/in-page-nav mechanism works in reverse order; it isn't intended
    // to exhaustively walk the whole history.
    await test.step('Verify the Results month sections and in-page navigation stay in sync', async () => {
        const sectionMonths = await getMonthSectionTexts(page);
        const navLabels = await getInPageNavLabels(page);

        expect(sectionMonths.length, 'The Results tab should list at least one month section').toBeGreaterThan(0);
        expect(navLabels.slice(0, sectionMonths.length), 'The in-page navigation should list the same months, in the same order, as the page sections').toEqual(sectionMonths);

        const sampleSize = Math.min(3, sectionMonths.length);
        for (let index = 0; index < sampleSize; index += 1) {
            await scrollToMonthSection(page, index);
            expect(await getActiveInPageNavIndex(page), `Scrolling to Results month section ${index} should activate the matching in-page nav item`).toBe(index);
        }
    });
});

test('Visit Lord\'s - Fixtures and Results - Filter Results', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Results tab', async () => {
        await openPage(page, '/lords/match-day/fixtures-and-results?display=results');
        await openFiltersIfCollapsed(page);
    });

    await test.step('Cycle through every match type filter option', async () => {
        const typeSelect = filterSelect(page, 0);
        const optionLabels = await typeSelect.locator('option').allTextContents();

        for (const label of optionLabels.map((text) => text.trim())) {
            await test.step(`Select match type: ${label}`, async () => {
                const expectedValue = await typeSelect.locator('option', { hasText: label }).getAttribute('value');
                const expectedType = new URL(expectedValue, page.url()).searchParams.get('type') || '';

                await selectFilterAndWait(page, typeSelect, label);

                expect(new URL(page.url()).searchParams.get('type') || '', `Selecting "${label}" should update the type filter in the URL`).toBe(expectedType);
            });
        }
    });

    await test.step('Reset to All Matches', async () => {
        await selectFilterAndWait(page, filterSelect(page, 0), 'All Matches');
    });

    await test.step('Switch the ground filter to All Grounds', async () => {
        await selectFilterAndWait(page, filterSelect(page, 1), 'All Grounds');

        expect(new URL(page.url()).searchParams.get('ground'), 'Selecting All Grounds should update the ground filter in the URL').toBe('all');
    });

    await test.step('Filter results to September 2025', async () => {
        await selectFilterAndWait(page, filterSelect(page, 2), 'September 2025');

        const url = new URL(page.url());
        expect(url.searchParams.get('month'), 'Selecting September 2025 should set month=9').toBe('9');
        expect(url.searchParams.get('year'), 'Selecting September 2025 should set year=2025').toBe('2025');

        const sectionMonths = await getMonthSectionTexts(page);
        if (sectionMonths.length > 0) {
            expect(sectionMonths, 'Filtering to September 2025 should only show September sections').toEqual(['september']);
        }
    });

    await test.step('Filter results to May 2025', async () => {
        await selectFilterAndWait(page, filterSelect(page, 2), 'May 2025');

        const url = new URL(page.url());
        expect(url.searchParams.get('month'), 'Selecting May 2025 should set month=5').toBe('5');
        expect(url.searchParams.get('year'), 'Selecting May 2025 should set year=2025').toBe('2025');

        const sectionMonths = await getMonthSectionTexts(page);
        if (sectionMonths.length > 0) {
            expect(sectionMonths, 'Filtering to May 2025 should only show May sections').toEqual(['may']);
        }
    });

    await test.step('Scroll down and verify the standard footer is present', async () => {
        const footer = page.locator('footer.footer').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The standard MCC footer should be visible at the bottom of the page').toBeVisible();
    });
});

test('Visit Lord\'s - How to get here Traversal', async ({ page, context, baseURL }) => {
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

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/how to get here/i);
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

    // Each accordion expansion/collapse pushes all later content up or down the page, shifting every
    // subsequent header's screen position - a real pointer click was observed to intermittently miss
    // (click registers but Bootstrap's toggle silently doesn't fire) once several sections above it
    // had already changed height. Dispatching the click directly on the element sidesteps that
    // layout-position dependency entirely (same pattern used for other layout-shifting toggles
    // elsewhere in this project's specs).
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

// ===============================================================================================
// Tours and Museum
// ===============================================================================================

test('Visit Lord\'s - Tours and Museum Traversal', async ({ page, context, baseURL }) => {
    test.setTimeout(180000);

    await test.step('Navigate via the Visit Lord\'s menu', async () => {
        const navigated = await navigateViaVisitLordsMenu(page, ['Tours and Museum']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Tours & Museum heading').toHaveText(/Tours\s*&\s*Museum/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/tours/i);
    });

    await test.step('Follow the hero "Book the Lord\'s Tour" button', async () => {
        const heroButton = page.locator('a.button', { hasText: /^Book the Lord's Tour$/i }).first();
        if ((await heroButton.count()) === 0) {
            return;
        }

        await heroButton.scrollIntoViewIfNeeded();
        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, heroButton),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'Book the Lord\'s Tour should open the external booking site').toBe('tours.lords.org');
        await popup.close();
    });

    await test.step('Verify the "What will I see?" section and its Book Now button (if present)', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /what will i see/i }).first(), 'The page should show the What will I see? heading').toBeVisible();

        const bookNowButton = page.locator('a.button', { hasText: /^Book Now$/i }).first();
        if ((await bookNowButton.count()) === 0) {
            return;
        }

        await bookNowButton.scrollIntoViewIfNeeded();
        const href = await bookNowButton.getAttribute('href');
        await clickWithCookieGuard(page, bookNowButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).host, 'Book Now should navigate to the external booking site').toBe(new URL(href).host);

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenterToursMuseum(page);
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Play the intro YouTube video', async () => {
        const videoIframe = page.locator('iframe[src*="youtube"]').first();
        if ((await videoIframe.count()) === 0) {
            return;
        }

        const videoFrame = page.frameLocator('iframe[src*="youtube"]').first();
        await videoIframe.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        await videoFrame.locator('.ytmCuedOverlayPlayButton').click({ timeout: 15000 });
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
        await expect.poll(() => videoFrame.locator('video').first().evaluate((video) => video.paused).catch(() => false), {
            message: 'The video should pause when clicked',
        }).toBe(true);
    });

    await test.step('Verify the "Tours and Experiences" cards and their hover effect (if present)', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /tours and experiences/i }).first(), 'The page should show the Tours and Experiences heading').toBeVisible();

        const cards = page.locator('.ctaTile--panel');
        const cardCount = await cards.count();

        for (let index = 0; index < cardCount; index += 1) {
            const card = cards.nth(index);
            const title = (await card.locator('.ctaTile__title').first().textContent()).trim();

            await test.step(`"${title}" card hover effect`, async () => {
                await card.scrollIntoViewIfNeeded();
                // Confirmed via direct CSS inspection: this card variant (.ctaTile--panel) doesn't
                // zoom its image on hover like the "Other premium hospitality" cards elsewhere in
                // this project do (its own hover rule sets the background scale to exactly 1, a
                // deliberate override/no-op) - the real, verifiable hover effect here is the box
                // shadow around the whole card.
                const boxShadowBefore = await card.evaluate((el) => getComputedStyle(el).boxShadow);
                await card.hover();
                await expect.poll(() => card.evaluate((el) => getComputedStyle(el).boxShadow), {
                    message: `Hovering the "${title}" card should change its box shadow`,
                }).not.toBe(boxShadowBefore);
            });
        }
    });

    await test.step('Test the accordions (if present)', async () => {
        const accordionLabels = await page.locator('.accordion__header:visible').evaluateAll((els) => els.map((el) => el.textContent.trim()));
        if (accordionLabels.length === 0) {
            return;
        }

        await expandThenCollapseAccordionsBatch(page, accordionLabels);
    });

    await test.step('Follow the "The Lord\'s Tour" Book Now and Gift Vouchers buttons (if present)', async () => {
        const sectionHeading = page.getByRole('heading', { level: 5, name: /^The Lord's Tour$/i }).first();
        if ((await sectionHeading.count()) === 0) {
            return;
        }

        await sectionHeading.scrollIntoViewIfNeeded();

        const bookNowButton = page.locator('a.button', { hasText: /^Book Now$/i }).last();
        const [bookPopup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, bookNowButton),
        ]);
        await bookPopup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(bookPopup.url()).host, 'Book Now should open the external booking site').toBe('tours.lords.org');
        await bookPopup.close();

        const giftVouchersButton = page.locator('a.button', { hasText: /gift vouchers/i }).first();
        const [giftPopup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, giftVouchersButton),
        ]);
        await giftPopup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(giftPopup.url()).host, 'Gift Vouchers should open the external booking site').toBe('tours.lords.org');
        await giftPopup.close();
    });

    await test.step('Verify the MCC Museum section (if present)', async () => {
        const heading = page.getByRole('heading', { level: 2, name: /mcc museum/i }).first();
        if ((await heading.count()) === 0) {
            return;
        }

        await heading.scrollIntoViewIfNeeded();
        await expect(heading, 'The page should show the MCC Museum heading').toBeVisible();
        await expect(page.getByRole('heading', { level: 5, name: /opening.*ticket prices/i }).first(), 'The page should show the Opening & ticket prices heading').toBeVisible();

        // Confirmed real content defect: the "MCC Museum" link here points at a web.archive.org
        // snapshot from 2025 instead of the live site's own heritage-collections page - left as a
        // deliberately failing assertion rather than worked around, same "surface, don't mask"
        // convention as every other confirmed defect in this project.
        const museumLink = page.locator('.oneColumnContentRow__wysiwyg a', { hasText: /^MCC Museum$/i }).first();
        const href = await museumLink.getAttribute('href');
        expect(new URL(href).host, 'The MCC Museum link should point at the live site, not an archived snapshot').toBe(new URL(baseURL).host);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Tours and Museum - Guided Tours at Lord\'s Traversal', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'Guided Tours at Lord\'s');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Navigate to Guided Tours at Lord\'s', async () => {
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        // Confirmed real content defect on UAT2 only (2026-07-14): this card's own href is hardcoded
        // to the absolute Live production domain rather than a relative path, so clicking it on UAT2
        // silently navigates off the UAT2 environment onto Live - part of the same defect family
        // documented at the top of this file. Left failing here rather than worked around.
        await expect(page, 'Clicking Guided Tours at Lord\'s should navigate to the expected page (confirmed real UAT2-only defect: this card\'s href is hardcoded to Live\'s domain)').toHaveURL(buildExpectedUrl(baseURL, '/lords/lord-s-experience/tours/lords-guided-tour'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Guided Tours heading').toHaveText(/Guided Tours? of Lord's/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/guided tour/i);
    });

    await test.step('Follow the Book Now button', async () => {
        const bookNowButton = page.locator('a.button', { hasText: /^Book Now$/i }).first();
        await bookNowButton.scrollIntoViewIfNeeded();
        const href = await bookNowButton.getAttribute('href');
        await clickWithCookieGuard(page, bookNowButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).host, 'Book Now should navigate to the external booking site').toBe(new URL(href).host);

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenterToursMuseum(page);
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Tours and Museum - Private and Group Tours Traversal', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'Private and Group Tours');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Navigate to Private and Group Tours', async () => {
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Clicking Private and Group Tours should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/lord-s-experience/tours/lord-s-private-tour'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Private and Group Tours heading').toHaveText(/Private and Group Tours/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/private tour/i);
    });

    await test.step('Verify the tours@mcc.org.uk contact mailto', async () => {
        // This page's primary CTA is a plain mailto within the body content, not a styled button -
        // confirmed via direct inspection, no "Book Now"-style button exists here.
        const mailtoLink = page.locator('a[href^="mailto:"]', { hasText: /tours@mcc\.org\.uk/i }).first();
        await mailtoLink.scrollIntoViewIfNeeded();
        await expect(mailtoLink, 'A tours@mcc.org.uk contact link should be present').toBeVisible();
        const href = await mailtoLink.getAttribute('href');
        expect(href, 'The mailto should contain a real-looking email address').toMatch(/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Tours and Museum - England v India Women\'s Test Match Traversal', async ({ page }) => {
    test.setTimeout(60000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'England v India Women\'s Test Match');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Follow the England v India Women\'s Test Match card to the external ticketing site', async () => {
        // External ticket link, same tab (confirmed target is unset) - only checked as a working
        // link, same convention as every other external CTA in this project, not a full traversal
        // into a third-party site's own content.
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        // Confirmed via direct testing: on a throttled mobile-emulated run, this external site can
        // take longer than the usual load-state wait to actually land - waited on the URL itself
        // (generous timeout) rather than trusting waitForLoadState('load') to mean the navigation
        // has completed.
        await page.waitForURL(/tickets\.lords\.org/, { timeout: 20000 }).catch(() => { });

        expect(new URL(page.url()).host, 'The card should navigate to the external ticketing site').toBe('tickets.lords.org');
    });
});

test('Visit Lord\'s - Tours and Museum - Players\' Dining Experience Traversal', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'PLAYERS\' DINING EXPERIENCE');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Navigate to Players\' Dining Experience', async () => {
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        // Confirmed real content defect on UAT2 only (2026-07-14): this card's own title text is
        // missing its apostrophe there ("PLAYERS DINING EXPERIENCE" instead of "PLAYERS' DINING
        // EXPERIENCE"), so findToursCardLink's substring match against the apostrophe'd name falls
        // through to the sibling "HOSTED PLAYERS' DINING EXPERIENCE" card instead (which does contain
        // that exact substring) - landing on the Hosted variant's own anchored URL instead. A genuine
        // CMS content typo, not a test bug; left failing here rather than worked around.
        await expect(page, 'Clicking Players\' Dining Experience should navigate to the expected page (confirmed real UAT2-only defect: this card\'s title is missing its apostrophe, causing a mismatch to the "Hosted" sibling card)').toHaveURL(buildExpectedUrl(baseURL, '/lords/lord-s-experience/tours/players-dining-room'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Players\' Dining Room heading').toHaveText(/Players' Dining Room/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/players' dining/i);
    });

    await test.step('Follow the Players\' Dining Room Experience Book Now button', async () => {
        const bookNowButton = page.locator('a.button', { hasText: /^Book Now$/i }).first();
        await bookNowButton.scrollIntoViewIfNeeded();
        const href = await bookNowButton.getAttribute('href');
        const target = await bookNowButton.getAttribute('target');

        if (target === '_blank') {
            const [popup] = await Promise.all([
                page.context().waitForEvent('page'),
                clickWithCookieGuard(page, bookNowButton),
            ]);
            await popup.waitForLoadState('domcontentloaded').catch(() => { });
            expect(new URL(popup.url()).host, 'Book Now should open the external booking site').toBe(new URL(href).host);
            await popup.close();
        } else {
            await clickWithCookieGuard(page, bookNowButton);
            await page.waitForLoadState('load').catch(() => { });
            expect(new URL(page.url()).host, 'Book Now should navigate to the external booking site').toBe(new URL(href).host);
            await page.goBack();
            await page.waitForLoadState('load').catch(() => { });
            await waitForAndDismissPreferenceCenterToursMuseum(page);
            await dismissCookieOverlayIfPresent(page);
        }
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Tours and Museum - Hosted Players\' Dining Experience Traversal', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'HOSTED PLAYERS\' DINING EXPERIENCE');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Navigate to Hosted Players\' Dining Experience', async () => {
        await cardLink.scrollIntoViewIfNeeded();
        const href = await cardLink.getAttribute('href');
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Clicking Hosted Players\' Dining Experience should navigate to the expected page').toHaveURL(new URL(href, buildExpectedUrl(baseURL, '/')).toString());
    });

    await test.step('Verify the Hosted Players\' Dining Room Experience heading', async () => {
        // Confirmed real content wording: this section's own heading reads "Players Dining Room
        // Experience - Hosted By A Former Cricketer", not "Hosted Players' Dining Room Experience"
        // (that phrasing is only used on the card back on the main Tours & Museum page).
        await expect(page.getByRole('heading', { name: /Hosted By A Former Cricketer/i }).first(), 'The page should show the hosted dining experience heading').toBeVisible();
    });

    await test.step('Follow the Hosted Players\' Dining Room Experience Book Now button', async () => {
        // Confirmed via direct inspection: the page has exactly two VISIBLE "Book Now" buttons, in
        // document order - the first (id=26675) belongs to the base Players' Dining Room Experience
        // (anchor-1), the second (id=27696) belongs to this Hosted variant (anchor-2). Several other
        // hidden template "Book Now"/"Buy Now" links with the same .button class also exist in the
        // DOM, so this is scoped to visible ones specifically rather than by DOM position relative
        // to the anchor.
        const visibleBookNowButtons = page.locator('a.button:visible', { hasText: /^Book Now$/i });
        const bookNowButton = visibleBookNowButtons.nth(1);
        const buttonHref = await bookNowButton.getAttribute('href');
        expect(buttonHref, 'The Hosted Players\' Dining Room Experience should have its own Book Now button').toBeTruthy();

        await bookNowButton.scrollIntoViewIfNeeded();
        const target = await bookNowButton.getAttribute('target');

        if (target === '_blank') {
            const [popup] = await Promise.all([
                page.context().waitForEvent('page'),
                clickWithCookieGuard(page, bookNowButton),
            ]);
            await popup.waitForLoadState('domcontentloaded').catch(() => { });
            expect(new URL(popup.url()).host, 'Book Now should open the external booking site').toBe(new URL(buttonHref).host);
            await popup.close();
        } else {
            await clickWithCookieGuard(page, bookNowButton);
            await page.waitForLoadState('load').catch(() => { });
            expect(new URL(page.url()).host, 'Book Now should navigate to the external booking site').toBe(new URL(buttonHref).host);
            await page.goBack();
            await page.waitForLoadState('load').catch(() => { });
            await waitForAndDismissPreferenceCenterToursMuseum(page);
            await dismissCookieOverlayIfPresent(page);
        }
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Tours and Museum - Lord\'s Ultimate Collection Traversal', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'Lord\'s Ultimate Collection');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Navigate to Lord\'s Ultimate Collection', async () => {
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        // Confirmed real content quirk: the card's raw href is the stale "beyond-the-boundary" slug,
        // which the server transparently redirects (200, same request) to "lords-ultimate-collection" -
        // checked against the real destination the browser lands on, not the stale href.
        await expect(page, 'Clicking Lord\'s Ultimate Collection should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/lord-s-experience/tours/lords-ultimate-collection'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Lord\'s Ultimate Collection heading').toHaveText(/Lord's Ultimate Collection/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/ultimate collection/i);
    });

    await test.step('Follow the Book Now button', async () => {
        const bookNowButton = page.locator('a.button', { hasText: /^Book Now$/i }).first();
        await bookNowButton.scrollIntoViewIfNeeded();
        const href = await bookNowButton.getAttribute('href');

        const [popup] = await Promise.all([
            page.context().waitForEvent('page'),
            clickWithCookieGuard(page, bookNowButton),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'Book Now should open the external booking site').toBe(new URL(href).host);
        await popup.close();
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Tours and Museum - Father Time Wall Plaque Traversal', async ({ page, context }) => {
    test.setTimeout(60000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'FATHER TIME WALL PLAQUE');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Follow the Father Time Wall Plaque card to the external ordering site', async () => {
        // Confirmed real content quirk: this card's raw target attribute is malformed
        // (target="'_blank'", with literal extra quote characters) - confirmed via direct testing
        // that Chromium still opens it as a new tab regardless, so this is tested as new-tab
        // behaviour, matching the actual observed outcome rather than the letter of the markup.
        await cardLink.scrollIntoViewIfNeeded();
        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, cardLink),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'The card should open the external ordering site').toBe('fathertimewall.lords.org');
        await popup.close();
    });
});

test('Visit Lord\'s - Tours and Museum - Ultra India VIP Experience Traversal', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'ULTRA INDIA VIP EXPERIENCE');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Navigate to Ultra India VIP Experience', async () => {
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Clicking Ultra India VIP Experience should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/lord-s-experience/tours/exclusive-ultra-india-experience'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Ultra India VIP Experience heading').toHaveText(/Ultra India VIP Experience/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/ultra india/i);
    });

    await test.step('Follow the Buy Gift Voucher button', async () => {
        const buyVoucherButton = page.locator('a.button', { hasText: /buy gift voucher/i }).first();
        await buyVoucherButton.scrollIntoViewIfNeeded();
        const href = await buyVoucherButton.getAttribute('href');
        await clickWithCookieGuard(page, buyVoucherButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).host, 'Buy Gift Voucher should navigate to the external booking site').toBe(new URL(href).host);

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenterToursMuseum(page);
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Tours and Museum - The Australian Special Traversal', async ({ page, baseURL, context }) => {
    test.setTimeout(90000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'The Australian Special');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Navigate to The Australian Special', async () => {
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        // Confirmed real content defect on UAT2 only (2026-07-14): this card's own href is hardcoded
        // to the absolute Live production domain rather than a relative path, so clicking it on UAT2
        // silently navigates off the UAT2 environment onto Live - part of the same defect family
        // documented at the top of this file. Left failing here rather than worked around.
        await expect(page, 'Clicking The Australian Special should navigate to the expected page (confirmed real UAT2-only defect: this card\'s href is hardcoded to Live\'s domain)').toHaveURL(buildExpectedUrl(baseURL, '/lords/lord-s-experience/tours/bespoke-tour-australia'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show The Australian Special heading').toHaveText(/The Australian Special/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/australian special/i);
    });

    await test.step('Follow the first Book Now button', async () => {
        const bookNowButtons = page.locator('a.button', { hasText: /^Book Now$/i });
        const firstButton = bookNowButtons.first();
        await firstButton.scrollIntoViewIfNeeded();
        const href = await firstButton.getAttribute('href');

        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, firstButton),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'Book Now should open the external booking site').toBe(new URL(href).host);
        await popup.close();
    });

    await test.step('Verify every Book Now button points at a real booking link (not a leaked email-safelink wrapper)', async () => {
        // Confirmed real content defect: one of this page's several Book Now buttons has a raw href
        // wrapped in an Outlook "Safelinks" tracking URL (clearly copy-pasted from an email), not a
        // direct tours.lords.org link - left as a deliberately failing assertion rather than worked
        // around, same "surface, don't mask" convention as every other confirmed defect in this
        // project.
        const hrefs = await page.locator('a.button', { hasText: /^Book Now$/i }).evaluateAll((els) => els.map((el) => el.getAttribute('href')));
        for (const href of hrefs) {
            expect(new URL(href).host, `Book Now href "${href}" should point directly at the booking site, not a wrapped/tracking link`).toBe('tours.lords.org');
        }
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Tours and Museum - Lord\'s Sensory Tour Traversal', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'Lord\'s Sensory Tour');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Navigate to Lord\'s Sensory Tour', async () => {
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Clicking Lord\'s Sensory Tour should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/lord-s-experience/tours/lord-s-sensory-tour'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Lord\'s Sensory Tour heading').toHaveText(/Lord's Sensory Tour/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/sensory tour/i);
    });

    await test.step('Verify the tours@mcc.org.uk contact mailto', async () => {
        const mailtoLink = page.locator('a[href^="mailto:"]', { hasText: /tours@mcc\.org\.uk/i }).first();
        await mailtoLink.scrollIntoViewIfNeeded();
        await expect(mailtoLink, 'A tours@mcc.org.uk contact link should be present').toBeVisible();
        const href = await mailtoLink.getAttribute('href');
        expect(href, 'The mailto should contain a real-looking email address').toMatch(/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Tours and Museum - Lord\'s Virtual Tour Traversal', async ({ page, baseURL }) => {
    test.setTimeout(90000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'Lord\'s Virtual Tour');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Navigate to Lord\'s Virtual Tour', async () => {
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'Clicking Lord\'s Virtual Tour should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/lord-s-experience/tours/lord-s-virtual-tour'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Lord\'s Virtual Tour heading').toHaveText(/Lord's Virtual Tour/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should contain the page name').toHaveTitle(/virtual tour/i);
    });

    await test.step('Follow the Purchase a Virtual Tour button', async () => {
        const purchaseButton = page.locator('a.button', { hasText: /purchase a virtual tour/i }).first();
        await purchaseButton.scrollIntoViewIfNeeded();
        const href = await purchaseButton.getAttribute('href');
        await clickWithCookieGuard(page, purchaseButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        expect(new URL(page.url()).host, 'Purchase a Virtual Tour should navigate to the external ticketing site').toBe(new URL(href).host);

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenterToursMuseum(page);
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});

test('Visit Lord\'s - Tours and Museum - Lord\'s Tour Gift Voucher Traversal', async ({ page }) => {
    test.setTimeout(60000);

    await openPage(page, '/lords/lord-s-experience/tours');
    const cardLink = findToursCardLink(page, 'Lord\'s Tour Gift Voucher');
    if ((await cardLink.count()) === 0) {
        test.skip(true, 'This card doesn\'t exist on this environment yet.');
    }

    await test.step('Follow the Lord\'s Tour Gift Voucher card to the external voucher site', async () => {
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });

        expect(new URL(page.url()).host, 'The card should navigate to the external voucher site').toBe('tours.lords.org');
    });
});

// ===============================================================================================
// Lord's Tavern
// ===============================================================================================

test('Visit Lord\'s - Lord\'s Tavern Traversal', async ({ page, baseURL }) => {
    await runVisitLordsPageTraversal(page, baseURL, {
        menuPath: ['Lord\'s Tavern'],
        h1Pattern: /Lord's Tavern/i,
        titlePattern: /Lord's Tavern/i,
    });
});

// ===============================================================================================
// HOAM Coffee Shop (thin duplicate - full depth lives in 14-mcc.playandtrain.spec.js under Play & Train)
// ===============================================================================================

test('Visit Lord\'s - HOAM Coffee Shop Traversal', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    await test.step('Navigate via the Visit Lord\'s menu', async () => {
        const navigated = await navigateViaVisitLordsMenu(page, ['HOAM Coffee Shop']);
        test.skip(!navigated, 'This menu path doesn\'t exist on this environment yet.');
    });

    // Thin check only, per the duplicate-destination convention - full depth (menu/opening hours,
    // gallery, etc.) is already covered under Play & Train's own HOAM Coffee Shop traversal.
    await test.step('Verify it lands on the HOAM Coffee Shop page', async () => {
        // Confirmed real content defect on UAT2 only (2026-07-14): this meganav item's own href is
        // hardcoded to the absolute Live production domain rather than a relative path (confirmed via
        // direct DOM inspection - the link even carries data-external="false", i.e. the site itself
        // doesn't think this leaves the site), so navigating here on UAT2 silently lands the visitor
        // on Live instead - part of the same defect family documented at the top of this file. Left
        // failing here rather than worked around.
        await expect(page, 'The menu should navigate to the HOAM Coffee Shop page (confirmed real UAT2-only defect: this menu item\'s href is hardcoded to Live\'s domain)').toHaveURL(buildExpectedUrl(baseURL, '/hoam-cafe'));
        await expect(page.locator('h1').first(), 'The page should show the HOAM Coffee Shop heading').toHaveText(/HOAM Coffee Shop/i);
    });

    await test.step('Verify the page title', async () => {
        await expect(page, 'The title should reference HOAM Coffee Shop').toHaveTitle(/ho.?am coffee shop/i);
    });
});

// ===============================================================================================
// Contact us
// ===============================================================================================

test('Visit Lord\'s - Contact us Traversal', async ({ page, baseURL }) => {
    await runVisitLordsPageTraversal(page, baseURL, {
        menuPath: ['Contact us'],
        h1Pattern: /Contact Us/i,
        titlePattern: /Contact us/i,
    });
});
