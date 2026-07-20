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
// Coverage notes - Locations (/locations) + every regional and office page
// ============================================================================
// Scope: the Locations hub (office accordions by region, regional
// experience cards) AND every individual regional-experience page (8) and
// office page (15, across Asia Pacific/Europe/North America) it links to -
// all generated from fixed lists at the top of this file (OFFICE_ACCORDIONS,
// REGIONAL_EXPERIENCE_LINKS, REGIONAL_PAGE_DETAILS, and the 3
// *_OFFICE_DETAILS arrays), not discovered dynamically - if a real office
// or region is added/removed, these lists need a matching update.
//
// Tests in this file (26 total):
//   1. Locations - Initial Page Load Checks
//      Verifies title/hero heading and the hero's "Get in touch" CTA.
//   2. Locations - Office Accordions Expand, Collapse, and Expose the
//      Office Links
//      Opens each of the 3 office accordions (Asia Pacific, Europe, North
//      America) in turn, confirming each one auto-collapses the previous
//      one (single-open behaviour) and lists its expected office links
//      with a hover-arrow effect, then collapses the last one.
//   3. Locations - Regional Experience Links and Footer Are Present
//      Confirms the "Our regional experience" section exposes exactly the
//      8 expected region cards (order-independent) and the footer sits below.
//   4-11. Locations - Regional Experience Page [Africa/Middle East/Latin
//      and South America/Asia Pacific/North America/Indian Subcontinent/
//      Europe/Russia, Ukraine and the CIS] (8 tests, one per region)
//      Opens each regional page and checks its hero, Track Record section
//      (Show more reveals additional panels), Experience section (if
//      present, each link's hover effect), Our team section (card count
//      1-8, flip-hover effect, and - depending on the region's configured
//      `teamMode` - either no expansion control, a "View all" link that
//      routes to a pre-filtered People page, or a "Show more" that reveals
//      more cards in place), Insight section (default or the 2-panel
//      "Latin" variant), and the lower Get in touch section/footer.
//   12-19. Locations - Asia Pacific Office Page [Hong Kong/Singapore/Tokyo]
//      (3 tests)
//   20-23. Locations - Europe Office Page [Geneva/Milan/Padua/London]
//      (4 tests)
//   24-26+. Locations - North America Office Page [British Virgin Islands/
//      New Haven/San Diego/Greenwich/New York/San Francisco/Los Angeles/
//      Texas] (8 tests)
//      Each office test opens its accordion, follows its office link,
//      checks the hero (heading/address/mailto/tel), the optional "Read
//      more" intro-copy expansion (per-office `hasReadMore` flag), the
//      "Meet the team" section + its "View all" link routing to a
//      pre-filtered People page, the office contact panel (phone reveal or
//      direct tel link + email), the directions PDF panel (link format
//      differs slightly by region - see `verifyDirectionsPdfPanel` vs
//      `verifyOfficeDirectionsPanel`), the footer, then goes back to the
//      Locations page.
//
// Viewport-conditional logic (not environment-conditional): regional pages
// only verify animated hover effects (`verifyAnimatedHover`) when
// `window.matchMedia('(hover: hover)')` reports true - touch viewports
// skip the animation checks and fall back to structural presence only.
//
// No baseURL-environment-conditional logic exists in this file - every
// check applies identically regardless of which environment `baseURL`
// points at. Runtime note: this file generates 26 tests from fixed
// location/office lists, each doing a real multi-section page traversal -
// expect it to be one of the slower files in this project.
// ============================================================================

const LOCATIONS_PATH = '/locations';
const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';

const OFFICE_ACCORDIONS = [
    {
        name: 'Asia Pacific',
        links: [
            { label: 'Hong Kong', href: '/en-gb/locations/asia-pacific/hong-kong' },
            { label: 'Singapore', href: '/en-gb/locations/asia-pacific/singapore', verifyAnimatedHover: false },
            { label: 'Tokyo', href: '/en-gb/locations/asia-pacific/tokyo' },
        ],
    },
    {
        name: 'Europe',
        links: [
            { label: 'Geneva', href: '/en-gb/locations/europe/geneva' },
            { label: 'Milan', href: '/en-gb/locations/europe/milan' },
            { label: 'Padua', href: '/en-gb/locations/europe/padua' },
            { label: 'London', href: '/en-gb/locations/europe/london' },
        ],
    },
    {
        name: 'North America',
        links: [
            { label: 'British Virgin Islands', href: '/en-gb/locations/north-america/british-virgin-islands' },
            { label: 'New Haven', href: '/en-gb/locations/north-america/new-haven' },
            { label: 'San Diego', href: '/en-gb/locations/north-america/san-diego' },
            { label: 'Greenwich', href: '/en-gb/locations/north-america/greenwich' },
            { label: 'New York', href: '/en-gb/locations/north-america/new-york' },
            { label: 'San Francisco', href: '/en-gb/locations/north-america/san-francisco' },
            { label: 'Los Angeles', href: '/en-gb/locations/north-america/los-angeles' },
            { label: 'Texas', href: '/en-gb/locations/north-america/texas' },
        ],
    },
];

const REGIONAL_EXPERIENCE_LINKS = [
    { label: 'Africa', href: '/en-gb/locations/sub-saharan-africa' },
    { label: 'Middle East', href: '/en-gb/locations/middle-east' },
    { label: 'Latin and South America', href: '/en-gb/locations/latin-and-south-america' },
    { label: 'Asia Pacific', href: '/en-gb/locations/asia-pacific' },
    { label: 'North America', href: '/en-gb/locations/north-america' },
    { label: 'Indian Subcontinent', href: '/en-gb/locations/indian-subcontinent' },
    { label: 'Europe', href: '/en-gb/locations/europe' },
    { label: 'Russia, Ukraine and the CIS', href: '/en-gb/locations/russia-ukraine-and-the-cis' },
];

const REGIONAL_PAGE_DETAILS = [
    {
        label: 'Africa',
        href: '/en-gb/locations/sub-saharan-africa',
        pageKeyword: 'Africa',
        teamMode: 'none',
        expectedOfficeFilters: [],
        insightVariant: 'default',
    },
    {
        label: 'Middle East',
        href: '/en-gb/locations/middle-east',
        pageKeyword: 'Middle East',
        teamMode: 'expand',
        expectedOfficeFilters: [],
        insightVariant: 'default',
    },
    {
        label: 'Latin and South America',
        href: '/en-gb/locations/latin-and-south-america',
        pageKeyword: 'Latin and South America',
        teamMode: 'people',
        expectedOfficeFilters: ['British Virgin Islands', 'New Haven', 'San Diego', 'Greenwich', 'New York', 'San Francisco', 'Los Angeles', 'Texas'],
        insightVariant: 'latin',
    },
    {
        label: 'Asia Pacific',
        href: '/en-gb/locations/asia-pacific',
        pageKeyword: 'Asia Pacific',
        teamMode: 'people',
        expectedOfficeFilters: ['Hong Kong', 'Singapore', 'Tokyo'],
        insightVariant: 'default',
    },
    {
        label: 'North America',
        href: '/en-gb/locations/north-america',
        pageKeyword: 'North America',
        teamMode: 'expand',
        expectedOfficeFilters: [],
        insightVariant: 'default',
    },
    {
        label: 'Indian Subcontinent',
        href: '/en-gb/locations/indian-subcontinent',
        pageKeyword: 'India',
        teamMode: 'expand',
        expectedOfficeFilters: [],
        insightVariant: 'default',
    },
    {
        label: 'Europe',
        href: '/en-gb/locations/europe',
        pageKeyword: 'Europe',
        teamMode: 'people',
        expectedOfficeFilters: ['Geneva', 'London', 'Milan', 'Padua'],
        insightVariant: 'default',
    },
    {
        label: 'Russia, Ukraine and the CIS',
        href: '/en-gb/locations/russia-ukraine-and-the-cis',
        pageKeyword: 'Russia, Ukraine and the CIS',
        teamMode: 'expand',
        expectedOfficeFilters: [],
        insightVariant: 'default',
    },
];

