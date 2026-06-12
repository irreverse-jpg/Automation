const { test, expect } = require('@playwright/test');

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';
const NEWSROOM_PATH = '/insight/newsroom';
const MONTHS = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
};

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

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isCookieInterception = message.includes('intercepts pointer events') || message.includes('onetrust');

        if (!isCookieInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click();
    }
}

async function hoverWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.hover();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isCookieInterception = message.includes('intercepts pointer events') || message.includes('onetrust');

        if (!isCookieInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.hover();
    }
}

async function openNewsroomPage(page) {
    await page.goto(NEWSROOM_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);
    await expect(page, 'The newsroom route should resolve to the localized newsroom page').toHaveURL(new RegExp(`${NEWSROOM_PATH.replace('/', '\\/')}$`, 'i'));
}

function trimCollapsedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getLeadingTitleFragment(value, wordCount = 10) {
    return trimCollapsedText(value).split(/\s+/).slice(0, wordCount).join(' ');
}

function parseDateLabel(label) {
    const [datePart] = label.split('|');
    const tokens = datePart.trim().split(/\s+/);

    if (tokens.length !== 3) {
        return Number.NaN;
    }

    const day = Number(tokens[0]);
    const month = MONTHS[tokens[1].toLowerCase()];
    const year = Number(tokens[2]);

    if (!Number.isFinite(day) || !Number.isFinite(year) || month === undefined) {
        return Number.NaN;
    }

    return Date.UTC(year, month, day);
}

function extractDateLabel(value) {
    const collapsedText = trimCollapsedText(value);
    const match = collapsedText.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*\|\s*([A-Za-z][A-Za-z\s&-]+)/i);

    if (!match) {
        return null;
    }

    return `${trimCollapsedText(match[1])} | ${trimCollapsedText(match[2]).toUpperCase()}`;
}

function getContainerForHeading(heading) {
    return heading.locator('xpath=parent::*');
}

async function getLatestNewsCards(page) {
    const mainText = await page.evaluate(() => {
        const contentRoot = document.querySelector('main') || document.body;
        return contentRoot ? contentRoot.innerText || '' : '';
    });
    const labels = mainText
        .split(/\r?\n/)
        .map(trimCollapsedText)
        .filter(Boolean)
        .filter((line) => /^\d{1,2}\s+[A-Za-z]+\s+\d{4}\s+\|\s+Firm news$/i.test(line));

    return labels.map((dateLabel) => ({
        dateLabel,
        timestamp: parseDateLabel(dateLabel),
    }));
}

async function getPressOfficeProfiles(page) {
    const pressOfficeHeading = page.getByRole('heading', { level: 2, name: 'Meet the press office team' });
    await expect(pressOfficeHeading, 'The newsroom page should show the Meet the press office team heading before collecting press office profiles').toBeVisible();

    return page.evaluate(() => {
        const heading = Array.from(document.querySelectorAll('h2')).find((node) => node.textContent.trim() === 'Meet the press office team');
        const section = heading ? heading.closest('section.personRow') : null;

        if (!section) {
            return [];
        }

        return Array.from(section.querySelectorAll('.personRow__cardWrapper')).map((card) => {
            const nameNode = card.querySelector('.flip-card-front h3, .flip-card-back h3 a, .flip-card-back h3');
            const profileLink = card.querySelector('a.withers-btn, a.personRow__cardLink');

            return {
                name: (nameNode?.textContent || '').replace(/\s+/g, ' ').trim(),
                path: profileLink?.getAttribute('href') || '',
            };
        }).filter((profile) => profile.name && profile.path);
    });
}

async function getLatestNewsArticleCards(page) {
    const latestNewsHeading = page.getByRole('heading', { level: 2, name: 'Latest news' });
    await expect(latestNewsHeading, 'The newsroom page should show the Latest news heading before collecting article cards').toBeVisible();

    return page.locator('a.articleCard[href*="/insight/read/"]').evaluateAll((nodes) => {
        return nodes.map((node, index) => ({
            index: index + 1,
            title: (node.querySelector('h3')?.textContent || '').replace(/\s+/g, ' ').trim(),
            date: (node.querySelector('p')?.textContent || '').replace(/\s+/g, ' ').trim(),
            path: node.getAttribute('href') || '',
        })).filter((card) => card.title && card.date && card.path);
    });
}

