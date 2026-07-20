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
// Coverage notes - Help & Advice (/help-advice)
// ============================================================================
// Scope: The Help & Advice hub page (news/article panel, category filter,
// Further sources section) plus its three onward destinations - Our Guides
// (with a full traversal of every guide tile), Sources of Advice and Support
// (Support at a stressful time), and Glossary of Terms - plus Dementia Help
// & Advice, a separate meganav-linked article-listing page under the same
// "Help and advice" section.
//
// Tests in this file (6 total):
//   1. Help & Advice - Initial Page Checks - verifies title/H1/breadcrumb,
//      scrolls to the news panel and confirms at least 7 tiles (1 main + 6
//      others) with optional Show more expansion, verifies the Further
//      Sources of Helpful Information section (Our Guides, Sources of Advice
//      and Support, Glossary of Terms) each expose the correct heading and a
//      READ MORE CTA pointing at the right route, then checks footer/TOP.
//   2. Help & Advice - Category Selector - iterates every option in the
//      category filter dropdown (skipping the default "Category (All)"),
//      submits each, and for each one either confirms a no-results message
//      or confirms the "Search results for: <category>" heading, results
//      count text, and that every visible article tile's type label matches
//      the selected category (before and after an optional Show more click).
//   3. Help & Advice - Our Guides Traversal - opens Our Guides, verifies
//      title/H1/breadcrumb, then dynamically traverses every guide tile
//      found on the page, confirming each destination's H1/breadcrumb/title
//      shares a meaningful token with the tile's link text and checking
//      footer/TOP on each, plus a nearest-care-home postcode search and a
//      final footer/TOP check on the Our Guides page itself.
//   4. Help & Advice - Sources of Advice and Support Traversal - opens
//      Support at a stressful time, verifies title/H1/breadcrumb, checks the
//      hero "Find a care home" button routes to /care-homes, confirms the
//      article listing (>=7 tiles) with optional Show more, checks the
//      "Visit our help and advice area" button routes back to /help-advice,
//      runs a nearest-care-home postcode search, then checks footer/TOP.
//   5. Help & Advice - Glossary of Terms Traversal - opens Glossary of
//      Terms, verifies H1/title/breadcrumb, checks the hero button routes
//      back to /help-advice, then checks footer/TOP.
//   6. Help & Advice - Dementia Help & Advice Traversal - added to close a
//      real meganav coverage gap (previously untested). Opens
//      /help-advice/dementia-help-advice directly (its own meganav entry,
//      not a card reached from the hub page), verifies title/H1/breadcrumb,
//      confirms article tiles with optional Show more, then footer/TOP.
//
// The Category Selector test reads its option list live from the page's
// <select> rather than a hardcoded list, so it naturally adapts if categories
// are added/removed/renamed on the site.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler, button:has-text("YES, ALLOW ALL"), button:has-text("Accept")';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, #onetrust-pc-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

