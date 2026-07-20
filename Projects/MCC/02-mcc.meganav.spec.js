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
// Coverage notes - lords.org main navigation ("meganav")
// ============================================================================
// Scope: the site-wide meganav (desktop bar / tablet & mobile hamburger
// accordion) and the header logo link that sits alongside it. Not scoped to
// any single page - these tests open the homepage first, then drive the menu
// from there.
//
// Tests in this file:
//   1. Meganav - Verify Meganav is Present
//      Confirms the meganav and its root level are visible and expose at
//      least one item.
//   2. Meganav - Verify Header Logo is Present
//      From a non-homepage page, confirms the header logo is visible and
//      clicking it returns to the base URL with the meganav visible again.
//   3. Meganav - Expand Each of the Meganav Links
//      Expands every root-level item with children, and every second-level
//      item with children beneath it, checking the revealed sublist is
//      visible. On desktop only, also checks the expanded root item's link
//      gets a solid yellow "current" background (rgb(255, 200, 0)) and that
//      a previously-active root loses it once a different one is expanded -
//      confirmed via a real screenshot + getComputedStyle, not assumed.
//      Tablet/mobile (hamburger-driven) have no equivalent visual cue, so
//      this check is skipped there.
//   4. Meganav - Navigate Through Every First, Second and Third Level Item
//      Reads the entire menu tree fresh at test start (never hardcodes menu
//      labels or destination paths, since both have drifted before and will
//      differ again between Live/UAT2 or future releases) and clicks every
//      well-formed leaf link, confirming each one actually navigates
//      somewhere real (new tab for `target="_blank"` items, a changed URL
//      plus a visible H1 or non-empty title otherwise).
//
// No environment-conditional logic or currently-confirmed Live-vs-UAT2
// content differences exist in this file as of 2026-07-16 - the whole-tree,
// read-fresh approach means it adapts to menu/label/path changes on either
// environment automatically rather than needing per-environment maintenance.
// ============================================================================

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

// Confirmed via a real screenshot + getComputedStyle, not assumed: clicking a main-level meganav
// trigger (adds the "current" class) paints its link with a solid yellow background. Only one
// main-level item carries this at a time - clicking a different one moves it, it doesn't stack.
const ROOT_LEVEL_ACTIVE_BACKGROUND_COLOR = 'rgb(255, 200, 0)';

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

async function waitForMenuOpen(page) {
    await expect(page.locator('.meganav .mainLevel').first(), 'The MCC meganav should be visible').toBeVisible();
}

async function openMenuIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);

    // Desktop renders the meganav bar directly; tablet/mobile collapse it behind the hamburger icon.
    const mainLevel = page.locator('.meganav .mainLevel').first();
    if (await mainLevel.isVisible().catch(() => false)) {
        return;
    }

    const hamburger = page.locator('.header__hamburger').first();
    await expect(hamburger, 'The MCC hamburger menu icon should be visible when the meganav is collapsed').toBeVisible();
    await clickWithCookieGuard(page, hamburger);
    await waitForMenuOpen(page);
}

async function openHomeAndMenu(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    await openMenuIfPresent(page);
}

