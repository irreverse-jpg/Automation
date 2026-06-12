const { test, expect } = require('@playwright/test');

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';
const EXPERIENCE_PATH = '/experience';
const PRACTICE_PAGE_PATH_SEGMENT = '/experience/our-practices/';
const PRACTICE_PAGE_REQUIRED_TABS = ['Overview', 'Track Record', 'Our team', 'Insight', 'Get In touch'];

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click();
    }

    await dismissCookieOverlayIfPresent(page);
}

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    const acceptAllButton = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept all cookies")').first();
    const closeButton = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button[aria-label="Close"]').first();

    const overlayVisible = await cookieOverlay.isVisible().catch(() => false);
    const acceptVisible = await acceptAllButton.isVisible().catch(() => false);
    const closeVisible = await closeButton.isVisible().catch(() => false);

    if (!overlayVisible && !acceptVisible && !closeVisible) {
        return;
    }

    if (acceptVisible) {
        await acceptAllButton.click({ timeout: 2000 }).catch(() => { });
    }

    if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click({ timeout: 2000 }).catch(() => { });
    }

    if (await cookieOverlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }
}

async function openExperiencePage(page) {
    await page.goto(EXPERIENCE_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);
    await expect(page, 'The experience route should resolve to the localized Experience page').toHaveURL(new RegExp(`${EXPERIENCE_PATH.replace('/', '\\/')}$`, 'i'));
}

function trimCollapsedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanPracticeAreaLabel(value) {
    return trimCollapsedText(String(value || '')
        .replace(/^TEXT FEATURE TITLE\s+/i, '')
        .replace(/[]+/g, '')
        .replace(/\s+/g, ' '));
}

function normalizeComparisonText(value) {
    return cleanPracticeAreaLabel(value).toLowerCase();
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getContainerForHeading(heading) {
    return heading.locator('xpath=parent::*');
}

async function getMainContentLines(page) {
    const mainText = await page.evaluate(() => {
        const contentRoot = document.querySelector('main') || document.body;
        return contentRoot ? contentRoot.innerText || '' : '';
    });

    return mainText
        .split(/\r?\n/)
        .map(trimCollapsedText)
        .filter(Boolean);
}

function getSectionLines(lines, startHeading, endHeading) {
    const startIndex = lines.findIndex((line) => line === startHeading);
    const endIndex = endHeading
        ? lines.findIndex((line, index) => index > startIndex && line === endHeading)
        : -1;

    if (startIndex === -1) {
        return [];
    }

    return lines.slice(startIndex + 1, endIndex === -1 ? lines.length : endIndex);
}

async function getPracticeAreaLabels(page) {
    const lines = getSectionLines(await getMainContentLines(page), 'Our practice areas', 'How we help');

    return lines
        .map(cleanPracticeAreaLabel)
        .filter(Boolean);
}

async function getAreasOfFocusLabels(page) {
    const lines = getSectionLines(await getMainContentLines(page), 'Areas of focus', 'Get in touch');

    return lines
        .map(trimCollapsedText)
        .filter((line) => line.length <= 70)
        .filter((line) => !/[.!?]$/.test(line));
}

async function getExperiencePracticeLinks(page) {
    const practiceAreaLabels = new Set((await getPracticeAreaLabels(page)).map(normalizeComparisonText));
    const practiceAreasHeading = page.getByRole('heading', { level: 2, name: 'Our practice areas' });
    await expect(practiceAreasHeading, 'The Experience page should expose the Our practice areas section before collecting practice links').toBeVisible();
    const rawLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map((node) => ({
            href: node.getAttribute('href') || '',
            label: (node.textContent || '').replace(/\s+/g, ' ').trim(),
        }));
    });

    const seenPaths = new Set();

    return rawLinks.filter((item) => {
        if (!item.href) {
            return false;
        }

        const url = new URL(item.href, 'https://www.withersworldwide.com');
        const path = url.pathname;
        const segments = path.split('/').filter(Boolean);
        const experienceIndex = segments.indexOf('experience');
        const isTopLevelPracticePage = path.includes('/experience/our-practices/')
            && experienceIndex !== -1
            && segments[experienceIndex + 1] === 'our-practices'
            && segments.length === experienceIndex + 3;

        if (!isTopLevelPracticePage) {
            return false;
        }

        item.path = path;
        item.href = url.toString();
        item.label = cleanPracticeAreaLabel(item.label);

        if (!item.label) {
            return false;
        }

        const normalizedLabel = normalizeComparisonText(item.label);
        if (!practiceAreaLabels.has(normalizedLabel) || seenPaths.has(item.path)) {
            return false;
        }

        seenPaths.add(item.path);
        return true;
    });
}

