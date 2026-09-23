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
// Coverage notes - turn2us.org.uk main navigation ("meganav", #main-nav)
// ============================================================================
// Scope: the site-wide primary navigation (`#main-nav`) and the header logo
// that sits alongside it. Not scoped to any single page - these tests open
// the homepage first, then drive the menu from there.
//
// Confirmed via direct probing against Staging (2026-09-23): unlike every
// other project in this workspace, Turn2us's menu is only 2 levels deep -
// each top-level item either expands to ONE flat list of second-level links
// (Get support, Get involved, Campaigns & research, Services for
// organisations, About us) or is a plain direct link with no children
// (Login). There is no third level, so this file's 4th test is named
// "Meganav - Navigate to Second Level" (matching the naming already used by
// Withers/PBS/NPL for shallower sites) rather than RSC/MCC's "...First,
// Second and Third Level Item" naming.
//
// Structure confirmed via direct probing:
//   - Nav container: `#main-nav` (a real `<nav>`, but see the accessibility
//     note below).
//   - Each top-level item is `li.nav__item > a` (the `<a>` has a real href
//     AND toggles a sibling panel via `aria-expanded`/`aria-controls` - a
//     real click does NOT navigate, it only expands/collapses the panel).
//   - The revealed panel is `#<link-id>-content` (`.nav__item-content`),
//     and the parent `<li>` gains a `.nav__item--active` class while open.
//   - This behaviour is identical on mobile/tablet after opening the
//     `#nav-toggle` hamburger (no separate accordion logic needed, unlike
//     most other client projects' mobile nav).
//   - Login (`#nav-login`) has no panel - it's a plain direct link, already
//     covered by 01-turn2us.homepage.spec.js's "Homepage - Top-Level
//     Navigation is Present" test, so it's excluded from this file's
//     expand/leaf-walk tests (there's no "second level" to reach from it).
//
// Confirmed CURRENT defect, left as a note rather than a failing assertion
// (no test in this file currently checks it): `#main-nav`'s aria-label
// attribute is misspelled as `arial-label="Main"` in the rendered HTML, so
// the nav has no accessible name via ARIA despite the intent being clearly
// there. Worth raising with the dev team.
//
// Confirmed real content quirks (not test bugs) seen while reading the menu
// tree fresh:
//   - Each panel's first link duplicates the parent's own label/destination
//     (e.g. Get support's panel includes a "View Get support Get support"
//     link pointing back to `/get-support`) - a real, if slightly odd,
//     "view section overview" pattern rather than a broken link.
//   - Under "Get involved", "Campaign" and "Philanthropy" both link to the
//     exact same destination (`/campaigns-and-research/campaigns`), and
//     there's a link literally labelled "Additional meganav item" pointing
//     back to `/get-involved` - real CMS content oddities, left as-is
//     (still real, working links) rather than filtered out.
//
// No environment-conditional logic exists in this file - the whole-tree,
// read-fresh approach means it adapts to menu/label/path changes on either
// environment (Staging/UAT/Live) automatically.
// ============================================================================

async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#CybotCookiebotDialog').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

function buildExpectedUrl(baseURL, path) {
    return new URL(path, baseURL).toString();
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Turn2us renders some nav labels with a `<br>` between words (e.g. "Get support" is really
// "Get \n<br>support " in the raw DOM) - confirmed via direct probing 2026-09-23. A literal-space
// regex never matches that raw text, so any internal whitespace in the (already-normalized) label
// is rebuilt as `\s+` before being used against the live DOM.
function buildLooseLabelPattern(normalizedText) {
    return new RegExp(`^\\s*${escapeRegExp(normalizedText).replace(/\s+/g, '\\s+')}\\s*$`);
}

// Below the breakpoint where the desktop nav collapses, `#main-nav` is hidden behind the
// `#nav-toggle` hamburger button - confirmed via direct probing 2026-09-23.
async function openMenuIfPresent(page) {
    const mainNav = page.locator('#main-nav').first();
    if (await mainNav.isVisible().catch(() => false)) {
        return;
    }

    const toggleButton = page.locator('#nav-toggle');
    await expect(toggleButton, 'The "Toggle menu" hamburger icon should be visible when the meganav is collapsed').toBeVisible();
    await toggleButton.click();
    await expect(mainNav, 'The Turn2us meganav should be visible after opening the hamburger menu').toBeVisible();
}

async function openHomeAndMenu(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    await openMenuIfPresent(page);
}

// Reads every top-level item fresh from the DOM - never hardcodes labels, since they're
// CMS-managed and will drift.
async function getRootLevelItems(page) {
    return page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const items = Array.from(document.querySelectorAll('#main-nav > ul > li.nav__item'));
        return items.map((li) => {
            const link = li.querySelector(':scope > a');
            return {
                text: normalize(link?.textContent),
                hasChildren: !!link?.getAttribute('aria-controls'),
            };
        });
    });
}

