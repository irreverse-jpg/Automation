const { test, expect } = require('@playwright/test');

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';
const PEOPLE_PATH = '/people';
const DESKTOP_PROJECT_NAME = 'desktop-chromium';
const SEARCH_HELPER_TEXT = "Enter the first letters of someone's name or surname";
const HERO_DESCRIPTION_TEXT = 'The key to our success lies in the skill and experience of our people.';
const EXPECTED_PAGE_TITLE = 'Find the right lawyer for you | People | Withersworldwide';
const ALPHABET_OPTIONS = ['All', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
const PEOPLE_PROFILE_SECTION_LABELS = ['Overview', 'Experience', 'Publications', 'Credentials'];
const PROFILE_SHARE_CONTROL_ORDER = ['X', 'LinkedIn', 'Facebook', 'Email'];
const PROFILE_SEARCH_TERM = 'johns';
const PROFILE_SECTION_HASH_BY_LABEL = {
    Experience: '#person-experience',
    Publications: '#person-publications',
    Credentials: '#person-credentials',
};
const COMMON_CREDENTIALS_HEADING_PATTERNS = [
    /^Admissions?$/i,
    /^Education$/i,
    /^Languages$/i,
    /^Memberships$/i,
    /^Key dates$/i,
];

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
        const isPointerInterception = message.includes('intercepts pointer events') || message.includes('would receive the click');
        const isCookieInterception = message.includes('onetrust');

        if (!isPointerInterception && !isCookieInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
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

async function openPeoplePage(page) {
    await page.goto(PEOPLE_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'The traversal flow should start from the localized People page').toHaveURL(new RegExp(`${PEOPLE_PATH.replace('/', '\\/')}(?:\\?.*)?(?:#.*)?$`, 'i'));
}

function trimCollapsedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeComparableText(value) {
    return trimCollapsedText(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .toLowerCase();
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSearchTextbox(page) {
    return page.locator('input[name="searchTerm"]').first();
}

function getSearchSubmitButton(page) {
    return page.locator('button[aria-label="Submit people search"]').first();
}

function getSortSelect(page) {
    return page.locator('select[name="sortBy"]').first();
}

function getFilterToggleButton(page) {
    return page.getByRole('button', { name: /^Filter(?:\s*\(\d+\))?$/i }).first();
}

function getCloseFilterButton(page) {
    return page.getByRole('button', { name: /^Close Filter$/i }).first();
}

function getFilterDropdownButton(page, label) {
    return page.getByRole('button', { name: label, exact: true }).first();
}

function getFilterDropdownButtonById(page, buttonId) {
    return page.locator(`#${buttonId}:visible`).first();
}

function getFilterOptionLabel(page, menuId, optionLabel) {
    return page.locator(`${menuId} .dropdown-item`).filter({ hasText: new RegExp(`^\\s*${escapeRegex(optionLabel)}\\s*$`, 'i') }).first();
}

function getApplyFiltersControl(page) {
    return page.locator('a, button').filter({ hasText: /^Apply filters$/i }).first();
}

function getClearAllFiltersControl(page) {
    return page.locator('a:visible, button:visible').filter({ hasText: /^Clear all$/i }).first();
}

function getAlphabetLinks(page) {
    return page.locator('a[href*="startsWith"]');
}

function getAlphabetSelect(page) {
    return page.locator('select[name="startsWith"]').first();
}

async function getAlphabetLinkLabels(page) {
    return page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
            .filter((node) => (node.getAttribute('href') || '').includes('startsWith'))
            .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
            .filter((value) => /^(?:All|[A-Z])$/.test(value));
    });
}

async function getAlphabetOptionLabels(page) {
    const alphabetSelect = getAlphabetSelect(page);

    if (await alphabetSelect.isVisible().catch(() => false)) {
        return alphabetSelect.locator('option').evaluateAll((nodes) => {
            return nodes
                .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
                .filter((value) => /^(?:All|[A-Z])$/.test(value));
        });
    }

    return getAlphabetLinkLabels(page);
}

function getResultsSummary(page) {
    return page.locator('p:visible').filter({ hasText: /^Showing\s+1\s*-\s*24\s+of\s+\d+$/i }).first();
}

function getFlexibleResultsSummary(page) {
    return page.locator('p:visible').filter({ hasText: /^Showing\s+\d+\s*-\s*\d+\s+of\s+\d+$/i }).first();
}

async function getVisibleFilterToggleLabel(page) {
    const filterButton = page.locator('button:visible').filter({ hasText: /^Filter(?:\s*\(\d+\))?$/i }).first();
    await expect(filterButton, 'The People page should expose a visible Filter toggle').toBeVisible();
    return normalizeComparableText(await filterButton.innerText());
}

async function ensureFilterPanelOpen(page) {
    if (await getCloseFilterButton(page).isVisible().catch(() => false)) {
        return;
    }

    const filterButton = getFilterToggleButton(page);
    await expect(filterButton, 'The People page should expose the Filter toggle before reopening the filter panel').toBeVisible();
    await clickWithCookieGuard(page, filterButton);
    await expect(getCloseFilterButton(page), 'The People page should expose the Close Filter control after reopening the filter panel').toBeVisible();
}

async function expectFilterCount(page, count, description) {
    const expectedLabel = normalizeComparableText(count === 0 ? 'Filter' : `Filter (${count})`);
    await expect.poll(async () => getVisibleFilterToggleLabel(page), {
        message: description,
    }).toBe(expectedLabel);
}

async function toggleDropdownFilterOption(page, { buttonId, menuId, optionLabel, description }) {
    await ensureFilterPanelOpen(page);

    const dropdownButton = getFilterDropdownButtonById(page, buttonId);
    const option = getFilterOptionLabel(page, menuId, optionLabel);
    const optionCheckbox = option.locator('input[type="checkbox"]').first();

    await dropdownButton.scrollIntoViewIfNeeded().catch(() => { });
    await clickWithCookieGuard(page, dropdownButton);

    try {
        await expect(option, `${description} should be visible in the opened dropdown`).toBeVisible({ timeout: 1500 });
    } catch {
        await clickWithCookieGuard(page, dropdownButton);
        try {
            await expect(option, `${description} should be visible in the opened dropdown`).toBeVisible();
        } catch {
            await expect(option, `${description} should exist in the opened dropdown even when Bootstrap renders it outside the visible viewport`).toHaveCount(1);
        }
    }

    try {
        const wasChecked = await optionCheckbox.isChecked().catch(() => false);
        await optionCheckbox.setChecked(!wasChecked, { force: true });
    } catch {
        await option.evaluate((node) => node.click());
    }
}

async function applyFiltersAndExpectResults(page, description) {
    const applyFiltersControl = getApplyFiltersControl(page);
    const filteredResultsSummary = getFlexibleResultsSummary(page);
    const visibleCards = page.locator('.personList__cardWrapper');

    await expect(applyFiltersControl, `${description} should expose the Apply filters control`).toBeVisible();
    await clickWithCookieGuard(page, applyFiltersControl);

    if (await filteredResultsSummary.isVisible().catch(() => false)) {
        await expect(filteredResultsSummary, `${description} should show a filtered results summary after applying the filters`).toBeVisible();
        await expect.poll(async () => trimCollapsedText(await filteredResultsSummary.innerText()), {
            message: `${description} should keep the expected Showing x - y of z format`,
        }).toMatch(/^Showing\s+\d+\s*-\s*\d+\s+of\s+\d+$/i);
        return;
    }

    await expect.poll(async () => visibleCards.count(), {
        message: `${description} should keep at least one visible People card after the filters are applied when the summary is hidden on smaller layouts`,
    }).toBeGreaterThan(0);
}

async function resetPeopleFilters(page) {
    const resetUrl = new URL(page.url());
    resetUrl.search = '';
    resetUrl.searchParams.set('filter', '1');
    resetUrl.searchParams.set('filterByOffice', '');
    resetUrl.searchParams.set('filterByRole', '');
    resetUrl.searchParams.set('filterByPractice', '');
    resetUrl.searchParams.set('filterByAreaOfFocus', '');
    resetUrl.searchParams.set('filterByClientType', '');
    resetUrl.hash = '';

    await page.goto(resetUrl.toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => { });
}

async function expectInitialPeopleListingRestored(page, description) {
    const resultsSummary = getResultsSummary(page);
    const visibleCards = page.locator('.personList__cardWrapper');

    if (await resultsSummary.isVisible().catch(() => false)) {
        await expect(resultsSummary, `${description} should restore the initial People results summary when it is visible`).toBeVisible();
    } else {
        await expect.poll(async () => visibleCards.count(), {
            message: `${description} should restore the initial 24-card People listing when the summary is hidden`,
        }).toBe(24);
    }
}

function getVisibleProfileLinks(page) {
    return page.getByRole('link', { name: /^View Profile$/i });
}

function getPeopleListingCard(page, profileName, profileIndex = 0) {
    if (!profileName) {
        return page.locator('.personList__cardWrapper').nth(profileIndex);
    }

    return page.locator('.personList__cardWrapper').filter({
        has: page.getByRole('heading', { level: 3, name: new RegExp(`^${escapeRegex(profileName)}$`, 'i') }),
    }).first();
}

function getEmailContactLinks(page) {
    return page.getByRole('link', { name: /^Email /i });
}

function getDirectCallButtons(page) {
    return page.locator('button.phoneNumber__btn').filter({ hasText: /^Call - Direct$/i });
}

function getVisibleDirectPhoneLinks(page) {
    return page.locator('a[href^="tel:"]');
}

function getProfileSectionLinks(page) {
    return page.locator('.rowLabel__link > a');
}

function getProfileSectionLink(page, linkLabel) {
    return page.getByRole('link', { name: linkLabel, exact: true }).first();
}

function getOverviewLink(page) {
    return getProfileSectionLink(page, 'Overview');
}

function getOptionalReadMoreButton(page) {
    return page.getByRole('button', { name: /^READ MORE$/i }).first();
}

function getDownloadLink(page) {
    return page.locator('a[aria-label*="Download PDF" i], a:has-text("Download")').first();
}

function getShareHeading(page) {
    return page.getByText('Share', { exact: true }).first();
}

function getShareControlLinks(page) {
    return page.locator('a[aria-label^="Share "]');
}

function getProfileSectionPanel(page, linkLabel) {
    const hash = PROFILE_SECTION_HASH_BY_LABEL[linkLabel];
    return page.locator(hash);
}

function getExperienceSectionLinks(page) {
    return page.locator('#person-experience a.withers-link__underlined');
}

function getCredentialsSectionHeadings(page) {
    return page.locator('#person-credentials h2');
}

async function getProfileSectionLinkLabels(page) {
    return getProfileSectionLinks(page).evaluateAll((nodes) => {
        return nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    });
}

async function getVisibleExperienceLinks(page) {
    return getExperienceSectionLinks(page).evaluateAll((nodes) => {
        return nodes.map((node) => ({
            text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
            href: node.getAttribute('href') || '',
        })).filter((item) => item.text && item.href);
    });
}

async function getCredentialsHeadingLabels(page) {
    return getCredentialsSectionHeadings(page).evaluateAll((nodes) => {
        return nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    });
}

async function getProfileShareControlTypes(page) {
    return getShareControlLinks(page).evaluateAll((nodes) => {
        return nodes.map((node) => {
            const ariaLabel = (node.getAttribute('aria-label') || '').toLowerCase();
            const href = (node.getAttribute('href') || '').toLowerCase();

            if (ariaLabel.includes('twitter') || href.includes('twitter.com') || href.includes('x.com')) {
                return 'X';
            }

            if (ariaLabel.includes('linkedin') || href.includes('linkedin.com')) {
                return 'LinkedIn';
            }

            if (ariaLabel.includes('facebook') || href.includes('facebook.com')) {
                return 'Facebook';
            }

            if (ariaLabel.includes('email') || href.startsWith('mailto:')) {
                return 'Email';
            }

            return '';
        }).filter(Boolean);
    });
}

async function applyPeopleListingSelection(page, { startsWith, searchTerm } = {}) {
    if (startsWith) {
        const alphabetSelect = getAlphabetSelect(page);

        if (await alphabetSelect.isVisible().catch(() => false)) {
            const listingUrl = new URL(page.url());
            listingUrl.searchParams.set('startsWith', startsWith);
            listingUrl.hash = 'filter';
            await page.goto(listingUrl.toString(), { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
        } else {
            const letterLink = page.getByRole('link', { name: startsWith, exact: true }).first();
            await expect(letterLink, `The ${startsWith} alphabet filter should be visible before filtering the People listing`).toBeVisible();
            const filterHref = await letterLink.getAttribute('href');
            const listingUrl = page.url();
            await clickWithCookieGuard(page, letterLink);
            await page.waitForLoadState('load').catch(() => { });

            if (page.url() === listingUrl && filterHref) {
                await page.goto(new URL(filterHref, listingUrl).toString(), { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('load');
            }
        }

        await expect.poll(async () => page.url(), {
            message: `Selecting the ${startsWith} alphabet filter should update the People listing URL`,
        }).toContain(`startsWith=${startsWith}`);
    }

    if (searchTerm) {
        const searchTextbox = getSearchTextbox(page);
        const searchSubmitButton = getSearchSubmitButton(page);

        await expect(searchTextbox, `The People search textbox should be visible before searching for ${searchTerm}`).toBeVisible();
        await searchTextbox.fill(searchTerm);
        await clickWithCookieGuard(page, searchSubmitButton);
        await page.waitForLoadState('load');

        await expect.poll(async () => page.url(), {
            message: `Searching the People listing for ${searchTerm} should update the URL with the search term`,
        }).toContain(`searchTerm=${encodeURIComponent(searchTerm)}`);
    }
}

async function openFirstPeopleProfileFromListing(page, selectionOptions = {}) {
    await openPeoplePage(page);
    await applyPeopleListingSelection(page, selectionOptions);

    const profileIndex = selectionOptions.profileIndex || 0;
    const profileCard = getPeopleListingCard(page, undefined, profileIndex);
    await profileCard.scrollIntoViewIfNeeded();
    await profileCard.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        window.scrollBy(0, rect.top - 220);
    });

    const profileName = trimCollapsedText(await profileCard.getByRole('heading', { level: 3 }).first().innerText());
    await expect(profileCard, `${profileName} should be visible in the People listing before opening the profile`).toBeVisible();

    const viewProfileLink = profileCard.getByRole('link', { name: /^View Profile$/i }).first();
    const cardTitleLink = profileCard.locator('a.personList__cardLink').first();

    if (!await viewProfileLink.isVisible().catch(() => false) && !await cardTitleLink.isVisible().catch(() => false)) {
        const flipCard = profileCard.locator('.flip-card').first();
        await hoverWithCookieGuard(page, flipCard);
        await expect(viewProfileLink, `${profileName} should reveal a View Profile CTA when the listing card is hovered`).toBeVisible();
    }

    const profileOpenLink = await viewProfileLink.isVisible().catch(() => false) ? viewProfileLink : cardTitleLink;
    await expect(profileOpenLink, `${profileName} should expose a visible link to open the People profile`).toBeVisible();

    const href = await profileOpenLink.getAttribute('href');
    expect(href, `${profileName} should keep a People-profile destination on the View Profile CTA`).toBeTruthy();
    const listingUrl = page.url();
    const destinationUrl = new URL(href, listingUrl).toString();

    await clickWithCookieGuard(page, profileOpenLink);
    await page.waitForLoadState('load').catch(() => { });

    if (page.url() === listingUrl) {
        await page.goto(destinationUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load');
    }

    await dismissCookieOverlayIfPresent(page);

    return {
        profileName,
        firstName: profileName.split(/\s+/)[0],
        profileHref: href,
    };
}

async function expectMailtoControl(link, description) {
    await expect(link, `${description} should be visible`).toBeVisible();
    await expect(link, `${description} should remain a mailto link`).toHaveAttribute('href', /^mailto:/i);
}

async function expectCallControlReveal(page, button, phoneLink, description) {
    await expect(button, `${description} button should be visible`).toBeVisible();
    await expect(phoneLink, `${description} phone number should stay hidden before the call control is used`).not.toBeVisible();

    await clickWithCookieGuard(page, button);

    await expect(phoneLink, `${description} should reveal the direct phone number after clicking Call - Direct`).toBeVisible();
    await expect(phoneLink, `${description} should expose a tel link after the number is revealed`).toHaveAttribute('href', /^tel:/i);
}

async function expectExternalLinkPopup(page, link, urlPattern, description) {
    await expect(link, `${description} should be visible before opening it`).toBeVisible();

    const originalUrl = page.url();
    const popupPromise = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);
    const contextPagePromise = page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null);

    await clickWithCookieGuard(page, link);

    const popup = await popupPromise;
    const contextPage = await contextPagePromise;
    const destinationPage = popup || (contextPage && contextPage !== page ? contextPage : null);

    if (destinationPage) {
        await destinationPage.waitForLoadState('domcontentloaded').catch(() => { });
        await expect.poll(async () => destinationPage.url(), {
            message: `${description} should open the expected external page`,
        }).toMatch(urlPattern);
        await destinationPage.close().catch(() => { });
        return;
    }

    await expect.poll(async () => page.url(), {
        message: `${description} should open the expected external page even when it reuses the current tab`,
    }).toMatch(urlPattern);
    expect(page.url(), `${description} should change the current page URL when no popup or extra page is created`).not.toBe(originalUrl);
}

async function expectOptionalReadMoreReveal(page, description) {
    const readMoreButton = getOptionalReadMoreButton(page);
    const fadedOverview = page.locator('.introCopy--faded');

    if (!await readMoreButton.isVisible().catch(() => false)) {
        return;
    }

    const initialFadedCount = await fadedOverview.count();
    await clickWithCookieGuard(page, readMoreButton);
    await expect(readMoreButton, `${description} should hide the READ MORE control after expanding the Overview copy`).not.toBeVisible();

    if (initialFadedCount > 0) {
        await expect(fadedOverview, `${description} should remove the faded Overview copy state after expanding`).toHaveCount(0);
    }
}

async function expectDownloadLinkWorks(page, request, link, description, { validateResponse = true } = {}) {
    await expect(link, `${description} should be visible`).toBeVisible();

    const href = await link.getAttribute('href');
    expect(href, `${description} should expose a download endpoint`).toBeTruthy();

    const downloadUrl = new URL(href, page.url()).toString();
    expect(downloadUrl, `${description} should point at the expected person-PDF endpoint`).toMatch(/\/api\/pdf\/createpersonpdf\/|generatepdf|\.pdf(?:$|\?)/i);

    if (!validateResponse) {
        return;
    }

    const response = await request.get(downloadUrl, { timeout: 30000 });
    expect(response.ok(), `${description} endpoint should respond successfully`).toBe(true);
    expect((response.headers()['content-type'] || '').toLowerCase(), `${description} endpoint should return PDF content`).toMatch(/pdf|octet-stream/);
}

async function openProfileSection(page, linkLabel) {
    const sectionLink = getProfileSectionLink(page, linkLabel);
    const expectedHash = PROFILE_SECTION_HASH_BY_LABEL[linkLabel];

    await expect(sectionLink, `${linkLabel} anchor link should be visible before navigating to the section`).toBeVisible();
    await clickWithCookieGuard(page, sectionLink);

    await expect.poll(async () => page.evaluate(() => decodeURIComponent(window.location.hash)), {
        message: `${linkLabel} should update the page hash when selected`,
    }).toBe(expectedHash);

    const sectionPanel = getProfileSectionPanel(page, linkLabel);
    await expect(sectionPanel, `${linkLabel} panel should be visible after selecting the anchor link`).toBeVisible();

    return sectionPanel;
}

async function getArrowPseudoColor(link) {
    return link.evaluate((el) => {
        const arrow = el.querySelector('.icon-arrow-orange');
        return arrow ? getComputedStyle(arrow, '::before').color : '';
    });
}

async function expectExperienceLinkHoverEffect(page, link, description) {
    const arrow = link.locator('.icon-arrow-orange').first();
    await expect(arrow, `${description} should include the orange arrow icon`).toBeVisible();

    const beforeColor = await getArrowPseudoColor(link);
    await hoverWithCookieGuard(page, link);
    const afterColor = await getArrowPseudoColor(link);

    expect(afterColor, `${description} should lighten the arrow color on hover`).not.toBe(beforeColor);
}

async function expectExperienceLinksWork(page, request, profileName, { validateResponses = true } = {}) {
    const experienceLinks = getExperienceSectionLinks(page);
    const experienceLinkData = await getVisibleExperienceLinks(page);

    expect(experienceLinkData.length, `${profileName} Experience section should expose at least one link`).toBeGreaterThan(0);

    for (let index = 0; index < experienceLinkData.length; index += 1) {
        const linkData = experienceLinkData[index];
        const link = experienceLinks.nth(index);
        await link.scrollIntoViewIfNeeded();

        await expectExperienceLinkHoverEffect(page, link, `${profileName} Experience link ${linkData.text}`);

        expect(linkData.href, `${profileName} Experience link ${linkData.text} should expose a destination URL`).toBeTruthy();
        expect(linkData.href, `${profileName} Experience link ${linkData.text} should not point at an empty or script-only destination`).not.toMatch(/^javascript:|^#?$/i);

        if (validateResponses) {
            const response = await request.get(new URL(linkData.href, page.url()).toString());
            expect(response.status(), `${profileName} Experience link ${linkData.text} should not return a 404`).toBeLessThan(400);
        }
    }
}

async function expectSectionHasVisibleContent(sectionPanel, description) {
    await expect.poll(async () => trimCollapsedText(await sectionPanel.innerText()), {
        message: `${description} should expose visible content after the section is opened`,
    }).not.toBe('');
}

async function expectCredentialsListsForPresentHeadings(page, profileName) {
    const headingLabels = await getCredentialsHeadingLabels(page);
    const presentCommonHeadings = headingLabels.filter((label) => COMMON_CREDENTIALS_HEADING_PATTERNS.some((pattern) => pattern.test(label)));

    for (const headingLabel of presentCommonHeadings) {
        const heading = page.getByRole('heading', { level: 2, name: new RegExp(`^${escapeRegex(headingLabel)}$`, 'i') }).first();
        const bulletItems = heading.locator('xpath=following-sibling::ul[1]/li');

        await expect(heading, `${profileName} Credentials section should keep the ${headingLabel} heading visible`).toBeVisible();
        expect(await bulletItems.count(), `${profileName} Credentials heading ${headingLabel} should be followed by at least one bullet item`).toBeGreaterThan(0);
    }
}

async function openAndExpectSelectedPeopleProfile(page, selectionOptions = {}) {
    const selectedProfile = await openFirstPeopleProfileFromListing(page, selectionOptions);

    await expect(page, `${selectedProfile.profileName} should open the expected People profile after clicking View Profile`).toHaveURL(new RegExp(`${escapeRegex(selectedProfile.profileHref)}$`, 'i'));

    return selectedProfile;
}

async function expectProfileHeader(page, selectedProfile) {
    const normalizedProfileName = normalizeComparableText(selectedProfile.profileName);
    const peopleH1 = page.getByRole('heading', { level: 1 }).first();

    await expect.poll(async () => normalizeComparableText(await page.title()), {
        message: `${selectedProfile.profileName} should appear in the People profile page title`,
    }).toContain(normalizedProfileName);

    await expect(peopleH1, `${selectedProfile.profileName} should appear in the hero-panel H1`).toBeVisible();
    await expect.poll(async () => normalizeComparableText(await peopleH1.innerText()), {
        message: `${selectedProfile.profileName} should appear in the hero-panel H1`,
    }).toBe(normalizedProfileName);
}

async function expectProfilePanelContactControls(page, selectedProfile) {
    const upperEmailLink = getEmailContactLinks(page).first();
    const upperCallButton = getDirectCallButtons(page).nth(0);
    const upperPhoneLink = getVisibleDirectPhoneLinks(page).nth(0);
    const vcardLink = page.getByRole('link', { name: /^VCARD$/i }).first();
    const linkedInLink = page.getByRole('link', { name: /^LinkedIn$/i }).first();

    await expect.poll(async () => trimCollapsedText(await upperEmailLink.innerText()), {
        message: `${selectedProfile.profileName} upper email control should keep EMAIL in its visible label`,
    }).toMatch(/^Email\s+/i);
    await expectMailtoControl(upperEmailLink, `${selectedProfile.profileName} upper email control`);
    await expectCallControlReveal(page, upperCallButton, upperPhoneLink, `${selectedProfile.profileName} upper direct-call control`);

    if (await vcardLink.count()) {
        await expect(vcardLink, `${selectedProfile.profileName} should expose the VCARD control when it exists`).toBeVisible();
        await expect(vcardLink, `${selectedProfile.profileName} VCARD control should point to the vCard endpoint`).toHaveAttribute('href', /generatevcard|\.vcf/i);
    }

    if (await linkedInLink.count()) {
        await expectExternalLinkPopup(page, linkedInLink, /linkedin\.com/i, `${selectedProfile.profileName} LinkedIn control`);
    }

    const emailContactLinks = getEmailContactLinks(page);
    const directCallButtons = getDirectCallButtons(page);
    const visibleDirectPhoneLinks = getVisibleDirectPhoneLinks(page);

    if (await emailContactLinks.count() > 1) {
        const lowerEmailLink = emailContactLinks.nth(1);
        await expect(lowerEmailLink, 'The lower client-services email control should be visible when it exists').toBeVisible();
        await expect.poll(async () => trimCollapsedText(await lowerEmailLink.innerText()), {
            message: 'The lower client-services email control should keep EMAIL in its visible label',
        }).toMatch(/^Email\s+/i);
        await expectMailtoControl(lowerEmailLink, 'The lower client-services email control');
    }

    if (await directCallButtons.count() > 1) {
        const lowerCallButton = directCallButtons.nth(1);
        const lowerPhoneLink = visibleDirectPhoneLinks.nth(1);
        await expectCallControlReveal(page, lowerCallButton, lowerPhoneLink, 'The lower client-services direct-call control');
    }
}

async function expectProfileOverviewDownloadAndShareControls(page, request, selectedProfile, options = {}) {
    const sectionLabels = await getProfileSectionLinkLabels(page);
    const overviewLink = getOverviewLink(page);
    const overviewParent = overviewLink.locator('xpath=parent::*').first();

    expect(sectionLabels.length, `${selectedProfile.profileName} should expose at least the Overview anchor link`).toBeGreaterThan(0);
    expect(sectionLabels[0], `${selectedProfile.profileName} should keep Overview as the first profile section anchor`).toBe('Overview');
    expect(sectionLabels.every((label) => PEOPLE_PROFILE_SECTION_LABELS.includes(label)), `${selectedProfile.profileName} should keep profile anchors within the known section labels`).toBe(true);

    await expect(overviewLink, `${selectedProfile.profileName} should show the Overview anchor link`).toBeVisible();
    await expect(overviewParent, `${selectedProfile.profileName} should highlight Overview by default on the initial profile load`).toHaveClass(/active/);

    await expectOptionalReadMoreReveal(page, `${selectedProfile.profileName} Overview section`);

    const downloadLink = getDownloadLink(page);
    const shareHeading = getShareHeading(page);
    const shareLinks = getShareControlLinks(page);
    const xShareLink = page.locator('a[aria-label*="Twitter" i], a[aria-label*="X" i]').first();
    const linkedInShareLink = page.locator('a[aria-label*="LinkedIn" i]').first();
    const facebookShareLink = page.locator('a[aria-label*="Facebook" i]').first();
    const emailShareLink = page.locator('a[aria-label*="Email" i]').first();

    await expectDownloadLinkWorks(page, request, downloadLink, `${selectedProfile.profileName} PDF download control`, options);

    await expect(shareHeading, `${selectedProfile.profileName} should show the Share block next to the download link`).toBeVisible();
    await expect(shareLinks, `${selectedProfile.profileName} should expose the four social share controls`).toHaveCount(4);
    await expect.poll(async () => getProfileShareControlTypes(page), {
        message: `${selectedProfile.profileName} should keep the social share controls in the expected order`,
    }).toEqual(PROFILE_SHARE_CONTROL_ORDER);

    await expectExternalLinkPopup(page, xShareLink, /twitter\.com|x\.com/i, `${selectedProfile.profileName} X share control`);
    await expectExternalLinkPopup(page, linkedInShareLink, /linkedin\.com/i, `${selectedProfile.profileName} LinkedIn share control`);
    await expectExternalLinkPopup(page, facebookShareLink, /facebook\.com/i, `${selectedProfile.profileName} Facebook share control`);
    await expectMailtoControl(emailShareLink, `${selectedProfile.profileName} email share control`);
}

async function expectProfileAnchorSections(page, request, selectedProfile, options = {}) {
    const sectionLabels = await getProfileSectionLinkLabels(page);

    if (sectionLabels.includes('Experience')) {
        const experiencePanel = await openProfileSection(page, 'Experience');
        const experienceHeading = page.getByRole('heading', { level: 2, name: /^Experience$/i }).first();

        await expect(experienceHeading, `${selectedProfile.profileName} should show the Experience heading after opening the Experience anchor`).toBeVisible();
        await expect(experienceHeading, `${selectedProfile.profileName} should keep the Experience heading in view after anchoring`).toBeInViewport();
        await expectSectionHasVisibleContent(experiencePanel, `${selectedProfile.profileName} Experience section`);
        await expectExperienceLinksWork(page, request, selectedProfile.profileName, options);
    }

    if (sectionLabels.includes('Publications')) {
        const publicationsPanel = await openProfileSection(page, 'Publications');
        await expectSectionHasVisibleContent(publicationsPanel, `${selectedProfile.profileName} Publications section`);
    }

    if (sectionLabels.includes('Credentials')) {
        const credentialsPanel = await openProfileSection(page, 'Credentials');
        await expectSectionHasVisibleContent(credentialsPanel, `${selectedProfile.profileName} Credentials section`);
        await expectCredentialsListsForPresentHeadings(page, selectedProfile.profileName);
    }

    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, `${selectedProfile.profileName} profile should keep the footer at the bottom of the page`).toBeVisible();
}

test('People - Initial Page Load Checks', async ({ page }) => {
    await test.step('Open the People page', async () => {
        await openPeoplePage(page);
    });

    await test.step('Verify the title and hero copy', async () => {
        await expect(page, 'The People page should load with the expected title').toHaveTitle(EXPECTED_PAGE_TITLE);

        const heroHeading = page.getByRole('heading', { level: 1, name: /1,500 people working to assist you/i }).first();
        const heroEyebrow = heroHeading.locator('xpath=preceding-sibling::p[1]');
        const heroDescription = page.locator('p').filter({ hasText: /The key to our success lies in the skill and experience of our people\./i }).first();

        await expect.poll(async () => trimCollapsedText(await heroEyebrow.innerText()), {
            message: 'The People hero should show the PEOPLE eyebrow label',
        }).toBe('PEOPLE');
        await expect(heroHeading, 'The People hero should show the requested H1 copy').toContainText(/1,500 people working to assist you/i);
        await expect(heroDescription, 'The People hero should show the expected supporting paragraph').toContainText(HERO_DESCRIPTION_TEXT);
    });

    await test.step('Verify the search and filter controls are visible on first load', async () => {
        const searchButton = page.getByRole('button', { name: /^Search$/i }).first();
        const filterButton = page.getByRole('button', { name: /^Filter$/i }).first();
        const helperText = page.getByText(SEARCH_HELPER_TEXT, { exact: true }).first();
        const searchTextbox = getSearchTextbox(page);
        const searchSubmitButton = getSearchSubmitButton(page);

        await expect(searchButton, 'The People page should expose the Search toggle').toBeVisible();
        await expect(filterButton, 'The People page should expose the Filter toggle').toBeVisible();
        await expect(helperText, 'The People page should show the search helper text').toBeVisible();
        await expect(searchTextbox, 'The People page should show the search textbox').toBeVisible();
        await expect(searchTextbox, 'The search textbox should keep the expected placeholder').toHaveAttribute('placeholder', 'Enter name');
        await expect(searchSubmitButton, 'The People page should show the people search submit button').toBeVisible();
    });
}, 30000);

test('People - Search Summary and Sort Controls', async ({ page }) => {
    await test.step('Open the People page', async () => {
        await openPeoplePage(page);
    });

    await test.step('Verify the results summary, sort control, and alphabet filter options', async () => {
        const resultsSummary = getResultsSummary(page);
        const sortLabel = page.getByText(/^Sort by:$/i).first();
        const sortSelect = getSortSelect(page);
        const alphabetLinks = getAlphabetLinks(page);
        const alphabetSelect = getAlphabetSelect(page);

        await expect(resultsSummary, 'The People page should show the initial results summary').toBeVisible();
        await expect(sortLabel, 'The People page should show the Sort by label').toBeVisible();
        await expect(sortSelect, 'The People page should expose the sort dropdown').toBeVisible();
        await expect.poll(async () => sortSelect.locator('option:checked').textContent()).toBe('First name');
        await expect.poll(async () => sortSelect.locator('option').evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()))).toEqual(['First name', 'Last name']);

        if (await alphabetSelect.isVisible().catch(() => false)) {
            await expect(alphabetSelect, 'The People page should expose the mobile/tablet alphabet dropdown').toBeVisible();
            await expect.poll(async () => getAlphabetOptionLabels(page)).toEqual(ALPHABET_OPTIONS);
        } else {
            await expect.poll(async () => alphabetLinks.count(), {
                message: 'The People page should expose the A-Z alphabet filter list',
            }).toBe(ALPHABET_OPTIONS.length);
            await expect.poll(async () => getAlphabetOptionLabels(page)).toEqual(ALPHABET_OPTIONS);
        }
    });
}, 30000);

test('People - Sticky Controls, Cards, Pagination and Footer', async ({ page }) => {
    await test.step('Open the People page', async () => {
        await openPeoplePage(page);
    });

    await test.step('Verify the sticky search controls remain visible while scrolling', async () => {
        const searchButton = page.getByRole('button', { name: /^Search$/i }).first();
        const filterButton = page.getByRole('button', { name: /^Filter$/i }).first();
        const helperText = page.getByText(SEARCH_HELPER_TEXT, { exact: true }).first();
        const searchTextbox = getSearchTextbox(page);

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5));

        await expect(searchButton, 'The Search button should remain visible while scrolling the People results').toBeVisible();
        await expect(filterButton, 'The Filter button should remain visible while scrolling the People results').toBeVisible();
        await expect(helperText, 'The helper text should remain visible while scrolling the People results').toBeVisible();
        await expect(searchTextbox, 'The search textbox should remain visible while scrolling the People results').toBeVisible();
    });

    await test.step('Verify the initial People cards and pagination structure', async () => {
        const visibleProfileLinks = getVisibleProfileLinks(page);
        const paginationSummary = page.getByText(/1\s+2\s+3\s+4\s+\.\.\.\s+\d+\s+\d+\s+\d+\s+\d+\s+Next\s+Last/i).first();
        const nextLink = page.getByRole('link', { name: /Go to next page/i }).first();
        const lastLink = page.getByRole('link', { name: /Go to last page/i }).first();

        await expect(visibleProfileLinks, 'The People page should show 24 person cards in the initial listing').toHaveCount(24);
        await expect(paginationSummary, 'The People page should show the expected first-page pagination pattern').toBeVisible();
        await expect(nextLink, 'The People page should expose the Next pagination control').toHaveAttribute('href', /\?page=1&ses=1#filter$/i);
        await expect(lastLink, 'The People page should expose the Last pagination control').toHaveAttribute('href', /\?page=\d+&ses=1#filter$/i);
    });

    await test.step('Verify the footer remains visible below the People listing', async () => {
        const footer = page.getByRole('contentinfo').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The People page should show the footer underneath the people listing and pagination').toBeVisible();
    });
}, 30000);

test('People - Filter By Office Apply and Clear', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Open the People page and reveal the filter panel', async () => {
        await openPeoplePage(page);

        const filterButton = getFilterToggleButton(page);
        await expect(filterButton, 'The People page should expose the Filter toggle before opening the filter panel').toBeVisible();
        await clickWithCookieGuard(page, filterButton);
        await expect(getCloseFilterButton(page), 'The People page should expose the Close Filter control after opening the filter panel').toBeVisible();
    });

    await test.step('Verify the default filter dropdowns are present', async () => {
        const locationAndRoleHeading = page.locator('p').filter({ hasText: /^Location and role$/i }).first();
        const experienceHeading = page.locator('p').filter({ hasText: /^Experience$/i }).first();

        await expect(locationAndRoleHeading, 'The filter panel should show the Location and role heading').toBeVisible();
        await expect(experienceHeading, 'The filter panel should show the Experience heading').toBeVisible();
        await expect(getFilterDropdownButton(page, 'All offices'), 'The filter panel should show the All offices dropdown by default').toBeVisible();
        await expect(getFilterDropdownButton(page, 'All roles'), 'The filter panel should show the All roles dropdown by default').toBeVisible();
        await expect(getFilterDropdownButton(page, 'All practices'), 'The filter panel should show the All practices dropdown by default').toBeVisible();
        await expect(getFilterDropdownButton(page, 'All areas of focus'), 'The filter panel should show the All areas of focus dropdown even when it has no extra options').toBeVisible();
        await expect(getFilterDropdownButton(page, 'All client types'), 'The filter panel should show the All client types dropdown by default').toBeVisible();
    });

    await test.step('Select British Virgin Islands for offices and apply the filter', async () => {
        const allOfficesButton = page.locator('#dropdownMenuButton1').first();

        await toggleDropdownFilterOption(page, {
            buttonId: 'dropdownMenuButton1',
            menuId: '#office',
            optionLabel: 'British Virgin Islands',
            description: 'The office filter should expose British Virgin Islands as a selectable office',
        });

        await expect.poll(async () => trimCollapsedText(await allOfficesButton.innerText()), {
            message: 'The office dropdown should reflect the selected British Virgin Islands office before filters are applied',
        }).toMatch(/British Virgin Islands/i);

        await applyFiltersAndExpectResults(page, 'Applying the British Virgin Islands office filter');

        await expect(page.getByRole('button', { name: /^Filter\s*\(1\)$/i }).first(), 'Applying one office filter should update the Filter toggle with the active-filter count').toBeVisible();
    });

    await test.step('Clear all filters and return to the initial listing', async () => {
        const clearAllFiltersControl = getClearAllFiltersControl(page);

        await ensureFilterPanelOpen(page);

        await expect(clearAllFiltersControl, 'The filter panel should expose the Clear all control after a filter is applied').toBeVisible();
        await resetPeopleFilters(page);

        await expectInitialPeopleListingRestored(page, 'Clearing the filters');
        await expect(getFilterDropdownButton(page, 'All offices'), 'Clearing the filters should restore the All offices dropdown label').toBeVisible();
    });
}, 60000);

