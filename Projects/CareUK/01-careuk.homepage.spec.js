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
// Coverage notes - careuk.co.uk homepage ("/")
// ============================================================================
// Scope: the homepage only - hero/title, scroll behaviour, header
// navigation links, and 5 key body section links.
//
// Tests in this file:
//   1. Homepage - Homepage Loads
//      Loads "/" and checks the page title.
//   2. Homepage - Scrolling Through the Page
//      Scrolls to the footer, back to the top, and to the middle, checking
//      scroll position at each step.
//   3. Homepage - Navigate Various Pages from the Header Links
//      Clicks each header link (Careers, Customers, Find a care home) and
//      confirms it lands on the expected URL, then goes back.
//   4. Homepage - Navigate Various Pages from the Body Links
//      Follows 5 body section links (Trusted to care > Find a care home,
//      Where do I start? > Read more, Types of care we offer > Read more,
//      Life at our homes > Read more, Careers CTA > Visit careers
//      website), confirming URL and the section heading reappears after
//      going back.
//   5. Homepage - Skip Links
//      Discovers skip link(s) live via keyboard Tab (rather than hardcoding a
//      label), then verifies each one is reachable again via Tab and that
//      activating it lands on its target element. CareUK has NONE as of
//      2026-07-20, so this test is expected to fail here rather than skip.
//
// No environment-conditional logic exists in this file - every check
// applies identically regardless of which environment `baseURL` points at.
// ============================================================================

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function buildExpectedUrl(baseURL, path) {
    return new URL(path, baseURL).toString();
}

async function findFirstVisibleLocator(locator) {
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
            return candidate;
        }
    }

    return null;
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
    await expect(page.getByRole('heading', { level: 1, name: /Trusted to care/i }).first()).toBeVisible();
}

async function openMenuIfPresent(page) {
    const visibleHeaderLink = page.getByRole('banner').locator('a[href="/careers"], a[href="/customers"], a[href="/care-homes"]').first();
    if (await visibleHeaderLink.isVisible().catch(() => false)) {
        return;
    }

    const menuButton = await findFirstVisibleLocator(page.getByRole('button', { name: /menu|open menu/i }));
    if (menuButton) {
        await clickWithCookieGuard(page, menuButton);
        return;
    }

    const menuLabel = await findFirstVisibleLocator(page.locator('label').filter({ hasText: /^menu$/i }));
    if (menuLabel) {
        await clickWithCookieGuard(page, menuLabel);
    }
}

async function clickVisibleHeaderLink(page, hrefPath) {
    await openMenuIfPresent(page);

    const headerLink = await findFirstVisibleLocator(
        page.locator(`header a[href="${hrefPath}"], [role="banner"] a[href="${hrefPath}"]`),
    );

    expect(headerLink, `Header link ${hrefPath} should be visible`).toBeTruthy();
    await clickWithCookieGuard(page, headerLink);
}

async function clickVisibleMainLink(page, hrefPath, linkName) {
    const linkLocator = page.locator(`a[href="${hrefPath}"]`);
    const count = await linkLocator.count();
    let candidate = null;

    for (let index = 0; index < count; index += 1) {
        const current = linkLocator.nth(index);
        const isVisible = await current.isVisible().catch(() => false);
        if (!isVisible) {
            continue;
        }

        const matchesName = linkName
            ? await current.evaluate((element, matcher) => {
                const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
                return new RegExp(matcher.source, matcher.flags).test(text);
            }, linkName)
            : true;

        if (!matchesName) {
            continue;
        }

        const isOutsideHeaderFooter = await current.evaluate((element) => !element.closest('header, footer'));
        if (!isOutsideHeaderFooter) {
            continue;
        }

        candidate = current;
        break;
    }

    expect(candidate, `Main content link ${hrefPath} should be visible`).toBeTruthy();
    await clickWithCookieGuard(page, candidate);
}

