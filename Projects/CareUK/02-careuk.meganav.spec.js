const { test, expect } = require('@playwright/test');

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
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

async function waitForMenuOpen(page) {
    await expect(page.locator('.navigation.navigation--open .rootlevel').first(), 'The CareUK navigation drawer should be open').toBeVisible();
}

async function openMenuIfPresent(page) {
    await dismissCookieOverlayIfPresent(page);

    const openDrawer = page.locator('.navigation.navigation--open .rootlevel').first();
    if (await openDrawer.isVisible().catch(() => false)) {
        return;
    }

    const navIcon = page.locator('.navicon').first();
    await expect(navIcon, 'The CareUK hamburger menu icon should be visible').toBeVisible();
    await clickWithCookieGuard(page, navIcon);
    await waitForMenuOpen(page);
}

async function clickRootLevelItem(page, name) {
    await openMenuIfPresent(page);

    const result = await page.evaluate((wantedName) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => normalize(node.textContent))
            .join(' ')
            .trim();

        const items = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li'));
        const target = items.find((item) => {
            const label = normalize(directText(item) || item.querySelector(':scope > a')?.textContent);
            return label === wantedName;
        });

        if (!target) {
            return { clicked: false };
        }

        const link = target.querySelector(':scope > a[href]');
        (link || target).click();

        return {
            clicked: true,
            hasSublevel: target.classList.contains('hasSublevel'),
        };
    }, name);

    expect(result.clicked, `Root-level menu item "${name}" should be clickable`).toBeTruthy();
    return result;
}

async function clickSecondLevelItem(page, rootName, childName) {
    await openMenuIfPresent(page);

    const result = await page.evaluate(({ wantedRoot, wantedChild }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => normalize(node.textContent))
            .join(' ')
            .trim();
        const rootItems = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li.hasSublevel'));
        const root = rootItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedRoot);
        if (!root) {
            return { clicked: false, reason: 'root-not-found' };
        }

        const childItems = Array.from(root.querySelectorAll(':scope > .sublevelOne > ul > li'));
        const child = childItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedChild);
        if (!child) {
            return { clicked: false, reason: 'child-not-found' };
        }

        const link = child.querySelector(':scope > a[href]');
        (link || child).click();

        return {
            clicked: true,
            hasSublevel: child.classList.contains('hasSublevel'),
        };
    }, { wantedRoot: rootName, wantedChild: childName });

    expect(result.clicked, `Second-level menu item "${childName}" under "${rootName}" should be clickable`).toBeTruthy();
    return result;
}

async function expectSecondLevelVisible(page, rootName) {
    await expect.poll(async () => page.evaluate((wantedRoot) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => normalize(node.textContent))
            .join(' ')
            .trim();
        const visible = (el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
        };

        const rootItems = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li.hasSublevel'));
        const root = rootItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedRoot);
        const sublevel = root?.querySelector(':scope > .sublevelOne');

        return Boolean(sublevel && visible(sublevel) && sublevel.querySelectorAll('a[href]').length > 0);
    }, rootName), {
        message: `${rootName} should reveal second-level navigation items`,
    }).toBe(true);
}

async function expectThirdLevelVisible(page, rootName, secondLevelName) {
    await expect.poll(async () => page.evaluate(({ wantedRoot, wantedChild }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => normalize(node.textContent))
            .join(' ')
            .trim();
        const visible = (el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
        };

        const rootItems = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li.hasSublevel'));
        const root = rootItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedRoot);
        const childItems = Array.from(root?.querySelectorAll(':scope > .sublevelOne > ul > li.hasSublevel') || []);
        const child = childItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedChild);
        const sublevel = child?.querySelector(':scope > .sublevelTwo');

        return Boolean(sublevel && visible(sublevel) && sublevel.querySelectorAll('a[href]').length > 0);
    }, { wantedRoot: rootName, wantedChild: secondLevelName }), {
        message: `${secondLevelName} under ${rootName} should reveal third-level navigation items`,
    }).toBe(true);
}

async function getRootLevelItems(page) {
    await openMenuIfPresent(page);

    return page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => normalize(node.textContent))
            .join(' ')
            .trim();

        return Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li')).map((item) => ({
            text: normalize(directText(item) || item.querySelector(':scope > a')?.textContent),
            href: item.querySelector(':scope > a')?.getAttribute('href') || null,
            hasSublevel: item.classList.contains('hasSublevel'),
        }));
    });
}

async function getSecondLevelItems(page, rootName) {
    await openMenuIfPresent(page);

    return page.evaluate((wantedRoot) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const directText = (li) => Array.from(li.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => normalize(node.textContent))
            .join(' ')
            .trim();
        const rootItems = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li.hasSublevel'));
        const root = rootItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedRoot);
        if (!root) {
            return [];
        }

        return Array.from(root.querySelectorAll(':scope > .sublevelOne > ul > li')).map((item) => ({
            text: normalize(directText(item) || item.querySelector(':scope > a')?.textContent),
            href: item.querySelector(':scope > a')?.getAttribute('href') || null,
            hasSublevel: item.classList.contains('hasSublevel'),
        }));
    }, rootName);
}

async function openHomeAndMenu(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await openMenuIfPresent(page);
}

async function verifyNavigatedPage(page) {
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page.locator('h1').first(), 'Navigating from the CareUK menu should load a page with a visible H1').toBeVisible();
}