// Reads the whole meganav tree in one pass and returns every leaf (an item with no further
// children) as a { path, href, target } record. Deliberately independent of what any item is
// currently named or where it currently points - the names/targets are read fresh each run, so
// this keeps working across environments/CMS edits without needing hardcoded labels or paths.
async function getMenuLeafTargets(page) {
    await openMenuIfPresent(page);

    return page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);

        const mainLevel = document.querySelector('.meganav .mainLevel');
        const leaves = [];

        for (const root of directChildItems(mainLevel)) {
            const rootLink = root.querySelector(':scope > a.meganav__link');
            const rootName = normalize(rootLink?.textContent);

            if (!root.classList.contains('hasChildren')) {
                leaves.push({ path: [rootName], href: rootLink?.getAttribute('href') || null, target: rootLink?.getAttribute('target') || null });
                continue;
            }

            const rootSub = root.querySelector(':scope > ul.meganav__list');
            for (const second of directChildItems(rootSub)) {
                const secondLink = second.querySelector(':scope > a.meganav__link');
                const secondName = normalize(secondLink?.textContent);

                if (!second.classList.contains('hasChildren')) {
                    leaves.push({ path: [rootName, secondName], href: secondLink?.getAttribute('href') || null, target: secondLink?.getAttribute('target') || null });
                    continue;
                }

                const secondSub = second.querySelector(':scope > ul.meganav__list');
                for (const third of directChildItems(secondSub)) {
                    const thirdLink = third.querySelector(':scope > a.meganav__link');
                    leaves.push({ path: [rootName, secondName, normalize(thirdLink?.textContent)], href: thirdLink?.getAttribute('href') || null, target: thirdLink?.getAttribute('target') || null });
                }
            }
        }

        return leaves;
    });
}

function isWellFormedMenuHref(href) {
    // Root-relative ("/path") or fully-qualified ("http(s)://...") only - excludes "#" triggers,
    // empty hrefs, and malformed CMS placeholder tokens (e.g. an unresolved "Model.CtaURL" seen
    // elsewhere on this site), none of which are real navigable destinations.
    return Boolean(href) && /^(\/(?!\/)|https?:\/\/)/i.test(href) && href !== '#';
}

async function clickMenuPath(page, path) {
    await clickRootLevelItem(page, path[0]);
    if (path.length === 1) {
        return;
    }

    await expectSecondLevelVisible(page, path[0]);
    await clickSecondLevelItem(page, path[0], path[1]);
    if (path.length === 2) {
        return;
    }

    await expectThirdLevelVisible(page, path[0], path[1]);
    await clickThirdLevelItem(page, path[0], path[1], path[2]);
}

async function verifyLeafNavigation(page, context, leaf, homepageUrl) {
    const label = leaf.path.join(' > ');

    if (leaf.target === '_blank') {
        const popup = await context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
        expect(popup, `"${label}" should open a new tab`).toBeTruthy();
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(popup.url(), `"${label}" should navigate the new tab away from a blank page`).not.toBe('about:blank');
        await popup.close();
        return;
    }

    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);

    expect(page.url(), `"${label}" should navigate away from the homepage`).not.toBe(homepageUrl);

    const heading = page.locator('h1').first();
    const hasHeading = await heading.isVisible({ timeout: 10000 }).catch(() => false);
    if (!hasHeading) {
        const title = (await page.title().catch(() => '')).trim();
        expect(title.length, `"${label}" destination should expose either a visible H1 or a non-empty document title`).toBeGreaterThan(0);
    }
}

async function clickRootLevelItem(page, name) {
    await openMenuIfPresent(page);

    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const link = page.locator('.meganav .mainLevel > li.meganav__item > a.meganav__link').filter({ hasText: new RegExp(`^\\s*${escapedName}\\s*$`) }).first();

    const found = await link.count();
    expect(found, `Root-level menu item "${name}" should be clickable`).toBeGreaterThan(0);

    const hasChildren = await link.evaluate((el) => Boolean(el.closest('li.meganav__item')?.classList.contains('hasChildren')));

    // Desktop needs a real (not synthetic) pointer click so the browser actually transfers focus -
    // the "current" yellow focus-state styling depends on genuine :focus, confirmed a synthetic
    // el.click() leaves the background transparent. Tablet/mobile render the menu as a vertical
    // accordion instead: an already-open section pushes later items down the page, so a real click
    // can land on the wrong (now-shifted) element - dispatching the click directly on the element
    // sidesteps that layout dependency entirely.
    const isDesktopMeganav = !(await page.locator('.header__hamburger').first().isVisible().catch(() => false));
    if (isDesktopMeganav) {
        await clickWithCookieGuard(page, link);
    } else {
        await link.evaluate((el) => el.click());
    }

    return { clicked: true, hasChildren };
}