async function revealLatestNewsCardsToCount(page, targetCount) {
    let latestNewsCards = await getLatestNewsArticleCards(page);

    while (latestNewsCards.length < targetCount) {
        const showMoreButton = page.getByRole('button', { name: /^Show More$/i });
        const previousCount = latestNewsCards.length;

        await expect(showMoreButton, `The newsroom page should keep exposing Show More until at least ${targetCount} Latest news cards are visible`).toBeVisible();
        let expanded = false;

        for (let attempt = 0; attempt < 3 && !expanded; attempt += 1) {
            await dismissCookieOverlayIfPresent(page);
            await showMoreButton.scrollIntoViewIfNeeded().catch(() => { });

            if (attempt === 0) {
                await clickWithCookieGuard(page, showMoreButton);
            } else {
                await showMoreButton.click({ force: true });
            }

            try {
                await expect.poll(async () => {
                    const cards = await getLatestNewsArticleCards(page);
                    return cards.length;
                }, {
                    timeout: 5000,
                }).toBeGreaterThan(previousCount);
                expanded = true;
            } catch (error) {
                if (attempt === 2) {
                    throw error;
                }
            }
        }

        latestNewsCards = await getLatestNewsArticleCards(page);
    }

    return latestNewsCards;
}

function assertDescendingDateOrder(cards, scenarioLabel) {
    expect(cards.length, `${scenarioLabel} should expose at least one parseable newsroom card`).toBeGreaterThan(0);
    expect(cards.every((card) => Number.isFinite(card.timestamp)), `${scenarioLabel} should only expose parseable newsroom card dates`).toBe(true);

    for (let index = 0; index < cards.length - 1; index += 1) {
        expect(
            cards[index].timestamp,
            `${scenarioLabel} should keep cards ordered from newest to oldest between ${cards[index].dateLabel} and ${cards[index + 1].dateLabel}`,
        ).toBeGreaterThanOrEqual(cards[index + 1].timestamp);
    }
}

test('Newsroom - Initial Page Load Checks', async ({ page }) => {
    await test.step('Open the newsroom page', async () => {
        await openNewsroomPage(page);
    });

    await test.step('Verify the page title, H1, and hero CTA', async () => {
        await expect(page, 'The newsroom page should load with the expected title').toHaveTitle('Newsroom | Withersworldwide');

        const h1 = page.getByRole('heading', { level: 1, name: 'Newsroom' });
        await expect(h1, 'The newsroom page should show the Newsroom H1').toBeVisible();

        const heroPanel = getContainerForHeading(h1);
        const getInTouchCta = heroPanel.locator('a, button').filter({ hasText: /^Get in touch$/i }).first();
        await expect(getInTouchCta, 'The newsroom hero panel should show the Get in touch CTA').toBeVisible();
    });
}, 30000);

test('Newsroom - Office Team and Latest News Listing', async ({ page }) => {
    await test.step('Open the newsroom page', async () => {
        await openNewsroomPage(page);
    });

    await test.step('Verify the Meet the press office team section shows profile cards', async () => {
        const pressOfficeHeading = page.getByRole('heading', { level: 2, name: 'Meet the press office team' });
        await expect(pressOfficeHeading, 'The newsroom page should show the Meet the press office team heading').toBeVisible();

        const profileLinks = page.getByRole('link', { name: /View Profile/i });
        expect(await profileLinks.count(), 'The press office section should show at least one visible profile card').toBeGreaterThan(0);
    });

    await test.step('Verify the Latest news section shows cards in descending date order', async () => {
        const latestNewsHeading = page.getByRole('heading', { level: 2, name: 'Latest news' });
        await expect(latestNewsHeading, 'The newsroom page should show the Latest news heading').toBeVisible();

        const newsCards = await getLatestNewsCards(page);

        expect(newsCards.length, 'The Latest news section should show the initial newsroom card set').toBeGreaterThanOrEqual(16);
        assertDescendingDateOrder(newsCards, 'The initial Latest news listing');
    });
}, 30000);