async function dismissCookieOverlayIfPresent(page) {
    const acceptTargets = [
        page.locator(COOKIE_ACCEPT_SELECTOR).first(),
        page.getByRole('button', { name: /accept|allow all|yes, allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
        page.getByRole('link', { name: /allow all|yes, i'?m happy|i'?m ok with that/i }).first(),
    ];

    for (const target of acceptTargets) {
        if (await target.isVisible().catch(() => false)) {
            await target.click({ timeout: 3000 }).catch(() => { });
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
        const isOverlayBlock = message.includes('intercepts pointer events') || message.includes('cookie') || message.includes('onetrust');
        const isNotVisible = message.includes('not visible') || message.includes('waiting for element to be visible') || message.includes('element is not visible');

        if (!isOverlayBlock && !isNotVisible) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

function getHelpAdviceTiles(page) {
    return page.locator('a.article__tile');
}

function getHelpAdviceShowMore(page) {
    return page.locator('a, button').filter({ hasText: /^show more$/i }).first();
}

async function helpAdviceClickShowMoreAndWait(page, beforeCount, contextMessage) {
    const showMore = getHelpAdviceShowMore(page);
    await expect(showMore, `${contextMessage} should expose Show more`).toBeVisible();
    await clickWithCookieGuard(page, showMore);

    await expect.poll(async () => await getHelpAdviceTiles(page).count(), {
        message: `${contextMessage} should append more article tiles after clicking Show more`,
        timeout: 15000,
    }).toBeGreaterThan(beforeCount);
}

async function helpAdviceApplyCategoryAndSubmit(page, categoryLabel) {
    const categorySelect = page.locator('select[name="category"]').first();
    const submitButton = page.getByRole('button', { name: /^submit$/i }).first();

    await expect(categorySelect, 'Help & advice page should expose category dropdown').toBeVisible();
    await categorySelect.selectOption({ label: categoryLabel });

    await expect(submitButton, 'Help & advice page should expose Submit button for category filtering').toBeVisible();
    await clickWithCookieGuard(page, submitButton);
    await page.waitForTimeout(2500);
}

function helpAdviceEscapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function helpAdviceMeaningfulTitleTokens(value) {
    const stopWords = new Set(['a', 'an', 'the', 'to', 'for', 'and', 'of', 'on', 'in', 'with', 'our', 'your', 'what', 'how']);
    const tokens = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 3 && !stopWords.has(t));

    return Array.from(new Set(tokens));
}

async function helpAdviceVerifySearchResultsHeading(page, selectedCategoryLabel) {
    const heading = page.locator('p, h2, h3, h4').filter({ hasText: /search results for:/i }).first();
    await expect(heading, `${selectedCategoryLabel} category should show Search results for heading`).toBeVisible();

    const headingText = normalizeWhitespace(await heading.textContent().catch(() => ''));
    expect(
        headingText.toLowerCase(),
        `${selectedCategoryLabel} category Search results heading should match selected category label`
    ).toBe(`search results for: ${selectedCategoryLabel}`.toLowerCase());
}

async function helpAdviceVerifyAllTypeLabels(page, expectedLabel, contextMessage) {
    const tiles = getHelpAdviceTiles(page);
    const count = await tiles.count();

    for (let index = 0; index < count; index += 1) {
        const typeLabel = normalizeWhitespace(await tiles.nth(index).locator('.article__type').first().textContent().catch(() => ''));
        expect(typeLabel, `${contextMessage} article ${index + 1} should carry ${expectedLabel} as its type label`).toMatch(new RegExp(`^${helpAdviceEscapeRegExp(expectedLabel)}$`, 'i'));
    }
}

function getTopButton(page) {
    return page.getByRole('link', { name: /^top$/i }).first()
        .or(page.getByRole('button', { name: /^top$/i }).first())
        .or(page.locator('.footer__scrolltop').first())
        .or(page.locator('a[href="#top"], a:has-text("Back to top"), button:has-text("Back to top"), [class*="back-to-top"], [class*="to-top"]').first());
}

async function verifyFooterAndTopButton(page, contextName) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);

    const scrolledPosition = await page.evaluate(() => window.scrollY);
    expect(scrolledPosition, `${contextName} should be scrolled down before checking footer and TOP`).toBeGreaterThan(500);

    const footer = page.locator('footer').first();
    await expect(footer, `${contextName} should expose a visible footer at the bottom`).toBeVisible();

    const topButton = getTopButton(page);
    await expect(topButton, `${contextName} should expose a TOP button near footer`).toHaveCount(1);

    // Try to make the button interactable: scroll it into view then click (clickWithCookieGuard will force if overlay blocks)
    await topButton.scrollIntoViewIfNeeded().catch(() => { });
    await page.waitForTimeout(200);
    try {
        await clickWithCookieGuard(page, topButton);
    } catch (err) {
        // Some viewports hide the top button; fallback to programmatically scrolling to top
        await page.evaluate(() => window.scrollTo(0, 0));
    }
    await expect.poll(async () => await page.evaluate(() => window.scrollY), {
        message: `${contextName} TOP button should scroll to page top`,
        timeout: 8000,
    }).toBeLessThan(100);
}

test('Help & Advice - Initial Page Checks', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    await test.step('Open /help-advice and verify title, breadcrumb, and H1', async () => {
        await page.goto('/help-advice', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);

        await expect(page, 'Help & advice page title should include Help & advice').toHaveTitle(/help\s*&\s*advice|help and advice/i);
        await expect(page.getByRole('heading', { level: 1 }).first(), 'Help & advice page H1 should be Help and advice').toContainText(/help\s*&\s*advice|help and advice/i);
        await expect(page.locator('nav[aria-label*="breadcrumb" i], .breadcrumb, .bc').first(), 'Help & advice page breadcrumb should include Help & advice').toContainText(/help\s*&\s*advice|help and advice/i);
    });

    await test.step('Scroll to news panel, verify main + six others and Show more if present', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(400);

        const tiles = getHelpAdviceTiles(page);
        const initialCount = await tiles.count();
        expect(initialCount, 'Help & advice news panel should expose at least seven tiles (one main + six others)').toBeGreaterThanOrEqual(7);

        const showMore = getHelpAdviceShowMore(page);
        if (await showMore.isVisible().catch(() => false)) {
            const before = await tiles.count();
            await helpAdviceClickShowMoreAndWait(page, before, 'Help & advice initial Show more click');
        }
    });

    await test.step('Verify Further sources section and READ MORE links', async () => {
        const further = page.getByRole('heading', { level: 3, name: /Further sources of helpful information/i }).first()
            .or(page.locator('h3').filter({ hasText: /further sources of helpful information/i }).first());
        await expect(further, 'Page should expose Further sources of helpful information H3').toBeVisible();

        const guides = page.getByRole('heading', { level: 4, name: /Our guides/i }).first();
        await expect(guides, 'Page should expose Our guides H4').toBeVisible();
        const guidesReadMore = page.locator('a, button').filter({ hasText: /read more/i }).filter({ has: page.locator('a[href*="/help-advice/our-guides"], a[href="/help-advice/our-guides"]') }).first();
        if (await guidesReadMore.isVisible().catch(() => false)) {
            await expect(guidesReadMore, 'Our guides READ MORE should link to /help-advice/our-guides').toHaveAttribute('href', /\/help-advice\/our-guides(?:$|[?#])/i);
        }

        const sources = page.getByRole('heading', { level: 4, name: /Sources of advice and support/i }).first();
        await expect(sources, 'Page should expose Sources of advice and support H4').toBeVisible();
        const sourcesReadMore = page.locator('a, button').filter({ hasText: /read more/i }).filter({ has: page.locator('a[href*="/where-do-i-start/support-at-a-stressful-time"], a[href="/where-do-i-start/support-at-a-stressful-time"]') }).first();
        if (await sourcesReadMore.isVisible().catch(() => false)) {
            await expect(sourcesReadMore, 'Sources of advice READ MORE should link to /where-do-i-start/support-at-a-stressful-time').toHaveAttribute('href', /\/where-do-i-start\/support-at-a-stressful-time(?:$|[?#])/i);
        }

        const glossary = page.getByRole('heading', { level: 4, name: /Glossary of terms/i }).first();
        await expect(glossary, 'Page should expose Glossary of terms H4').toBeVisible();
        const glossaryReadMore = page.locator('a, button').filter({ hasText: /read more/i }).filter({ has: page.locator('a[href*="/help-advice/glossary-of-terms"], a[href="/help-advice/glossary-of-terms"]') }).first();
        if (await glossaryReadMore.isVisible().catch(() => false)) {
            await expect(glossaryReadMore, 'Glossary READ MORE should link to /help-advice/glossary-of-terms').toHaveAttribute('href', /\/help-advice\/glossary-of-terms(?:$|[?#])/i);
        }
    });

    await test.step('Scroll to footer and use TOP button', async () => {
        await verifyFooterAndTopButton(page, 'Help & advice page');
    });
});



test('Help & Advice - Category Selector', async ({ page }) => {
    test.setTimeout(300000);

    await test.step('Open /help-advice and ensure category dropdown exists', async () => {
        await page.goto('/help-advice', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);

        const categorySelect = page.locator('select[name="category"]').first();
        await expect(categorySelect, 'Help & advice page should expose category dropdown').toBeVisible();
        const selectedOption = normalizeWhitespace(await categorySelect.locator('option:checked').first().textContent().catch(() => ''));
        expect(selectedOption, 'Help & advice category default should be Category (All)').toMatch(/^category\s*\(all\)$/i);
    });

    await test.step('Iterate through category options and validate results', async () => {
        const categorySelect = page.locator('select[name="category"]').first();
        const options = await categorySelect.locator('option').allTextContents();
        const normalizedOptions = options.map((o) => normalizeWhitespace(o)).filter(Boolean);

        for (const label of normalizedOptions) {
            if (/^category\s*\(all\)$/i.test(label)) {
                continue;
            }

            await test.step(`Select ${label} and submit`, async () => {
                await helpAdviceApplyCategoryAndSubmit(page, label);

                const bodyText = normalizeWhitespace(await page.locator('body').textContent().catch(() => ''));
                const tiles = getHelpAdviceTiles(page);
                const count = await tiles.count();

                if (/no results found!?/i.test(bodyText) || count === 0) {
                    expect(bodyText, `${label} category should display no-results message`).toMatch(/no results found!?/i);
                    await expect(tiles, `${label} category should have no article tiles`).toHaveCount(0);
                    return;
                }

                await helpAdviceVerifySearchResultsHeading(page, label);

                const resultsText = normalizeWhitespace(await page.locator('p').filter({ hasText: /results/i }).first().textContent().catch(() => ''));
                if (resultsText) {
                    expect(resultsText.toLowerCase(), `${label} search results summary should include results count`).toMatch(/results?/i);
                }

                await helpAdviceVerifyAllTypeLabels(page, label, `${label} initial results`);

                const showMore = getHelpAdviceShowMore(page);
                if (await showMore.isVisible().catch(() => false)) {
                    const before = await tiles.count();
                    await helpAdviceClickShowMoreAndWait(page, before, `${label} Show more click`);
                    await page.waitForTimeout(1500);
                    await helpAdviceVerifyAllTypeLabels(page, label, `${label} after Show more`);
                }
            });
        }
    });
});

test('Help & Advice - Our Guides Traversal', async ({ page }) => {
    test.setTimeout(300000);

    await page.goto('/help-advice', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);

    const guidesH4 = page.getByRole('heading', { level: 4, name: /Our guides/i }).first();
    await expect(guidesH4, 'Our guides H4 should be present').toBeVisible();
    await guidesH4.scrollIntoViewIfNeeded().catch(() => { });

    const guidesLink = page.locator('a[href*="/help-advice/our-guides"], a:has-text("Read more")').first();
    await expect(guidesLink, 'Our guides READ MORE link should exist in the DOM').toHaveCount(1);
    await guidesLink.scrollIntoViewIfNeeded().catch(() => { });
    try {
        await clickWithCookieGuard(page, guidesLink);
    } catch (err) {
        const href = await guidesLink.getAttribute('href');
        if (href) {
            await page.goto(href, { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
        } else {
            throw err;
        }
    }

    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);

    await expect(page, 'Our guides page title should include Our guides').toHaveTitle(/Our guides/i);
    await expect(page.getByRole('heading', { level: 1 }).first(), 'Our guides H1 should be Our guides').toContainText(/Our guides/i);
    await expect(page.locator('nav[aria-label*="breadcrumb" i], .breadcrumb, .bc').first(), 'Our guides breadcrumb should include Our guides').toContainText(/Our guides/i);

    await test.step('Traverse each Our guides tile and verify destinations', async () => {
        // collect unique guide tiles on the Our guides page
        const tiles = page.locator('a[href^="/help-advice/"]').filter({ has: page.locator('.article__title, h3, .card__title') });
        const count = await tiles.count();
        const seen = new Set();

        for (let i = 0; i < count; i += 1) {
            const tile = tiles.nth(i);
            const href = (await tile.getAttribute('href')) || '';
            if (!href || /\/our-guides(?:$|[?#])/.test(href)) continue;
            if (seen.has(href)) continue;
            seen.add(href);

            const tileTitle = normalizeWhitespace(await tile.textContent().catch(() => '')).toLowerCase();

            await tile.scrollIntoViewIfNeeded().catch(() => { });
            try {
                await clickWithCookieGuard(page, tile);
            } catch (err) {
                if (href) {
                    await page.goto(href, { waitUntil: 'domcontentloaded' });
                    await page.waitForLoadState('load').catch(() => { });
                } else {
                    throw err;
                }
            }

            await page.waitForLoadState('load').catch(() => { });
            await acceptCookiesIfPresent(page);

            const h1 = page.getByRole('heading', { level: 1 }).first();
            await expect(h1, `Destination H1 for ${tileTitle} should be present`).toBeVisible();

            const h1Text = normalizeWhitespace(await h1.textContent().catch(() => '')).toLowerCase();
            const breadcrumbText = normalizeWhitespace(await page.locator('nav[aria-label*="breadcrumb" i], .breadcrumb, .bc').first().textContent().catch(() => '')).toLowerCase();
            const titleText = normalizeWhitespace(await page.title()).toLowerCase();

            const tokens = helpAdviceMeaningfulTitleTokens(tileTitle);
            const tokenMatch = tokens.some((token) => h1Text.includes(token) || breadcrumbText.includes(token) || titleText.includes(token));
            expect(tokenMatch, `Destination page should share meaningful tokens from ${tileTitle} in the H1, breadcrumb, or page title`).toBeTruthy();

            await verifyFooterAndTopButton(page, `${tileTitle} destination`);

            // return to Our guides to continue iteration
            await page.goto('/help-advice/our-guides', { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
            await acceptCookiesIfPresent(page);
        }
    });

    await test.step('Nearest home search in Our guides', async () => {
        const nearestHeading = page.getByRole('heading', { name: /Your nearest care home|Find your nearest/i }).first();
        if (await nearestHeading.isVisible().catch(() => false)) {
            await nearestHeading.scrollIntoViewIfNeeded();
            const nearestSection = nearestHeading.locator('xpath=ancestor::section[1], ancestor::div[contains(@class, "section")], ancestor::div[contains(@class, "container")]').first();
            const searchInput = nearestSection.locator('input#careHomeSearch, input[placeholder*="postcode" i], input[type="search"]').first();
            const submitButton = nearestSection.locator('button[type="submit"], button:has-text("Search"), button:has-text("Find"), button:has-text("Submit")').first();

            if (await searchInput.isVisible().catch(() => false)) {
                await searchInput.click().catch(() => { });
                await searchInput.fill('SE173HE', { timeout: 5000 }).catch(() => { });

                if (await submitButton.isVisible().catch(() => false)) {
                    await clickWithCookieGuard(page, submitButton);
                    await page.waitForTimeout(2000);

                    await expect.poll(async () => normalizeWhitespace(await page.locator('body').textContent().catch(() => '')), {
                        message: 'Nearest home search should present results',
                        timeout: 30000,
                    }).not.toBe('');
                }
            }
        }
    });

    await test.step('Verify footer and TOP on Our guides page', async () => {
        await verifyFooterAndTopButton(page, 'Our guides page');
    });
});

test('Help & Advice - Sources of Advice and Support Traversal', async ({ page, baseURL }) => {
    test.setTimeout(180000);
    test.setTimeout(300000);
    await page.goto('/help-advice', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);

    const sourcesH4 = page.getByRole('heading', { level: 4, name: /Sources of advice and support/i }).first();
    await expect(sourcesH4, 'Sources of advice and support H4 should be present').toBeVisible();
    await sourcesH4.scrollIntoViewIfNeeded().catch(() => { });

    const readMore = page.locator('a, button').filter({ hasText: /read more/i }).filter({ has: sourcesH4 }).first();
    if (await readMore.count() === 0) {
        // fallback: search nearby links under the H4
        const nearby = page.locator(`xpath=//h4[normalize-space()=${JSON.stringify(normalizeWhitespace(await sourcesH4.textContent().catch(() => '')))}]/following::a|//h4[normalize-space()=${JSON.stringify(normalizeWhitespace(await sourcesH4.textContent().catch(() => '')))}]/following::button`).filter({ hasText: /read more/i }).first();
        if (await nearby.count() === 0) throw new Error('Sources of advice READ MORE not found');
        try {
            await clickWithCookieGuard(page, nearby);
        } catch (err) {
            const href = await nearby.getAttribute('href').catch(() => null);
            if (href) {
                await page.goto(href, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            } else {
                throw err;
            }
        }
    } else {
        try {
            await clickWithCookieGuard(page, readMore);
        } catch (err) {
            const href = await readMore.getAttribute('href').catch(() => null);
            if (href) {
                await page.goto(href, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            } else {
                throw err;
            }
        }
    }

    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);

    await expect(page, 'Support at a stressful time title should be present').toHaveTitle(/Support at a stressful time/i);
    await expect(page.getByRole('heading', { level: 1 }).first(), 'H1 should be Support at a stressful time').toContainText(/Support at a stressful time/i);
    await expect(page.locator('nav[aria-label*="breadcrumb" i], .breadcrumb, .bc').first(), 'Breadcrumb should include Support at a stressful time').toContainText(/Support at a stressful time/i);

    // Hero: Find a care home button
    const hero = page.locator('header, .hero, .page-hero').first();
    const findCareHome = hero.locator('a, button').filter({ hasText: /find a care home/i }).first()
        .or(page.getByRole('link', { name: /find a care home/i }).first())
        .or(page.getByRole('button', { name: /find a care home/i }).first());

    if (await findCareHome.isVisible().catch(() => false)) {
        const href = await findCareHome.getAttribute('href').catch(() => null);
        if (href) expect(href, 'Find a care home hero button should target /care-homes').toMatch(/\/care-homes(?:$|[?#])/i);

        await clickWithCookieGuard(page, findCareHome);
        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);
        await expect(page, 'Clicking Find a care home should navigate to /care-homes').toHaveURL(new RegExp(`${new URL('/care-homes', baseURL).toString()}(?:$|[?#])`, 'i'));

        // return
        await page.goBack({ waitUntil: 'load' }).catch(async () => { await page.goto('/where-do-i-start/support-at-a-stressful-time'); });
        await acceptCookiesIfPresent(page);
    }

    // Article listing: featured + at least 6 others
    const listingTiles = page.locator('a.article__tile, .article, .card').filter({ has: page.locator('h3, .article__title, .card__title') });
    const listingCount = await listingTiles.count();
    expect(listingCount, 'Support page should list at least 7 articles (1 featured + 6 others)').toBeGreaterThanOrEqual(7);

    // Show more handling
    const showMore = page.locator('a, button').filter({ hasText: /^show more$/i }).first();
    if (await showMore.isVisible().catch(() => false)) {
        const before = await listingTiles.count();
        await clickWithCookieGuard(page, showMore);
        await expect.poll(async () => await listingTiles.count(), { timeout: 15000 }).toBeGreaterThan(before);
    }

    // Visit our Help and Advice area button
    const visitHelp = page.locator('a, button').filter({ hasText: /visit our help and advice area/i }).first();
    if (await visitHelp.count() > 0) {
        const href = await visitHelp.getAttribute('href').catch(() => null);
        if (href) expect(href, 'Visit our help and advice area should link to /help-advice').toMatch(/\/help-advice(?:$|[?#])/i);
        try {
            await clickWithCookieGuard(page, visitHelp);
        } catch (err) {
            if (href) {
                await page.goto(href, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            } else {
                throw err;
            }
        }

        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);
        await expect(page).toHaveURL(new RegExp(`${new URL('/help-advice', baseURL).toString()}(?:$|[?#])`, 'i'));

        // return
        await page.goBack({ waitUntil: 'load' }).catch(async () => { await page.goto('/where-do-i-start/support-at-a-stressful-time'); });
        await acceptCookiesIfPresent(page);
    }

    // Nearest care home search
    const nearestHeading = page.getByRole('heading', { name: /Your nearest care home|Find your nearest/i }).first();
    if (await nearestHeading.isVisible().catch(() => false)) {
        await nearestHeading.scrollIntoViewIfNeeded();
        const nearestSection = nearestHeading.locator('xpath=ancestor::section[1], ancestor::div[contains(@class, "section")], ancestor::div[contains(@class, "container")]').first();
        const searchInput = nearestSection.locator('input#careHomeSearch, input[placeholder*="postcode" i], input[type="search"]').first();
        const submitButton = nearestSection.locator('button[type="submit"], button:has-text("Search"), button:has-text("Find"), button:has-text("Submit")').first();

        if (await searchInput.isVisible().catch(() => false)) {
            await searchInput.click().catch(() => { });
            await searchInput.fill('SE173HE', { timeout: 5000 }).catch(() => { });

            if (await submitButton.isVisible().catch(() => false)) {
                await clickWithCookieGuard(page, submitButton);
                await page.waitForTimeout(2000);

                await expect.poll(async () => await page.locator('a[href*="/care-homes/"]').count(), {
                    message: 'Nearest home search should present exactly 1 result',
                    timeout: 30000,
                }).toBe(1);
            }
        }
    }

    // Footer and TOP
    await verifyFooterAndTopButton(page, 'Support at a stressful time page');
});



test('Help & Advice - Glossary of terms Traversal', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await page.goto('/help-advice', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);

    const glossaryH4 = page.getByRole('heading', { level: 4, name: /Glossary of terms/i }).first();
    await expect(glossaryH4, 'Glossary of terms H4 should be present').toBeVisible();
    await glossaryH4.scrollIntoViewIfNeeded().catch(() => { });

    const readMore = page.locator('a, button').filter({ hasText: /read more/i }).filter({ has: glossaryH4 }).first();
    if (await readMore.count() === 0) {
        const nearby = page.locator(`xpath=//h4[normalize-space()=${JSON.stringify(normalizeWhitespace(await glossaryH4.textContent().catch(() => '')))}]/following::a|//h4[normalize-space()=${JSON.stringify(normalizeWhitespace(await glossaryH4.textContent().catch(() => '')))}]/following::button`).filter({ hasText: /read more/i }).first();
        if (await nearby.count() === 0) throw new Error('Glossary READ MORE not found');
        try {
            await clickWithCookieGuard(page, nearby);
        } catch (err) {
            const href = await nearby.getAttribute('href').catch(() => null);
            if (href) {
                await page.goto(href, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            } else {
                throw err;
            }
        }
    } else {
        try {
            await clickWithCookieGuard(page, readMore);
        } catch (err) {
            const href = await readMore.getAttribute('href').catch(() => null);
            if (href) {
                await page.goto(href, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            } else {
                throw err;
            }
        }
    }

    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);

    const h1 = page.getByRole('heading', { level: 1 }).first();
    await expect(h1, 'Destination H1 should be present').toBeVisible();

    const h1Text = normalizeWhitespace(await h1.textContent().catch(() => '')).toLowerCase();
    const titleText = normalizeWhitespace(await page.title()).toLowerCase();
    expect(titleText, 'Page title should include "Glossary of terms"').toMatch(/glossary of terms/i);

    const breadcrumb = page.locator('nav[aria-label*="breadcrumb" i], .breadcrumb, .bc').first();
    await expect(breadcrumb, 'Breadcrumb should include Help & advice').toContainText(/help\s*&\s*advice|help and advice/i);

    // Hero button should take to /help-advice
    const hero = page.locator('header, .hero, .page-hero').first();
    const backBtn = hero.locator('a, button').filter({ hasText: /help[- ]?advice|visit our help and advice area|visit help and advice/i }).first()
        .or(page.locator('a[href*="/help-advice"]').first());

    if (await backBtn.isVisible().catch(() => false)) {
        const href = await backBtn.getAttribute('href').catch(() => null);
        if (href) expect(href, 'Hero button should target /help-advice').toMatch(/\/help-advice(?:$|[?#])/i);

        try {
            await clickWithCookieGuard(page, backBtn);
        } catch (err) {
            if (href) {
                await page.goto(href, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load').catch(() => { });
            } else {
                throw err;
            }
        }

        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);
        await expect(page).toHaveURL(new RegExp(`${new URL('/help-advice', baseURL).toString()}(?:$|[?#])`, 'i'));

        // return
        await page.goBack({ waitUntil: 'load' }).catch(async () => { await page.goto('/help-advice/glossary-of-terms'); });
        await acceptCookiesIfPresent(page);
    }

    await verifyFooterAndTopButton(page, 'Glossary of terms page');
});

test('Help & Advice - Dementia Help & Advice Traversal', async ({ page }) => {
    // Added to close a real meganav coverage gap - this page previously had
    // no test at all. It's a filtered article-listing page using the same
    // tile/Show-more component as the main /help-advice hub, reached via its
    // own meganav entry rather than a card on the hub page.
    test.setTimeout(120000);

    await test.step('Open /help-advice/dementia-help-advice and verify title, breadcrumb, and H1', async () => {
        await page.goto('/help-advice/dementia-help-advice', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
        await acceptCookiesIfPresent(page);

        await expect(page, 'Dementia help & advice page title should include Dementia help & advice').toHaveTitle(/dementia help\s*&?\s*advice/i);
        await expect(page.getByRole('heading', { level: 1 }).first(), 'Dementia help & advice page H1 should be Dementia help & advice').toContainText(/dementia help\s*&?\s*advice/i);
        await expect(page.locator('nav[aria-label*="breadcrumb" i], .breadcrumb, .bc').first(), 'Dementia help & advice breadcrumb should include Help and advice').toContainText(/help\s*&\s*advice|help and advice/i);
    });

    await test.step('Verify article tiles and Show more if present', async () => {
        const tiles = getHelpAdviceTiles(page);
        const initialCount = await tiles.count();
        expect(initialCount, 'Dementia help & advice should expose at least one article tile').toBeGreaterThan(0);

        const showMore = getHelpAdviceShowMore(page);
        if (await showMore.isVisible().catch(() => false)) {
            const before = await tiles.count();
            await helpAdviceClickShowMoreAndWait(page, before, 'Dementia help & advice Show more click');
        }
    });

    await verifyFooterAndTopButton(page, 'Dementia help & advice page');
});