async function clickSecondLevelItem(page, rootName, childName) {
    await openMenuIfPresent(page);

    const result = await page.evaluate(({ wantedRoot, wantedChild }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);

        const mainLevel = document.querySelector('.meganav .mainLevel');
        const rootItems = directChildItems(mainLevel).filter((item) => item.classList.contains('hasChildren'));
        const root = rootItems.find((item) => normalize(item.querySelector(':scope > a.meganav__link')?.textContent) === wantedRoot);
        if (!root) {
            return { clicked: false, reason: 'root-not-found' };
        }

        const rootSub = root.querySelector(':scope > ul.meganav__list');
        const childItems = directChildItems(rootSub);
        const child = childItems.find((item) => normalize(item.querySelector(':scope > a.meganav__link')?.textContent) === wantedChild);
        if (!child) {
            return { clicked: false, reason: 'child-not-found' };
        }

        child.querySelector(':scope > a.meganav__link').click();

        return {
            clicked: true,
            hasChildren: child.classList.contains('hasChildren'),
        };
    }, { wantedRoot: rootName, wantedChild: childName });

    expect(result.clicked, `Second-level menu item "${childName}" under "${rootName}" should be clickable`).toBeTruthy();
    return result;
}

async function clickThirdLevelItem(page, rootName, childName, grandchildName) {
    await openMenuIfPresent(page);

    const result = await page.evaluate(({ wantedRoot, wantedChild, wantedGrandchild }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);

        const mainLevel = document.querySelector('.meganav .mainLevel');
        const rootItems = directChildItems(mainLevel).filter((item) => item.classList.contains('hasChildren'));
        const root = rootItems.find((item) => normalize(item.querySelector(':scope > a.meganav__link')?.textContent) === wantedRoot);
        const rootSub = root?.querySelector(':scope > ul.meganav__list');
        const childItems = directChildItems(rootSub).filter((item) => item.classList.contains('hasChildren'));
        const child = childItems.find((item) => normalize(item.querySelector(':scope > a.meganav__link')?.textContent) === wantedChild);
        const childSub = child?.querySelector(':scope > ul.meganav__list');
        const grandchildItems = directChildItems(childSub);
        const grandchild = grandchildItems.find((item) => normalize(item.querySelector(':scope > a.meganav__link')?.textContent) === wantedGrandchild);
        const link = grandchild?.querySelector(':scope > a.meganav__link');

        if (!link) {
            return { clicked: false };
        }

        link.click();
        return { clicked: true };
    }, { wantedRoot: rootName, wantedChild: childName, wantedGrandchild: grandchildName });

    expect(result.clicked, `Third-level menu item "${grandchildName}" under "${rootName}" > "${childName}" should be clickable`).toBeTruthy();
    return result;
}

async function expectSecondLevelVisible(page, rootName) {
    await expect.poll(async () => page.evaluate((wantedRoot) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);
        const visible = (el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
        };

        const mainLevel = document.querySelector('.meganav .mainLevel');
        const rootItems = directChildItems(mainLevel).filter((item) => item.classList.contains('hasChildren'));
        const root = rootItems.find((item) => normalize(item.querySelector(':scope > a.meganav__link')?.textContent) === wantedRoot);
        const sub = root?.querySelector(':scope > ul.meganav__list');

        return Boolean(sub && visible(sub) && directChildItems(sub).length > 0);
    }, rootName), {
        message: `${rootName} should reveal second-level navigation items`,
    }).toBe(true);
}