function rootLinkLocator(page, rootText) {
    const pattern = buildLooseLabelPattern(rootText);
    return page.locator('#main-nav > ul > li.nav__item').filter({
        has: page.locator(':scope > a', { hasText: pattern }),
    }).locator(':scope > a').first();
}

async function expandRootItem(page, rootText) {
    const link = rootLinkLocator(page, rootText);
    await link.scrollIntoViewIfNeeded().catch(() => { });
    await link.click();

    const parentItem = page.locator('#main-nav > ul > li.nav__item').filter({
        has: page.locator(':scope > a', { hasText: buildLooseLabelPattern(rootText) }),
    }).first();
    await expect(parentItem, `"${rootText}" should reveal its panel (gain the "nav__item--active" class) once expanded`).toHaveClass(/(^|\s)nav__item--active(\s|$)/);

    const panelId = await link.getAttribute('aria-controls');
    const panel = page.locator(`#${panelId}`);
    await expect(panel, `"${rootText}"'s panel should be visible once expanded`).toBeVisible();

    return panel;
}

// Reads the child links of an already-expanded root item's panel, fresh from the DOM - never
// hardcodes labels or destinations, since both are CMS-managed and will drift.
async function getChildLinks(page, panelId) {
    return page.evaluate((id) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const panel = document.getElementById(id);
        if (!panel) return [];
        return Array.from(panel.querySelectorAll('a')).map((a) => ({
            text: normalize(a.textContent),
            href: a.getAttribute('href'),
            target: a.getAttribute('target'),
        }));
    }, panelId);
}

function isWellFormedHref(href) {
    // Root-relative ("/path") or fully-qualified ("http(s)://...") only - excludes "#" triggers,
    // empty hrefs, and malformed CMS placeholder tokens, none of which are real navigable
    // destinations.
    return Boolean(href) && /^(\/(?!\/)|https?:\/\/)/i.test(href) && href !== '#';
}

async function verifyLeafNavigation(page, context, label, homepageUrl, target) {
    if (target === '_blank') {
        const popup = await context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
        expect(popup, `"${label}" should open a new tab`).toBeTruthy();
        await popup.waitForLoadState('domcontentloaded').catch(() => { });
        expect(popup.url(), `"${label}" should navigate the new tab away from a blank page`).not.toBe('about:blank');
        await popup.close();
        return;
    }

    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await page.waitForLoadState('load').catch(() => { });

    expect(page.url(), `"${label}" should navigate away from the homepage`).not.toBe(homepageUrl);

    // A few destinations are third-party, JS-heavy embedded forms (e.g. "Get involved > Donate"
    // -> a beaconforms.com donation widget) that render nothing but a loading spinner for several
    // seconds before any H1/title appears - confirmed 2026-09-23. expect.poll gives those a real
    // chance to finish loading instead of failing on a still-loading page.
    await expect.poll(async () => {
        const heading = page.locator('h1').first();
        const hasHeading = await heading.isVisible().catch(() => false);
        if (hasHeading) return true;

        const title = (await page.title().catch(() => '')).trim();
        return title.length > 0;
    }, {
        message: `"${label}" destination should expose either a visible H1 or a non-empty document title`,
        timeout: 30000,
    }).toBe(true);
}

test('Meganav - Verify Meganav is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await openHomeAndMenu(page);
    });

    await test.step('Verify the Turn2us meganav is visible', async () => {
        await expect(page.locator('#main-nav'), 'The Turn2us meganav should be visible').toBeVisible();

        const rootItems = await getRootLevelItems(page);
        expect(rootItems.length, 'The meganav should expose at least one root-level item').toBeGreaterThan(0);
    });
});

