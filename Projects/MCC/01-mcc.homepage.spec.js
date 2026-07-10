const { test, expect } = require('@playwright/test');

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
}

async function acceptCookiesIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);
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

async function waitForHomepageContent(page) {
    await expect(page.locator('.homeHeader').first(), 'Homepage hero carousel should be visible').toBeVisible();
    await expect(page.locator('.quickLinks__heading').first(), 'Homepage should show the Quick Links section').toBeVisible();
}

function shuffle(items) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Homepage content (hero carousel, quick links, promos) changes between environments/releases,
// so instead of hardcoding paths we walk the page top-to-bottom collecting whatever internal
// links are actually rendered and sample from those at runtime.
async function collectRandomBodyLinks(page, baseURL, { excludeHrefPaths = [], count = 6 } = {}) {
    const origin = new URL(baseURL).origin;
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const steps = Math.max(5, Math.ceil(scrollHeight / viewportHeight));
    const seen = new Map();

    for (let step = 0; step <= steps; step++) {
        const scrollY = Math.round((scrollHeight / steps) * step);
        await page.evaluate((y) => window.scrollTo(0, y), scrollY);
        await page.waitForTimeout(150);

        const linksAtStep = await page.evaluate(() => {
            // Carousels/sliders (hero banner, "what's on" swiper) auto-rotate their active slide, so a
            // link that's visible when collected can be hidden again by the time we come back to click it.
            const isExcluded = (el) => el.closest('header, footer, nav, .eyebrowNav, .homeHeader, [class*="swiper"], [class*="slider"], [class*="carousel"], [class*="cookie"], #onetrust-consent-sdk');
            return Array.from(document.querySelectorAll('a[href]'))
                .filter((a) => a.offsetParent !== null && !isExcluded(a))
                .map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim() }));
        });

        for (const link of linksAtStep) {
            if (link.href && !seen.has(link.href)) {
                seen.set(link.href, link.text);
            }
        }
    }

    await page.evaluate(() => window.scrollTo(0, 0));

    // Only trust well-formed hrefs (root-relative "/path" or fully-qualified same-origin URLs).
    // Anything else observed in the wild here has been a CMS bug rather than a real link: an
    // unresolved template token ("Model.CtaURL") or a protocol-less host ("lords.org/ballot")
    // that `new URL()` would otherwise silently resolve into a bogus same-origin path.
    const wellFormedHrefPattern = new RegExp(`^(/(?!/)|${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`);
    const candidates = [...seen.entries()]
        .filter(([href]) => wellFormedHrefPattern.test(href))
        .map(([href, text]) => {
            const resolved = new URL(href, baseURL);
            return { hrefPath: `${resolved.pathname}${resolved.search}`, label: text || resolved.pathname, origin: resolved.origin };
        })
        .filter((link) => link.origin === origin && !excludeHrefPaths.includes(link.hrefPath));

    const deduped = [...new Map(candidates.map((link) => [link.hrefPath, link])).values()];

    return shuffle(deduped).slice(0, count);
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
        await expect(page, 'Homepage should load with the expected Lord\'s title').toHaveTitle(/Home of Cricket/i);
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
        await expect(page.locator('footer.footer'), 'Scrolling to the bottom should reveal the footer').toBeVisible();
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

test('Homepage - Navigate to Various Pages from the Header Links', async ({ page, context, baseURL }) => {
    test.setTimeout(60000);

    const homepageUrl = buildExpectedUrl(baseURL, '/');
    const eyebrowTargets = [
        { name: 'Lord\'s Insider', host: 'inside.lords.org' },
        { name: 'London Spirit', host: 'londonspirit.com' },
        { name: 'Shop', host: 'store.lords.org' },
        { name: 'Tickets', host: 'tickets.lords.org' },
    ];

    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await waitForHomepageContent(page);
    });

    for (const target of eyebrowTargets) {
        await test.step(`Open eyebrow navigation link for ${target.name}`, async () => {
            const link = page.locator('.eyebrowNav').getByRole('link', { name: target.name }).first();
            await expect(link, `Eyebrow navigation link "${target.name}" should be visible`).toBeVisible();

            const [popup] = await Promise.all([
                context.waitForEvent('page'),
                clickWithCookieGuard(page, link),
            ]);
            await popup.waitForLoadState('domcontentloaded').catch(() => { });
            expect(new URL(popup.url()).host, `"${target.name}" should open a page on ${target.host}`).toContain(target.host);
            await popup.close();
        });
    }

    await expect(page, 'The original tab should remain on the homepage after opening external links').toHaveURL(homepageUrl);
});

test('Homepage - Navigate to Various Pages from the Body Links', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    const homepageUrl = buildExpectedUrl(baseURL, '/');
    const quickLinkTargets = [
        { label: 'Fixtures', hrefPath: '/lords/match-day/fixtures-and-results' },
        { label: 'Getting here', hrefPath: '/lords/visit-us/contact' },
        { label: 'Tours & Museum', hrefPath: '/lords/inside-lord-s/your-inside-lords' },
    ];

    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
        await waitForHomepageContent(page);
    });

    for (const target of quickLinkTargets) {
        await test.step(`Navigate to ${target.label} from Quick Links`, async () => {
            const quickLink = page.locator(`.quickLinks a[href="${target.hrefPath}"]`).first();
            await expect(quickLink, `Quick link "${target.label}" should be visible`).toBeVisible();
            await clickWithCookieGuard(page, quickLink);
            await expect(page, `Quick link "${target.label}" should navigate to ${target.hrefPath}`).toHaveURL(buildExpectedUrl(baseURL, target.hrefPath));

            await page.goBack();
            await page.waitForLoadState('load').catch(() => { });
            await acceptCookiesIfPresent(page);
            await expect(page, `Going back from ${target.label} should restore the homepage URL`).toHaveURL(homepageUrl);
            await waitForHomepageContent(page);
        });
    }

    let randomBodyLinks = [];
    await test.step('Collect random body links while scrolling towards the bottom', async () => {
        randomBodyLinks = await collectRandomBodyLinks(page, baseURL, {
            excludeHrefPaths: quickLinkTargets.map((target) => target.hrefPath),
            count: 6,
        });
        expect(randomBodyLinks.length, 'Homepage should expose at least one additional internal body link to sample').toBeGreaterThan(0);
    });

    for (const target of randomBodyLinks) {
        await test.step(`Navigate to random body link "${target.label}" (${target.hrefPath})`, async () => {
            // Some sections (e.g. carousels) render duplicate/off-screen clones of the same href,
            // so pick whichever matching instance is actually visible right now rather than the first in the DOM.
            const bodyLink = page.locator(`a[href="${target.hrefPath}"]:visible`).first();
            await expect(bodyLink, `Body link "${target.label}" should be visible`).toBeVisible();
            await clickWithCookieGuard(page, bodyLink);
            await expect(page, `Body link "${target.label}" should navigate to ${target.hrefPath}`).toHaveURL(buildExpectedUrl(baseURL, target.hrefPath));

            await page.goBack();
            await page.waitForLoadState('load').catch(() => { });
            await acceptCookiesIfPresent(page);
            await expect(page, `Going back from ${target.label} should restore the homepage URL`).toHaveURL(homepageUrl);
            await waitForHomepageContent(page);
        });
    }
});