test('Meganav - Verify Meganav is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await openHomeAndMenu(page);
    });

    await test.step('Verify the CareUK meganav is visible', async () => {
        await expect(page.locator('.navigation.navigation--open').first(), 'The CareUK navigation drawer should be visible once the hamburger is clicked').toBeVisible();
        await expect(page.locator('.navigation.navigation--open .rootlevel').first(), 'The root-level navigation should be visible inside the open drawer').toBeVisible();
    });
}, 30000);

test('Meganav - Verify Header Logo is Present', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await openHomeAndMenu(page);
    });

    await test.step('Verify the header logo is visible', async () => {
        const logoLink = page.locator('header .header__logo a[href="/"]').first();
        await expect(logoLink, 'The CareUK header logo link should be visible in the header').toBeVisible();
    });
}, 30000);

test('Meganav - Expand Each of the Meganav Links', async ({ page }) => {
    await test.step('Open homepage and primary navigation', async () => {
        await openHomeAndMenu(page);
    });

    const rootItems = (await getRootLevelItems(page)).filter((item) => item.text && item.text.toLowerCase() !== 'jhtest');
    const expandableRoots = rootItems.filter((item) => item.hasSublevel);

    for (const rootItem of expandableRoots) {
        await test.step(`Expand ${rootItem.text}`, async () => {
            await clickRootLevelItem(page, rootItem.text);
            await expectSecondLevelVisible(page, rootItem.text);

            const secondLevelItems = (await getSecondLevelItems(page, rootItem.text)).filter((item) => item.hasSublevel);
            for (const secondLevelItem of secondLevelItems) {
                await test.step(`Expand ${rootItem.text} > ${secondLevelItem.text}`, async () => {
                    await clickSecondLevelItem(page, rootItem.text, secondLevelItem.text);
                    await expectThirdLevelVisible(page, rootItem.text, secondLevelItem.text);
                });
            }
        });
    }
}, 60000);

test('Meganav - Navigate to First, Second and Third Level Pages', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Open homepage and primary navigation', async () => {
        await openHomeAndMenu(page);
    });

    const navigationTargets = [
        {
            level: 'first',
            root: 'Find a local care home',
            expectedPath: '/care-homes',
        },
        {
            level: 'first',
            root: 'Care UK News',
            expectedPath: '/news',
        },
        {
            level: 'second',
            root: 'Where do I start?',
            child: 'Moving in',
            expectedPath: '/where-do-i-start/moving-in',
        },
        {
            level: 'second',
            root: 'Help & advice',
            child: 'Our guides',
            expectedPath: '/help-advice/our-guides',
        },
        {
            level: 'third',
            root: 'Life at a Care UK home',
            child: 'Lifestyle',
            grandchild: 'Meaningful lifestyles',
            expectedPath: '/life-at-a-care-uk-home/lifestyle/meaningful-lifestyles',
        },
        {
            level: 'third',
            root: 'Types of care',
            child: 'Dementia care',
            grandchild: 'Namaste care',
            expectedPath: '/types-of-care/dementia-care/namaste-care',
        },
    ];

    for (const target of navigationTargets) {
        await test.step(`Navigate to ${target.expectedPath} from the ${target.level}-level navigation`, async () => {
            await openMenuIfPresent(page);

            if (target.level === 'first') {
                await clickRootLevelItem(page, target.root);
            } else if (target.level === 'second') {
                await clickRootLevelItem(page, target.root);
                await expectSecondLevelVisible(page, target.root);
                await clickSecondLevelItem(page, target.root, target.child);
            } else {
                await clickRootLevelItem(page, target.root);
                await expectSecondLevelVisible(page, target.root);
                await clickSecondLevelItem(page, target.root, target.child);
                await expectThirdLevelVisible(page, target.root, target.child);
                await clickSecondLevelItem(page, target.root, target.child);

                const clicked = await page.evaluate(({ wantedRoot, wantedChild, wantedGrandchild }) => {
                    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
                    const directText = (li) => Array.from(li.childNodes)
                        .filter((node) => node.nodeType === Node.TEXT_NODE)
                        .map((node) => normalize(node.textContent))
                        .join(' ')
                        .trim();
                    const rootItems = Array.from(document.querySelectorAll('.navigation .rootlevel > ul > li.hasSublevel'));
                    const root = rootItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedRoot);
                    const childItems = Array.from(root?.querySelectorAll(':scope > .sublevelOne > ul > li.hasSublevel') || []);
                    const child = childItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedChild);
                    const grandchildItems = Array.from(child?.querySelectorAll(':scope > .sublevelTwo > ul > li') || []);
                    const grandchild = grandchildItems.find((item) => normalize(directText(item) || item.querySelector(':scope > a')?.textContent) === wantedGrandchild);
                    const link = grandchild?.querySelector(':scope > a[href]');

                    if (!link) {
                        return false;
                    }

                    link.click();
                    return true;
                }, { wantedRoot: target.root, wantedChild: target.child, wantedGrandchild: target.grandchild });

                expect(clicked, `Third-level menu item "${target.grandchild}" should be clickable under ${target.root} > ${target.child}`).toBeTruthy();
            }

            await expect(page, `${target.level}-level menu navigation should open ${target.expectedPath}`).toHaveURL(buildExpectedUrl(baseURL, target.expectedPath));
            await verifyNavigatedPage(page);
        });
    }
}, 120000);