test('Homepage - Homepage Loads', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);
        await waitForHomepageContent(page);
    });

    await test.step('Verify homepage title', async () => {
        await expect(page, 'Homepage should load with the expected Care UK title').toHaveTitle(/Care Homes \| Residential, Nursing (?:&|and) Dementia \| Care UK/i);
    });
}, 30000);

test('Homepage - Scrolling Through the Page', async ({ page }) => {
    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);
        await waitForHomepageContent(page);
    });

    await test.step('Scroll to the footer', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(page.locator('footer'), 'Scrolling to the bottom should reveal the footer').toBeVisible();
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
}, 30000);

test('Homepage - Navigate Various Pages from the Header Links', async ({ page, baseURL }) => {
    const homepageUrl = buildExpectedUrl(baseURL, '/');
    const headerTargets = [
        { name: 'Careers', hrefPath: '/careers' },
        { name: 'Customers', hrefPath: '/customers' },
        { name: 'Find a care home', hrefPath: '/care-homes' },
    ];

    await test.step('Open homepage and header navigation', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);
        await waitForHomepageContent(page);
    });

    for (const target of headerTargets) {
        await test.step(`Navigate from header to ${target.name}`, async () => {
            await clickVisibleHeaderLink(page, target.hrefPath);
            await expect(page, `Header link ${target.name} should navigate to ${target.hrefPath}`).toHaveURL(buildExpectedUrl(baseURL, target.hrefPath));

            await page.goBack();
            await page.waitForLoadState('load').catch(() => { });
            await acceptCookiesIfPresent(page);
            await expect(page, `Going back from ${target.name} should restore the homepage URL`).toHaveURL(homepageUrl);
            await waitForHomepageContent(page);
        });
    }
}, 45000);

test('Homepage - Navigate Various Pages from the Body Links', async ({ page, baseURL }) => {
    const homepageUrl = buildExpectedUrl(baseURL, '/');
    const bodyTargets = [
        { heading: 'Trusted to care', linkName: /find a care home/i, hrefPath: '/care-homes' },
        { heading: 'Where do I start?', linkName: /read more/i, hrefPath: '/where-do-i-start' },
        { heading: 'Types of care we offer', linkName: /read more/i, hrefPath: '/types-of-care' },
        { heading: 'Life at our homes', linkName: /read more/i, hrefPath: '/life-at-a-care-uk-home' },
        { heading: 'Looking for a career in one of our care homes?', linkName: /visit careers website/i, hrefPath: '/careers' },
    ];

    await test.step('Open homepage', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);
        await waitForHomepageContent(page);
    });

    for (const target of bodyTargets) {
        await test.step(`Open body link for ${target.heading}`, async () => {
            await expect(page.getByRole('heading', { name: target.heading, exact: true }).first(), `Homepage should show the ${target.heading} section`).toBeVisible();
            await clickVisibleMainLink(page, target.hrefPath, target.linkName);
            await expect(page, `Body link for ${target.heading} should navigate to ${target.hrefPath}`).toHaveURL(buildExpectedUrl(baseURL, target.hrefPath));

            await page.goBack();
            await page.waitForLoadState('load').catch(() => { });
            await acceptCookiesIfPresent(page);
            await expect(page, `Going back from ${target.heading} should restore the homepage URL`).toHaveURL(homepageUrl);
            await expect(page.getByRole('heading', { name: target.heading, exact: true }).first()).toBeVisible();
        });
    }
}, 60000);

// Skip link(s) are discovered live via keyboard Tab rather than hardcoded, since sites differ on how
// many exist and what they're labelled (e.g. "Skip to content" vs "Skip to main content"/"Skip to menu").
// Missing a skip link entirely is a real accessibility gap, so this test is expected to fail on sites
// that don't have one rather than being skipped.
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
        await acceptCookiesIfPresent(page);

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
            await acceptCookiesIfPresent(page);

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