async function openPracticePage(page, practicePagePath) {
    const firstAttemptSucceeded = await page.goto(practicePagePath, { waitUntil: 'domcontentloaded', timeout: 60000 })
        .then(() => true)
        .catch(() => false);

    if (!firstAttemptSucceeded) {
        await page.goto(practicePagePath, { waitUntil: 'commit', timeout: 60000 });
    }

    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => { });
    await acceptCookiesIfPresent(page);
}

async function getOnThisPageLinks(page) {
    return page.locator('#subNav a[href*="#"]').evaluateAll((nodes) => {
        return nodes.map((node) => ({
            label: (node.textContent || '').replace(/\s+/g, ' ').trim(),
            href: node.getAttribute('href') || '',
            parentClassName: node.parentElement ? node.parentElement.className : '',
        }));
    });
}

async function clickOnThisPageLink(page, linkLabel) {
    const link = page.locator('#subNav a').filter({ hasText: new RegExp(`^${escapeRegex(linkLabel)}$`, 'i') }).first();
    await expect(link, `The practice page should show the ${linkLabel} anchor in the On this page nav`).toBeVisible();

    const href = await link.getAttribute('href');
    expect(href, `The ${linkLabel} anchor should have an in-page hash target`).toBeTruthy();

    await dismissCookieOverlayIfPresent(page);
    await link.scrollIntoViewIfNeeded();

    try {
        await link.click();
    } catch (error) {
        await dismissCookieOverlayIfPresent(page);

        const message = error instanceof Error ? error.message : String(error || '');
        if (!/intercepts pointer events|Timeout/i.test(message)) {
            throw error;
        }

        await link.evaluate((node) => node.click());
    }

    await expect.poll(async () => page.evaluate(() => decodeURIComponent(window.location.hash))).toBe(href);

    return href;
}

function getTrackRecordSection(page) {
    return getContainerForHeading(page.getByRole('heading', { level: 2, name: /^Track record$/i }).first());
}

function getTeamSection(page) {
    return getContainerForHeading(page.getByRole('heading', { level: 2, name: /^Our team$/i }).first());
}

function getInsightSection(page) {
    return getContainerForHeading(page.getByRole('heading', { level: 2, name: /^Insight$/i }).first());
}

function getGetInTouchSection(page) {
    return page.locator('xpath=//*[@id="Get in touch"]/following::*[contains(@class, "featurePanel")][1]');
}

async function expectAnchoredHeading(page, anchorId, headingText) {
    const heading = page.getByRole('heading', { level: 2, name: new RegExp(`^${escapeRegex(headingText)}$`, 'i') }).first();
    await expect(heading, `The ${headingText} section should render after jumping to its anchor`).toHaveText(new RegExp(`^${escapeRegex(headingText)}$`, 'i'));

    const box = await heading.boundingBox();
    expect(box, `The ${headingText} heading should be measurable after the anchor jump`).toBeTruthy();
}

function getTrackRecordTabs(page) {
    return page.locator('#trackRecord-filters').getByRole('tab');
}

async function getTrackRecordFilterLabels(page) {
    return getTrackRecordTabs(page).evaluateAll((nodes) => {
        return nodes
            .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean);
    });
}

test('Experience - Initial Page Load Checks', async ({ page }) => {
    await test.step('Open the Experience page', async () => {
        await openExperiencePage(page);
    });

    await test.step('Verify the page title, H1, and hero CTA', async () => {
        await expect(page, 'The Experience page should load with the expected title').toHaveTitle('Experience | Withersworldwide');

        const h1 = page.getByRole('heading', { level: 1, name: 'Experience' });
        await expect(h1, 'The Experience page should show the Experience H1 in the hero').toBeVisible();

        const heroPanel = getContainerForHeading(h1);
        const getInTouchCta = heroPanel.locator('a, button').filter({ hasText: /^Get in touch$/i }).first();
        await expect(getInTouchCta, 'The Experience hero panel should show the Get in touch CTA').toBeVisible();
    });
}, 30000);

test('Experience - Practice Areas Listing', async ({ page }) => {
    await test.step('Open the Experience page', async () => {
        await openExperiencePage(page);
    });

    await test.step('Verify Our practice areas links are shown', async () => {
        const practiceAreasHeading = page.getByRole('heading', { level: 2, name: 'Our practice areas' });
        await expect(practiceAreasHeading, 'The Experience page should show the Our practice areas heading').toBeVisible();

        const practiceAreaLabels = await getPracticeAreaLabels(page);
        expect(practiceAreaLabels.length, 'The practice areas list should show the practice area links').toBeGreaterThan(10);
    });
}, 30000);

