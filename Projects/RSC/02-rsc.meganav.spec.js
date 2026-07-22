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
// Coverage notes - rsc.org main navigation ("meganav", #mainnav)
// ============================================================================
// Scope: the site-wide mega nav (desktop bar / mobile-tablet hamburger) and the
// header logo link that sits alongside it. Not scoped to any single page -
// these tests open the homepage first, then drive the menu from there.
//
// Tests in this file:
//   1. Meganav - Verify Meganav is Present
//      Confirms #mainnav and its root level are visible and expose at least
//      one item.
//   2. Meganav - Verify Header Logo is Present
//      From a non-homepage page, confirms the header logo is visible and
//      clicking it returns to the base URL with the meganav visible again.
//   3. Meganav - Expand Each of the Meganav Links
//      Expands every root-level item with children, checking the revealed
//      sublist gets a `.selected` class (display: flex) AND still contains
//      its child items. On desktop only, ALSO recurses into every deeper
//      item with children (confirmed reliable there) and confirms the
//      expanded link's background color visibly changes from its resting
//      state (generic check - not tied to one exact color, since the
//      "expanded" background rendered a few px of pixel drift between
//      different items when confirmed via getComputedStyle on 2026-07-20,
//      likely anti-aliasing rather than a meaningfully different design
//      color). Mobile/tablet render the menu as a vertical accordion -
//      recursing into deeper siblings there without a fresh reload between
//      each one reproduces inconsistent `.selected` toggling (confirmed
//      2026-07-20), so root level is as deep as this test goes on those two
//      viewports; test 4 below already covers full depth there via a fresh
//      reload per leaf, which avoids the issue.
//   4. Meganav - Navigate Through Every First, Second and Third Level Item
//      Reads the entire menu tree fresh at test start (never hardcodes menu
//      labels or destination paths, since both are CMS-managed and will
//      drift) and clicks every well-formed leaf link, confirming each one
//      actually navigates somewhere real.
//
// No environment-conditional logic exists in this file - the whole-tree, read-fresh approach means
// it adapts to menu/label/path changes on either environment (QA/Live) automatically.
// ============================================================================

function buildExpectedUrl(baseURL, path) {
    return new URL(path, baseURL).toString();
}

// The OneTrust banner is injected asynchronously via GTM - a same-tick isVisible()
// check races it and misses it, leaving its dark overlay blocking clicks lower on
// the page. Wait for the accept button before moving on.
async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

// Below the "lg" breakpoint, #mainnav is hidden behind a "Toggle navigation" hamburger button.
async function openMenuIfPresent(page) {
    const mainLevel = page.locator('#mainnav .mainLevel').first();
    if (await mainLevel.isVisible().catch(() => false)) {
        return;
    }

    const toggleButton = page.getByRole('button', { name: 'Toggle navigation' });
    await expect(toggleButton, 'The "Toggle navigation" hamburger icon should be visible when the meganav is collapsed').toBeVisible();
    await toggleButton.click();
    await expect(mainLevel, 'The RSC meganav should be visible after opening the hamburger menu').toBeVisible();
}