const ASIA_PACIFIC_OFFICE_DETAILS = [
    {
        label: 'Hong Kong',
        href: '/en-gb/locations/asia-pacific/hong-kong',
        address: '30/F United Centre, 95 Queensway, Hong Kong',
        officeContactHeading: 'OFFICE CONTACT',
        officeHeading: 'HONG KONG OFFICE',
    },
    {
        label: 'Singapore',
        href: '/en-gb/locations/asia-pacific/singapore',
        address: '80 Raffles Place, #25-01 UOB Plaza 1, 048624 Singapore',
        officeContactHeading: 'OFFICE CONTACT',
        officeHeading: 'SINGAPORE OFFICE',
    },
    {
        label: 'Tokyo',
        href: '/en-gb/locations/asia-pacific/tokyo',
        address: '21F JA Building, 1-3-1 Otemachi, Chiyoda-Ku, Tokyo 100-6821, Japan',
        officeContactHeading: 'OFFICE MANAGER',
        officeHeading: 'TOKYO OFFICE',
    },
];

const EUROPE_OFFICE_DETAILS = [
    {
        label: 'Geneva',
        href: '/en-gb/locations/europe/geneva',
        address: '63 Rue Du Rh\u00f4ne, 1204 Gen\u00e8ve, Switzerland',
        officeContactHeading: 'OFFICE CONTACT',
    },
    {
        label: 'Milan',
        href: '/en-gb/locations/europe/milan',
        address: 'Via Durini 18, 20122 Milano, Italy',
        officeContactHeading: 'OFFICE MANAGING DIRECTOR',
    },
    {
        label: 'Padua',
        href: '/en-gb/locations/europe/padua',
        address: 'Piazza dell\'Insurrezione 1, 35137 Padova, Italy',
        officeContactHeading: 'OFFICE MANAGING DIRECTOR',
    },
    {
        label: 'London',
        href: '/en-gb/locations/europe/london',
        address: '20 Old Bailey, London, EC4M 7AN, UK',
        officeContactHeading: 'OFFICE CONTACT',
    },
];

const NORTH_AMERICA_OFFICE_DETAILS = [
    {
        label: 'British Virgin Islands',
        href: '/en-gb/locations/north-america/british-virgin-islands',
        address: 'Withers BVI, Little Denmark, PO Box 145, Road Town, Tortola VG1110, BVI',
        officeContactHeading: 'OFFICE CONTACT',
        hasReadMore: false,
    },
    {
        label: 'New Haven',
        href: '/en-gb/locations/north-america/new-haven',
        address: '12th Floor, 157 Church Street, New Haven, CT 06510-2100, US',
        officeContactHeading: 'OFFICE CONTACT FOR THE NEW HAVEN OFFICE',
        hasReadMore: true,
    },
    {
        label: 'San Diego',
        href: '/en-gb/locations/north-america/san-diego',
        address: '12830 El Camino Real, Suite 350, San Diego, CA 92130, US',
        officeContactHeading: 'OFFICE CONTACT FOR THE SAN DIEGO OFFICE',
        hasReadMore: true,
    },
    {
        label: 'Greenwich',
        href: '/en-gb/locations/north-america/greenwich',
        address: '1700 East Putnam Avenue, Suite 400, Greenwich, CT 06870-1366, US',
        officeContactHeading: 'OFFICE CONTACT FOR THE GREENWICH OFFICE',
        hasReadMore: true,
    },
    {
        label: 'New York',
        href: '/en-gb/locations/north-america/new-york',
        address: '430 Park Avenue, 10th Floor, New York, NY 10022-3505, US',
        officeContactHeading: 'OFFICE CONTACT FOR THE NEW YORK OFFICE',
        hasReadMore: true,
    },
    {
        label: 'San Francisco',
        href: '/en-gb/locations/north-america/san-francisco',
        address: '909 Montgomery Street, Suite 300, San Francisco, CA 94133, US',
        officeContactHeading: 'OFFICE CONTACT FOR THE SAN FRANCISCO OFFICE',
        hasReadMore: true,
    },
    {
        label: 'Los Angeles',
        href: '/en-gb/locations/north-america/los-angeles',
        address: '10250 Constellation Boulevard, Suite 1400, Los Angeles, CA 90067, US',
        officeContactHeading: 'OFFICE CONTACT FOR THE LOS ANGELES OFFICE',
        hasReadMore: true,
    },
    {
        label: 'Texas',
        href: '/en-gb/locations/north-america/texas',
        address: '600 River Pointe Drive, Ste 200, Conroe, TX 77304, US',
        officeContactHeading: 'OFFICE CONTACT FOR THE TEXAS OFFICE',
        hasReadMore: false,
    },
];

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPathUrlPattern(path) {
    return new RegExp(`${escapeRegex(path)}(?:\\?.*)?(?:#.*)?$`, 'i');
}