test('Experience - How We Help', async ({ page }) => {
    await test.step('Open the Experience page', async () => {
        await openExperiencePage(page);
    });

    await test.step('Verify How we help shows three panels with Find out more links', async () => {
        const howWeHelpHeading = page.getByRole('heading', { level: 2, name: 'How we help' });
        await expect(howWeHelpHeading, 'The Experience page should show the How we help heading').toBeVisible();

        const findOutMoreLinks = page.getByRole('link', { name: /Find out more/i });

        await expect(findOutMoreLinks, 'The How we help section should show three Find out more links').toHaveCount(3);
    });
}, 30000);

test('Experience - Areas Of Focus Listing', async ({ page }) => {
    await test.step('Open the Experience page', async () => {
        await openExperiencePage(page);
    });

    await test.step('Verify Areas of focus links are shown', async () => {
        const areasOfFocusHeading = page.getByRole('heading', { level: 2, name: 'Areas of focus' });
        await expect(areasOfFocusHeading, 'The Experience page should show the Areas of focus heading').toBeVisible();

        const areasOfFocusLabels = await getAreasOfFocusLabels(page);
        expect(areasOfFocusLabels.length, 'The areas of focus list should show the focus-area links').toBeGreaterThan(10);
    });
}, 30000);

test('Experience - Final CTA and Footer', async ({ page }) => {
    await test.step('Open the Experience page', async () => {
        await openExperiencePage(page);
    });

    await test.step('Verify the lower Get in touch panel and footer', async () => {
        const getInTouchHeading = page.getByRole('heading', { level: 2, name: 'Get in touch' }).last();
        await expect(getInTouchHeading, 'The Experience page should show the lower Get in touch heading').toBeVisible();

        const getInTouchCta = page.locator('a[href$="/contact-us"]').filter({ hasText: /^Get in touch$/i }).first();
        await expect(getInTouchCta, 'The lower Get in touch panel should show the Get in touch CTA').toBeVisible();

        const footer = page.getByRole('contentinfo').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Experience page should show the footer underneath the Experience sections').toBeVisible();
    });
}, 30000);