async function expectThirdLevelVisible(page, rootName, secondLevelName) {
    await expect.poll(async () => page.evaluate(({ wantedRoot, wantedChild }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);
        const visible = (el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
        };

        const mainLevel = document.querySelector('.meganav .mainLevel');
        const rootItems = directChildItems(mainLevel).filter((item) => item.classList.contains('hasChildren'));
        const root = rootItems.find((item) => normalize(item.querySelector(':scope > a.meganav__link')?.textContent) === wantedRoot);
        const rootSub = root?.querySelector(':scope > ul.meganav__list');
        const childItems = directChildItems(rootSub).filter((item) => item.classList.contains('hasChildren'));
        const child = childItems.find((item) => normalize(item.querySelector(':scope > a.meganav__link')?.textContent) === wantedChild);
        const sub = child?.querySelector(':scope > ul.meganav__list');

        return Boolean(sub && visible(sub) && directChildItems(sub).length > 0);
    }, { wantedRoot: rootName, wantedChild: secondLevelName }), {
        message: `${secondLevelName} under ${rootName} should reveal third-level navigation items`,
    }).toBe(true);
}

async function getRootLevelItems(page) {
    await openMenuIfPresent(page);

    return page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);

        const mainLevel = document.querySelector('.meganav .mainLevel');
        return directChildItems(mainLevel).map((item) => ({
            text: normalize(item.querySelector(':scope > a.meganav__link')?.textContent),
            href: item.querySelector(':scope > a.meganav__link')?.getAttribute('href') || null,
            hasChildren: item.classList.contains('hasChildren'),
        }));
    });
}

async function getRootLevelLinkBackgroundColor(page, name) {
    return page.evaluate((wantedName) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);

        const mainLevel = document.querySelector('.meganav .mainLevel');
        const items = directChildItems(mainLevel);
        const target = items.find((item) => normalize(item.querySelector(':scope > a.meganav__link')?.textContent) === wantedName);
        const link = target?.querySelector(':scope > a.meganav__link');

        return link ? window.getComputedStyle(link).backgroundColor : null;
    }, name);
}

async function getSecondLevelItems(page, rootName) {
    await openMenuIfPresent(page);

    return page.evaluate((wantedRoot) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.meganav__item, :scope > div.meganav__items > li.meganav__item')) : []);

        const mainLevel = document.querySelector('.meganav .mainLevel');
        const rootItems = directChildItems(mainLevel).filter((item) => item.classList.contains('hasChildren'));
        const root = rootItems.find((item) => normalize(item.querySelector(':scope > a.meganav__link')?.textContent) === wantedRoot);
        if (!root) {
            return [];
        }

        const rootSub = root.querySelector(':scope > ul.meganav__list');
        return directChildItems(rootSub).map((item) => ({
            text: normalize(item.querySelector(':scope > a.meganav__link')?.textContent),
            href: item.querySelector(':scope > a.meganav__link')?.getAttribute('href') || null,
            hasChildren: item.classList.contains('hasChildren'),
        }));
    }, rootName);
}

test('Meganav - Verify Meganav is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await openHomeAndMenu(page);
    });

    await test.step('Verify the MCC meganav is visible', async () => {
        await expect(page.locator('.meganav').first(), 'The MCC meganav should be visible').toBeVisible();
        await expect(page.locator('.meganav .mainLevel').first(), 'The root-level navigation should be visible').toBeVisible();

        const rootItems = await getRootLevelItems(page);
        expect(rootItems.length, 'The meganav should expose at least one root-level item').toBeGreaterThan(0);
    });
});