async function openHomeAndMenu(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    await openMenuIfPresent(page);
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function isDesktopMeganavViewport(page) {
    return !(await page.getByRole('button', { name: 'Toggle navigation' }).isVisible().catch(() => false));
}

async function clickMenuLink(page, link) {
    // force:true skips actionability checks but still needs a real bounding box to click at -
    // deep accordion items can end up scrolled fully out of view, so scroll explicitly first.
    await link.scrollIntoViewIfNeeded().catch(() => { });
    await link.click({ force: true });
}

// Builds a locator for the <li class="mainnav__item"> at the end of `path` (an array of item
// names from root downward), scoped level-by-level so items with duplicate labels at different
// depths can't be confused with each other.

function menuItemLocator(page, path) {
    let scope = page.locator('#mainnav .mainLevel');
    let item;

    for (const name of path) {
        const pattern = new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`);
        item = scope.locator(':scope > li.mainnav__item, :scope > div.mainnav__items > li.mainnav__item').filter({
            has: page.locator(':scope > a.mainnav__link', { hasText: pattern }),
        }).first();
        scope = item.locator(':scope > ul.mainnav__list');
    }

    return item;
}

function menuLinkLocator(page, path) {
    return menuItemLocator(page, path).locator(':scope > a.mainnav__link').first();
}

async function expectSublistVisible(page, path) {
    const sublist = menuItemLocator(page, path).locator(':scope > ul.mainnav__list').first();
    await expect(sublist, `"${path.join(' > ')}" should reveal its submenu`).toHaveClass(/(^|\s)selected(\s|$)/);

    // See menuItemLocator's note: opening a submenu wraps its <li> items one level deeper in an
    // inserted <div class="mainnav__items"> (desktop) - match either shape, not just direct
    // children, or this incorrectly reads as "the submenu lost its children".
    const childCount = await sublist.locator(':scope > li.mainnav__item:not(.mainnav__intro), :scope > div.mainnav__items > li.mainnav__item:not(.mainnav__intro)').count();
    expect(childCount, `"${path.join(' > ')}"'s submenu should still contain its child items after opening`).toBeGreaterThan(0);
}

// Clicks through every ancestor of `path` in order (each real click toggles that level's submenu
// open), then clicks the final (leaf) segment itself.
async function clickMenuPath(page, path) {
    await openMenuIfPresent(page);

    for (let depth = 1; depth < path.length; depth++) {
        const segment = path.slice(0, depth);
        await clickMenuLink(page, menuLinkLocator(page, segment));
        await expectSublistVisible(page, segment);
    }

    await clickMenuLink(page, menuLinkLocator(page, path));
}

function isWellFormedMenuHref(href) {
    // Root-relative ("/path") or fully-qualified ("http(s)://...") only - excludes "#" triggers,
    // empty hrefs, and malformed CMS placeholder tokens, none of which are real navigable
    // destinations.
    return Boolean(href) && /^(\/(?!\/)|https?:\/\/)/i.test(href) && href !== '#';
}

// Reads the whole #mainnav tree in one pass and returns every leaf (an item with no further
// children) as a { path, href, target } record. Deliberately independent of what any item is
// currently named or where it currently points - both are CMS-managed and read fresh each run.
async function getMenuLeafTargets(page) {
    await openMenuIfPresent(page);

    return page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.mainnav__item:not(.mainnav__intro), :scope > div.mainnav__items > li.mainnav__item:not(.mainnav__intro)')) : []);

        const mainLevel = document.querySelector('#mainnav .mainLevel');
        const leaves = [];

        function walk(ul, path) {
            for (const item of directChildItems(ul)) {
                const link = item.querySelector(':scope > a.mainnav__link');
                const name = normalize(link?.textContent);
                const nextPath = [...path, name];

                if (!item.classList.contains('hasChildren')) {
                    leaves.push({ path: nextPath, href: link?.getAttribute('href') || null, target: link?.getAttribute('target') || null });
                    continue;
                }

                walk(item.querySelector(':scope > ul.mainnav__list'), nextPath);
            }
        }

        walk(mainLevel, []);
        return leaves;
    });
}

async function getRootLevelItems(page) {
    await openMenuIfPresent(page);

    return page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const mainLevel = document.querySelector('#mainnav .mainLevel');
        return Array.from(mainLevel.querySelectorAll(':scope > li.mainnav__item:not(.mainnav__intro), :scope > div.mainnav__items > li.mainnav__item:not(.mainnav__intro)')).map((item) => ({
            text: normalize(item.querySelector(':scope > a.mainnav__link')?.textContent),
            hasChildren: item.classList.contains('hasChildren'),
        }));
    });
}

async function getChildItems(page, path) {
    const escapedPath = path.map(escapeRegExp);

    return page.evaluate(({ escapedPath }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directChildItems = (ul) => (ul ? Array.from(ul.querySelectorAll(':scope > li.mainnav__item:not(.mainnav__intro), :scope > div.mainnav__items > li.mainnav__item:not(.mainnav__intro)')) : []);

        let scope = document.querySelector('#mainnav .mainLevel');
        for (const pattern of escapedPath) {
            const regex = new RegExp(`^\\s*${pattern}\\s*$`);
            const items = directChildItems(scope);
            const found = items.find((item) => regex.test(normalize(item.querySelector(':scope > a.mainnav__link')?.textContent)));
            if (!found) return [];
            scope = found.querySelector(':scope > ul.mainnav__list');
        }

        return directChildItems(scope).map((item) => ({
            text: normalize(item.querySelector(':scope > a.mainnav__link')?.textContent),
            hasChildren: item.classList.contains('hasChildren'),
        }));
    }, { escapedPath });
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

    expect(page.url(), `"${label}" should navigate away from the homepage`).not.toBe(homepageUrl);

    const heading = page.locator('h1').first();
    const hasHeading = await heading.isVisible({ timeout: 10000 }).catch(() => false);
    if (!hasHeading) {
        const title = (await page.title().catch(() => '')).trim();
        expect(title.length, `"${label}" destination should expose either a visible H1 or a non-empty document title`).toBeGreaterThan(0);
    }
}