test('Newsroom - Latest News Listing Show More and Footer', async ({ page }) => {
    await test.step('Open the newsroom page', async () => {
        await openNewsroomPage(page);
    });

    await test.step('Verify Show more loads another 16 latest news cards in descending date order', async () => {
        const latestNewsHeading = page.getByRole('heading', { level: 2, name: 'Latest news' });
        await expect(latestNewsHeading, 'The newsroom page should show the Latest news heading before pagination checks').toBeVisible();

        const initialCards = await getLatestNewsCards(page);
        expect(initialCards.length, 'The newsroom page should show at least the first 16 latest news cards before expanding').toBeGreaterThanOrEqual(16);
        assertDescendingDateOrder(initialCards, 'The pre-expansion Latest news listing');

        const showMoreButton = page.getByRole('button', { name: 'Show more' });
        await expect(showMoreButton, 'The newsroom page should expose the Show more button').toBeVisible();
        await clickWithCookieGuard(page, showMoreButton);

        await expect.poll(async () => {
            const cards = await getLatestNewsCards(page);
            return cards.length;
        }, {
            message: 'Clicking Show more should append another 16 latest news cards',
            timeout: 30000,
        }).toBe(initialCards.length + 16);

        const expandedCards = await getLatestNewsCards(page);
        assertDescendingDateOrder(expandedCards, 'The expanded Latest news listing');
    });

    await test.step('Verify the footer remains visible below the newsroom content', async () => {
        const footer = page.getByRole('contentinfo').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The newsroom page should show the footer underneath the newsroom sections').toBeVisible();
    });
}, 30000);

test('Newsroom - Press Office Team Profile Cards flip on Hover and Open the Matching People Pages', async ({ page }) => {
    await test.step('Collect the press office profiles from the newsroom page', async () => {
        await openNewsroomPage(page);

        const pressOfficeProfiles = await getPressOfficeProfiles(page);
        expect(pressOfficeProfiles.length, 'The newsroom press office section should expose at least one profile card to validate').toBeGreaterThan(0);

        for (const profile of pressOfficeProfiles) {
            await test.step(`Hover the ${profile.name} press office card and open their people page`, async () => {
                await openNewsroomPage(page);

                const cardWrapper = page.locator('.personRow__cardWrapper').filter({
                    has: page.getByRole('heading', { level: 3, name: new RegExp(`^${escapeRegex(profile.name)}$`, 'i') }),
                }).first();
                await expect(cardWrapper, `${profile.name} should remain visible in the newsroom press office section`).toBeVisible();

                const flipCard = cardWrapper.locator('.flip-card').first();
                await hoverWithCookieGuard(page, flipCard);

                const viewProfileCta = cardWrapper.getByRole('link', { name: /^View Profile$/i }).first();
                await expect(viewProfileCta, `${profile.name} should reveal a View Profile CTA when the card is hovered`).toBeVisible();
                await expect(viewProfileCta, `${profile.name} should keep the View Profile CTA linked to the expected people page`).toHaveAttribute('href', profile.path);

                await clickWithCookieGuard(page, viewProfileCta);
                await page.waitForLoadState('load');

                await expect(page, `${profile.name} should open the expected people page after clicking View Profile`).toHaveURL(new RegExp(`${escapeRegex(profile.path)}$`, 'i'));

                const peopleH1 = page.getByRole('heading', { level: 1, name: new RegExp(`^${escapeRegex(profile.name)}$`, 'i') });
                await expect(peopleH1, `${profile.name} should load a people page whose H1 matches the card name`).toBeVisible();
                await expect(page, `${profile.name} should appear in the people page title`).toHaveTitle(new RegExp(escapeRegex(profile.name), 'i'));
            });
        }
    });
}, 60000);