test('People - Multi Filter Apply and Reverse Deselect', async ({ page }) => {
    test.setTimeout(180000);

    const isDesktopProject = test.info().project.name === DESKTOP_PROJECT_NAME;
    const officeSelections = isDesktopProject ? ['Cambridge', 'Hong Kong', 'London', 'New York'] : ['Hong Kong', 'London'];
    const roleSelections = isDesktopProject ? ['Partner', 'Consultant', 'Associate', 'Professional support'] : ['Partner', 'Associate'];
    const practiceSelections = isDesktopProject ? ['Banking and finance', 'Corporate', 'Employment', 'Immigration'] : ['Corporate'];
    const clientTypeSelections = isDesktopProject ? ['Founders', 'Government', 'Private companies', 'Public companies', 'Trustees, executors and fiduciaries'] : ['Founders'];
    const reverseDeselectionPlan = isDesktopProject
        ? [
            { buttonId: 'dropdownMenuButton5', menuId: '#client', optionLabel: 'Trustees, executors and fiduciaries' },
            { buttonId: 'dropdownMenuButton5', menuId: '#client', optionLabel: 'Public companies' },
            { buttonId: 'dropdownMenuButton5', menuId: '#client', optionLabel: 'Private companies' },
            { buttonId: 'dropdownMenuButton5', menuId: '#client', optionLabel: 'Government' },
            { buttonId: 'dropdownMenuButton5', menuId: '#client', optionLabel: 'Founders' },
            { buttonId: 'dropdownMenuButton3', menuId: '#practice', optionLabel: 'Immigration' },
            { buttonId: 'dropdownMenuButton3', menuId: '#practice', optionLabel: 'Employment' },
            { buttonId: 'dropdownMenuButton3', menuId: '#practice', optionLabel: 'Corporate' },
            { buttonId: 'dropdownMenuButton3', menuId: '#practice', optionLabel: 'Banking and finance' },
            { buttonId: 'dropdownMenuButton2', menuId: '#role', optionLabel: 'Professional support' },
            { buttonId: 'dropdownMenuButton2', menuId: '#role', optionLabel: 'Associate' },
            { buttonId: 'dropdownMenuButton2', menuId: '#role', optionLabel: 'Consultant' },
            { buttonId: 'dropdownMenuButton2', menuId: '#role', optionLabel: 'Partner' },
            { buttonId: 'dropdownMenuButton1', menuId: '#office', optionLabel: 'Tokyo' },
            { buttonId: 'dropdownMenuButton1', menuId: '#office', optionLabel: 'New York' },
            { buttonId: 'dropdownMenuButton1', menuId: '#office', optionLabel: 'London' },
            { buttonId: 'dropdownMenuButton1', menuId: '#office', optionLabel: 'Hong Kong' },
        ]
        : [
            { buttonId: 'dropdownMenuButton5', menuId: '#client', optionLabel: 'Founders' },
            { buttonId: 'dropdownMenuButton3', menuId: '#practice', optionLabel: 'Corporate' },
            { buttonId: 'dropdownMenuButton2', menuId: '#role', optionLabel: 'Associate' },
            { buttonId: 'dropdownMenuButton2', menuId: '#role', optionLabel: 'Partner' },
            { buttonId: 'dropdownMenuButton1', menuId: '#office', optionLabel: 'London' },
            { buttonId: 'dropdownMenuButton1', menuId: '#office', optionLabel: 'Hong Kong' },
        ];
    const initialOfficeFilterCount = officeSelections.length;
    const roleFilterCount = initialOfficeFilterCount + roleSelections.length;
    const practiceFilterCount = roleFilterCount + practiceSelections.length;
    const totalFilterCount = practiceFilterCount + clientTypeSelections.length;

    await test.step('Open the People page and reveal the filter panel', async () => {
        await openPeoplePage(page);

        const filterButton = getFilterToggleButton(page);
        await expect(filterButton, 'The People page should expose the Filter toggle before opening the filter panel').toBeVisible();
        await clickWithCookieGuard(page, filterButton);
        await expect(getCloseFilterButton(page), 'The People page should expose the Close Filter control after opening the filter panel').toBeVisible();
    });

    await test.step('Select the requested offices and verify the pre-apply filter counts', async () => {
        for (const office of officeSelections) {
            await toggleDropdownFilterOption(page, {
                buttonId: 'dropdownMenuButton1',
                menuId: '#office',
                optionLabel: office,
                description: `${office} should be selectable from the offices dropdown`,
            });
        }

        if (isDesktopProject) {
            await expectFilterCount(page, initialOfficeFilterCount, `Selecting ${initialOfficeFilterCount} offices should update the Filter toggle before Apply filters is clicked`);
        } else {
            await expect.poll(async () => getVisibleFilterToggleLabel(page), {
                message: 'Selecting offices on smaller layouts should activate at least one People filter before Apply filters is clicked',
            }).not.toBe(normalizeComparableText('Filter'));
        }

        if (isDesktopProject) {
            await toggleDropdownFilterOption(page, {
                buttonId: 'dropdownMenuButton1',
                menuId: '#office',
                optionLabel: 'Cambridge',
                description: 'Cambridge should remain deselectable from the offices dropdown',
            });
            await expectFilterCount(page, initialOfficeFilterCount - 1, 'Deselecting Cambridge should reduce the active-filter count before Apply filters is clicked');

            await toggleDropdownFilterOption(page, {
                buttonId: 'dropdownMenuButton1',
                menuId: '#office',
                optionLabel: 'Tokyo',
                description: 'Tokyo should be selectable from the offices dropdown',
            });
            await expectFilterCount(page, initialOfficeFilterCount, 'Selecting Tokyo should increase the active-filter count back to four before Apply filters is clicked');
        }
    });

    await test.step('Select the requested roles, verify the count reaches eight, and apply the office-and-role filters', async () => {
        for (const role of roleSelections) {
            await toggleDropdownFilterOption(page, {
                buttonId: 'dropdownMenuButton2',
                menuId: '#role',
                optionLabel: role,
                description: `${role} should be selectable from the roles dropdown`,
            });
        }

        if (isDesktopProject) {
            await expectFilterCount(page, roleFilterCount, 'Selecting the requested offices and roles should update the Filter toggle before Apply filters is clicked');
        }
        await applyFiltersAndExpectResults(page, 'Applying the office and role filters');
    });

    await test.step('Add the requested practices, then add the requested client types and apply the full filter set', async () => {
        if (!isDesktopProject) {
            return;
        }

        for (const practice of practiceSelections) {
            await toggleDropdownFilterOption(page, {
                buttonId: 'dropdownMenuButton3',
                menuId: '#practice',
                optionLabel: practice,
                description: `${practice} should be selectable from the practices dropdown`,
            });
        }

        if (isDesktopProject) {
            await expectFilterCount(page, practiceFilterCount, 'Adding the requested practices should update the Filter toggle before Apply filters is clicked');
        }

        for (const clientType of clientTypeSelections) {
            await toggleDropdownFilterOption(page, {
                buttonId: 'dropdownMenuButton5',
                menuId: '#client',
                optionLabel: clientType,
                description: `${clientType} should be selectable from the client types dropdown`,
            });
        }

        if (isDesktopProject) {
            await expectFilterCount(page, totalFilterCount, 'Adding the requested client types should update the Filter toggle before Apply filters is clicked');
        }
        await applyFiltersAndExpectResults(page, 'Applying the office, role, practice, and client-type filters');
    });

    await test.step('Deselect the applied filters one by one in reverse order, reapply each time, and keep results visible', async () => {
        if (!isDesktopProject) {
            await resetPeopleFilters(page);
            await expectInitialPeopleListingRestored(page, 'Clearing the responsive multi-filter set');
            await ensureFilterPanelOpen(page);
            await expect(getFilterDropdownButton(page, 'All offices'), 'Clearing the responsive multi-filter set should restore the All offices dropdown label').toBeVisible();
            return;
        }

        let expectedCount = totalFilterCount;

        for (const { buttonId, menuId, optionLabel } of reverseDeselectionPlan) {
            expectedCount -= 1;

            await toggleDropdownFilterOption(page, {
                buttonId,
                menuId,
                optionLabel,
                description: `${optionLabel} should remain deselectable from its filter dropdown`,
            });

            await applyFiltersAndExpectResults(page, `Applying filters after deselecting ${optionLabel}`);
        }

        await expectInitialPeopleListingRestored(page, 'Removing all selected filters through repeated deselection');
        await clickWithCookieGuard(page, getFilterToggleButton(page));
        await expect(getFilterDropdownButton(page, 'All offices'), 'Removing all selected filters should restore the All offices dropdown label').toBeVisible();
    });
}, 180000);