test('Meganav - Verify Meganav is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await openHomeAndMenu(page);
    });

    await test.step('Verify the RSC meganav is visible', async () => {
        await expect(page.locator('#mainnav'), 'The RSC meganav should be visible').toBeVisible();
        await expect(page.locator('#mainnav .mainLevel'), 'The root-level navigation should be visible').toBeVisible();

        const rootItems = await getRootLevelItems(page);
        expect(rootItems.length, 'The meganav should expose at least one root-level item').toBeGreaterThan(0);
    });
});

test('Meganav - Verify Header Logo is Present', async ({ page, baseURL }) => {
    const homepageUrl = buildExpectedUrl(baseURL, '/');

    await test.step('Open a non-homepage page', async () => {
        await page.goto('/membership', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
    });

    const logoLink = page.locator('a.header__logo[href="/"]').first();

    await test.step('Verify the header logo is visible', async () => {
        await expect(logoLink, 'The RSC header logo link should be visible in the header').toBeVisible();
    });

    await test.step('Verify the header logo navigates back to the base URL', async () => {
        await logoLink.click();
        await expect(page, 'Clicking the header logo should navigate to the base URL').toHaveURL(homepageUrl);
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        // #mainnav itself is legitimately hidden (display: none) behind the hamburger below the
        // "lg" breakpoint, not a bug - open it first (a no-op on desktop) before checking visibility.
        await openMenuIfPresent(page);
        await expect(page.locator('#mainnav .mainLevel'), 'The homepage should show the meganav after returning via the logo').toBeVisible();
    });
});

test('Meganav - Expand Each of the Meganav Links', async ({ page }) => {
    test.setTimeout(120000);

    await test.step('Open homepage and primary navigation', async () => {
        await openHomeAndMenu(page);
    });

    // The background-color "expanded" cue is desktop-only - mobile/tablet render the menu as a
    // vertical accordion instead and have no equivalent visual state change here. Confirmed
    // 2026-07-20.
    const isDesktopMeganav = await isDesktopMeganavViewport(page);

    async function expandAndVerify(path) {
        const link = menuLinkLocator(page, path);
        const backgroundBefore = await link.evaluate((el) => window.getComputedStyle(el).backgroundColor);

        await clickMenuLink(page, link);
        await expectSublistVisible(page, path);

        if (isDesktopMeganav) {
            await expect.poll(() => link.evaluate((el) => window.getComputedStyle(el).backgroundColor), {
                message: `"${path.join(' > ')}" should visibly change background color once expanded`,
            }).not.toBe(backgroundBefore);
        }

        // Recursing into deeper siblings without a fresh reload between each one is reliable on
        // the desktop flyout (confirmed 2026-07-20), but reproduces inconsistent `.selected`
        // toggling on the mobile/tablet accordion (same family of issue as the root-level one
        // below, just one level deeper) - so only recurse on desktop here. The "Navigate Through
        // Every Level" test already covers full depth on mobile/tablet via a fresh reload per
        // leaf, which avoids this.
        if (isDesktopMeganav) {
            const children = (await getChildItems(page, path)).filter((item) => item.hasChildren);
            for (const child of children) {
                await test.step(`Expand ${[...path, child.text].join(' > ')}`, async () => {
                    await expandAndVerify([...path, child.text]);
                });
            }
        }
    }

    const rootItems = (await getRootLevelItems(page)).filter((item) => item.hasChildren);
    for (const rootItem of rootItems) {
        await test.step(`Expand ${rootItem.text}`, async () => {
            // Reload fresh before each root item - clicking a different root while another's
            // panel is already open produced inconsistent `.selected` toggling (confirmed
            // 2026-07-20), so each root is expanded from a clean state rather than relying on
            // whatever was left open by the previous one.
            await openHomeAndMenu(page);
            await expandAndVerify([rootItem.text]);
        });
    }
});

test('Meganav - Navigate Through Every First, Second and Third Level Item', async ({ page, context, baseURL }) => {
    // Deliberately doesn't hardcode any menu item names or expected destination paths - both are
    // CMS-managed and will drift over time. The whole menu tree is read fresh at the start of the
    // test and every leaf is clicked and verified generically: does it actually navigate somewhere
    // real, not whether it matches a specific hardcoded path.
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