test('Newsroom - Latest News Sample Articles Keep Their Expected Metadata and Article Page Elements', async ({ page }) => {
    test.setTimeout(8 * 60 * 1000);

    await test.step('Collect the 10 sampled Latest news cards while preserving the revealed newsroom state', async () => {
        await openNewsroomPage(page);

        const sampleCards = [];
        const sampledPaths = new Set();
        const addSampleCard = (card) => {
            if (!card || sampledPaths.has(card.path) || sampleCards.length >= 10) {
                return;
            }

            sampledPaths.add(card.path);
            sampleCards.push(card);
        };

        let latestNewsCards = await getLatestNewsArticleCards(page);
        expect(latestNewsCards.length, 'The newsroom page should show at least the first 16 Latest news cards before sampling starts').toBeGreaterThanOrEqual(16);

        addSampleCard(latestNewsCards[0]);
        addSampleCard(latestNewsCards[15]);

        for (let expansionCount = 0; expansionCount < 5 && sampleCards.length < 10; expansionCount += 1) {
            const showMoreButton = page.getByRole('button', { name: /^Show More$/i });
            const previousCount = latestNewsCards.length;

            await expect(showMoreButton, 'The newsroom page should keep exposing Show More while collecting later sample cards').toBeVisible();
            await clickWithCookieGuard(page, showMoreButton);

            await expect.poll(async () => {
                const cards = await getLatestNewsArticleCards(page);
                return cards.length;
            }, {
                message: 'Clicking Show More should reveal a further batch of Latest news cards while building the sample set',
                timeout: 30000,
            }).toBeGreaterThan(previousCount);

            latestNewsCards = await getLatestNewsArticleCards(page);
            addSampleCard(latestNewsCards[previousCount]);
            addSampleCard(latestNewsCards[latestNewsCards.length - 1]);
        }

        expect(sampleCards.length, 'The staged Latest news sampling should produce the requested 10 article cards').toBe(10);

        for (const sampledCard of sampleCards) {
            await test.step(`Open Latest news sample ${sampledCard.index}: ${sampledCard.title}`, async () => {
                const requiredVisibleCardCount = Math.ceil(sampledCard.index / 16) * 16;
                const visibleCardsBeforeOpen = await revealLatestNewsCardsToCount(page, requiredVisibleCardCount);
                const visibleCardCountBeforeOpen = visibleCardsBeforeOpen.length;

                const latestNewsCard = page.locator('a.articleCard').filter({
                    has: page.getByRole('heading', { level: 3, name: new RegExp(`^${escapeRegex(sampledCard.title)}$`, 'i') }),
                }).first();

                await expect(latestNewsCard, `${sampledCard.title} should remain visible in the revealed Latest news listing before opening it`).toBeVisible();
                await expect(latestNewsCard, `${sampledCard.title} should keep the expected newsroom card destination`).toHaveAttribute('href', sampledCard.path);
                await expect(latestNewsCard.locator('p').first(), `${sampledCard.title} should keep the expected newsroom card date label`).toHaveText(new RegExp(`^${escapeRegex(sampledCard.date)}$`, 'i'));

                await clickWithCookieGuard(page, latestNewsCard);
                await page.waitForLoadState('load');
                await dismissCookieOverlayIfPresent(page);

                await expect(page, `${sampledCard.title} should open the matching newsroom article page`).toHaveURL(new RegExp(`${escapeRegex(sampledCard.path)}$`, 'i'));
                await expect(page, `${sampledCard.title} should appear in the article page title`).toHaveTitle(new RegExp(escapeRegex(getLeadingTitleFragment(sampledCard.title)), 'i'));

                const hero = page.locator('.hero').first();
                await expect(hero, `${sampledCard.title} should load with a visible hero section`).toBeVisible();

                const articleH1 = page.getByRole('heading', { level: 1, name: new RegExp(`^${escapeRegex(sampledCard.title)}$`, 'i') }).first();
                await expect(articleH1, `${sampledCard.title} should load an article hero H1 matching the newsroom card title`).toBeVisible();

                const [publishedDate, articleType] = sampledCard.date.split('|').map(trimCollapsedText);
                await expect(hero, `${sampledCard.title} should keep the newsroom card date visible in the article hero`).toContainText(new RegExp(escapeRegex(publishedDate), 'i'));
                await expect(hero, `${sampledCard.title} should keep the newsroom card type visible in the article hero`).toContainText(new RegExp(escapeRegex(articleType), 'i'));

                const xShareLink = page.locator('a[href*="twitter.com/share"], a[aria-label*="Twitter" i], a[aria-label*="X" i]').first();
                const linkedInShareLink = page.getByRole('link', { name: /Share on LinkedIn/i }).first();
                const facebookShareLink = page.getByRole('link', { name: /Share on Facebook/i }).first();
                const emailShareLink = page.getByRole('link', { name: /Share on Email/i }).first();

                await expect(xShareLink, `${sampledCard.title} should expose the X or Twitter share option below the article content`).toBeVisible();
                await expect(xShareLink, `${sampledCard.title} should link the X or Twitter share option to the expected share endpoint`).toHaveAttribute('href', /twitter\.com|x\.com/i);
                await expect(xShareLink, `${sampledCard.title} should open the X or Twitter share option in a new page`).toHaveAttribute('target', '_blank');

                await expect(linkedInShareLink, `${sampledCard.title} should expose the LinkedIn share option below the article content`).toBeVisible();
                await expect(linkedInShareLink, `${sampledCard.title} should link the LinkedIn share option to the expected share endpoint`).toHaveAttribute('href', /linkedin\.com/i);
                await expect(linkedInShareLink, `${sampledCard.title} should open the LinkedIn share option in a new page`).toHaveAttribute('target', '_blank');

                await expect(facebookShareLink, `${sampledCard.title} should expose the Facebook share option below the article content`).toBeVisible();
                await expect(facebookShareLink, `${sampledCard.title} should link the Facebook share option to the expected share endpoint`).toHaveAttribute('href', /facebook\.com/i);
                await expect(facebookShareLink, `${sampledCard.title} should open the Facebook share option in a new page`).toHaveAttribute('target', '_blank');

                await expect(emailShareLink, `${sampledCard.title} should expose the email share option below the article content`).toBeVisible();
                await expect(emailShareLink, `${sampledCard.title} should keep the email share option as a mailto link`).toHaveAttribute('href', /^mailto:/i);

                const joinHeading = page.getByRole('heading', { level: 2, name: 'Join the club' }).first();
                if (await joinHeading.isVisible().catch(() => false)) {
                    await joinHeading.scrollIntoViewIfNeeded();
                    await expect(joinHeading, `${sampledCard.title} should expose the optional Join the club section when it is present`).toBeVisible();

                    const joinSection = page.locator('xpath=//h2[normalize-space()="Join the club"]/ancestor::section[1]').first();
                    const signUpHereCta = joinSection.getByRole('link', { name: /Sign up here/i }).first();
                    await expect(signUpHereCta, `${sampledCard.title} should show the Sign up here CTA within the Join the club area when that section is present`).toBeVisible();
                }

                const footer = page.getByRole('contentinfo').first();
                await footer.scrollIntoViewIfNeeded();
                await expect(footer, `${sampledCard.title} should show the footer immediately below the article content tail`).toBeVisible();

                await page.goBack({ waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load');
                await dismissCookieOverlayIfPresent(page);

                await expect(page, `${sampledCard.title} should return to the newsroom page after one browser back action`).toHaveURL(new RegExp(`${NEWSROOM_PATH.replace('/', '\\/')}$`, 'i'));

                const restoredCards = await revealLatestNewsCardsToCount(page, requiredVisibleCardCount);
                expect(restoredCards.length, `${sampledCard.title} should restore the newsroom listing to the needed batch after one browser back action`).toBeGreaterThanOrEqual(requiredVisibleCardCount);
            });
        }
    });
});