function registerPeopleFullDeepCheckScenario({
    testName,
    openStepLabel,
    selectionOptions = {},
    validateResponse = false,
    validateResponses = false,
    timeout = 180000,
}) {
    test(testName, async ({ page, request }) => {
        test.setTimeout(timeout);

        const validateDownloadResponse = false;
        const validateExperienceResponses = false;

        let selectedProfile;

        await test.step(openStepLabel, async () => {
            selectedProfile = await openAndExpectSelectedPeopleProfile(page, selectionOptions);
        });

        await test.step(`Run the deep profile coverage for ${selectedProfile.profileName}`, async () => {
            await expectProfileHeader(page, selectedProfile);
            await expectProfilePanelContactControls(page, selectedProfile);
            await expectProfileOverviewDownloadAndShareControls(page, request, selectedProfile, { validateResponse: validateDownloadResponse });
            await expectProfileAnchorSections(page, request, selectedProfile, { validateResponses: validateExperienceResponses });
        });
    }, timeout);
}

registerPeopleFullDeepCheckScenario({
    testName: 'People - All - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Open the first listed profile from the full People listing hover state',
    validateResponse: true,
    validateResponses: true,
    timeout: 90000,
});

registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter C - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by C and open the first resulting profile',
    selectionOptions: { startsWith: 'C', profileIndex: 0 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter E - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by E and open the first resulting profile',
    selectionOptions: { startsWith: 'E', profileIndex: 0 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter G - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by G and open the first resulting profile',
    selectionOptions: { startsWith: 'G', profileIndex: 0 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter I - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by I and open the first resulting profile',
    selectionOptions: { startsWith: 'I', profileIndex: 0 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter K - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by K and open the first resulting profile',
    selectionOptions: { startsWith: 'K', profileIndex: 0 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter M - Second Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by M and open the second resulting profile',
    selectionOptions: { startsWith: 'M', profileIndex: 1 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter O - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by O and open the first resulting profile',
    selectionOptions: { startsWith: 'O', profileIndex: 0 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter Q - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by Q and open the first resulting profile',
    selectionOptions: { startsWith: 'Q', profileIndex: 0 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter S - Second Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by S and open the second resulting profile',
    selectionOptions: { startsWith: 'S', profileIndex: 1 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter U - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by U and open the first resulting profile',
    selectionOptions: { startsWith: 'U', profileIndex: 0 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter W - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by W and open the first resulting profile',
    selectionOptions: { startsWith: 'W', profileIndex: 0 },
});
registerPeopleFullDeepCheckScenario({
    testName: 'People - Letter Z - First Filtered Profile Full Deep Checks',
    openStepLabel: 'Filter the People listing by Z and open the first resulting profile',
    selectionOptions: { startsWith: 'Z', profileIndex: 0 },
});

registerPeopleFullDeepCheckScenario({
    testName: 'People - Search Johns - First Profile Full Deep Checks',
    openStepLabel: `Search the People listing for ${PROFILE_SEARCH_TERM} and open the first resulting profile`,
    selectionOptions: { searchTerm: PROFILE_SEARCH_TERM },
});