function buildSameOriginUrl(currentUrl, destinationHref) {
    const destination = new URL(destinationHref, currentUrl);
    return new URL(`${destination.pathname}${destination.search}${destination.hash}`, currentUrl).toString();
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click({ timeout: 2000 }).catch(() => { });
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

async function openLocationsPage(page) {
    await page.goto(LOCATIONS_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => { });
    await acceptCookiesIfPresent(page);

    await expect(page, 'The traversal flow should start from the localized Locations page').toHaveURL(/\/locations(?:\?.*)?(?:#.*)?$/i);
}

function getFilterToggleButton(page) {
    return page.locator('button:visible').filter({ hasText: /^Filter(?:\s*\(\d+\))?$/i }).first();
}

function getCloseFilterButton(page) {
    return page.getByRole('button', { name: /^Close Filter$/i }).first();
}

async function ensurePeopleFilterPanelOpen(page) {
    if (await getCloseFilterButton(page).isVisible().catch(() => false)) {
        return;
    }

    const filterButton = getFilterToggleButton(page);
    await expect(filterButton, 'The People page should expose the Filter toggle before reopening the filter panel').toBeVisible();
    await clickWithCookieGuard(page, filterButton);
    await expect(getCloseFilterButton(page), 'The People page should expose the Close Filter control after reopening the filter panel').toBeVisible();
}

function getHeroHeading(page) {
    return page.getByRole('heading', { level: 1, name: 'Locations' }).first();
}

function getHeroGetInTouchLink(page) {
    return page.locator('xpath=(//a[contains(@href, "/contact-us") and normalize-space()="Get in touch"])[1]');
}

function getOfficesSection(page) {
    return page.locator('xpath=//div[contains(@class,"col-12")][.//h2[normalize-space()="Our offices"]]').first();
}

function getOfficesHeading(page) {
    return page.getByRole('heading', { level: 2, name: 'Our offices' }).first();
}

function getOfficeAccordionButton(section, label) {
    return section.locator(`xpath=.//button[contains(@class,"accordion__title") and normalize-space()="${label}"]`).first();
}

async function getOfficeAccordionPanel(page, button) {
    const panelId = await button.getAttribute('aria-controls');
    expect(panelId, 'Accordion buttons should expose an aria-controls target').toBeTruthy();
    return page.locator(`#${panelId}`);
}

async function expectAccordionIndicatorState(button, expanded, description) {
    await expect(button, `${description} should expose the expected aria-expanded state`).toHaveAttribute('aria-expanded', expanded ? 'true' : 'false');

    if (expanded) {
        await expect(button, `${description} should show the expanded minus-state styling once opened`).not.toHaveClass(/\bcollapsed\b/);
        return;
    }

    await expect(button, `${description} should show the collapsed plus-state styling once closed`).toHaveClass(/\bcollapsed\b/);
}

async function ensureOfficeAccordionExpanded(page, section, label) {
    const button = getOfficeAccordionButton(section, label);
    await button.scrollIntoViewIfNeeded();

    if ((await button.getAttribute('aria-expanded')) !== 'true') {
        await clickWithCookieGuard(page, button);

        if ((await button.getAttribute('aria-expanded')) !== 'true') {
            await button.evaluate((node) => node.click());
        }
    }

    await expectAccordionIndicatorState(button, true, `${label} accordion`);

    const panel = await getOfficeAccordionPanel(page, button);
    await expect(panel, `${label} should expose its office links when expanded`).toBeVisible();

    return { button, panel };
}

function getRegionalExperienceSection(page) {
    return page.locator('xpath=//section[contains(@class,"textFeaturePanel")][.//h2[normalize-space()="Our regional experience"]]').first();
}

function getRegionalExperienceHeading(page) {
    return page.getByRole('heading', { level: 2, name: 'Our regional experience' }).first();
}

function getRegionalPageHeroHeading(page) {
    return page.getByRole('heading', { level: 1 }).first();
}

function getRegionalPageHeroGetInTouchLink(page) {
    return page.locator('xpath=(//div[contains(@class,"hero__content")]//a[contains(@href, "/contact-us") and normalize-space()="Get in touch"])[1]');
}

function getRegionalTrackRecordSection(page) {
    return page.locator('xpath=(//section[contains(@class,"trackRecord")][.//h2[contains(translate(normalize-space(), "abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "TRACK RECORD")]])[1]');
}

function getRegionalExperienceContentSection(page) {
    return page.locator('.page-body .container.textFeaturePanel').filter({
        has: page.getByRole('heading', { level: 2, name: 'Experience' }),
    }).first();
}

function getRegionalTeamSection(page) {
    return page.locator('xpath=(//section[contains(@class,"personRow")][.//h2[normalize-space()="Our team"]])[1]');
}

function getRegionalInsightArticleSection(page) {
    return page.locator('.page-body .container.articleRow').filter({
        has: page.getByRole('heading', { level: 2, name: 'Insight' }),
    }).first();
}

function getRegionalInsightFeaturePanelSection(page) {
    return page.locator('.page-body .container.featurePanelTwoColumn').filter({
        has: page.getByRole('heading', { level: 2, name: 'Insight' }),
    }).first();
}

function getRegionalGetInTouchSection(page) {
    return page.locator('xpath=(//div[contains(@class,"container")][.//h2[normalize-space()="Get in touch"] and .//a[contains(@href, "/contact-us")]])[1]');
}

function getSectionLinkByHref(section, href) {
    return section.locator(`xpath=.//a[contains(@class,"withers-link__underlined") and @href="${href}"]`).first();
}

function getOfficeHeroContent(page) {
    return page.locator('xpath=(//div[contains(@class,"hero__content")])[1]');
}

function getOfficeHeroAddress(page) {
    return page.locator('xpath=(//div[contains(@class,"hero__content")]//*[contains(@class,"icon-location-onwhite")]/parent::div)[1]');
}

function getOfficeHeroGetInTouchLink(page) {
    return page.locator('xpath=(//div[contains(@class,"hero__content")]//a[starts-with(@href,"mailto:") and normalize-space()="Get in touch"])[1]');
}

function getOfficeHeroPhoneLink(page) {
    return page.locator('xpath=(//div[contains(@class,"hero__content")]//a[starts-with(@href,"tel:")])[1]');
}

function getOfficeReadMoreButton(page) {
    return page.getByRole('button', { name: /^Read more$/i }).first();
}

function getOfficeExpandableContentSection(page) {
    return page.locator('xpath=(//button[translate(normalize-space(), "abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ")="READ MORE"]/ancestor::section[1])[1]');
}

function getMeetTheTeamSection(page) {
    return page.locator('xpath=(//section[contains(@class,"personRow")][.//h2[normalize-space()="Meet the team"]])[1]');
}

function getOfficeContactSection(page, headingText) {
    return page.locator(`xpath=(//div[contains(@class,"featurePanel")][.//h2[normalize-space()="${headingText}"]])[1]`);
}

function getOfficePanelSection(page, officeHeading) {
    return page.locator(`xpath=(//div[contains(@class,"featurePanel")][.//h2[normalize-space()="${officeHeading}"]])[1]`);
}

async function getVisibleTeamCardCount(section) {
    return section.locator('.personRow__cardWrapper:visible').count();
}

async function getCheckedOfficeFilterLabels(page) {
    return page.locator('#office input[type="checkbox"]:checked').evaluateAll((nodes) => {
        return nodes
            .map((node) => {
                const option = node.closest('label, .dropdown-item');
                return (option?.textContent || '').replace(/\s+/g, ' ').trim();
            })
            .filter(Boolean);
    });
}

async function getVisibleScopedLocationHrefs(section) {
    return section.locator('xpath=.//a[contains(@class,"withers-link__underlined") and starts-with(@href, "/en-gb/locations/")]').evaluateAll((nodes) => {
        return nodes
            .filter((node) => {
                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            })
            .map((node) => node.getAttribute('href') || '')
            .filter(Boolean);
    });
}

async function getArrowMetrics(link) {
    return link.evaluate((element) => {
        const arrow = element.querySelector('.icon-arrow-orange');
        const linkRect = element.getBoundingClientRect();
        const arrowRect = arrow ? arrow.getBoundingClientRect() : null;
        const pseudoStyle = arrow ? window.getComputedStyle(arrow, '::before') : null;

        return {
            relativeArrowX: arrowRect ? arrowRect.x - linkRect.x : null,
            pseudoColor: pseudoStyle ? pseudoStyle.color : '',
        };
    });
}

async function expectArrowHoverEffect(page, link, description, { verifyAnimatedHover = true } = {}) {
    const arrow = link.locator('xpath=.//span[contains(@class,"icon-arrow-orange")]').first();
    await expect(arrow, `${description} should show the orange arrow icon`).toBeVisible();

    if (!verifyAnimatedHover) {
        return;
    }

    await link.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    const before = await getArrowMetrics(link);
    await hoverWithCookieGuard(page, link);

    await expect.poll(async () => (await getArrowMetrics(link)).pseudoColor, {
        message: `${description} should lighten the arrow color on hover`,
        timeout: 1500,
    }).not.toBe(before.pseudoColor);

    await expect.poll(async () => (await getArrowMetrics(link)).relativeArrowX, {
        message: `${description} should move the arrow to the right on hover`,
        timeout: 1500,
    }).toBeGreaterThan(before.relativeArrowX);
}

async function canReliablyHover(page) {
    return page.evaluate(() => window.matchMedia('(hover: hover)').matches).catch(() => false);
}

async function getButtonHoverState(button) {
    return button.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
            color: style.color,
            borderColor: style.borderColor,
        };
    });
}