test('Meganav - Verify Header Logo is Present', async ({ page, baseURL }) => {
    const homepageUrl = buildExpectedUrl(baseURL, '/');

    await test.step('Open a non-homepage page', async () => {
        await page.goto('/about-us', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);
    });

    // Two logo wrappers exist (`#logo-wrapper-desktop`/`#logo-wrapper-mobile`) - only one is
    // visible at a time depending on viewport width, confirmed via direct probing 2026-09-23.
    const logoLink = page.locator('.header__logo a[href="/"][rel="home"]:visible').first();

    await test.step('Verify the header logo is visible', async () => {
        await expect(logoLink, 'The Turn2us header logo link should be visible in the header').toBeVisible();
    });

    await test.step('Verify the header logo navigates back to the base URL', async () => {
        await logoLink.click();
        await expect(page, 'Clicking the header logo should navigate to the base URL').toHaveURL(homepageUrl);
        await page.waitForLoadState('load').catch(() => { });
        await waitForAndAcceptCookieBanner(page);

        await openMenuIfPresent(page);
        await expect(page.locator('#main-nav'), 'The homepage should show the meganav after returning via the logo').toBeVisible();
    });
});

test('Meganav - Expand Each of the Meganav Links', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open homepage and primary navigation', async () => {
        await openHomeAndMenu(page);
    });

    const rootItems = (await getRootLevelItems(page)).filter((item) => item.hasChildren);
    expect(rootItems.length, 'The meganav should expose at least one expandable root-level item').toBeGreaterThan(0);

    for (const rootItem of rootItems) {
        await test.step(`Expand ${rootItem.text}`, async () => {
            const panel = await expandRootItem(page, rootItem.text);
            const childLinks = await getChildLinks(page, await panel.getAttribute('id'));
            expect(childLinks.length, `"${rootItem.text}"'s panel should still contain its child items after opening`).toBeGreaterThan(0);
        });
    }
});

test('Meganav - Navigate to Second Level', async ({ page, context, baseURL }) => {
    // Deliberately doesn't hardcode any menu item names or expected destination paths - both are
    // CMS-managed and will drift over time. Each root item's panel is read fresh right after
    // expanding it, and every well-formed child link is clicked and verified generically: does it
    // actually navigate somewhere real, not whether it matches a specific hardcoded path.
    //
    // ~28 real leaf links across 5 root items, each requiring a fresh homepage reload + re-expand
    // before its own click. Confirmed 2026-09-23: a normal run takes ~5 minutes; one run measured
    // ~51 minutes while Staging was confirmed running unusually slow that particular moment (a real
    // environment condition, not a test design issue - a re-run once Staging recovered came back to
    // ~5 minutes). The 60-minute ceiling below leaves generous margin above even that slow outlier -
    // if a run blows well past this, treat it as a real slowness/availability signal worth
    // investigating, not just bump the number again.
    test.setTimeout(60 * 60 * 1000);

    const homepageUrl = buildExpectedUrl(baseURL, '/');

    const rootItems = await test.step('Read every expandable root-level item', async () => {
        await openHomeAndMenu(page);
        const items = (await getRootLevelItems(page)).filter((item) => item.hasChildren);
        expect(items.length, 'The meganav should expose at least one expandable root-level item').toBeGreaterThan(0);
        return items;
    });

    for (const rootItem of rootItems) {
        const childLeaves = await test.step(`Read second-level items under ${rootItem.text}`, async () => {
            await openHomeAndMenu(page);
            const panel = await expandRootItem(page, rootItem.text);
            const panelId = await panel.getAttribute('id');
            const children = await getChildLinks(page, panelId);
            const wellFormedChildren = children.filter((child) => isWellFormedHref(child.href));
            expect(wellFormedChildren.length, `"${rootItem.text}" should expose at least one well-formed second-level link`).toBeGreaterThan(0);
            return wellFormedChildren.map((child) => ({ ...child, panelId }));
        });

        for (const leaf of childLeaves) {
            const label = `${rootItem.text} > ${leaf.text}`;

            await test.step(`Navigate to "${label}"`, async () => {
                await openHomeAndMenu(page);
                await expandRootItem(page, rootItem.text);

                const link = page.locator(`#${leaf.panelId} a`, { hasText: buildLooseLabelPattern(leaf.text) }).first();
                await link.scrollIntoViewIfNeeded().catch(() => { });
                await link.click();

                await verifyLeafNavigation(page, context, label, homepageUrl, leaf.target);
            });
        }
    }
});
