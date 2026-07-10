const { test, expect } = require('@playwright/test');

// This spec covers the Match Day Hospitality page (/lords/match-day/premium-seating/hospitality),
// accessed directly by URL. Several pieces of this page are genuinely present-or-absent by
// environment rather than just differently worded (the intro video, and an accordion right below
// it) - those are checked conditionally (test if present, skip otherwise) rather than assumed to
// exist on both. The per-suite "Find Out More" destinations and the "Other premium hospitality"
// cards are only lightly verified here (does the link/hover work) - deeper traversals into each of
// those destinations are separate, already-planned future work, same approach as spec 06.

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
        await page.waitForTimeout(600);
        const closeButton = page.locator('#close-pc-btn-handler').first();
        await closeButton.click({ timeout: 3000 }).catch(() => closeButton.click({ force: true, timeout: 3000 }).catch(() => { }));
        await preferenceCenterBackdrop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
    }
}

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

// Single-open accordion tester, index-based rather than by hardcoded label (the content here
// differs completely by environment/section - see project memory for the full rationale, same
// helper design as the Food & Drink and Accessibility specs). Soft assertions throughout, since a
// single malformed item elsewhere in this project (a real one was found on the Food & Drink page)
// shouldn't be allowed to abort every other block/item still queued up after it on a page this size.
async function testAccordionBlockByIndex(page, blockLocator) {
    const headers = blockLocator.locator('.inlineAccordion__itemHandle:visible');
    const itemCount = await headers.count();
    let previousItem = null;

    for (let index = 0; index < itemCount; index += 1) {
        const header = headers.nth(index);
        const label = (await header.textContent()).trim();

        await test.step(`Open "${label}"`, async () => {
            await header.scrollIntoViewIfNeeded();
            expect.soft(await header.evaluate((el) => el.classList.contains('collapsed')), `"${label}" should start collapsed (showing the + state)`).toBe(true);

            await dismissCookieOverlayIfPresent(page);
            await page.waitForTimeout(600);
            await header.evaluate((el) => el.click());

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
        await dismissCookieOverlayIfPresent(page);
        await page.waitForTimeout(600);
        await previousItem.header.evaluate((el) => el.click());
        await expect.soft(previousItem.header, `"${previousItem.label}" should return to the collapsed (+) state after clicking again`).toHaveClass(/collapsed/);
        await expect.soft(page.locator(previousItem.targetSelector), `"${previousItem.label}"'s content should be hidden once collapsed`).toBeHidden();
    });
}

// Discovers every "#anchor-N" in-page navigation link and, for each, the target heading and its
// "Find Out More" button - all in one evaluate() pass, walking the DOM with the XPath "following"
// axis rather than relying on sibling/containment relationships. Necessary because the anchor
// target is a bare <span id="anchor-N"> sitting alone in its own wrapper (its real content - the
// heading, description, and button - live in a *separate* sibling container, confirmed directly),
// so `closest()`-based scoping from the span doesn't reach them; "following" finds them regardless
// of exactly how deep the real content is nested relative to the span.
async function discoverSuiteSections(page) {
    return page.evaluate(() => {
        const nextH2After = (node) => document.evaluate('following::h2[1]', node, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        const nextButtonAfter = (node) => document.evaluate("following::a[contains(@class,'button')][1]", node, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

        const anchors = Array.from(document.querySelectorAll('.sectionNavigation a'))
            .filter((a) => !a.closest('header') && !a.closest('footer') && !a.closest('.meganav'));

        return anchors.map((anchor) => {
            const targetId = anchor.getAttribute('href').replace('#', '');
            const span = document.getElementById(targetId);
            const heading = span ? nextH2After(span) : null;
            const button = span ? nextButtonAfter(span) : null;

            return {
                anchorText: anchor.textContent.trim(),
                anchorHref: anchor.getAttribute('href'),
                headingText: heading ? heading.textContent.trim() : null,
                buttonHref: button ? button.getAttribute('href') : null,
                buttonText: button ? button.textContent.trim() : null,
            };
        });
    });
}

test('Match Day Hospitality - Initial Page Checks', async ({ page, context, baseURL }) => {
    test.setTimeout(300000);

    await test.step('Open the Match Day Hospitality page directly', async () => {
        await openPage(page, '/lords/match-day/premium-seating/hospitality');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Match Day Hospitality heading').toHaveText(/Match Day Hospitality/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should contain the page name').toHaveTitle(/Premium Cricket Hospitality/i);
        }
    });

    await test.step('Follow the hero Book Now button (opens in a new tab)', async () => {
        const bookNowButton = page.locator('.standardHeader a.button', { hasText: /^Book Now$/i }).first();
        await bookNowButton.scrollIntoViewIfNeeded();

        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, bookNowButton),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'Book Now should open the external ticketing site').toBe('tickets.lords.org');
        await popup.close();
    });

    await test.step('Verify the "Welcome to the Home of Cricket" heading', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /welcome to the home of cricket/i }).first(), 'The page should show the Welcome to the Home of Cricket heading').toBeVisible();
    });

    const videoIframe = page.locator('iframe[src*="youtube"]').first();

    await test.step('Play the intro YouTube video (if present)', async () => {
        // Confirmed via direct testing: Live currently has this video, UAT2 currently doesn't -
        // per Hector, UAT2 may get one added later, so this is deliberately presence-gated rather
        // than assumed to exist (or assumed absent) on either environment.
        const hasVideo = (await videoIframe.count()) > 0;
        if (!hasVideo) {
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

    await test.step('Test the accordion below the intro (if present)', async () => {
        // Confirmed via direct testing: UAT2 currently has one here (e.g. "2025 International
        // Fixtures"/"2025 Domestic Fixtures"), Live currently has none in this position at all -
        // same presence-gated approach as the video above, for the same reason.
        const introAccordionCount = await page.evaluate(() => {
            const enquireButton = Array.from(document.querySelectorAll('a.button')).find((a) => /^enquire now$/i.test(a.textContent.trim()));
            if (!enquireButton) {
                return 0;
            }
            return Array.from(document.querySelectorAll('.inlineAccordion')).filter((acc) => Boolean(enquireButton.compareDocumentPosition(acc) & Node.DOCUMENT_POSITION_PRECEDING)).length;
        });

        for (let index = 0; index < introAccordionCount; index += 1) {
            await testAccordionBlockByIndex(page, page.locator('.inlineAccordion').nth(index));
        }
    });

    await test.step('Follow the Enquire Now button', async () => {
        // Raw href is an absolute link to the live storefront domain on UAT2 (the destination page
        // doesn't exist on UAT2 itself yet - confirmed a UAT2-relative guess 404s, while the actual
        // href on the button resolves fine) - same "hardcoded production URL leak" pattern already
        // documented elsewhere in this project. Deep coverage of this destination is deliberately
        // out of scope here - Hector plans a dedicated traversal for it later, same approach as spec 06.
        const enquireNowButton = page.locator('a.button', { hasText: /^Enquire Now$/i }).first();
        await enquireNowButton.scrollIntoViewIfNeeded();
        const href = await enquireNowButton.getAttribute('href');

        await clickWithCookieGuard(page, enquireNowButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Enquire Now should navigate to its own href').toHaveURL(new URL(href, page.url()).toString());
        await expect(page.locator('h1').first(), 'The Enquire Now destination should show a plausible heading').toHaveText(/enquire now/i);

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenter(page);
        await dismissCookieOverlayIfPresent(page);
    });

    await test.step('Navigate through every suite/experience anchor and its Find Out More button', async () => {
        const sections = await discoverSuiteSections(page);
        expect(sections.length, 'There should be at least one suite/experience anchor link').toBeGreaterThan(0);

        const navArea = page.locator('.sectionNavigation').first();

        for (const section of sections) {
            await test.step(`"${section.anchorText}"`, async () => {
                await navArea.scrollIntoViewIfNeeded();

                const anchorLink = page.locator('.sectionNavigation a', { hasText: section.anchorText }).first();
                await clickWithCookieGuard(page, anchorLink);
                await page.waitForTimeout(400);

                expect.soft(page.url(), `Clicking "${section.anchorText}" should jump to ${section.anchorHref}`).toContain(section.anchorHref);

                const targetHeading = page.getByRole('heading', { level: 2, name: section.headingText || section.anchorText }).first();
                await expect.soft(targetHeading, `The "${section.anchorText}" section heading should be visible after the jump`).toBeVisible();

                if (!section.buttonHref) {
                    return;
                }

                // Some of these (confirmed: "Verity's" and "The Willow" on UAT2) currently point at
                // a destination that 404s - a real, confirmed content defect, not a test issue -
                // kept as a soft failure so it surfaces without blocking every other section queued
                // up after it.
                //
                // Scoped by its exact href, not by the generic "Find Out More" text - every section
                // has its own identically-worded button, so a plain text-based `.first()` lookup
                // always re-matches Ultimate Suite's button regardless of which section is current.
                const findOutMoreButton = page.locator(`a.button[href="${section.buttonHref}"]`).first();
                await findOutMoreButton.scrollIntoViewIfNeeded();

                // Confirmed via direct testing: whether this opens in the same tab or a new one is
                // set per-button, not consistently by environment (on UAT2, Find Out More is
                // target="_blank" while Enquire Now on the very same page is target="_self" despite
                // both being absolute cross-domain links) - so this branches on the actual attribute
                // rather than assuming either way.
                const opensNewTab = (await findOutMoreButton.getAttribute('target')) === '_blank';

                if (opensNewTab) {
                    const [popup] = await Promise.all([
                        context.waitForEvent('page'),
                        clickWithCookieGuard(page, findOutMoreButton),
                    ]);
                    await popup.waitForLoadState('load').catch(() => { });
                    expect.soft(popup.url(), `"${section.anchorText}"'s Find Out More should open its own href in a new tab`).toBe(new URL(section.buttonHref, page.url()).toString());

                    const statusCheck = await page.request.get(popup.url());
                    expect.soft(statusCheck.status(), `"${section.anchorText}"'s Find Out More destination should not return an error status`).toBeLessThan(400);

                    await popup.close();
                } else {
                    await clickWithCookieGuard(page, findOutMoreButton);
                    await page.waitForLoadState('load').catch(() => { });
                    await dismissCookieOverlayIfPresent(page);

                    expect.soft(page.url(), `"${section.anchorText}"'s Find Out More should navigate to its own href`).toBe(new URL(section.buttonHref, page.url()).toString());

                    const statusCheck = await page.request.get(page.url());
                    expect.soft(statusCheck.status(), `"${section.anchorText}"'s Find Out More destination should not return an error status`).toBeLessThan(400);

                    await page.goBack();
                    await page.waitForLoadState('load').catch(() => { });
                    await waitForAndDismissPreferenceCenter(page);
                    await dismissCookieOverlayIfPresent(page);
                }
            });
        }
    });

    await test.step('Verify the FAQs heading and its accordion blocks', async () => {
        await expect(page.getByRole('heading', { level: 2, name: /^FAQs$/i }).first(), 'The page should show the FAQs heading').toBeVisible();

        const faqBlockCount = await page.evaluate(() => {
            const faqHeading = Array.from(document.querySelectorAll('h2')).find((h) => /^faqs$/i.test(h.textContent.trim()));
            if (!faqHeading) {
                return 0;
            }
            return Array.from(document.querySelectorAll('.inlineAccordion')).filter((acc) => Boolean(faqHeading.compareDocumentPosition(acc) & Node.DOCUMENT_POSITION_FOLLOWING)).length;
        });

        expect(faqBlockCount, 'There should be at least one FAQ accordion block').toBeGreaterThan(0);

        const allBlocks = page.locator('.inlineAccordion');
        const totalBlocks = await allBlocks.count();

        for (let index = totalBlocks - faqBlockCount; index < totalBlocks; index += 1) {
            await testAccordionBlockByIndex(page, allBlocks.nth(index));
        }
    });

    await test.step('Verify the "Contact our team" CTA (mailto + phone)', async () => {
        const contactHeading = page.locator('h5', { hasText: /contact our team/i }).first();
        await contactHeading.scrollIntoViewIfNeeded();
        await expect(contactHeading, 'The page should show the Contact our team heading').toBeVisible();

        const ctaContainer = contactHeading.locator('xpath=ancestor::div[contains(@class,"row")][1]');
        const mailtoButton = ctaContainer.locator('a[href^="mailto:"]').first();
        const telButton = ctaContainer.locator('a[href^="tel:"]').first();

        await expect(mailtoButton, 'A mailto button should be present').toBeVisible();
        await expect(telButton, 'A phone number button should be present').toBeVisible();

        // Confirming both are well-formed without ever clicking them - clicking a mailto/tel link
        // hands off to an OS-level app, unreliable in a headless test environment.
        const mailtoHref = await mailtoButton.getAttribute('href');
        expect(mailtoHref, 'The mailto should contain a real-looking email address').toMatch(/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i);

        const telHref = await telButton.getAttribute('href');
        expect(telHref, 'The phone button should be a real tel: link').toMatch(/^tel:\+?\d+$/i);
    });

    await test.step('Verify the "Other premium hospitality and experiences" cards', async () => {
        const heading = page.getByRole('heading', { level: 2, name: /other premium hospitality and experiences/i }).first();
        await heading.scrollIntoViewIfNeeded();
        await expect(heading, 'The page should show the Other premium hospitality and experiences heading').toBeVisible();

        // Scoped to this specific list, not just `.ctaTile--alt` - confirmed both environments have
        // all 3 cards, but UAT2 renders 2 of them as `.ctaTile--noimage` instead (no background image
        // configured yet), not `.ctaTile--alt` - a narrower class-only selector would silently miss
        // those two. Discovered dynamically rather than hardcoded, in case the count ever changes.
        // Deep traversal into each card's own destination is separate, already-planned future work.
        const cards = page.locator('.relatedPagesList .ctaTile');
        const cardCount = await cards.count();
        expect(cardCount, 'There should be at least one "Other premium hospitality" card').toBeGreaterThan(0);

        for (let index = 0; index < cardCount; index += 1) {
            const card = cards.nth(index);
            const title = (await card.locator('.ctaTile__title').first().textContent()).trim();

            await test.step(`"${title}" card hover effect`, async () => {
                await card.scrollIntoViewIfNeeded();

                const readMore = card.locator('.ctaTile__cta').first();
                await card.hover();
                await expect.poll(() => readMore.evaluate((el) => el.clientHeight), {
                    message: `Hovering the "${title}" card should reveal its Read More link`,
                }).toBeGreaterThan(0);

                const href = await card.locator('a.ctaTile__link').first().getAttribute('href');
                expect(href, `The "${title}" card should have a real link`).toBeTruthy();
            });
        }
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        // Per Hector: everything on UAT2 past the cards above (e.g. a "Let's find your ideal venue"
        // section, confirmed present there but not on Live) is deliberately out of scope - this just
        // scrolls straight to the footer regardless of what sits in between, so nothing further
        // needs a separate environment branch here.
        await verifySponsorsAndFooter(page);
    });
});

test('Match Day Hospitality - Old Clock Tower Club Traversal', async ({ page, context, baseURL }) => {
    test.setTimeout(120000);

    // Confirmed via direct testing: UAT2 currently only has a bare H1 and a single "Enquire Now"
    // mailto on this destination - none of the sections described below (packages, the pair of
    // buttons underneath them, the FAQs, the "Other premium hospitality" cards) exist there yet.
    // Every section below is presence-gated (find it, test if found, otherwise move on) rather than
    // assumed to exist on both environments, per Hector's own instruction for this traversal.

    await test.step('Open Match Day Hospitality and navigate to Old Clock Tower Club', async () => {
        await openPage(page, '/lords/match-day/premium-seating/hospitality');

        const cardLink = page.locator('.relatedPagesList .ctaTile__link[href*="old-clock-tower-club"]').first();
        await cardLink.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, cardLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Clicking Old Clock Tower Club should navigate to the expected page').toHaveURL(buildExpectedUrl(baseURL, '/lords/match-day/premium-seating/old-clock-tower-club'));
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('h1').first(), 'The page should show the Old Clock Tower Club heading').toHaveText(/Old Clock Tower Club/i);
    });

    await test.step('Verify the page title (environment-aware)', async () => {
        if (isUatEnvironment(baseURL)) {
            await expect(page, 'UAT2 uses the generic environment title on every page').toHaveTitle('Lords MCC (UAT)');
        } else {
            await expect(page, 'The live title should contain the page name').toHaveTitle(/Old Clock Tower Club/i);
        }
    });

    await test.step('Follow the Buy Now and Download Brochure buttons (if present)', async () => {
        const buyNowButton = page.locator('a.button', { hasText: /^Buy Now$/i }).first();
        if ((await buyNowButton.count()) === 0) {
            return;
        }

        await buyNowButton.scrollIntoViewIfNeeded();
        const [buyPopup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, buyNowButton),
        ]);
        await buyPopup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(buyPopup.url()).host, 'Buy Now should open the external ticketing site').toBe('tickets.lords.org');
        await buyPopup.close();

        const brochureButton = page.locator('a.button', { hasText: /download brochure/i }).first();
        await brochureButton.scrollIntoViewIfNeeded();
        const [brochurePopup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, brochureButton),
        ]);
        await brochurePopup.waitForLoadState('load').catch(() => { });
        expect(new URL(brochurePopup.url()).host, 'Download Brochure should stay on the same site').toBe(new URL(baseURL).host);

        const statusCheck = await page.request.get(brochurePopup.url());
        expect(statusCheck.status(), 'The Download Brochure destination should not return an error status').toBeLessThan(400);
        await brochurePopup.close();
    });

    await test.step('Test the package selector (Gold/Silver, if present)', async () => {
        // Same tabccordion component already covered on the Food & Drink page (Food/Drinks tabs) -
        // here used for package tiers instead. "Purple" is the active tab's background colour; the
        // assertion checks the `active` class (the mechanism), not the exact colour, so it stays
        // correct if the branding colour is ever tweaked.
        const tabGroup = page.locator('.tabccordion').first();
        if ((await tabGroup.count()) === 0) {
            return;
        }

        const tabs = tabGroup.locator('.tabccordion__tabs a');
        const tabCount = await tabs.count();
        expect(tabCount, 'There should be at least 2 package options to choose between').toBeGreaterThanOrEqual(2);

        const firstTab = tabs.nth(0);
        const secondTab = tabs.nth(1);

        await firstTab.scrollIntoViewIfNeeded();
        await expect(firstTab, 'The first package should be preselected (active/purple) by default').toHaveClass(/active/);
        await expect(secondTab, 'The second package should not be active by default').not.toHaveClass(/active/);

        await secondTab.evaluate((el) => el.click());
        await expect(secondTab, 'The second package should become active (purple) after clicking it').toHaveClass(/active/);
        await expect(firstTab, 'The first package should lose its active (purple) state once the second is selected').not.toHaveClass(/active/);

        // Leave the selector back in its default state, matching the convention elsewhere in this
        // project of returning interactive components to how they started.
        await firstTab.evaluate((el) => el.click());
        await expect(firstTab, 'The first package should become active again after switching back').toHaveClass(/active/);
    });

    await test.step('Follow the Enquire Now and Buy Now buttons below the packages (if present)', async () => {
        const enquireNowButton = page.locator('a.button', { hasText: /^Enquire Now$/i }).first();
        if ((await enquireNowButton.count()) === 0) {
            return;
        }

        await enquireNowButton.scrollIntoViewIfNeeded();
        const href = await enquireNowButton.getAttribute('href');

        // Confirmed via direct testing: UAT2's only "Enquire Now" here is currently a plain mailto
        // (no packages/Buy Now pairing exists alongside it there at all) - Live's is a real internal
        // page link. Verify the mailto is well-formed without clicking it (same "don't hand off to
        // an OS mail client" reasoning as the sponsors page and the main hospitality page's CTA),
        // and don't expect a Buy Now pairing in that case.
        if (href.startsWith('mailto:')) {
            expect(href, 'The Enquire Now mailto should contain a real-looking email address').toMatch(/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i);
            return;
        }

        await clickWithCookieGuard(page, enquireNowButton);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        await expect(page, 'Enquire Now should navigate to its own href').toHaveURL(new URL(href, page.url()).toString());
        const enquireStatusCheck = await page.request.get(page.url());
        expect(enquireStatusCheck.status(), 'The Enquire Now destination should not return an error status').toBeLessThan(400);

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndDismissPreferenceCenter(page);
        await dismissCookieOverlayIfPresent(page);

        // Functionally identical to the hero Buy Now already checked above (same href/target) - this
        // one just happens to sit right below the packages, matching what Hector described here.
        const buyNowButton = page.locator('a.button', { hasText: /^Buy Now$/i }).first();
        await buyNowButton.scrollIntoViewIfNeeded();
        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            clickWithCookieGuard(page, buyNowButton),
        ]);
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(new URL(popup.url()).host, 'Buy Now should open the external ticketing site').toBe('tickets.lords.org');
        await popup.close();
    });

    await test.step('Verify the Old Clock Tower Club FAQs accordion (if present)', async () => {
        const faqHeading = page.getByRole('heading', { level: 2, name: /old clock tower club faqs/i }).first();
        if ((await faqHeading.count()) === 0) {
            return;
        }

        await faqHeading.scrollIntoViewIfNeeded();
        await expect(faqHeading, 'The page should show the Old Clock Tower Club FAQs heading').toBeVisible();

        const faqBlockCount = await page.evaluate(() => {
            const h2 = Array.from(document.querySelectorAll('h2')).find((h) => /old clock tower club faqs/i.test(h.textContent.trim()));
            if (!h2) {
                return 0;
            }
            return Array.from(document.querySelectorAll('.inlineAccordion')).filter((acc) => Boolean(h2.compareDocumentPosition(acc) & Node.DOCUMENT_POSITION_FOLLOWING)).length;
        });

        const allBlocks = page.locator('.inlineAccordion');
        const totalBlocks = await allBlocks.count();

        for (let index = totalBlocks - faqBlockCount; index < totalBlocks; index += 1) {
            await testAccordionBlockByIndex(page, allBlocks.nth(index));
        }
    });

    await test.step('Verify the "Other premium hospitality and experiences" cards (if present)', async () => {
        const heading = page.getByRole('heading', { level: 2, name: /other premium hospitality and experiences/i }).first();
        if ((await heading.count()) === 0) {
            return;
        }

        await heading.scrollIntoViewIfNeeded();
        await expect(heading, 'The page should show the Other premium hospitality and experiences heading').toBeVisible();

        // This destination's own "related pages" list excludes itself and links back to Match Day
        // Hospitality instead - confirmed directly, so the exact card titles here differ from the
        // parent page's own list. Discovered dynamically, same convention as spec 08's own version
        // of this exact check.
        const cards = page.locator('.relatedPagesList .ctaTile');
        const cardCount = await cards.count();
        expect(cardCount, 'There should be at least one "Other premium hospitality" card').toBeGreaterThan(0);

        for (let index = 0; index < cardCount; index += 1) {
            const card = cards.nth(index);
            const title = (await card.locator('.ctaTile__title').first().textContent()).trim();

            await test.step(`"${title}" card hover effect`, async () => {
                await card.scrollIntoViewIfNeeded();

                const readMore = card.locator('.ctaTile__cta').first();
                await card.hover();
                await expect.poll(() => readMore.evaluate((el) => el.clientHeight), {
                    message: `Hovering the "${title}" card should reveal its Read More link`,
                }).toBeGreaterThan(0);

                const href = await card.locator('a.ctaTile__link').first().getAttribute('href');
                expect(href, `The "${title}" card should have a real link`).toBeTruthy();
            });
        }
    });

    await test.step('Scroll to the bottom and verify the sponsors block / footer', async () => {
        await verifySponsorsAndFooter(page);
    });
});