async function expectButtonHoverStateChange(page, button, description, { verifyAnimatedHover = true } = {}) {
    await expect(button, `${description} should be visible before checking its hover treatment`).toBeVisible();

    if (!verifyAnimatedHover) {
        return;
    }

    await button.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const before = await getButtonHoverState(button);
    await hoverWithCookieGuard(page, button);

    await expect.poll(async () => (await getButtonHoverState(button)).color, {
        message: `${description} should change the button text color on hover`,
        timeout: 1500,
    }).not.toBe(before.color);

    await expect.poll(async () => (await getButtonHoverState(button)).borderColor, {
        message: `${description} should change the button border color on hover`,
        timeout: 1500,
    }).not.toBe(before.borderColor);
}

async function getFlipCardTransform(card) {
    return card.locator('.flip-card__inner').first().evaluate((element) => window.getComputedStyle(element).transform);
}

async function expectTeamCardFlipHoverEffect(page, card, description, { verifyAnimatedHover = true } = {}) {
    const flipCardInner = card.locator('.flip-card__inner').first();
    await expect(flipCardInner, `${description} should expose the flip-card wrapper`).toBeVisible();

    if (!verifyAnimatedHover) {
        return;
    }

    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const before = await getFlipCardTransform(card);
    await hoverWithCookieGuard(page, card);

    await expect.poll(async () => getFlipCardTransform(card), {
        message: `${description} should change the flip-card transform on hover`,
        timeout: 1500,
    }).not.toBe(before);
}

async function getInsightCardMetrics(card) {
    return card.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return {
            width: rect.width,
            height: rect.height,
            transform: style.transform,
        };
    });
}

async function expectInsightCardHoverEffect(page, card, description, { verifyAnimatedHover = true } = {}) {
    await expect(card, `${description} should be visible before checking its hover treatment`).toBeVisible();

    if (!verifyAnimatedHover) {
        return;
    }

    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const before = await getInsightCardMetrics(card);
    await hoverWithCookieGuard(page, card);

    await expect.poll(async () => (await getInsightCardMetrics(card)).width, {
        message: `${description} should slightly expand on hover`,
        timeout: 1500,
    }).toBeGreaterThan(before.width);

    await expect.poll(async () => (await getInsightCardMetrics(card)).transform, {
        message: `${description} should change its transform on hover`,
        timeout: 1500,
    }).not.toBe(before.transform);
}

async function getLinkHoverState(link) {
    return link.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
            color: style.color,
            textDecorationColor: style.textDecorationColor,
        };
    });
}

async function expectReadMoreHoverEffect(page, link, description, { verifyAnimatedHover = true } = {}) {
    await expect(link, `${description} should be visible before checking its hover treatment`).toBeVisible();

    if (!verifyAnimatedHover) {
        return;
    }

    await link.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const before = await getLinkHoverState(link);
    await hoverWithCookieGuard(page, link);

    await expect.poll(async () => (await getLinkHoverState(link)).color, {
        message: `${description} should change the link text color on hover`,
        timeout: 1500,
    }).not.toBe(before.color);

    await expect.poll(async () => (await getLinkHoverState(link)).textDecorationColor, {
        message: `${description} should change the link underline color on hover`,
        timeout: 1500,
    }).not.toBe(before.textDecorationColor);
}

async function verifyRegionalTrackRecordSection(page, region, { verifyAnimatedHover }) {
    const trackRecordSection = getRegionalTrackRecordSection(page);
    const trackRecordHeading = trackRecordSection.getByRole('heading', { level: 2 }).filter({ hasText: /track record/i }).first();
    const showMoreButton = trackRecordSection.getByRole('button', { name: /^Show more$/i }).first();
    const cards = trackRecordSection.locator('.trackRecord__grid > *:visible');

    await expect(trackRecordSection, `${region.label} should show the Track record section`).toBeVisible();
    await expect(trackRecordHeading, `${region.label} should show the Track record heading`).toBeVisible();
    await expect(showMoreButton, `${region.label} should expose the Track record Show more button`).toBeVisible();
    await expectButtonHoverStateChange(page, showMoreButton, `${region.label} Track record Show more button`, { verifyAnimatedHover });

    const countBefore = await cards.count();
    expect(countBefore, `${region.label} Track record should expose at least one visible panel before expanding`).toBeGreaterThan(0);

    await clickWithCookieGuard(page, showMoreButton);

    await expect.poll(async () => cards.count(), {
        message: `${region.label} Track record should reveal more panels after one Show more click`,
        timeout: 5000,
    }).toBeGreaterThan(countBefore);
}

async function verifyRegionalExperienceSection(page, region, { verifyAnimatedHover }) {
    const experienceSection = getRegionalExperienceContentSection(page);

    if (!await experienceSection.isVisible().catch(() => false)) {
        return;
    }

    const experienceHeading = experienceSection.getByRole('heading', { level: 2, name: 'Experience' }).first();
    const experienceLinks = experienceSection.locator('a[href]');
    const linkCount = await experienceLinks.count();

    await expect(experienceSection, `${region.label} should show the Experience section when it is available`).toBeVisible();
    await expect(experienceHeading, `${region.label} should show the Experience heading when it is available`).toBeVisible();
    expect(linkCount, `${region.label} Experience should expose at least one destination link`).toBeGreaterThan(0);

    if (!verifyAnimatedHover) {
        await expect(experienceLinks.first(), `${region.label} Experience should still expose at least one link on touch layouts`).toBeVisible();
        return;
    }

    for (let index = 0; index < linkCount; index += 1) {
        await expectArrowHoverEffect(page, experienceLinks.nth(index), `${region.label} Experience link ${index + 1}`, { verifyAnimatedHover });
    }
}