test('Meganav - Verify Header Logo is Present', async ({ page, baseURL }) => {
    const homepageUrl = buildExpectedUrl(baseURL, '/');

    await test.step('Open a non-homepage page', async () => {
        await page.goto('/lords/match-day/plan-your-day', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
    });

    const logoLink = page.locator('header .header__logo[href="/"]').first();

    await test.step('Verify the header logo is visible', async () => {
        await expect(logoLink, 'The MCC header logo link should be visible in the header').toBeVisible();
    });

    await test.step('Verify the header logo navigates back to the base URL', async () => {
        await clickWithCookieGuard(page, logoLink);
        await expect(page, 'Clicking the header logo should navigate to the base URL').toHaveURL(homepageUrl);
        await page.waitForLoadState('load').catch(() => { });
        await expect(page.locator('.meganav').first(), 'The homepage should show the meganav after returning via the logo').toBeVisible();
    });
});

test('Meganav - Expand Each of the Meganav Links', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open homepage and primary navigation', async () => {
        await openHomeAndMenu(page);
    });

    // The yellow focus-state background is desktop-only: on tablet/mobile (hamburger-driven menu)
    // clicking a root item never adds the "current" class to the link at all (confirmed - only the
    // revealed sublist gets "selected" there), so there's no equivalent visual cue to assert there.
    const isDesktopMeganav = !(await page.locator('.header__hamburger').first().isVisible().catch(() => false));

    const rootItems = await getRootLevelItems(page);
    const expandableRoots = rootItems.filter((item) => item.hasChildren);

    let previouslyActiveRoot = null;

    for (const rootItem of expandableRoots) {
        await test.step(`Expand ${rootItem.text}`, async () => {
            await clickRootLevelItem(page, rootItem.text);
            await expectSecondLevelVisible(page, rootItem.text);

            if (isDesktopMeganav) {
                // The yellow focus-state background fades in over ~500ms (a CSS transition), so poll
                // rather than check immediately after the click.
                await expect.poll(() => getRootLevelLinkBackgroundColor(page, rootItem.text), {
                    message: `${rootItem.text} should show the yellow focus state once expanded`,
                }).toBe(ROOT_LEVEL_ACTIVE_BACKGROUND_COLOR);

                if (previouslyActiveRoot && previouslyActiveRoot !== rootItem.text) {
                    expect(await getRootLevelLinkBackgroundColor(page, previouslyActiveRoot), `${previouslyActiveRoot} should lose the yellow focus state once ${rootItem.text} is expanded`).not.toBe(ROOT_LEVEL_ACTIVE_BACKGROUND_COLOR);
                }
                previouslyActiveRoot = rootItem.text;
            }

            const secondLevelItems = (await getSecondLevelItems(page, rootItem.text)).filter((item) => item.hasChildren);
            for (const secondLevelItem of secondLevelItems) {
                await test.step(`Expand ${rootItem.text} > ${secondLevelItem.text}`, async () => {
                    await clickSecondLevelItem(page, rootItem.text, secondLevelItem.text);
                    await expectThirdLevelVisible(page, rootItem.text, secondLevelItem.text);
                });
            }
        });
    }
});

test('Meganav - Navigate Through Every First, Second and Third Level Item', async ({ page, context, baseURL }) => {
    // Deliberately doesn't hardcode any menu item names or expected destination paths - both
    // change over time (confirmed: menu labels have already drifted twice this project, and
    // hrefs/paths will differ again once this same spec runs against Live). The whole menu tree
    // is read fresh at the start of the test and every leaf is clicked and verified generically:
    // does it actually navigate somewhere real, not whether it matches a specific hardcoded path.
    test.setTimeout(20 * 60 * 1000);

    const homepageUrl = buildExpectedUrl(baseURL, '/');

    const leaves = await test.step('Read every leaf item currently in the meganav', async () => {
        await openHomeAndMenu(page);
        const allLeaves = await getMenuLeafTargets(page);
        const wellFormedLeaves = allLeaves.filter((leaf) => isWellFormedMenuHref(leaf.href));

        expect(wellFormedLeaves.length, 'The meganav should expose at least one well-formed leaf link to navigate to').toBeGreaterThan(0);
        return wellFormedLeaves;
    });

    for (const leaf of leaves) {
        await test.step(`Navigate to "${leaf.path.join(' > ')}"`, async () => {
            await openHomeAndMenu(page);
            await clickMenuPath(page, leaf.path);
            await verifyLeafNavigation(page, context, leaf, homepageUrl);
        });
    }
});
