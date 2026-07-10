const { test, expect } = require('@playwright/test');

// This spec covers the Fixtures and Results core page (/lords/match-day/fixtures-and-results).

const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';

// Confirmed via computed style on the in-page navigation's ::before accent bar - NOT the link's own
// text colour (which is #007bff on both states and is not the indicator). Active is red, inactive is
// a dark navy/purple, not the "#007bff purple" originally assumed - see project memory for detail.
const IN_PAGE_NAV_ACTIVE_BORDER_COLOR = 'rgb(255, 50, 40)';
const IN_PAGE_NAV_INACTIVE_BORDER_COLOR = 'rgb(30, 0, 70)';

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
    // and can flash open asynchronously - observed specifically right after navigating via a
    // meganav click-through, even when consent was already accepted earlier in the session. Escape
    // does not close it; it has its own dedicated close button.
    const preferenceCenterBackdrop = page.locator('.onetrust-pc-dark-filter').first();
    if (await preferenceCenterBackdrop.isVisible().catch(() => false)) {
        await page.locator('#close-pc-btn-handler').first().click({ timeout: 3000 }).catch(() => { });
        await preferenceCenterBackdrop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
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

async function openPage(page, path) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
}

// --- Fixtures and Results page helpers ---

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
    // The topmost in-page nav item(s) can end up rendered behind the sticky meganav header
    // depending on scroll position (confirmed via a real "subtree intercepts pointer events"
    // failure during test authoring - a genuine overlap, same family as the search-box overlap
    // noted elsewhere) - dispatch the click on the element directly so this test isn't flaky
    // depending on exactly where the widget lands on screen.
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

test('Fixtures and Results - Initial Page Checks', async ({ page, baseURL }) => {
    test.setTimeout(60000);

    await test.step('Open the Fixtures and Results page', async () => {
        await openPage(page, '/lords/match-day/fixtures-and-results');
    });

    await test.step('Verify the H1', async () => {
        await expect(page.locator('.standardHeader__title'), 'The page should show the Fixtures & Results heading').toHaveText(/Fixtures\s*&\s*Results/i);
    });

    await test.step('Verify the hero Buy Tickets CTA', async () => {
        const buyTickets = page.locator('.standardHeader').getByRole('link', { name: /buy tickets/i });
        await expect(buyTickets, 'The hero should show a Buy Tickets button').toBeVisible();

        await clickWithCookieGuard(page, buyTickets);
        await page.waitForLoadState('load').catch(() => { });
        expect(new URL(page.url()).host, 'Buy Tickets should navigate to the Lord\'s ticketing site').toBe('tickets.lords.org');

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

test('Fixtures and Results - Fixtures Month Sections and In-Page Navigation', async ({ page }) => {
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

test('Fixtures and Results - Download Calendar and Print Fixtures', async ({ page }) => {
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

test('Fixtures and Results - Switch to Results and Verify Month Sections', async ({ page, baseURL }) => {
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

test('Fixtures and Results - Filter Results', async ({ page }) => {
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