async function verifyRegionalTeamSection(page, region, { verifyAnimatedHover }) {
    const teamSection = getRegionalTeamSection(page);
    const teamHeading = teamSection.getByRole('heading', { level: 2, name: 'Our team' }).first();
    const teamCards = teamSection.locator('.personRow__cardWrapper:visible');
    const moreControl = teamSection.locator('a:visible, button:visible').filter({ hasText: /^(?:View all|View more|Show more)$/i }).first();
    const visibleCardCount = await teamCards.count();

    await expect(teamSection, `${region.label} should show the Our team section`).toBeVisible();
    await expect(teamHeading, `${region.label} should show the Our team heading`).toBeVisible();
    expect(visibleCardCount, `${region.label} should show at least one visible person card`).toBeGreaterThan(0);
    expect(visibleCardCount, `${region.label} should not show more than eight visible person cards before any expansion`).toBeLessThanOrEqual(8);

    const firstCard = teamCards.first();
    const firstViewProfileLink = firstCard.getByRole('link', { name: /^View Profile$/i }).first();
    await expect(firstViewProfileLink, `${region.label} should expose the View Profile action on its first visible team card`).toBeVisible();
    await expectTeamCardFlipHoverEffect(page, firstCard, `${region.label} first team card`, { verifyAnimatedHover });

    if (region.teamMode === 'none') {
        expect(visibleCardCount, `${region.label} should currently expose a single person card in the Our team section`).toBe(1);
        expect(await teamSection.locator('a:visible, button:visible').filter({ hasText: /^(?:View all|View more|Show more)$/i }).count(), `${region.label} should not show a team expansion control`).toBe(0);
        return;
    }

    await expect(moreControl, `${region.label} should expose a team expansion control`).toBeVisible();
    expect(normalizeWhitespace(await moreControl.innerText()), `${region.label} should label the team control as View all, View more, or Show more`).toMatch(/^(view all|view more|show more)$/i);

    if (region.teamMode === 'people') {
        const originalPageUrl = page.url();
        const controlHref = await moreControl.getAttribute('href');
        const destinationUrl = controlHref ? buildSameOriginUrl(originalPageUrl, controlHref) : null;

        await clickWithCookieGuard(page, moreControl);
        await page.waitForLoadState('load').catch(() => { });

        if (!/\/people\?filterByOffice=/i.test(page.url()) && destinationUrl) {
            await page.goto(destinationUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
        }

        await dismissCookieOverlayIfPresent(page);

        await expect(page, `${region.label} team control should land on the People page when it routes to filters`).toHaveURL(/\/people\?filterByOffice=/i);
        await ensurePeopleFilterPanelOpen(page);

        const expectedFilterCount = region.expectedOfficeFilters.length;
        const filterButton = page.getByRole('button', { name: new RegExp(`^Filter\\s*\\(${expectedFilterCount}\\)$`, 'i') }).first();
        const checkedLabels = await getCheckedOfficeFilterLabels(page);

        await expect(filterButton, `${region.label} should keep the expected number of office filters selected on the People page`).toBeVisible();
        expect(checkedLabels.slice().sort(), `${region.label} should preselect the expected offices in the People filter`).toEqual(region.expectedOfficeFilters.slice().sort());

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, `${region.label} should return to its regional page after going back from People`).toHaveURL(getPathUrlPattern(region.href));
        return;
    }

    await clickWithCookieGuard(page, moreControl);

    if (await moreControl.isVisible().catch(() => false)) {
        await moreControl.evaluate((element) => element.click()).catch(() => { });
    }

    await expect.poll(async () => teamCards.count(), {
        message: `${region.label} should reveal more people cards after one click on the team expansion control`,
        timeout: 5000,
    }).toBeGreaterThan(visibleCardCount);
}

async function verifyRegionalInsightSection(page, region, { verifyAnimatedHover }) {
    if (region.insightVariant === 'latin') {
        const insightSection = getRegionalInsightFeaturePanelSection(page);
        const insightHeading = insightSection.getByRole('heading', { level: 2, name: 'Insight' }).first();
        const panels = insightSection.locator('.row > div:visible');

        await expect(insightSection, `${region.label} should show the Insight section`).toBeVisible();
        await expect(insightHeading, `${region.label} should show the Insight heading`).toBeVisible();
        await expect(panels, `${region.label} should show exactly two Insight panels in the Latin insight layout`).toHaveCount(2);

        for (let index = 0; index < 2; index += 1) {
            const readMoreLink = panels.nth(index).locator('a[href]').filter({ hasText: /^Read more$/i }).first();
            await expect(readMoreLink, `${region.label} Insight panel ${index + 1} should show its Read more link`).toBeVisible();
            await expectReadMoreHoverEffect(page, readMoreLink, `${region.label} Insight Read more link ${index + 1}`, { verifyAnimatedHover });
        }

        return;
    }

    const insightSection = getRegionalInsightArticleSection(page);
    const insightHeading = insightSection.getByRole('heading', { level: 2, name: 'Insight' }).first();
    const cards = insightSection.locator('.row > div:visible > a:visible');
    const showMoreButton = insightSection.locator('button:visible').filter({ hasText: /^Show more$/i }).first();
    const initialCardCount = await cards.count();

    await expect(insightSection, `${region.label} should show the Insight section`).toBeVisible();
    await expect(insightHeading, `${region.label} should show the Insight heading`).toBeVisible();
    expect(initialCardCount, `${region.label} should show at least one visible Insight card`).toBeGreaterThan(0);

    await expectInsightCardHoverEffect(page, cards.first(), `${region.label} first Insight card`, { verifyAnimatedHover });

    if (await showMoreButton.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, showMoreButton);

        await expect.poll(async () => cards.count(), {
            message: `${region.label} Insight should reveal more cards after one Show more click`,
            timeout: 5000,
        }).toBeGreaterThan(initialCardCount);
    }
}