test.describe('Experience - Practice Area Pages', () => {
    test.setTimeout(10 * 60 * 1000);

    test('Experience - Practice Area Links - Open the Expected Practice Pages', async ({ page }) => {
        await test.step('Collect the top-level practice links from the Experience page', async () => {
            await openExperiencePage(page);

            const practiceLinks = await getExperiencePracticeLinks(page);
            expect(practiceLinks.length, 'The Experience page should expose the top-level practice pages from the Our practice areas section').toBeGreaterThan(10);

            for (const practiceLink of practiceLinks) {
                await test.step(`Open ${practiceLink.label} from the Experience page and verify the practice hero and On this page nav`, async () => {
                    await openExperiencePage(page);
                    await dismissCookieOverlayIfPresent(page);

                    const linkOnExperiencePage = page.locator(`a[href="${practiceLink.path}"]:visible`).first();
                    await expect(linkOnExperiencePage, `${practiceLink.label} should be clickable from the Experience page`).toBeVisible();

                    await expect(linkOnExperiencePage, `${practiceLink.label} should point to the expected practice page`).toHaveAttribute('href', practiceLink.path);
                    await openPracticePage(page, practiceLink.path);
                    await dismissCookieOverlayIfPresent(page);

                    const h1 = page.getByRole('heading', { level: 1 }).first();
                    await expect(h1, `${practiceLink.label} should load a practice hero H1`).toBeVisible();
                    await expect(h1, `The ${practiceLink.label} page should expose a non-empty practice hero H1`).not.toHaveText(/^\s*$/);

                    const onThisPageLinks = await getOnThisPageLinks(page);
                    const normalizedLabels = new Set(onThisPageLinks.map((item) => normalizeComparisonText(item.label)));

                    PRACTICE_PAGE_REQUIRED_TABS.forEach((tabLabel) => {
                        expect(normalizedLabels.has(normalizeComparisonText(tabLabel)), `The ${practiceLink.label} practice page should expose the ${tabLabel} anchor in On this page`).toBe(true);
                    });

                    const overviewEntry = onThisPageLinks.find((item) => normalizeComparisonText(item.label) === normalizeComparisonText('Overview'));
                    expect(overviewEntry, `The ${practiceLink.label} practice page should expose the Overview tab`).toBeTruthy();
                    expect(overviewEntry.parentClassName, `The ${practiceLink.label} practice page should highlight Overview on initial load`).toContain('active');
                });
            }
        });
    });

    test('Experience - Practice Area - Track Record Anchors and Filters Work Across the Practice Pages', async ({ page }) => {
        await openExperiencePage(page);
        const practiceLinks = await getExperiencePracticeLinks(page);

        for (const practiceLink of practiceLinks) {
            await test.step(`Validate Track Record on ${practiceLink.label}`, async () => {
                await openPracticePage(page, practiceLink.path);

                await clickOnThisPageLink(page, 'Track Record');
                await expectAnchoredHeading(page, 'Track Record', 'Track record');

                const trackRecordSection = getTrackRecordSection(page);
                await expect(trackRecordSection, `${practiceLink.label} should render a Track record section after the anchor jump`).toBeVisible();

                const allButton = getTrackRecordTabs(page).filter({ hasText: /^All$/i }).first();
                if (!await allButton.isVisible().catch(() => false)) {
                    return;
                }

                await expect(allButton, `${practiceLink.label} should render the All Track record filter`).toHaveClass(/active/);

                const filterLabels = await getTrackRecordFilterLabels(page);
                expect(filterLabels.length, `${practiceLink.label} should expose Track record filter tabs`).toBeGreaterThan(0);

                for (const filterLabel of filterLabels) {
                    const filterButton = getTrackRecordTabs(page).filter({ hasText: new RegExp(`^${escapeRegex(filterLabel)}$`, 'i') }).first();
                    await expect(filterButton, `${practiceLink.label} should render the ${filterLabel} Track record filter`).toBeVisible();

                    await filterButton.click();
                    await expect(filterButton, `${practiceLink.label} should activate the ${filterLabel} Track record filter when clicked`).toHaveClass(/active/);
                }
            });
        }
    });

    test('Experience - Practice Area - Our team, Insight, and Get in Touch Sections are Present Across the Practice Pages', async ({ page }) => {
        await openExperiencePage(page);
        const practiceLinks = await getExperiencePracticeLinks(page);

        for (const practiceLink of practiceLinks) {
            await test.step(`Validate Our team, Insight, and Get in Touch on ${practiceLink.label}`, async () => {
                await openPracticePage(page, practiceLink.path);

                await clickOnThisPageLink(page, 'Our team');
                await expectAnchoredHeading(page, 'Our team', 'Our team');

                const teamSection = getTeamSection(page);
                await expect(teamSection, `${practiceLink.label} should render an Our team section`).toBeVisible();

                const viewProfileLinks = page.getByRole('link', { name: /View profile/i });
                expect(await viewProfileLinks.count(), `${practiceLink.label} should show at least one person card in Our team`).toBeGreaterThan(0);

                const viewAllLink = page.getByRole('link', { name: /View all/i }).first();
                if (await viewAllLink.isVisible().catch(() => false)) {
                    await expect(viewAllLink, `${practiceLink.label} should keep the optional View all people link clickable when it is shown`).toHaveAttribute('href', /\/people/i);
                }

                await clickOnThisPageLink(page, 'Insight');
                await expectAnchoredHeading(page, 'Insight', 'Insight');

                const insightSection = getInsightSection(page);
                await expect(insightSection, `${practiceLink.label} should render an Insight section`).toBeVisible();

                const insightCards = page.locator('a[href*="/insight/read/"]');
                expect(await insightCards.count(), `${practiceLink.label} should show at least one Insight card`).toBeGreaterThan(0);

                const showMoreControl = page.locator('button, a').filter({ hasText: /^Show more$/i }).first();
                if (await showMoreControl.isVisible().catch(() => false)) {
                    await expect(showMoreControl, `${practiceLink.label} should keep the optional Show more control visible when present`).toBeVisible();
                }

                await clickOnThisPageLink(page, 'Get In touch');
                await expectAnchoredHeading(page, 'Get in touch', 'Get in touch');

                const getInTouchSection = getGetInTouchSection(page);
                await expect(getInTouchSection, `${practiceLink.label} should render the Get in touch panel`).toBeVisible();

                const getInTouchCta = getInTouchSection.locator('a[href$="/contact-us"]').filter({ hasText: /^Get in touch$/i }).first();
                await expect(getInTouchCta, `${practiceLink.label} should show a Get in touch CTA in the lower panel`).toBeVisible();

                const footer = page.getByRole('contentinfo').first();
                await footer.scrollIntoViewIfNeeded();
                await expect(footer, `${practiceLink.label} should show the footer beneath the Get in touch panel`).toBeVisible();

                const positions = await Promise.all([
                    getInTouchSection.boundingBox(),
                    footer.boundingBox(),
                ]);

                expect(positions[0], `${practiceLink.label} should expose measurable Get in touch panel bounds`).toBeTruthy();
                expect(positions[1], `${practiceLink.label} should expose measurable footer bounds`).toBeTruthy();
                expect(positions[1].y, `${practiceLink.label} should keep the footer below the Get in touch panel`).toBeGreaterThan(positions[0].y);
            });
        }
    });
});