async function verifyRegionalGetInTouchSection(page, region) {
    const getInTouchSection = getRegionalGetInTouchSection(page);
    const getInTouchHeading = getInTouchSection.getByRole('heading', { level: 2, name: 'Get in touch' }).first();
    const getInTouchLink = getInTouchSection.getByRole('link', { name: /^Get in touch$/i }).first();

    await expect(getInTouchSection, `${region.label} should show the Get in touch section`).toBeVisible();
    await expect(getInTouchHeading, `${region.label} should show the Get in touch heading`).toBeVisible();
    await expect(getInTouchLink, `${region.label} should show the Get in touch CTA in the lower contact panel`).toBeVisible();
    await expect(getInTouchLink, `${region.label} lower Get in touch CTA should point at the contact page`).toHaveAttribute('href', /\/contact-us(?:$|[?#])/i);
}

async function expectOfficeHeroContent(page, office) {
    const heroContent = getOfficeHeroContent(page);
    const heroHeading = page.getByRole('heading', { level: 1, name: office.label }).first();
    const heroAddress = getOfficeHeroAddress(page);
    const getInTouchLink = getOfficeHeroGetInTouchLink(page);
    const phoneLink = getOfficeHeroPhoneLink(page);

    await expect(heroContent, `${office.label} should expose the office hero content`).toBeVisible();
    await expect(heroHeading, `${office.label} should show the expected office heading in the hero`).toBeVisible();
    await expect.poll(async () => normalizeWhitespace(await heroAddress.innerText()).toLowerCase(), {
        message: `${office.label} should show the expected office address in the hero`,
    }).toBe(office.address.toLowerCase());
    await expect(getInTouchLink, `${office.label} should show the hero Get in touch mailto CTA`).toBeVisible();
    await expect(getInTouchLink, `${office.label} hero Get in touch CTA should stay a mailto link`).toHaveAttribute('href', /^mailto:/i);
    await expect(phoneLink, `${office.label} should show the hero phone link`).toBeVisible();
    await expect(phoneLink, `${office.label} hero phone link should stay a tel link`).toHaveAttribute('href', /^tel:/i);
}

async function expandOfficeIntroCopy(page, office) {
    const readMoreButton = getOfficeReadMoreButton(page);

    if (office.hasReadMore === false) {
        await expect(readMoreButton, `${office.label} should not show a Read more button for this office`).not.toBeVisible();
        return;
    }

    const contentSection = getOfficeExpandableContentSection(page);
    const sectionReadMoreButton = contentSection.getByRole('button', { name: /^Read more$/i }).first();

    await expect(contentSection, `${office.label} should show the office introduction content block`).toBeVisible();
    await expect(sectionReadMoreButton, `${office.label} should expose the Read more button beneath the hero`).toBeVisible();
    await sectionReadMoreButton.scrollIntoViewIfNeeded();
    await clickWithCookieGuard(page, sectionReadMoreButton);

    if (await sectionReadMoreButton.isVisible().catch(() => false)) {
        await sectionReadMoreButton.click({ force: true }).catch(() => { });
    }

    if (await sectionReadMoreButton.isVisible().catch(() => false)) {
        await sectionReadMoreButton.evaluate((element) => element.click()).catch(() => { });
    }

    await expect(sectionReadMoreButton, `${office.label} should hide the Read more button after expanding the office introduction`).not.toBeVisible();
}

async function verifyMeetTeamAndViewAllFlow(page, office) {
    const meetTeamSection = getMeetTheTeamSection(page);
    const meetTeamHeading = meetTeamSection.getByRole('heading', { level: 2, name: 'Meet the team' }).first();
    const viewAllLink = meetTeamSection.getByRole('link', { name: /^View all$/i }).first();

    await expect(meetTeamSection, `${office.label} should show the Meet the team section`).toBeVisible();
    await expect(meetTeamHeading, `${office.label} should show the Meet the team heading`).toBeVisible();
    await expect.poll(async () => getVisibleTeamCardCount(meetTeamSection), {
        message: `${office.label} should show between one and eight visible people cards in the Meet the team section`,
    }).toBeGreaterThan(0);
    const visibleTeamCards = await getVisibleTeamCardCount(meetTeamSection);
    expect(visibleTeamCards, `${office.label} should not show more than eight visible people cards in the Meet the team section`).toBeLessThanOrEqual(8);
    await expect(viewAllLink, `${office.label} should show the View all people link beneath the team cards`).toBeVisible();
    await expect(viewAllLink, `${office.label} View all link should filter the People page by office`).toHaveAttribute('href', /\/people\?filterByOffice=/i);

    const originalOfficeUrl = page.url();
    const viewAllHref = await viewAllLink.getAttribute('href');
    expect(viewAllHref, `${office.label} View all link should expose a destination`).toBeTruthy();
    const destinationUrl = new URL(viewAllHref, originalOfficeUrl).toString();

    await clickWithCookieGuard(page, viewAllLink);
    await page.waitForLoadState('load').catch(() => { });

    if (page.url() === originalOfficeUrl) {
        await page.goto(destinationUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => { });
    }

    await dismissCookieOverlayIfPresent(page);

    await expect(page, `${office.label} View all link should land on the People page`).toHaveURL(/\/people\?filterByOffice=/i);
    await ensurePeopleFilterPanelOpen(page);

    const filterButton = page.getByRole('button', { name: /^Filter\s*\(1\)$/i }).first();
    const locationAndRoleHeading = page.locator('p').filter({ hasText: /^Location and role$/i }).first();
    const officeDropdownButton = page.locator('#dropdownMenuButton1').first();

    await expect(filterButton, `${office.label} View all flow should keep exactly one People filter selected`).toBeVisible();
    await expect(locationAndRoleHeading, `${office.label} People filter panel should show the Location and role heading`).toBeVisible();
    await expect.poll(async () => normalizeWhitespace(await officeDropdownButton.innerText()), {
        message: `${office.label} People filter dropdown should reflect the preselected office`,
    }).toBe(office.label);
    await expect.poll(async () => getCheckedOfficeFilterLabels(page), {
        message: `${office.label} People filter menu should keep the office checkbox preselected`,
    }).toContain(office.label);

    await page.goBack();
    await page.waitForLoadState('load').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, `${office.label} should return to its office page after going back from People`).toHaveURL(getPathUrlPattern(office.href));
}

async function verifyOfficeContactSection(page, office) {
    const officeContactSection = getOfficeContactSection(page, office.officeContactHeading);
    const officeContactHeading = officeContactSection.getByRole('heading', { level: 2, name: office.officeContactHeading }).first();
    const phoneButton = officeContactSection.locator('button.phoneNumber__btn').first();
    const telLink = officeContactSection.locator('a[href^="tel:"], a[href^="mailto:tel:"]').first();
    const emailLink = officeContactSection.locator('a[href^="mailto:"]').filter({ hasText: /email/i }).first();

    await expect(officeContactSection, `${office.label} should show the office contact panel`).toBeVisible();
    await expect(officeContactHeading, `${office.label} should show the expected office contact heading`).toBeVisible();
    await expect.poll(async () => {
        const hasPhoneButton = await phoneButton.isVisible().catch(() => false);
        const hasTelLink = await telLink.isVisible().catch(() => false);
        return hasPhoneButton || hasTelLink;
    }, {
        message: `${office.label} office contact panel should expose either a phone reveal button or a direct telephone link`,
    }).toBe(true);
    await expect(telLink, `${office.label} office contact panel should keep a phone destination available`).toHaveAttribute('href', /^(?:tel:|mailto:tel:)/i);
    await expect(emailLink, `${office.label} office contact panel should show the Email us mailto link`).toBeVisible();
    await expect(emailLink, `${office.label} office contact email link should stay a mailto link`).toHaveAttribute('href', /^mailto:/i);
}

async function verifyDirectionsPdfPanel(page, office) {
    const directionsSection = getOfficeContactSection(page, 'DIRECTIONS');
    const directionsHeading = directionsSection.getByRole('heading', { level: 2, name: 'DIRECTIONS' }).first();
    const directionsLink = directionsSection.getByRole('link', { name: /Directions/i }).first();

    await expect(directionsSection, `${office.label} should show the lower directions panel`).toBeVisible();
    await expect(directionsHeading, `${office.label} should show the DIRECTIONS heading`).toBeVisible();
    await expect(directionsLink, `${office.label} directions panel should show the Directions PDF link`).toBeVisible();
    await expect(directionsLink, `${office.label} directions link should point at a PDF asset`).toHaveAttribute('href', /\.pdf(?:$|\?)/i);
    await expect(directionsLink, `${office.label} directions link should remain marked as a downloadable asset`).toHaveAttribute('download', '');
}

async function verifyOfficeDirectionsPanel(page, office) {
    const officePanelSection = getOfficePanelSection(page, office.officeHeading);
    const officeHeading = officePanelSection.getByRole('heading', { level: 2, name: office.officeHeading }).first();
    const directionsLink = officePanelSection.getByRole('link', { name: /Directions/i }).first();

    await expect(officePanelSection, `${office.label} should show the lower office information panel`).toBeVisible();
    await expect(officeHeading, `${office.label} should show the expected office panel heading`).toBeVisible();
    await expect(directionsLink, `${office.label} office information panel should show the Directions PDF link`).toBeVisible();
    await expect(directionsLink, `${office.label} Directions link should point at a PDF asset`).toHaveAttribute('href', /\.pdf(?:$|\?)/i);
    await expect(directionsLink, `${office.label} Directions link should remain marked as a downloadable asset`).toHaveAttribute('download', '');
}

test('Locations - Initial Page Load Checks', async ({ page }) => {
    await openLocationsPage(page);

    await test.step('Verify the page title and the hero heading', async () => {
        await expect(page, 'The Locations page should expose the expected page title').toHaveTitle(/Find your local office globally \| Locations/i);
        await expect(getHeroHeading(page), 'The Locations page hero should show the Locations heading').toBeVisible();
    });

    await test.step('Verify the hero Get in touch CTA', async () => {
        const getInTouchLink = getHeroGetInTouchLink(page);

        await expect(getInTouchLink, 'The Locations hero should show the Get in touch CTA').toBeVisible();
        await expect(getInTouchLink, 'The Locations hero Get in touch CTA should point at the contact page').toHaveAttribute('href', /\/contact-us$/i);
    });
}, 30000);

test('Locations - Office Accordions Expand, Collapse, and Expose the Office Links', async ({ page }) => {
    test.setTimeout(120000);

    await openLocationsPage(page);

    const verifyAnimatedHover = false;

    const officesHeading = getOfficesHeading(page);
    const officesSection = getOfficesSection(page);

    await test.step('Verify the Our offices section and accordion labels', async () => {
        await expect(officesHeading, 'The Locations page should show the Our offices heading').toBeVisible();

        for (const accordion of OFFICE_ACCORDIONS) {
            const accordionButton = getOfficeAccordionButton(officesSection, accordion.name);
            await expect(accordionButton, `${accordion.name} should be available as an office accordion button`).toBeVisible();
            await expectAccordionIndicatorState(accordionButton, false, `${accordion.name} accordion`);
        }
    });

    for (let index = 0; index < OFFICE_ACCORDIONS.length; index += 1) {
        const accordion = OFFICE_ACCORDIONS[index];

        await test.step(`Open the ${accordion.name} office accordion`, async () => {
            const { button, panel } = await ensureOfficeAccordionExpanded(page, officesSection, accordion.name);

            if (index > 0) {
                const previousButton = getOfficeAccordionButton(officesSection, OFFICE_ACCORDIONS[index - 1].name);
                const previousPanel = await getOfficeAccordionPanel(page, previousButton);

                await expect(previousButton, `${OFFICE_ACCORDIONS[index - 1].name} should collapse when ${accordion.name} is opened`).toHaveAttribute('aria-expanded', 'false');
                await expect(previousPanel, `${OFFICE_ACCORDIONS[index - 1].name} panel should collapse when ${accordion.name} is opened`).not.toBeVisible();
            }

            for (const officeLink of accordion.links) {
                const link = getSectionLinkByHref(panel, officeLink.href);

                await expect(link, `${accordion.name} should list ${officeLink.label}`).toBeVisible();
                await expect.poll(async () => normalizeWhitespace(await link.innerText()).toLowerCase(), {
                    message: `${accordion.name} should keep the ${officeLink.label} link text`,
                }).toBe(officeLink.label.toLowerCase());
                await expectArrowHoverEffect(page, link, `${accordion.name} office link ${officeLink.label}`, {
                    verifyAnimatedHover: verifyAnimatedHover && officeLink.verifyAnimatedHover !== false,
                });
            }
        });
    }

    await test.step('Collapse the North America accordion once the office checks are complete', async () => {
        const northAmericaButton = getOfficeAccordionButton(officesSection, 'North America');
        const northAmericaPanel = await getOfficeAccordionPanel(page, northAmericaButton);

        await clickWithCookieGuard(page, northAmericaButton);
        await expectAccordionIndicatorState(northAmericaButton, false, 'North America accordion');
        await expect(northAmericaPanel, 'North America should hide its office list after collapsing').not.toBeVisible();
    });
}, 30000);

test('Locations - Regional Experience Links and Footer Are Present', async ({ page }) => {
    test.setTimeout(120000);

    await openLocationsPage(page);

    const verifyAnimatedHover = false;

    const regionalHeading = getRegionalExperienceHeading(page);
    const regionalSection = getRegionalExperienceSection(page);

    await test.step('Verify the Our regional experience cards without relying on card order', async () => {
        await expect(regionalHeading, 'The Locations page should show the Our regional experience heading').toBeVisible();
        await expect(regionalSection, 'The Locations page should show the regional experience section').toBeVisible();

        const actualHrefs = await getVisibleScopedLocationHrefs(regionalSection);
        const uniqueActualHrefs = [...new Set(actualHrefs)].sort();
        const expectedHrefs = REGIONAL_EXPERIENCE_LINKS.map((item) => item.href).sort();

        expect(uniqueActualHrefs, 'The regional experience section should expose the expected set of experience destinations').toEqual(expectedHrefs);

        for (const experienceLink of REGIONAL_EXPERIENCE_LINKS) {
            const link = getSectionLinkByHref(regionalSection, experienceLink.href);

            await expect(link, `The regional experience section should show ${experienceLink.label}`).toBeVisible();
            await expect(link, `${experienceLink.label} should remain discoverable within the regional experience card text`).toContainText(new RegExp(escapeRegex(experienceLink.label), 'i'));
            await expectArrowHoverEffect(page, link, `Regional experience link ${experienceLink.label}`, { verifyAnimatedHover });
        }
    });

    await test.step('Verify the footer is still present beneath the locations content', async () => {
        const footer = page.getByRole('contentinfo').first();
        const legalLink = footer.getByRole('link', { name: 'Legal and regulatory' }).first();

        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Locations page should still show the usual footer').toBeVisible();
        await expect(legalLink, 'The footer should keep the Legal and regulatory link on the Locations page').toBeVisible();
    });
}, 30000);

for (const region of REGIONAL_PAGE_DETAILS) {
    test(`Locations - Regional Experience Page ${region.label}`, async ({ page }) => {
        test.setTimeout(120000);

        await openLocationsPage(page);

        const regionalSection = getRegionalExperienceSection(page);
        const regionalLink = getSectionLinkByHref(regionalSection, region.href);
        const regionalLinkHref = await regionalLink.getAttribute('href');

        await expect(regionalLink, `The Locations page should expose the ${region.label} regional experience card before opening it`).toBeVisible();
        await clickWithCookieGuard(page, regionalLink);
        await page.waitForLoadState('load').catch(() => { });

        if (!getPathUrlPattern(region.href).test(page.url()) && regionalLinkHref) {
            await page.goto(buildSameOriginUrl(page.url(), regionalLinkHref), { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
        }

        await dismissCookieOverlayIfPresent(page);

        const verifyAnimatedHover = await canReliablyHover(page);
        const heroHeading = getRegionalPageHeroHeading(page);
        const heroGetInTouchLink = getRegionalPageHeroGetInTouchLink(page);

        await expect(page, `${region.label} should open its expected regional page`).toHaveURL(getPathUrlPattern(region.href));
        await expect(page, `${region.label} page title should contain the region keyword`).toHaveTitle(new RegExp(escapeRegex(region.pageKeyword), 'i'));
        await expect(heroHeading, `${region.label} hero heading should contain the region keyword`).toContainText(new RegExp(escapeRegex(region.pageKeyword), 'i'));
        await expect(heroGetInTouchLink, `${region.label} hero should show the Get in touch CTA`).toBeVisible();
        await expect(heroGetInTouchLink, `${region.label} hero Get in touch CTA should point at the contact page`).toHaveAttribute('href', /\/contact-us(?:$|[?#])/i);

        await verifyRegionalTrackRecordSection(page, region, { verifyAnimatedHover });
        await verifyRegionalExperienceSection(page, region, { verifyAnimatedHover });
        await verifyRegionalTeamSection(page, region, { verifyAnimatedHover });
        await verifyRegionalInsightSection(page, region, { verifyAnimatedHover });
        await verifyRegionalGetInTouchSection(page, region);

        const footer = page.getByRole('contentinfo').first();
        const legalLink = footer.getByRole('link', { name: 'Legal and regulatory' }).first();

        await footer.scrollIntoViewIfNeeded();
        await expect(footer, `${region.label} should show the footer beneath the regional page content`).toBeVisible();
        await expect(legalLink, `${region.label} footer should keep the Legal and regulatory link visible`).toBeVisible();
    }, 30000);
}

for (const office of ASIA_PACIFIC_OFFICE_DETAILS) {
    test(`Locations - Asia Pacific Office Page ${office.label}`, async ({ page }) => {
        test.setTimeout(120000);

        await openLocationsPage(page);

        const officesSection = getOfficesSection(page);
        const { panel } = await ensureOfficeAccordionExpanded(page, officesSection, 'Asia Pacific');
        const officeLink = getSectionLinkByHref(panel, office.href);
        const officeHref = await officeLink.getAttribute('href');

        await expect(officeLink, `Asia Pacific should expose the ${office.label} office link before opening it`).toBeVisible();
        await clickWithCookieGuard(page, officeLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        if (!getPathUrlPattern(office.href).test(page.url()) && officeHref) {
            await page.goto(new URL(officeHref, page.url()).toString(), { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
        }

        await expect(page, `${office.label} should open the expected office page from the Asia Pacific accordion`).toHaveURL(getPathUrlPattern(office.href));

        await expectOfficeHeroContent(page, office);
        await expandOfficeIntroCopy(page, office);
        await verifyMeetTeamAndViewAllFlow(page, office);
        await verifyOfficeContactSection(page, office);
        await verifyOfficeDirectionsPanel(page, office);

        const footer = page.getByRole('contentinfo').first();
        const legalLink = footer.getByRole('link', { name: 'Legal and regulatory' }).first();

        await footer.scrollIntoViewIfNeeded();
        await expect(footer, `${office.label} should show the footer beneath the office page content`).toBeVisible();
        await expect(legalLink, `${office.label} footer should keep the Legal and regulatory link visible`).toBeVisible();

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, `Going back from ${office.label} should return to the locations page`).toHaveURL(/\/locations(?:\?.*)?(?:#.*)?$/i);
    }, 30000);
}

for (const office of EUROPE_OFFICE_DETAILS) {
    test(`Locations - Europe Office Page ${office.label}`, async ({ page }) => {
        test.setTimeout(120000);

        await openLocationsPage(page);

        const officesSection = getOfficesSection(page);
        const { panel } = await ensureOfficeAccordionExpanded(page, officesSection, 'Europe');
        const officeLink = getSectionLinkByHref(panel, office.href);
        const officeHref = await officeLink.getAttribute('href');

        await expect(officeLink, `Europe should expose the ${office.label} office link before opening it`).toBeVisible();
        await clickWithCookieGuard(page, officeLink);
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);

        if (!getPathUrlPattern(office.href).test(page.url()) && officeHref) {
            await page.goto(new URL(officeHref, page.url()).toString(), { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
        }

        await expect(page, `${office.label} should open the expected office page from the Europe accordion`).toHaveURL(getPathUrlPattern(office.href));

        await expectOfficeHeroContent(page, office);
        await expandOfficeIntroCopy(page, office);
        await verifyMeetTeamAndViewAllFlow(page, office);
        await verifyOfficeContactSection(page, office);
        await verifyDirectionsPdfPanel(page, office);

        const footer = page.getByRole('contentinfo').first();
        const legalLink = footer.getByRole('link', { name: 'Legal and regulatory' }).first();

        await footer.scrollIntoViewIfNeeded();
        await expect(footer, `${office.label} should show the footer beneath the office page content`).toBeVisible();
        await expect(legalLink, `${office.label} footer should keep the Legal and regulatory link visible`).toBeVisible();

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, `Going back from ${office.label} should return to the locations page`).toHaveURL(/\/locations(?:\?.*)?(?:#.*)?$/i);
    }, 30000);
}

for (const office of NORTH_AMERICA_OFFICE_DETAILS) {
    test(`Locations - North America Office Page ${office.label}`, async ({ page }) => {
        test.setTimeout(120000);

        await openLocationsPage(page);

        const officesSection = getOfficesSection(page);
        const { panel } = await ensureOfficeAccordionExpanded(page, officesSection, 'North America');
        const officeLink = getSectionLinkByHref(panel, office.href);
        const officeHref = await officeLink.getAttribute('href');

        await expect(officeLink, `North America should expose the ${office.label} office link before opening it`).toBeVisible();
        await clickWithCookieGuard(page, officeLink);
        await page.waitForLoadState('load').catch(() => { });

        if (!getPathUrlPattern(office.href).test(page.url()) && officeHref) {
            await page.goto(new URL(officeHref, page.url()).toString(), { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('load').catch(() => { });
        }

        await dismissCookieOverlayIfPresent(page);

        await expect(page, `${office.label} should open the expected office page from the North America accordion`).toHaveURL(getPathUrlPattern(office.href));

        await expectOfficeHeroContent(page, office);
        await expandOfficeIntroCopy(page, office);
        await verifyMeetTeamAndViewAllFlow(page, office);
        await verifyOfficeContactSection(page, office);
        await verifyDirectionsPdfPanel(page, office);

        const footer = page.getByRole('contentinfo').first();
        const legalLink = footer.getByRole('link', { name: 'Legal and regulatory' }).first();

        await footer.scrollIntoViewIfNeeded();
        await expect(footer, `${office.label} should show the footer beneath the office page content`).toBeVisible();
        await expect(legalLink, `${office.label} footer should keep the Legal and regulatory link visible`).toBeVisible();

        await page.goBack();
        await page.waitForLoadState('load').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, `Going back from ${office.label} should return to the locations page`).toHaveURL(/\/locations(?:\?.*)?(?:#.*)?$/i);
    }, 30000);
}
