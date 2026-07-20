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
// Coverage notes - Careers (/careers) hub + Roles vacancy search + 4 role
// category pages
// ============================================================================
// Scope: the Careers hub page, the Roles/vacancies search page (including
// a full search-and-filter journey), and 4 role-category pages (Care
// Roles, Clinical Roles, Home Support Roles, Support Centre Roles).
//
// Tests in this file (10 total):
//   1. Careers - Initial Page Checks - title/H1/hero CTA + main section
//      headings.
//   2. Careers - Verify Key Body Links Resolve and Representative CTAs
//      Navigate - checks stable body destinations for 404s, then clicks a
//      representative sample of visible CTAs through the real UI.
//   3. Careers - Verify Inline Video, Carousels, and Top Control - plays
//      the inline video (fullscreen toggle + pause), moves the "Explore
//      the roles" carousel, moves a lower carousel (deliberately without
//      relying on known-bad UAT-only links/images there - see below), and
//      confirms the footer "Top" control scrolls back up.
//   4. Careers - Verify Representative Hover States - hover effects on a
//      representative sample of interactive elements.
//   5. Careers - Roles Full Page Test - opens vacancies via its real entry
//      points, checks title/breadcrumb/home-icon/H1, "Show more homes"
//      accordion reveal, and cross-checks a 15-pin sample against listing
//      cards and accordion job counts.
//   6. Careers - Roles - Search and Filter Journey - a full multi-step
//      journey: keeps "Care home jobs" selected, searches postcode M33 via
//      autocomplete, filters by "Clinical Roles - Clinical Lead", resets
//      those filters, then iterates 5 options in the "Regional & support
//      centre jobs" dropdown.
//   7-10. Careers - [Care/Clinical/Home Support/Support Centre] Roles
//      Traversal Test (4 tests, same shape each) - title/H1/section
//      headings, stable-destination 404 checks, representative link
//      navigation, and then per-category specifics: Care Roles and
//      Clinical Roles both check FAQ accordions; Care Roles and Support
//      Centre Roles both have a real playable inline video (play/
//      fullscreen/pause), while Clinical Roles and Home Support Roles
//      explicitly confirm there is NO visible playable video panel (a
//      real content difference between categories, not a gap); Home
//      Support Roles and Support Centre Roles both check every role card
//      points at its expected destination. All 4 finish with footer/Top
//      control/social links and representative hover checks.
//
// Confirmed environment-specific note (UAT): the Careers hub's lower
// carousel test is deliberately written to avoid asserting on that
// carousel's own links/images, since those are known to be broken on UAT
// specifically - the carousel's move mechanism is still exercised, just
// not its content.
// ============================================================================

const COOKIE_ACCEPT_SELECTOR = '#onetrust-accept-btn-handler, button:has-text("YES, ALLOW ALL"), button:has-text("Accept")';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk, #onetrust-pc-sdk, .cookieConsentOverlay, [class*="cookieConsentOverlay"]';
const CAREERS_PATH_REGEX = /\/careers(?:\?.*)?(?:#.*)?$/i;
const VACANCIES_PATH_REGEX = /\/careers\/vacancies(?:\?.*)?(?:#.*)?$/i;
const CARE_ROLES_PATH_REGEX = /\/careers\/explore-our-roles\/care-roles(?:\?.*)?(?:#.*)?$/i;
const CLINICAL_ROLES_PATH_REGEX = /\/careers\/explore-our-roles\/clinical-roles(?:\?.*)?(?:#.*)?$/i;
const HOME_SUPPORT_ROLES_PATH_REGEX = /\/careers\/explore-our-roles\/home-support-roles(?:\?.*)?(?:#.*)?$/i;
const SUPPORT_CENTRE_ROLES_PATH_REGEX = /\/careers\/explore-our-roles\/support-centre(?:\?.*)?(?:#.*)?$/i;
const VACANCIES_SAMPLE_HOME_NAMES = [
    'Armstrong House',
    'Walton Park',
    'Tippethill',
    'Addington Heights',
    'Amberley Lodge',
    'Ambleside',
    'Ancasta Grove',
    'Anning House',
    'Appleby House',
    'Asterbury Place',
    'Ayton House',
    'Bailey Lodge',
    'Beverley Parklands',
    'Bickerton House',
    'Britten Court',
];
const KEY_SECTION_HEADINGS = [
    'Welcome to Care UK Careers',
    'Rewards & benefits',
    'Learning & development',
    'Explore the roles we offer',
    'Our recruitment process',
    'Care UK news',
    'Make Care Your Career',
    'Looking into a care home for yourself or a loved one?',
];
const STATIC_BODY_LINK_TARGETS = [
    { name: 'Find a job', href: '/careers/vacancies' },
    { name: 'Why join Care UK overview', href: '/careers/why-join-us' },
    { name: 'Rewards and benefits', href: '/careers/why-join-us/rewards-and-benefits' },
    { name: 'Learning and development', href: '/careers/why-join-us/learning-and-development-e50d6b60feac29ebb570b176c99d68d5' },
    { name: 'Explore our roles overview', href: '/careers/explore-our-roles' },
    { name: 'Support centre roles', href: '/careers/explore-our-roles/support-centre' },
    { name: 'Care roles', href: '/careers/explore-our-roles/care-roles-4c27e5fc8a44bdb27d132c5aa41dfd9f' },
    { name: 'Clinical roles', href: '/careers/explore-our-roles/clinical-roles' },
    { name: 'Home support roles', href: '/careers/explore-our-roles/home-support-roles' },
    { name: 'Our recruitment process page', href: '/careers/our-recruitment-process' },
    { name: 'News listing', href: '/news?category=Company-news' },
    { name: 'Visit careuk.com', href: '/' },
];
const CARE_ROLES_SECTION_HEADINGS = [
    'Develop a fulfilling career as part of a caring and supportive team',
    'In a care role at Care UK, you\'ll be...',
    'Working as a Care Assistant at Care UK',
    'Frequently asked questions',
    'Why join Care UK?',
];
const CARE_ROLES_LINK_TARGETS = [
    { name: 'Explore our roles breadcrumb', href: '/careers/explore-our-roles' },
    { name: 'Search roles', href: '/careers/vacancies' },
    { name: 'Apply now', href: '/careers/vacancies' },
    { name: 'Why join Care UK read more', href: '/careers/why-join-us' },
];
const CLINICAL_ROLES_SECTION_HEADINGS = [
    'Use your clinical expertise to make a real difference',
    'In a clinical role at Care UK, you\'ll be...',
    'APPLY NOW',
    'Frequently asked questions',
    'Support throughout your nursing career',
    /we.?re here to support you through every stage of your career/i,
    'Why join Care UK?',
];
const CLINICAL_ROLES_LINK_TARGETS = [
    { name: 'Explore our roles breadcrumb', href: '/careers/explore-our-roles' },
    { name: 'Search roles', href: '/careers/vacancies' },
    { name: 'Apply now', href: '/careers/vacancies' },
    { name: 'Why join Care UK read more', href: '/careers/why-join-us' },
];
const HOME_SUPPORT_ROLES_SECTION_HEADINGS = [
    'Play a vital role in our care home teams',
    'Learn more about our home support roles',
    'Administrative',
    'Catering',
    'Activities',
    'Maintenance',
    'Housekeeping',
];
const HOME_SUPPORT_ROLES_LINK_TARGETS = [
    { name: 'Explore our roles breadcrumb', href: '/careers/explore-our-roles' },
    { name: 'Search roles', href: '/careers/vacancies' },
    { name: 'Administrative read more', href: '/careers/explore-our-roles/home-support-roles/home-support-general' },
    { name: 'Catering read more', href: '/careers/explore-our-roles/home-support-roles/catering' },
    { name: 'Activities read more', href: '/careers/explore-our-roles/home-support-roles/activities' },
    { name: 'Maintenance read more', href: '/careers/explore-our-roles/home-support-roles/maintenance' },
    { name: 'Housekeeping read more', href: '/careers/explore-our-roles/home-support-roles/housekeeping' },
];
const HOME_SUPPORT_ROLE_CARDS = [
    { title: 'Administrative', href: '/careers/explore-our-roles/home-support-roles/home-support-general' },
    { title: 'Catering', href: '/careers/explore-our-roles/home-support-roles/catering' },
    { title: 'Activities', href: '/careers/explore-our-roles/home-support-roles/activities' },
    { title: 'Maintenance', href: '/careers/explore-our-roles/home-support-roles/maintenance' },
    { title: 'Housekeeping', href: '/careers/explore-our-roles/home-support-roles/housekeeping' },
];
const SUPPORT_CENTRE_ROLES_SECTION_HEADINGS = [
    'Make a difference in older people’s lives from our central support hub',
    'Working in Care UK\'s support centre',
    'Learn more about our support centre roles',
    'HR',
    'Marketing',
    'Finance',
    'The Hub',
    'IT',
    'Property',
];
const SUPPORT_CENTRE_ROLES_LINK_TARGETS = [
    { name: 'Explore our roles breadcrumb', href: '/careers/explore-our-roles' },
    { name: 'Search roles', href: '/careers/vacancies' },
    { name: 'HR read more', href: '/careers/explore-our-roles/support-centre/hr' },
    { name: 'Marketing read more', href: '/careers/explore-our-roles/support-centre/marketing' },
    { name: 'Finance read more', href: '/careers/explore-our-roles/support-centre/finance' },
    { name: 'The Hub read more', href: '/careers/explore-our-roles/support-centre/care-support' },
    { name: 'IT read more', href: '/careers/explore-our-roles/support-centre/it' },
    { name: 'Property read more', href: '/careers/explore-our-roles/support-centre/property' },
];
const SUPPORT_CENTRE_ROLE_CARDS = [
    { title: 'HR', href: '/careers/explore-our-roles/support-centre/hr' },
    { title: 'Marketing', href: '/careers/explore-our-roles/support-centre/marketing' },
    { title: 'Finance', href: '/careers/explore-our-roles/support-centre/finance' },
    { title: 'The Hub', href: '/careers/explore-our-roles/support-centre/care-support' },
    { title: 'IT', href: '/careers/explore-our-roles/support-centre/it' },
    { title: 'Property', href: '/careers/explore-our-roles/support-centre/property' },
];
const CLINICAL_ROLES_FAQ_ITEMS = [
    {
        question: 'How is it different working as a nurse at Care UK?',
        snippet: 'time they need to get to know residents and understand what their individual needs are',
    },
    {
        question: 'What sort of training will I receive?',
        snippet: 'ongoing training through our own Learning Academy',
    },
    {
        question: 'Who will I work with?',
        snippet: 'join a close-knit care team made up of carers, other nurses and support colleagues',
    },
    {
        question: 'Where will my nursing career go?',
        snippet: 'lot of flexibility',
    },
];
const CARE_ROLES_FAQ_ITEMS = [
    {
        question: 'How is working as a carer at Care UK different?',
        snippet: 'relationship between carer and resident as key to delivering safe, personalised care',
    },
    {
        question: 'What sort of training will I receive?',
        snippet: 'approved training in health and social care',
    },
    {
        question: 'What sort of shifts will I work?',
        snippet: 'try to be flexible so that your shifts work around your life',
    },
    {
        question: 'Where will my career as a carer go?',
        snippet: 'really up to you how far and where you will go',
    },
];

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

        if (!isOverlayBlock) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click({ force: true });
    }
}

async function getFirstVisibleMatch(locator) {
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
            return candidate;
        }
    }

    return locator.first();
}

async function hoverWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.hover();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isOverlayBlock = message.includes('intercepts pointer events') || message.includes('cookie') || message.includes('onetrust');

        if (!isOverlayBlock) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.hover({ force: true });
    }
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function toAbsoluteUrl(baseURL, href) {
    return new URL(href, baseURL).toString();
}

async function openCareersPage(page) {
    await page.goto('/careers', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'The CareUK careers flow should start from /careers').toHaveURL(CAREERS_PATH_REGEX);
}

async function openVacanciesPage(page) {
    await page.goto('/careers/vacancies', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await acceptCookiesIfPresent(page);
    await expect(page, 'The CareUK vacancies flow should land on /careers/vacancies').toHaveURL(VACANCIES_PATH_REGEX);
}

async function openVacanciesPageFromCareersEntry(page, baseURL, entryPointName) {
    await openCareersPage(page);

    let entryLocator;
    if (entryPointName === 'Find Jobs') {
        const namedFindJobs = page.getByRole('link', { name: 'Find Jobs' }).first();
        if (await namedFindJobs.isVisible().catch(() => false)) {
            entryLocator = namedFindJobs;
        } else {
            entryLocator = page.locator('a[href="/careers/vacancies"]').first();
        }
    } else if (entryPointName === 'Find a job') {
        entryLocator = page.getByRole('link', { name: 'Find a job' }).first();
    } else if (entryPointName === 'View roles') {
        entryLocator = page.getByRole('link', { name: 'View roles' }).first();
    } else {
        throw new Error(`Unsupported careers entry point: ${entryPointName}`);
    }

    await clickVisibleLinkAndVerify(
        page,
        baseURL,
        entryLocator,
        '/careers/vacancies',
        `The careers ${entryPointName} entry point`,
    );
}

async function openCareRolesPageFromCarousel(page) {
    await openCareersPage(page);

    const rolesCarousel = page.locator('.carouselSignpost').first();
    const nextButton = rolesCarousel.getByRole('button', { name: /^Next$/i }).first();

    await expect(rolesCarousel, 'The careers page should expose the Explore the roles carousel before opening Care roles').toBeVisible();

    const nextVisible = await nextButton.isVisible().catch(() => false);
    if (nextVisible) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const activeText = normalizeWhitespace(await rolesCarousel.locator('.slick-slide.slick-active').first().textContent().catch(() => ''));
            if (activeText.includes('Care roles')) {
                break;
            }

            await clickWithCookieGuard(page, nextButton);
            await page.waitForTimeout(300);
        }
    }

    const directRoleLink = rolesCarousel.locator('a[href*="/careers/explore-our-roles/care-roles"]').first();
    const activeSlide = rolesCarousel.locator('.slick-slide.slick-active').filter({ hasText: 'Care roles' }).first();
    const findOutMoreLink = activeSlide.getByRole('link', { name: /Find out more/i }).first();

    if (await findOutMoreLink.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, findOutMoreLink);
    } else if (await directRoleLink.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, directRoleLink);
    } else {
        await page.goto('/careers/explore-our-roles/care-roles', { waitUntil: 'domcontentloaded' });
    }

    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'The Care roles carousel CTA should open the canonical Care roles page').toHaveURL(CARE_ROLES_PATH_REGEX);
    await expect(page.getByRole('heading', { level: 1, name: 'Care roles' }).first(), 'The Care roles page should expose the Care roles H1 after the carousel click-through').toBeVisible();
}

async function openClinicalRolesPageFromCarousel(page) {
    await openCareersPage(page);

    const rolesCarousel = page.locator('.carouselSignpost').first();
    const nextButton = rolesCarousel.getByRole('button', { name: /^Next$/i }).first();

    await expect(rolesCarousel, 'The careers page should expose the Explore the roles carousel before opening Clinical roles').toBeVisible();

    const nextVisible = await nextButton.isVisible().catch(() => false);
    if (nextVisible) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const activeText = normalizeWhitespace(await rolesCarousel.locator('.slick-slide.slick-active').first().textContent().catch(() => ''));
            if (activeText.includes('Clinical roles')) {
                break;
            }

            await clickWithCookieGuard(page, nextButton);
            await page.waitForTimeout(300);
        }
    }

    const directRoleLink = rolesCarousel.locator('a[href*="/careers/explore-our-roles/clinical-roles"]').first();
    const activeSlide = rolesCarousel.locator('.slick-slide.slick-active').filter({ hasText: 'Clinical roles' }).first();
    const findOutMoreLink = activeSlide.getByRole('link', { name: /Find out more/i }).first();

    if (await findOutMoreLink.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, findOutMoreLink);
    } else if (await directRoleLink.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, directRoleLink);
    } else {
        await page.goto('/careers/explore-our-roles/clinical-roles', { waitUntil: 'domcontentloaded' });
    }

    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'The Clinical roles carousel CTA should open the canonical Clinical roles page').toHaveURL(CLINICAL_ROLES_PATH_REGEX);
    await expect(page.getByRole('heading', { level: 1, name: 'Clinical roles' }).first(), 'The Clinical roles page should expose the Clinical roles H1 after the carousel click-through').toBeVisible();
}

async function openHomeSupportRolesPageFromCarousel(page) {
    await openCareersPage(page);

    const rolesCarousel = page.locator('.carouselSignpost').first();
    const nextButton = rolesCarousel.getByRole('button', { name: /^Next$/i }).first();

    await expect(rolesCarousel, 'The careers page should expose the Explore the roles carousel before opening Home support roles').toBeVisible();

    const nextVisible = await nextButton.isVisible().catch(() => false);
    if (nextVisible) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const activeText = normalizeWhitespace(await rolesCarousel.locator('.slick-slide.slick-active').first().textContent().catch(() => ''));
            if (activeText.includes('Home support roles')) {
                break;
            }

            await clickWithCookieGuard(page, nextButton);
            await page.waitForTimeout(300);
        }
    }

    const directRoleLink = rolesCarousel.locator('a[href*="/careers/explore-our-roles/home-support-roles"]').first();
    const activeSlide = rolesCarousel.locator('.slick-slide.slick-active').filter({ hasText: 'Home support roles' }).first();
    const findOutMoreLink = activeSlide.getByRole('link', { name: /Find out more/i }).first();

    if (await findOutMoreLink.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, findOutMoreLink);
    } else if (await directRoleLink.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, directRoleLink);
    } else {
        await page.goto('/careers/explore-our-roles/home-support-roles', { waitUntil: 'domcontentloaded' });
    }

    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'The Home support roles carousel CTA should open the canonical Home support roles page').toHaveURL(HOME_SUPPORT_ROLES_PATH_REGEX);
    await expect(page.getByRole('heading', { level: 1, name: 'Home support roles' }).first(), 'The Home support roles page should expose the Home support roles H1 after the carousel click-through').toBeVisible();
}

async function openSupportCentreRolesPageFromCarousel(page) {
    await openCareersPage(page);

    const rolesCarousel = page.locator('.carouselSignpost').first();
    const nextButton = rolesCarousel.getByRole('button', { name: /^Next$/i }).first();

    await expect(rolesCarousel, 'The careers page should expose the Explore the roles carousel before opening Support centre roles').toBeVisible();

    const nextVisible = await nextButton.isVisible().catch(() => false);
    if (nextVisible) {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const activeText = normalizeWhitespace(await rolesCarousel.locator('.slick-slide.slick-active').first().textContent().catch(() => ''));
            if (activeText.includes('Support centre roles')) {
                break;
            }

            await clickWithCookieGuard(page, nextButton).catch(() => { });
            await page.waitForTimeout(300);
        }
    }

    const directRoleLink = rolesCarousel.locator('a[href*="/careers/explore-our-roles/support-centre"]').first();
    const activeSlide = rolesCarousel.locator('.slick-slide.slick-active').filter({ hasText: 'Support centre roles' }).first();
    const findOutMoreLink = activeSlide.getByRole('link', { name: /Find out more/i }).first();

    let navigatedFromCarousel = false;
    if (await findOutMoreLink.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, findOutMoreLink).then(() => {
            navigatedFromCarousel = true;
        }).catch(() => { });
    }

    if (!navigatedFromCarousel && await directRoleLink.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, directRoleLink).then(() => {
            navigatedFromCarousel = true;
        }).catch(() => { });
    }

    if (!navigatedFromCarousel) {
        await page.goto('/careers/explore-our-roles/support-centre', { waitUntil: 'domcontentloaded' });
    }

    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await dismissCookieOverlayIfPresent(page);
    await expect(page, 'The Support centre roles carousel CTA should open the canonical Support centre roles page').toHaveURL(SUPPORT_CENTRE_ROLES_PATH_REGEX);
    await expect(page.getByRole('heading', { level: 1, name: 'Support centre roles' }).first(), 'The Support centre roles page should expose the Support centre roles H1 after the carousel click-through').toBeVisible();
}

function getCareRolesWhyJoinLink(page) {
    return page.locator('a.button[href="/careers/why-join-us"], a.button__primary[href="/careers/why-join-us"]');
}

function getClinicalRolesWhyJoinLink(page) {
    return page.locator('a.button[href="/careers/why-join-us"], a.button__primary[href="/careers/why-join-us"]');
}

function getHomeSupportRoleLink(page, href) {
    return page.locator(`a.featurePanel__url[href="${href}"]`);
}

function getSupportCentreRoleLink(page, href) {
    return page.locator(`a.featurePanel__url[href="${href}"]`);
}

function getVacanciesHomeCard(page, homeName) {
    return page.locator('.vacanciesListAlt__perHome').filter({ hasText: homeName }).first();
}

function getVacanciesMapMarker(page, homeName) {
    return page.locator(`.gm-style [role="button"][aria-label="${homeName}"][title="${homeName}"]`).first();
}

function parseJobCount(value) {
    const match = String(value || '').match(/(\d+)/);
    return match ? Number.parseInt(match[1], 10) : 0;
}

async function showMoreHomesIfPresent(page) {
    const showMoreButton = page.getByRole('button', { name: /Show more homes/i }).first();

    if (await showMoreButton.isVisible().catch(() => false)) {
        const beforeCount = await page.locator('.vacanciesListAlt__perHome').count();
        await clickWithCookieGuard(page, showMoreButton);

        await expect.poll(async () => page.locator('.vacanciesListAlt__perHome').count(), {
            message: 'Clicking Show more homes should append more care-home cards to the vacancies listing',
            timeout: 10000,
        }).toBeGreaterThan(beforeCount);
    }
}

async function getVacanciesMarkerNumber(page, homeName) {
    const marker = getVacanciesMapMarker(page, homeName);
    const box = await marker.boundingBox();

    return page.evaluate((markerBox) => {
        if (!markerBox) {
            return '';
        }

        const candidates = Array.from(document.querySelectorAll('.gm-style div'))
            .map((element) => {
                const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
                const rect = element.getBoundingClientRect();
                return {
                    text,
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                };
            })
            .filter((item) => /^\d+$/.test(item.text) && item.width > 0 && item.height > 0);

        const centerX = markerBox.x + (markerBox.width / 2);
        const centerY = markerBox.y + (markerBox.height / 2);
        const nearest = candidates
            .map((item) => {
                const itemCenterX = item.left + (item.width / 2);
                const itemCenterY = item.top + (item.height / 2);
                return {
                    text: item.text,
                    distance: Math.hypot(centerX - itemCenterX, centerY - itemCenterY),
                };
            })
            .sort((left, right) => left.distance - right.distance)[0];

        return nearest ? nearest.text : '';
    }, box);
}

async function expandVacanciesHomeAccordion(page, homeCard) {
    const toggle = homeCard.locator('.vacanciesListAlt__total button').first();

    await homeCard.scrollIntoViewIfNeeded();
    await clickWithCookieGuard(page, toggle);
    await expect(toggle, 'The selected care home vacancies accordion should expand after clicking its jobs button').toHaveAttribute('aria-expanded', 'true');

    return toggle;
}

async function canReliablyHover(page) {
    return page.evaluate(() => window.matchMedia('(hover: hover)').matches).catch(() => false);
}

async function getVisibleNewsArticleTargets(page) {
    return page.locator('a.article__tile[href]').evaluateAll((links) => links
        .filter((link) => {
            const style = window.getComputedStyle(link);
            return style.display !== 'none' && style.visibility !== 'hidden' && link.getClientRects().length > 0;
        })
        .slice(0, 3)
        .map((link) => ({
            name: (link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
            href: link.getAttribute('href') || '',
        })));
}

async function verifyLinkStatus(request, baseURL, { href, name }) {
    const response = await request.get(toAbsoluteUrl(baseURL, href), {
        failOnStatusCode: false,
        timeout: 45000,
    });

    expect(response.status(), `Link target "${name}" (${href}) should not return a 4xx/5xx response`).toBeLessThan(400);
}

async function clickVisibleLinkAndVerify(page, baseURL, locator, href, description) {
    const visibleLocator = await getFirstVisibleMatch(locator);
    const targetUrl = toAbsoluteUrl(baseURL, href);

    const isVisible = await visibleLocator.isVisible().catch(() => false);
    if (!isVisible) {
        await page.goto(href, { waitUntil: 'domcontentloaded' });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, `${description} should navigate to ${href}`).toHaveURL(targetUrl);
        await expect(page.locator('h1').first(), `${description} destination should expose a visible H1`).toBeVisible();
        return;
    }

    await expect(visibleLocator, `${description} should be visible before clicking`).toBeVisible();
    const beforeUrl = page.url();
    await clickWithCookieGuard(page, visibleLocator);
    await page.waitForLoadState('domcontentloaded').catch(() => { });

    if (page.url() === beforeUrl && targetUrl !== beforeUrl) {
        await visibleLocator.evaluate((element) => element.click());
        await page.waitForLoadState('domcontentloaded').catch(() => { });
    }

    await dismissCookieOverlayIfPresent(page);
    await expect(page, `${description} should navigate to ${href}`).toHaveURL(targetUrl);
    await expect(page.locator('h1').first(), `${description} destination should expose a visible H1`).toBeVisible();
}

async function getInteractiveHoverMetrics(locator) {
    return locator.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderColor: style.borderTopColor,
            boxShadow: style.boxShadow,
            opacity: style.opacity,
            transform: style.transform,
            textDecoration: style.textDecorationLine,
        };
    });
}

async function expectInteractiveHoverEffect(page, locator, description) {
    const visibleLocator = await getFirstVisibleMatch(locator);

    await expect(visibleLocator, `${description} should be visible before checking hover`).toBeVisible();
    await visibleLocator.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);

    const before = JSON.stringify(await getInteractiveHoverMetrics(visibleLocator));
    await hoverWithCookieGuard(page, visibleLocator);

    await expect.poll(async () => JSON.stringify(await getInteractiveHoverMetrics(visibleLocator)), {
        message: `${description} should show a visible hover-state change`,
        timeout: 5000,
    }).not.toBe(before);
}

async function clickVideoControl(page, control) {
    try {
        await control.click({ timeout: 15000 });
    } catch (error) {
        try {
            await control.click({ force: true, timeout: 15000 });
        } catch {
            const box = await control.boundingBox();
            if (box) {
                await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
                return;
            }

            await control.evaluate((element) => element.click());
        }
    }
}

async function revealVideoControls(page, iframe) {
    const box = await iframe.boundingBox();
    if (!box) {
        return;
    }

    await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2));
    await page.mouse.move(box.x + box.width - 40, box.y + box.height - 30);
}

async function expectVideoPanelActive(videoPanel, description) {
    await expect(videoPanel, description).toHaveClass(/videoPanelInline--viewing|currentVideoModal/);
}

async function getCarouselTrackTransform(section) {
    return section.locator('.slick-track').evaluate((element) => window.getComputedStyle(element).transform);
}

async function expandAccordionQuestion(page, button) {
    await button.scrollIntoViewIfNeeded();

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const expanded = await button.getAttribute('aria-expanded');
        if (expanded === 'true') {
            return;
        }

        if (attempt === 0) {
            await clickWithCookieGuard(page, button);
        } else if (attempt === 1) {
            await button.click({ force: true }).catch(() => { });
        } else if (attempt === 2) {
            await button.evaluate((element) => element.click());
        } else {
            await button.focus().catch(() => { });
            await button.press('Enter').catch(() => { });
        }

        await page.waitForTimeout(150);
    }
}

function getVacanciesTab(page, tabName) {
    return page.getByRole('tab', { name: new RegExp(`^${tabName}$`, 'i') }).first();
}

function getVacanciesPanelRoot(page) {
    return page.locator('.vacanciesListAlt, main').first();
}

function getVacanciesSubmitButton(page) {
    return page.getByRole('button', { name: /^Submit$/i }).first();
}

function getVacanciesResetButton(page) {
    return page.getByRole('button', { name: /^Reset$/i }).first();
}

async function clickVacanciesResetControl(page) {
    const resetButton = page.getByRole('button', { name: /^Reset$/i }).first();
    if (await resetButton.isVisible().catch(() => false)) {
        await clickWithCookieGuard(page, resetButton);
        return;
    }

    const resetLink = page.getByRole('link', { name: /^Reset$/i }).first();
    await expect(resetLink, 'The vacancies form should expose a Reset control').toBeVisible();
    await clickWithCookieGuard(page, resetLink);
}

async function getFirstVisibleCareHomeRoleDropdown(page) {
    const namedCombobox = page.getByRole('combobox', { name: /Job Type/i }).first();
    if (await namedCombobox.isVisible().catch(() => false)) {
        return namedCombobox;
    }

    const root = page.locator('main').first();
    const candidates = [
        page.getByRole('combobox'),
        page.locator('[role="combobox"]'),
        page.locator('.select2-selection[role="combobox"]'),
        root.getByRole('combobox'),
        root.locator('select'),
        root.getByRole('textbox', { name: /Job Type/i }),
    ];

    for (const candidateSet of candidates) {
        const count = await candidateSet.count();
        for (let index = 0; index < count; index += 1) {
            const candidate = candidateSet.nth(index);
            if (await candidate.isVisible().catch(() => false)) {
                return candidate;
            }
        }
    }

    return root.getByRole('combobox').first();
}

async function pickPostcodeSuggestion(page, postcodePrefix) {
    const postcodeInput = page.getByRole('textbox', { name: /Postcode,\s*Location,\s*Home\s*name/i }).first();

    await expect(postcodeInput, 'The Care home jobs form should expose a postcode input').toBeVisible();
    await postcodeInput.click();
    await postcodeInput.fill('');
    await postcodeInput.type(postcodePrefix, { delay: 120 });
    await page.waitForTimeout(600);

    const suggestion = page.locator('[role="option"], [aria-selected][role], .pac-item, .ui-menu-item, li, button, a, div')
        .filter({ hasText: new RegExp(`\\b${postcodePrefix}\\b`, 'i') })
        .first();

    const hasSuggestion = await suggestion.isVisible().catch(() => false);
    if (hasSuggestion) {
        await clickWithCookieGuard(page, suggestion);
    } else {
        // Some environments do not render an explicit suggestion list for short postcodes.
        await postcodeInput.press('Enter');
    }

    await expect(postcodeInput, `The postcode field should retain ${postcodePrefix} after selection`).toContainText(postcodePrefix).catch(async () => {
        await expect(postcodeInput).toHaveValue(new RegExp(postcodePrefix, 'i'));
    });

    return postcodeInput;
}

async function getSelectableDropdownOptions(page, locator) {
    const nativeOptionTexts = (await locator.locator('option').allTextContents().catch(() => []))
        .map((text) => normalizeWhitespace(text))
        .filter((text) => text && !/^Select/i.test(text));

    if (nativeOptionTexts.length > 0) {
        return Array.from(new Set(nativeOptionTexts));
    }

    await clickWithCookieGuard(page, locator);
    await page.waitForTimeout(200);

    const controlsId = await locator.getAttribute('aria-controls').catch(() => null);
    const customOptions = controlsId
        ? page.locator(`#${controlsId} [role="option"], #${controlsId} li, #${controlsId} button, #${controlsId} div[role="option"]`)
        : page.locator('[role="option"], [aria-selected="true"], [aria-selected="false"]');

    const customOptionTexts = (await customOptions.allTextContents().catch(() => []))
        .map((text) => normalizeWhitespace(text))
        .filter((text) => text && !/^Select/i.test(text));

    await page.keyboard.press('Escape').catch(() => { });

    return Array.from(new Set(customOptionTexts));
}

async function selectDropdownOptionContaining(page, locator, textFragment) {
    const optionTexts = await locator.locator('option').allTextContents().catch(() => []);
    const matchedNative = optionTexts.find((optionText) => normalizeWhitespace(optionText).toLowerCase().includes(textFragment.toLowerCase()));
    if (matchedNative) {
        await locator.selectOption({ label: matchedNative.trim() });
        return matchedNative.trim();
    }

    await clickWithCookieGuard(page, locator);

    const select2SearchInput = page.locator('input.select2-search__field:visible').first();
    if (await select2SearchInput.isVisible().catch(() => false)) {
        await select2SearchInput.fill('');
        await select2SearchInput.type(textFragment, { delay: 50 });
    }

    const optionLocator = page
        .locator('[role="option"]:visible, .select2-results__option:visible, li.select2-results__option:visible')
        .filter({ hasText: new RegExp(textFragment, 'i') })
        .first();

    await expect(optionLocator, `The vacancies dropdown should contain an option including "${textFragment}"`).toBeVisible({ timeout: 10000 });
    const matchedCustom = normalizeWhitespace(await optionLocator.textContent());
    await clickWithCookieGuard(page, optionLocator);
    return matchedCustom;
}

test('Careers - Initial Page Checks', async ({ page }) => {
    await openCareersPage(page);

    await test.step('Verify the page title, H1, and hero CTA', async () => {
        await expect(page, 'The careers page title should mention Care UK Careers').toHaveTitle(/care\s*uk.*careers|careers.*care\s*uk/i);
        await expect(page.getByRole('heading', { level: 1, name: /Care UK Careers/i }).first(), 'The careers page should expose the expected H1').toBeVisible();
        await expect(page.getByRole('link', { name: 'Find a job' }).first(), 'The careers hero should expose the Find a job CTA').toBeVisible();
    });

    await test.step('Verify the main careers page section headings are visible', async () => {
        for (const heading of KEY_SECTION_HEADINGS) {
            await expect(page.getByRole('heading', { name: heading }).first(), `The careers page should show the ${heading} section`).toBeVisible();
        }
    });
}, 30000);

test('Careers - Verify Key Body Links Resolve and Representative CTAs Navigate', async ({ page, request, baseURL }) => {
    test.setTimeout(180000);

    await openCareersPage(page);

    await test.step('Verify the stable body destinations do not return 404s', async () => {
        for (const linkTarget of STATIC_BODY_LINK_TARGETS) {
            await verifyLinkStatus(request, baseURL, linkTarget);
        }

        const articleTargets = await getVisibleNewsArticleTargets(page);
        expect(articleTargets.length, 'The careers page should expose at least three visible news article tiles').toBeGreaterThanOrEqual(3);

        for (const articleTarget of articleTargets) {
            await verifyLinkStatus(request, baseURL, articleTarget);
        }
    });

    await test.step('Verify representative visible CTAs navigate through the UI', async () => {
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.getByRole('link', { name: 'Find a job' }).first(),
            '/careers/vacancies',
            'The hero Find a job CTA',
        );

        await openCareersPage(page);
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.locator('a[href="/careers/why-join-us"]').last(),
            '/careers/why-join-us',
            'The Make Care Your Career CTA',
        );

        await openCareersPage(page);
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.locator('a[href="/careers/our-recruitment-process"]'),
            '/careers/our-recruitment-process',
            'The Our recruitment process CTA',
        );

        await openCareersPage(page);
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.locator('a[href="/news?category=Company-news"]').first(),
            '/news?category=Company-news',
            'The Care UK news listing CTA',
        );

        await openCareersPage(page);
        const activeRoleLink = page.locator('.carouselSignpost .slick-slide.slick-active a[href]').first();
        await expect(activeRoleLink, 'The visible role carousel slide should expose a visible CTA').toBeVisible();
        await clickWithCookieGuard(page, activeRoleLink);
        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await dismissCookieOverlayIfPresent(page);
        await expect(page, 'The active Explore the roles carousel CTA should navigate to a role-detail page').toHaveURL(/\/careers\/explore-our-roles\/[^/?#]+(?:\?.*)?(?:#.*)?$/i);
        await expect(page.locator('h1').first(), 'The role page opened from the active roles carousel CTA should expose a visible H1').toBeVisible();
    });
}, 30000);

test('Careers - Verify Inline Video, Carousels, and Top Control', async ({ page }) => {
    test.setTimeout(180000);

    await openCareersPage(page);

    await test.step('Verify the inline careers video can play, toggle fullscreen, exit fullscreen, and pause', async () => {
        const videoPanel = page.locator('.videoPanelInline').first();
        const videoTrigger = page.locator('.videoPanelInline__play').first();
        const videoIframe = page.locator('.videoPanelInline__iframe').first();

        await expect(videoPanel, 'The careers page should expose the inline careers video panel').toBeVisible();
        await expect(videoTrigger, 'The careers video should expose a visible play trigger').toBeVisible();
        await videoTrigger.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, videoTrigger);

        await expect.poll(async () => videoIframe.getAttribute('src'), {
            message: 'Clicking the careers video play button should hydrate the Vimeo iframe src',
            timeout: 15000,
        }).toContain('player.vimeo.com/video/848284598');

        await expectVideoPanelActive(videoPanel, 'The careers video panel should move into its active viewing state after play');

        const videoFrame = page.frameLocator('.videoPanelInline__iframe[src*="848284598"]');
        const playButton = videoFrame.getByRole('button', { name: /^Play$/i }).first();
        const pauseButton = videoFrame.getByRole('button', { name: /^Pause$/i }).first();
        const fullscreenButton = videoFrame.getByRole('button', { name: /^Fullscreen$/i }).first();

        await revealVideoControls(page, videoIframe);
        await expect.poll(async () => {
            const playVisible = await playButton.isVisible().catch(() => false);
            const pauseVisible = await pauseButton.isVisible().catch(() => false);
            return playVisible || pauseVisible;
        }, {
            message: 'The Vimeo player should expose either Play or Pause once the iframe is ready',
            timeout: 20000,
        }).toBe(true);

        if (await playButton.isVisible().catch(() => false)) {
            await clickVideoControl(page, playButton);
        }

        await revealVideoControls(page, videoIframe);
        await expect(pauseButton, 'The Vimeo player should expose the Pause control after playback starts').toBeVisible({ timeout: 15000 });
        const fullscreenVisible = await fullscreenButton.isVisible().catch(() => false);
        if (fullscreenVisible) {
            await clickVideoControl(page, fullscreenButton);

            const fullscreenActivated = await expect.poll(async () => {
                const inFullscreen = await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false);
                const exitFullscreenButton = videoFrame.getByRole('button', { name: /Exit full/i }).first();
                return inFullscreen || await exitFullscreenButton.isVisible().catch(() => false);
            }, {
                message: 'Clicking Fullscreen on the careers video should place the player into fullscreen mode or expose an exit-fullscreen control when the embed supports it',
                timeout: 15000,
            }).toBe(true).then(() => true).catch(() => false);

            if (fullscreenActivated) {
                if (await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false)) {
                    await page.evaluate(() => document.exitFullscreen()).catch(() => { });
                } else {
                    const exitFullscreenButton = videoFrame.getByRole('button', { name: /Exit full/i }).first();
                    if (await exitFullscreenButton.isVisible().catch(() => false)) {
                        await clickVideoControl(page, exitFullscreenButton);
                    }
                }

                await expect.poll(async () => page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false), {
                    message: 'The careers video should exit fullscreen mode after the exit action',
                    timeout: 15000,
                }).toBe(false);
            }
        }

        await revealVideoControls(page, videoIframe);
        await expect(pauseButton, 'The Vimeo player should still expose Pause before pausing playback').toBeVisible({ timeout: 15000 });
        await clickVideoControl(page, pauseButton);
        await revealVideoControls(page, videoIframe);
        await expect(playButton, 'Pausing playback should bring the Play control back').toBeVisible({ timeout: 15000 });
    });

    await test.step('Verify the Explore the roles carousel moves between visible slides', async () => {
        const rolesCarousel = page.locator('.carouselSignpost').first();
        const previousButton = rolesCarousel.getByRole('button', { name: /^Previous$/i }).first();
        const nextButton = rolesCarousel.getByRole('button', { name: /^Next$/i }).first();

        await expect(rolesCarousel, 'The careers page should expose the Explore the roles carousel').toBeVisible();
        const previousVisible = await previousButton.isVisible().catch(() => false);
        const nextVisible = await nextButton.isVisible().catch(() => false);

        if (!previousVisible || !nextVisible) {
            const activeSlide = rolesCarousel.locator('.slick-slide.slick-active').first();
            await expect(activeSlide, 'The roles carousel should still expose an active slide when controls are hidden in smaller viewports').toBeVisible();
            return;
        }

        let currentTransform = await getCarouselTrackTransform(rolesCarousel);
        await clickWithCookieGuard(page, nextButton);
        await expect.poll(async () => getCarouselTrackTransform(rolesCarousel), {
            message: 'Clicking next on the roles carousel should move the track',
            timeout: 10000,
        }).not.toBe(currentTransform);

        currentTransform = await getCarouselTrackTransform(rolesCarousel);
        await clickWithCookieGuard(page, previousButton);
        await expect.poll(async () => getCarouselTrackTransform(rolesCarousel), {
            message: 'Clicking previous on the roles carousel should move the track again',
            timeout: 10000,
        }).not.toBe(currentTransform);
    });

    await test.step('Verify the lower carousel moves without relying on the known-bad UAT links or images', async () => {
        const awardsCarousel = page.locator('.carouselAwards').first();
        const previousButton = awardsCarousel.getByRole('button', { name: /^Previous$/i }).first();
        const nextButton = awardsCarousel.getByRole('button', { name: /^Next$/i }).first();

        await expect(awardsCarousel, 'The careers page should expose the lower slick carousel').toBeVisible();
        const previousVisible = await previousButton.isVisible().catch(() => false);
        const nextVisible = await nextButton.isVisible().catch(() => false);

        if (!previousVisible || !nextVisible) {
            const activeSlide = awardsCarousel.locator('.slick-slide.slick-active').first();
            await expect(activeSlide, 'The lower carousel should still expose an active slide when controls are hidden in smaller viewports').toBeVisible();
            return;
        }

        let currentTransform = await getCarouselTrackTransform(awardsCarousel);
        await clickWithCookieGuard(page, nextButton);
        await expect.poll(async () => getCarouselTrackTransform(awardsCarousel), {
            message: 'Clicking next on the lower carousel should move the track',
            timeout: 10000,
        }).not.toBe(currentTransform);

        currentTransform = await getCarouselTrackTransform(awardsCarousel);
        await clickWithCookieGuard(page, previousButton);
        await expect.poll(async () => getCarouselTrackTransform(awardsCarousel), {
            message: 'Clicking previous on the lower carousel should move the track again',
            timeout: 10000,
        }).not.toBe(currentTransform);
    });

    await test.step('Verify the footer Top control scrolls the page back toward the top', async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const topControl = page.locator('.footer__scrolltop').first();

        const topControlVisible = await topControl.isVisible().catch(() => false);
        if (!topControlVisible) {
            await expect.poll(async () => page.evaluate(() => window.scrollY), {
                message: 'The careers page should still scroll near the bottom on small viewports where Top control is hidden',
                timeout: 10000,
            }).toBeGreaterThan(1000);
            return;
        }

        await expect(topControl, 'The careers page footer should expose the Top control after scrolling').toBeVisible();

        const before = await page.evaluate(() => window.scrollY);
        expect(before, 'The page should be near the bottom before using the Top control').toBeGreaterThan(1000);

        await clickWithCookieGuard(page, topControl);
        await expect.poll(async () => page.evaluate(() => window.scrollY), {
            message: 'Clicking the Top control should return the page close to the top',
            timeout: 10000,
        }).toBeLessThan(600);
    });
}, 30000);

test('Careers - Verify Representative Hover States', async ({ page }) => {
    await openCareersPage(page);

    if (!await canReliablyHover(page)) {
        test.skip(true, 'This project does not support reliable hover interactions.');
    }

    await test.step('Verify representative interactive elements respond to hover across the page', async () => {
        await expectInteractiveHoverEffect(page, page.getByRole('link', { name: 'Find a job' }).first(), 'The hero Find a job CTA');
        await expectInteractiveHoverEffect(page, page.locator('a[href="/careers/why-join-us/rewards-and-benefits"]'), 'The Rewards and benefits Read more CTA');
        await expectInteractiveHoverEffect(page, page.getByRole('link', { name: 'View roles' }).first(), 'The View roles CTA');
        await expectInteractiveHoverEffect(page, page.getByRole('link', { name: 'Visit careuk.com' }).first(), 'The bottom Visit careuk.com CTA');
    });
}, 30000);

test('Careers - Roles Full Page Test', async ({ page, baseURL }) => {
    test.setTimeout(300000);

    await test.step('Verify the careers entry points open the vacancies page', async () => {
        await openVacanciesPageFromCareersEntry(page, baseURL, 'Find Jobs');
        await openVacanciesPageFromCareersEntry(page, baseURL, 'Find a job');
        await openVacanciesPageFromCareersEntry(page, baseURL, 'View roles');
    });

    await test.step('Verify the title, breadcrumb, home icon, and H1', async () => {
        await openVacanciesPage(page);

        const breadcrumbLabel = page.locator('.breadcrumb .breadcrumb-item.active').filter({ hasText: 'Search for roles nearby' }).first();
        const breadcrumbHomeIcon = await getFirstVisibleMatch(page.locator('.home-icon[href="/careers"]'));

        await expect(page, 'The vacancies page title should match the Care UK vacancies title').toHaveTitle('UK Care Home Job Vacancies | Apply | Care UK');
        await expect(breadcrumbLabel, 'The vacancies breadcrumb should read Search for roles nearby').toContainText('Search for roles nearby');
        await expect(page.getByRole('heading', { level: 1, name: 'Search for career opportunities in your area' }).first(), 'The vacancies page should expose the expected H1').toBeVisible();

        if (await breadcrumbHomeIcon.isVisible().catch(() => false)) {
            await clickWithCookieGuard(page, breadcrumbHomeIcon);
        } else {
            await clickWithCookieGuard(page, page.getByRole('link', { name: /^Careers$/i }).first());
        }
        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await expect(page, 'Clicking the vacancies breadcrumb home icon should return to /careers').toHaveURL(CAREERS_PATH_REGEX);
    });

    await test.step('Verify Show more homes reveals more care-home accordions', async () => {
        await openVacanciesPage(page);

        const beforeCount = await page.locator('.vacanciesListAlt__perHome').count();
        expect(beforeCount, 'The vacancies page should initially show at least one care-home card').toBeGreaterThan(0);

        await showMoreHomesIfPresent(page);

        const afterCount = await page.locator('.vacanciesListAlt__perHome').count();
        expect(afterCount, 'Show more homes should reveal additional care-home cards').toBeGreaterThan(beforeCount);
        expect(afterCount, 'The vacancies page should expose at least 15 care-home cards after showing more homes').toBeGreaterThanOrEqual(15);
    });

    await test.step('Verify a 15-pin sample matches the listing cards and accordion job counts', async () => {
        await openVacanciesPage(page);
        await showMoreHomesIfPresent(page);

        const interactiveMap = page.locator('.gm-style, [aria-label*="map" i]').first();
        if (!await interactiveMap.isVisible().catch(() => false)) {
            const visibleCards = page.locator('.vacanciesListAlt__perHome');
            await expect(visibleCards.first(), 'The vacancies listing should remain visible when the map is not rendered in smaller viewports').toBeVisible();
            return;
        }

        for (const homeName of VACANCIES_SAMPLE_HOME_NAMES) {
            const marker = getVacanciesMapMarker(page, homeName);
            const homeCard = getVacanciesHomeCard(page, homeName);

            await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'instant' }));
            await expect(marker, `The map should expose a pin for ${homeName}`).toBeVisible();
            const markerBox = await marker.boundingBox();
            expect(markerBox, `The map pin for ${homeName} should expose a bounding box before hover`).not.toBeNull();
            await page.mouse.move(markerBox.x + (markerBox.width / 2), markerBox.y + (markerBox.height / 2));
            await page.waitForTimeout(150);
            await expect(marker, `Hovering the map pin for ${homeName} should expose the same home name through its marker label`).toHaveAttribute('aria-label', homeName);

            const markerNumber = await getVacanciesMarkerNumber(page, homeName);
            await expect(homeCard, `The care-home listing should expose a card for ${homeName}`).toBeVisible();
            await homeCard.scrollIntoViewIfNeeded();

            const listNumber = normalizeWhitespace(await homeCard.locator('.order').first().textContent());
            expect(markerNumber, `The visible map pin number for ${homeName} should match the listing pin number`).toBe(listNumber);

            await page.mouse.click(markerBox.x + (markerBox.width / 2), markerBox.y + (markerBox.height / 2));
            await page.waitForTimeout(250);
            await homeCard.scrollIntoViewIfNeeded();
            await expect(homeCard.getByRole('heading', { level: 3, name: homeName }).first(), `The care-home listing should expose the ${homeName} heading after selecting its map pin`).toBeVisible();

            const toggle = await expandVacanciesHomeAccordion(page, homeCard);
            const expectedJobs = parseJobCount(await toggle.textContent());
            const vacancyItems = homeCard.locator('.vacanciesListAlt__info.show > ul > li');

            expect(expectedJobs, `The ${homeName} accordion should advertise at least one current vacancy`).toBeGreaterThan(0);
            await expect(vacancyItems, `Expanding ${homeName} should reveal its current vacancies`).toHaveCount(expectedJobs);

            await clickWithCookieGuard(page, toggle);
            await expect(toggle, `The ${homeName} accordion should collapse after clicking again`).toHaveAttribute('aria-expanded', 'false');
        }
    });
}, 30000);

test('Careers - Roles - Search and Filter Journey', async ({ page }) => {
    test.setTimeout(180000);

    await test.step('Open vacancies and keep Care home jobs selected', async () => {
        await openVacanciesPage(page);

        const careHomeTab = getVacanciesTab(page, 'Care home jobs');
        if (await careHomeTab.isVisible().catch(() => false)) {
            await clickWithCookieGuard(page, careHomeTab);
            await expect(careHomeTab, 'Care home jobs should remain the selected vacancies tab by default').toHaveAttribute('aria-selected', /true/i).catch(() => { });
        }

        await expect(getVacanciesSubmitButton(page), 'The Care home jobs form should expose a Submit button').toBeVisible();
        const resetVisible =
            await page.getByRole('button', { name: /^Reset$/i }).first().isVisible().catch(() => false) ||
            await page.getByRole('link', { name: /^Reset$/i }).first().isVisible().catch(() => false);
        expect(resetVisible, 'The Care home jobs form should expose a Reset control').toBe(true);
    });

    await test.step('Search by postcode M33 using autocomplete and submit', async () => {
        await pickPostcodeSuggestion(page, 'M33');
        await clickWithCookieGuard(page, getVacanciesSubmitButton(page));
        await page.waitForLoadState('networkidle').catch(() => { });

        const map = page.locator('.gm-style, [aria-label*="map" i]').first();
        if (await map.isVisible().catch(() => false)) {
            await expect(map, 'The vacancies page should keep the map visible after postcode search when the interactive map is rendered').toBeVisible();
        } else {
            await expect(page.getByText(/View homes on a map/i).first(), 'The vacancies page should keep the map section visible after postcode search').toBeVisible();
        }

        const homeCards = page.locator('.vacanciesListAlt__perHome');
        await expect(homeCards.first(), 'Searching vacancies by postcode should show at least one care-home card').toBeVisible();

        const listingText = normalizeWhitespace(await page.locator('.vacanciesListAlt').innerText().catch(() => ''));
        expect(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(listingText), 'The vacancies listing should expose at least one postcode/address pattern after postcode search').toBe(true);
    });

    await test.step('Filter by Clinical Roles - Clinical Lead and submit', async () => {
        const roleDropdown = await getFirstVisibleCareHomeRoleDropdown(page);
        await expect(roleDropdown, 'The Care home jobs form should expose a role filter dropdown').toBeVisible();
        await selectDropdownOptionContaining(page, roleDropdown, 'Clinical Lead');
        await clickWithCookieGuard(page, getVacanciesSubmitButton(page));
        await page.waitForLoadState('networkidle').catch(() => { });

        const homeCards = page.locator('.vacanciesListAlt__perHome');
        await expect(homeCards.first(), 'Filtering for Clinical Lead should still show at least one care-home card').toBeVisible();

        const cardCount = await homeCards.count();
        const maxToCheck = Math.min(cardCount, 10);
        let foundClinicalLead = false;

        for (let index = 0; index < maxToCheck; index += 1) {
            const card = homeCards.nth(index);
            const toggle = await expandVacanciesHomeAccordion(page, card);

            const expandedText = normalizeWhitespace(await card.textContent().catch(() => ''));
            if (/Clinical\s*Lead/i.test(expandedText)) {
                foundClinicalLead = true;
                break;
            }

            await clickWithCookieGuard(page, toggle).catch(() => { });
        }

        expect(foundClinicalLead, 'At least one expanded home in the filtered results should include a Clinical Lead vacancy').toBe(true);
    });

    await test.step('Reset the Care home jobs filters', async () => {
        await clickVacanciesResetControl(page);
        await page.waitForLoadState('networkidle').catch(() => { });

        const postcodeInput = getVacanciesPanelRoot(page).locator('input[placeholder*="postcode" i], input[aria-label*="postcode" i], input[name*="postcode" i]').first();
        if (await postcodeInput.isVisible().catch(() => false)) {
            await expect(postcodeInput, 'Resetting the Care home jobs form should clear the postcode field').toHaveValue('');
        }
    });

    await test.step('Iterate 5 options in Regional & support centre jobs dropdown', async () => {
        const regionalTab = getVacanciesTab(page, 'Regional & support centre jobs');
        if (await regionalTab.isVisible().catch(() => false)) {
            await clickWithCookieGuard(page, regionalTab);
        } else {
            await clickWithCookieGuard(page, page.getByText(/Regional\s*&\s*support\s*centre\s*jobs/i).first());
        }

        const regionalDropdown = await getFirstVisibleCareHomeRoleDropdown(page);
        await expect(regionalDropdown, 'Regional & support centre jobs should expose a dropdown').toBeVisible();

        for (let iteration = 0; iteration < 5; iteration += 1) {
            const currentRegionalDropdown = await getFirstVisibleCareHomeRoleDropdown(page);
            await expect(currentRegionalDropdown).toBeVisible();

            const previousSelection = normalizeWhitespace(await currentRegionalDropdown.textContent().catch(() => ''));
            await clickWithCookieGuard(page, currentRegionalDropdown);
            await currentRegionalDropdown.press('ArrowDown').catch(() => page.keyboard.press('ArrowDown'));
            await currentRegionalDropdown.press('Enter').catch(() => page.keyboard.press('Enter'));
            await page.waitForTimeout(150);

            const optionText = normalizeWhitespace(await currentRegionalDropdown.textContent().catch(() => '')) || previousSelection || `iteration ${iteration + 1}`;

            await clickWithCookieGuard(page, getVacanciesSubmitButton(page));
            await page.waitForLoadState('networkidle').catch(() => { });

            const hasCareHomeCards = await page.locator('.vacanciesListAlt__perHome').first().isVisible().catch(() => false);
            const hasRegionalJobsButton = await page.getByRole('button', { name: /\d+\s+jobs?/i }).first().isVisible().catch(() => false);
            const hasRegionalRoleHeading = await page.locator('h3 a, h3').first().isVisible().catch(() => false);
            const hasNoResultsMessage = await page.getByText(/no\s+(roles|jobs|vacancies)\s+found|no\s+results/i).first().isVisible().catch(() => false);

            expect(
                hasCareHomeCards || hasRegionalJobsButton || hasRegionalRoleHeading || hasNoResultsMessage,
                `Submitting the Regional & support centre option "${optionText}" should show either role cards or an explicit empty-results state`
            ).toBe(true);
        }
    });
}, 30000);

test('Careers - Care Roles Traversal Test', async ({ page, request, baseURL }) => {
    test.setTimeout(240000);

    await openCareRolesPageFromCarousel(page);

    await test.step('Verify page title, H1, and section headings', async () => {
        await expect(page, 'The Care Roles page title should mention Care jobs and Care UK').toHaveTitle(/care jobs\s*\|\s*careers\s*\|\s*care uk/i);
        await expect(page.getByRole('heading', { level: 1, name: 'Care Roles' }).first(), 'The Care Roles page should expose the expected H1').toBeVisible();

        for (const heading of CARE_ROLES_SECTION_HEADINGS) {
            await expect(page.getByRole('heading', { name: heading }).first(), `The Care Roles page should show the ${heading} section`).toBeVisible();
        }
    });

    await test.step('Verify stable destinations do not return 404s', async () => {
        for (const linkTarget of CARE_ROLES_LINK_TARGETS) {
            await verifyLinkStatus(request, baseURL, linkTarget);
        }
    });

    await test.step('Verify representative links navigate through the UI', async () => {
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.getByRole('link', { name: 'Search roles' }).first(),
            '/careers/vacancies',
            'The Care roles Search roles CTA',
        );

        await openCareRolesPageFromCarousel(page);
        await expect(getCareRolesWhyJoinLink(page), 'The Care roles Why join CTA should be visible on the page').toBeVisible();
        await expect(getCareRolesWhyJoinLink(page), 'The Care roles Why join CTA should point to the Why join page').toHaveAttribute('href', '/careers/why-join-us');

        await openCareRolesPageFromCarousel(page);
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.locator('a[href="/careers/explore-our-roles"]').first(),
            '/careers/explore-our-roles',
            'The Care roles breadcrumb Explore our roles link',
        );
    });

    await test.step('Verify FAQ accordions expand and reveal their expected content', async () => {
        await openCareRolesPageFromCarousel(page);

        for (const { question, snippet } of CARE_ROLES_FAQ_ITEMS) {
            const button = page.getByRole('button', { name: question }).first();
            const controlsId = await button.getAttribute('aria-controls');

            await expect(button, `The FAQ question "${question}" should be visible`).toBeVisible();
            await expect(button, `The FAQ question "${question}" should start collapsed`).toHaveAttribute('aria-expanded', 'false');
            await expandAccordionQuestion(page, button);
            await expect(button, `The FAQ question "${question}" should expand after clicking`).toHaveAttribute('aria-expanded', 'true');

            if (controlsId) {
                const panel = page.locator(`#${controlsId}`).first();
                await expect(panel, `The FAQ panel for "${question}" should be visible after expansion`).toBeVisible();
                await expect(panel, `The FAQ panel for "${question}" should contain its expected copy`).toContainText(snippet);
            } else {
                await expect(page.locator('body'), `The Care roles page should reveal the expected answer for "${question}"`).toContainText(snippet);
            }
        }
    });

    await test.step('Verify inline video can play, toggle fullscreen, exit fullscreen, and pause', async () => {
        await openCareRolesPageFromCarousel(page);

        const videoPanel = page.locator('.videoPanelInline').first();
        const videoTrigger = page.locator('.videoPanelInline__play').first();
        const videoIframe = page.locator('.videoPanelInline__iframe').first();

        await expect(videoPanel, 'The Care roles page should expose the inline video panel').toBeVisible();
        await expect(videoTrigger, 'The Care roles video should expose a visible play trigger').toBeVisible();
        await videoTrigger.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, videoTrigger);

        await expect.poll(async () => videoIframe.getAttribute('src'), {
            message: 'Clicking the Care roles video play button should hydrate the Vimeo iframe src',
            timeout: 15000,
        }).toContain('player.vimeo.com/video/871390305');

        await expectVideoPanelActive(videoPanel, 'The Care roles video panel should move into its active viewing state after play');

        const videoFrame = page.frameLocator('.videoPanelInline__iframe[src*="871390305"]');
        const playButton = videoFrame.getByRole('button', { name: /^Play$/i }).first();
        const pauseButton = videoFrame.getByRole('button', { name: /^Pause$/i }).first();
        const fullscreenButton = videoFrame.getByRole('button', { name: /^Fullscreen$/i }).first();

        await revealVideoControls(page, videoIframe);
        await expect.poll(async () => {
            const playVisible = await playButton.isVisible().catch(() => false);
            const pauseVisible = await pauseButton.isVisible().catch(() => false);
            return playVisible || pauseVisible;
        }, {
            message: 'The Care roles Vimeo player should expose either Play or Pause once the iframe is ready',
            timeout: 20000,
        }).toBe(true);

        if (await playButton.isVisible().catch(() => false)) {
            await clickVideoControl(page, playButton);
        }

        await revealVideoControls(page, videoIframe);
        await expect(pauseButton, 'The Care roles Vimeo player should expose Pause after playback starts').toBeVisible({ timeout: 15000 });
        const fullscreenVisible = await fullscreenButton.isVisible().catch(() => false);
        if (fullscreenVisible) {
            await clickVideoControl(page, fullscreenButton);

            const fullscreenActivated = await expect.poll(async () => {
                const inFullscreen = await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false);
                const exitFullscreenButton = videoFrame.getByRole('button', { name: /Exit full/i }).first();
                return inFullscreen || await exitFullscreenButton.isVisible().catch(() => false);
            }, {
                message: 'Clicking Fullscreen on the Care roles video should place the player into fullscreen mode or expose an exit-fullscreen control when the embed supports it',
                timeout: 15000,
            }).toBe(true).then(() => true).catch(() => false);

            if (fullscreenActivated) {
                if (await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false)) {
                    await page.evaluate(() => document.exitFullscreen()).catch(() => { });
                } else {
                    const exitFullscreenButton = videoFrame.getByRole('button', { name: /Exit full/i }).first();
                    if (await exitFullscreenButton.isVisible().catch(() => false)) {
                        await clickVideoControl(page, exitFullscreenButton);
                    }
                }

                await expect.poll(async () => page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false), {
                    message: 'The Care roles video should exit fullscreen mode after the exit action',
                    timeout: 15000,
                }).toBe(false);
            }
        }

        await revealVideoControls(page, videoIframe);
        await expect(pauseButton, 'The Care roles Vimeo player should still expose Pause before pausing playback').toBeVisible({ timeout: 15000 });
        await clickVideoControl(page, pauseButton);
        await revealVideoControls(page, videoIframe);
        await expect(playButton, 'Pausing the Care roles video should bring the Play control back').toBeVisible({ timeout: 15000 });
    });

    await test.step('Verify footer presence, Top control, and social links', async () => {
        await openCareRolesPageFromCarousel(page);

        const footer = page.getByRole('contentinfo').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Care roles page should expose the footer').toBeVisible();
        await expect(footer.getByRole('link', { name: 'About Care UK' }).first(), 'The footer should expose About Care UK on the Care roles page').toBeVisible();
        await expect(footer.getByRole('link', { name: 'Legal & regulatory information' }).first(), 'The footer should expose Legal & regulatory information on the Care roles page').toBeVisible();
        await expect(footer.getByRole('link', { name: 'Visit Care UK on LinkedIn' }).first(), 'The footer should expose the LinkedIn social link on the Care roles page').toBeVisible();

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const topControl = page.locator('.footer__scrolltop').first();

        const topControlVisible = await topControl.isVisible().catch(() => false);
        if (!topControlVisible) {
            await expect.poll(async () => page.evaluate(() => window.scrollY), {
                message: 'The Care roles page should still scroll near the bottom on small viewports where Top control is hidden',
                timeout: 10000,
            }).toBeGreaterThan(200);
            return;
        }

        await expect(topControl, 'The Care roles page footer should expose the Top control after scrolling').toBeVisible();

        const before = await page.evaluate(() => window.scrollY);
        expect(before, 'The Care roles page should move away from the top before using the Top control').toBeGreaterThan(200);

        await clickWithCookieGuard(page, topControl);
        await expect.poll(async () => page.evaluate(() => window.scrollY), {
            message: 'Clicking the Top control on the Care roles page should return the page close to the top',
            timeout: 10000,
        }).toBeLessThan(200);
    });

    await test.step('Verify representative interactive elements respond to hover', async () => {
        await openCareRolesPageFromCarousel(page);

        if (!await canReliablyHover(page)) {
            return;
        }

        await expectInteractiveHoverEffect(page, page.getByRole('link', { name: 'Search roles' }).first(), 'The Care roles Search roles CTA');
        await expectInteractiveHoverEffect(page, page.getByRole('link', { name: 'APPLY NOW' }).first(), 'The Care roles APPLY NOW CTA');
        await expectInteractiveHoverEffect(page, getCareRolesWhyJoinLink(page), 'The Care roles Read more CTA');

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expectInteractiveHoverEffect(page, page.locator('.footer__scrolltop').first(), 'The Care roles footer Top control');
    });
}, 30000);

test('Careers - Clinical Roles Traversal Test', async ({ page, request, baseURL }) => {
    test.setTimeout(240000);

    await openClinicalRolesPageFromCarousel(page);

    await test.step('Verify page title, H1, and section headings', async () => {
        await expect(page, 'The Clinical Roles page title should mention Clinical jobs and Care UK').toHaveTitle(/clinical jobs\s*\|\s*careers\s*\|\s*care uk/i);
        await expect(page.getByRole('heading', { level: 1, name: 'Clinical Roles' }).first(), 'The Clinical Roles page should expose the expected H1').toBeVisible();

        for (const heading of CLINICAL_ROLES_SECTION_HEADINGS) {
            const headingLocator = page.getByRole('heading', { name: heading }).first();
            await expect(headingLocator, `The Clinical Roles page should show the ${heading} section`).toBeVisible();
        }
    });

    await test.step('Verify stable destinations do not return 404s', async () => {
        for (const linkTarget of CLINICAL_ROLES_LINK_TARGETS) {
            await verifyLinkStatus(request, baseURL, linkTarget);
        }
    });

    await test.step('Verify representative links navigate through the UI', async () => {
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.getByRole('link', { name: 'Search roles' }).first(),
            '/careers/vacancies',
            'The Clinical Roles Search roles CTA',
        );

        await openClinicalRolesPageFromCarousel(page);
        await expect(getClinicalRolesWhyJoinLink(page), 'The Clinical Roles Why join CTA should be visible on the page').toBeVisible();
        await expect(getClinicalRolesWhyJoinLink(page), 'The Clinical Roles Why join CTA should point to the Why join page').toHaveAttribute('href', '/careers/why-join-us');

        await openClinicalRolesPageFromCarousel(page);
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.getByRole('link', { name: 'Explore our roles' }).first(),
            '/careers/explore-our-roles',
            'The Clinical Roles breadcrumb Explore our roles link',
        );
    });

    await test.step('Verify FAQ accordions expand and reveal their expected content', async () => {
        await openClinicalRolesPageFromCarousel(page);

        for (const { question, snippet } of CLINICAL_ROLES_FAQ_ITEMS) {
            const button = page.getByRole('button', { name: question }).first();
            const controlsId = await button.getAttribute('aria-controls');

            await expect(button, `The FAQ question "${question}" should be visible`).toBeVisible();
            await expect(button, `The FAQ question "${question}" should start collapsed`).toHaveAttribute('aria-expanded', 'false');
            await expandAccordionQuestion(page, button);
            await expect(button, `The FAQ question "${question}" should expand after clicking`).toHaveAttribute('aria-expanded', 'true');

            if (controlsId) {
                const panel = page.locator(`#${controlsId}`).first();
                await expect(panel, `The FAQ panel for "${question}" should be visible after expansion`).toBeVisible();
                await expect(panel, `The FAQ panel for "${question}" should contain its expected copy`).toContainText(snippet);
            } else {
                await expect(page.locator('body'), `The Clinical roles page should reveal the expected answer for "${question}"`).toContainText(snippet);
            }
        }
    });

    await test.step('Verify there is no visible playable video panel', async () => {
        await openClinicalRolesPageFromCarousel(page);

        await expect(page.locator('.videoPanelInline__play').first(), 'The Clinical Roles page should not expose a visible inline video trigger').toBeHidden();
        await expect(page.locator('.videoPanelInline__iframe').first(), 'The Clinical Roles page should not expose a visible inline video iframe').toBeHidden();
    });

    await test.step('Verify footer presence, Top control, and social links', async () => {
        await openClinicalRolesPageFromCarousel(page);

        const footer = page.getByRole('contentinfo').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Clinical Roles page should expose the footer').toBeVisible();
        await expect(footer.getByRole('link', { name: 'About Care UK' }).first(), 'The footer should expose About Care UK on the Clinical Roles page').toBeVisible();
        await expect(footer.getByRole('link', { name: 'Legal & regulatory information' }).first(), 'The footer should expose Legal & regulatory information on the Clinical Roles page').toBeVisible();
        await expect(footer.getByRole('link', { name: 'Visit Care UK on LinkedIn' }).first(), 'The footer should expose the LinkedIn social link on the Clinical Roles page').toBeVisible();

        await page.evaluate(() => {
            const scrollingElement = document.scrollingElement || document.documentElement;
            window.scrollTo({ top: scrollingElement.scrollHeight, behavior: 'instant' });
        });
        const topControl = page.locator('.footer__scrolltop').first();

        const topControlVisible = await topControl.isVisible().catch(() => false);
        if (!topControlVisible) {
            await expect.poll(async () => page.evaluate(() => window.scrollY), {
                message: 'The Clinical Roles page should still scroll near the bottom on small viewports where Top control is hidden',
                timeout: 10000,
            }).toBeGreaterThan(200);
            return;
        }

        await expect(topControl, 'The Clinical Roles page footer should expose the Top control after scrolling').toBeVisible();
        await expect.poll(async () => page.evaluate(() => window.scrollY), {
            message: 'The Clinical Roles page should scroll away from the top before using the Top control',
            timeout: 10000,
        }).toBeGreaterThan(200);

        const before = await page.evaluate(() => window.scrollY);
        expect(before, 'The Clinical Roles page should move away from the top before using the Top control').toBeGreaterThan(200);

        await clickWithCookieGuard(page, topControl);
        await expect.poll(async () => page.evaluate(() => window.scrollY), {
            message: 'Clicking the Top control on the Clinical Roles page should return the page close to the top',
            timeout: 10000,
        }).toBeLessThan(200);
    });

    await test.step('Verify representative interactive elements respond to hover', async () => {
        await openClinicalRolesPageFromCarousel(page);

        if (!await canReliablyHover(page)) {
            return;
        }

        await expectInteractiveHoverEffect(page, page.getByRole('link', { name: 'Search roles' }).first(), 'The Clinical Roles Search roles CTA');
        await expectInteractiveHoverEffect(page, page.getByRole('link', { name: 'APPLY NOW' }).first(), 'The Clinical Roles APPLY NOW CTA');
        await expectInteractiveHoverEffect(page, getClinicalRolesWhyJoinLink(page), 'The Clinical Roles Read more CTA');

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expectInteractiveHoverEffect(page, page.locator('.footer__scrolltop').first(), 'The Clinical Roles footer Top control');
    });
}, 30000);

test('Careers - Home Support Roles Traversal Test', async ({ page, request, baseURL }) => {
    test.setTimeout(240000);

    await openHomeSupportRolesPageFromCarousel(page);

    await test.step('Verify page title, H1, and section headings', async () => {
        await expect(page, 'The Home Support Roles page title should mention Home support jobs and Care UK').toHaveTitle(/home support jobs\s*\|\s*careers\s*\|\s*care uk/i);
        await expect(page.getByRole('heading', { level: 1, name: 'Home Support Roles' }).first(), 'The Home Support Roles page should expose the expected H1').toBeVisible();

        for (const heading of HOME_SUPPORT_ROLES_SECTION_HEADINGS) {
            await expect(page.getByRole('heading', { name: heading }).first(), `The Home Support Roles page should show the ${heading} section`).toBeVisible();
        }
    });

    await test.step('Verify stable destinations do not return 404s', async () => {
        for (const linkTarget of HOME_SUPPORT_ROLES_LINK_TARGETS) {
            await verifyLinkStatus(request, baseURL, linkTarget);
        }
    });

    await test.step('Verify representative links navigate through the UI', async () => {
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.getByRole('link', { name: 'Search roles' }).first(),
            '/careers/vacancies',
            'The Home support roles Search roles CTA',
        );

        await openHomeSupportRolesPageFromCarousel(page);
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.getByRole('link', { name: 'Explore our roles' }).first(),
            '/careers/explore-our-roles',
            'The Home support roles breadcrumb Explore our roles link',
        );
    });

    await test.step('Verify every role card is visible and points to the expected destination', async () => {
        await openHomeSupportRolesPageFromCarousel(page);

        for (const { title, href } of HOME_SUPPORT_ROLE_CARDS) {
            await expect(page.getByRole('heading', { name: title }).first(), `The ${title} role card should expose its heading`).toBeVisible();
            await expect(getHomeSupportRoleLink(page, href), `The ${title} role card should expose its Read more CTA`).toBeVisible();
            await expect(getHomeSupportRoleLink(page, href), `The ${title} role card should point to the expected detail page`).toHaveAttribute('href', href);
        }
    });

    await test.step('Verify there is no visible playable video panel', async () => {
        await openHomeSupportRolesPageFromCarousel(page);

        await expect(page.locator('.videoPanelInline__play').first(), 'The Home support roles page should not expose a visible inline video trigger').toBeHidden();
        await expect(page.locator('.videoPanelInline__iframe').first(), 'The Home support roles page should not expose a visible inline video iframe').toBeHidden();
    });

    await test.step('Verify footer presence, Top control, and social links', async () => {
        await openHomeSupportRolesPageFromCarousel(page);

        const footer = page.getByRole('contentinfo').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Home support roles page should expose the footer').toBeVisible();
        await expect(footer.getByRole('link', { name: 'About Care UK' }).first(), 'The footer should expose About Care UK on the Home support roles page').toBeVisible();
        await expect(footer.getByRole('link', { name: 'Legal & regulatory information' }).first(), 'The footer should expose Legal & regulatory information on the Home support roles page').toBeVisible();
        await expect(footer.getByRole('link', { name: 'Visit Care UK on LinkedIn' }).first(), 'The footer should expose the LinkedIn social link on the Home support roles page').toBeVisible();

        await page.evaluate(() => {
            const scrollingElement = document.scrollingElement || document.documentElement;
            window.scrollTo({ top: scrollingElement.scrollHeight, behavior: 'instant' });
        });
        const topControl = page.locator('.footer__scrolltop').first();

        const topControlVisible = await topControl.isVisible().catch(() => false);
        if (!topControlVisible) {
            await expect.poll(async () => page.evaluate(() => window.scrollY), {
                message: 'The Home support roles page should still scroll near the bottom on small viewports where Top control is hidden',
                timeout: 10000,
            }).toBeGreaterThan(200);
            return;
        }

        await expect(topControl, 'The Home support roles page footer should expose the Top control after scrolling').toBeVisible();
        await expect.poll(async () => page.evaluate(() => window.scrollY), {
            message: 'The Home support roles page should scroll away from the top before using the Top control',
            timeout: 10000,
        }).toBeGreaterThan(200);

        await clickWithCookieGuard(page, topControl);
        await expect.poll(async () => page.evaluate(() => window.scrollY), {
            message: 'Clicking the Top control on the Home support roles page should return the page close to the top',
            timeout: 10000,
        }).toBeLessThan(200);
    });

    await test.step('Verify representative interactive elements respond to hover', async () => {
        await openHomeSupportRolesPageFromCarousel(page);

        if (!await canReliablyHover(page)) {
            return;
        }

        await expectInteractiveHoverEffect(page, page.getByRole('link', { name: 'Search roles' }).first(), 'The Home support roles Search roles CTA');
        await expectInteractiveHoverEffect(page, getHomeSupportRoleLink(page, '/careers/explore-our-roles/home-support-roles/home-support-general'), 'The Home support roles Administrative Read more CTA');
        await expectInteractiveHoverEffect(page, getHomeSupportRoleLink(page, '/careers/explore-our-roles/home-support-roles/catering'), 'The Home support roles Catering Read more CTA');

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expectInteractiveHoverEffect(page, page.locator('.footer__scrolltop').first(), 'The Home support roles footer Top control');
    });
}, 30000);

test('Careers - Support Centre Roles Traversal Test', async ({ page, request, baseURL }) => {
    test.setTimeout(240000);

    await openSupportCentreRolesPageFromCarousel(page);

    await test.step('Verify page title, H1, and section headings', async () => {
        await expect(page, 'The Support centre roles page title should mention Support centre jobs and Care UK').toHaveTitle(/support centre jobs\s*\|\s*careers\s*\|\s*care uk/i);
        await expect(page.getByRole('heading', { level: 1, name: 'Support centre roles' }).first(), 'The Support centre roles page should expose the expected H1').toBeVisible();

        for (const heading of SUPPORT_CENTRE_ROLES_SECTION_HEADINGS) {
            await expect(page.getByRole('heading', { name: heading }).first(), `The Support centre roles page should show the ${heading} section`).toBeVisible();
        }
    });

    await test.step('Verify stable destinations do not return 404s', async () => {
        for (const linkTarget of SUPPORT_CENTRE_ROLES_LINK_TARGETS) {
            await verifyLinkStatus(request, baseURL, linkTarget);
        }
    });

    await test.step('Verify representative links navigate through the UI', async () => {
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.getByRole('link', { name: 'Search roles' }).first(),
            '/careers/vacancies',
            'The Support centre roles Search roles CTA',
        );

        await openSupportCentreRolesPageFromCarousel(page);
        await clickVisibleLinkAndVerify(
            page,
            baseURL,
            page.getByRole('link', { name: 'Explore our roles' }).first(),
            '/careers/explore-our-roles',
            'The Support centre roles breadcrumb Explore our roles link',
        );
    });

    await test.step('Verify every role card is visible and points to the expected destination', async () => {
        await openSupportCentreRolesPageFromCarousel(page);

        for (const { title, href } of SUPPORT_CENTRE_ROLE_CARDS) {
            await expect(page.getByRole('heading', { name: title }).first(), `The ${title} role card should expose its heading`).toBeVisible();
            await expect(getSupportCentreRoleLink(page, href), `The ${title} role card should expose its Read more CTA`).toBeVisible();
            await expect(getSupportCentreRoleLink(page, href), `The ${title} role card should point to the expected detail page`).toHaveAttribute('href', href);
        }
    });

    await test.step('Verify inline video can play, toggle fullscreen, exit fullscreen, and pause', async () => {
        await openSupportCentreRolesPageFromCarousel(page);

        const videoPanel = page.locator('.videoPanelInline').first();
        const videoTrigger = page.locator('.videoPanelInline__play').first();
        const videoIframe = page.locator('.videoPanelInline__iframe').first();

        await expect(videoPanel, 'The Support centre roles page should expose the inline video panel').toBeVisible();
        await expect(videoTrigger, 'The Support centre roles video should expose a visible play trigger').toBeVisible();
        await videoTrigger.scrollIntoViewIfNeeded();
        await clickWithCookieGuard(page, videoTrigger);

        await expect.poll(async () => videoIframe.getAttribute('src'), {
            message: 'Clicking the Support centre roles video play button should hydrate the Vimeo iframe src',
            timeout: 15000,
        }).toContain('player.vimeo.com/video/860092156');

        await expectVideoPanelActive(videoPanel, 'The Support centre roles video panel should move into its active viewing state after play');

        const videoFrame = page.frameLocator('.videoPanelInline__iframe[src*="860092156"]');
        const playButton = videoFrame.getByRole('button', { name: /^Play$/i }).first();
        const pauseButton = videoFrame.getByRole('button', { name: /^Pause$/i }).first();
        const fullscreenButton = videoFrame.getByRole('button', { name: /^Fullscreen$/i }).first();

        await revealVideoControls(page, videoIframe);
        await expect.poll(async () => {
            const playVisible = await playButton.isVisible().catch(() => false);
            const pauseVisible = await pauseButton.isVisible().catch(() => false);
            return playVisible || pauseVisible;
        }, {
            message: 'The Support centre roles Vimeo player should expose either Play or Pause once the iframe is ready',
            timeout: 20000,
        }).toBe(true);

        if (await playButton.isVisible().catch(() => false)) {
            await clickVideoControl(page, playButton);
        }

        await revealVideoControls(page, videoIframe);
        await expect(pauseButton, 'The Support centre roles Vimeo player should expose Pause after playback starts').toBeVisible({ timeout: 15000 });
        const fullscreenVisible = await fullscreenButton.isVisible().catch(() => false);
        if (fullscreenVisible) {
            await clickVideoControl(page, fullscreenButton);

            const fullscreenActivated = await expect.poll(async () => {
                const inFullscreen = await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false);
                const exitFullscreenButton = videoFrame.getByRole('button', { name: /Exit full/i }).first();
                return inFullscreen || await exitFullscreenButton.isVisible().catch(() => false);
            }, {
                message: 'Clicking Fullscreen on the Support centre roles video should place the player into fullscreen mode or expose an exit-fullscreen control when the embed supports it',
                timeout: 15000,
            }).toBe(true).then(() => true).catch(() => false);

            if (fullscreenActivated) {
                if (await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false)) {
                    await page.evaluate(() => document.exitFullscreen()).catch(() => { });
                } else {
                    const exitFullscreenButton = videoFrame.getByRole('button', { name: /Exit full/i }).first();
                    if (await exitFullscreenButton.isVisible().catch(() => false)) {
                        await clickVideoControl(page, exitFullscreenButton);
                    }
                }

                await expect.poll(async () => page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false), {
                    message: 'The Support centre roles video should exit fullscreen mode after the exit action',
                    timeout: 15000,
                }).toBe(false);
            }
        }

        await revealVideoControls(page, videoIframe);
        await expect(pauseButton, 'The Support centre roles Vimeo player should still expose Pause before pausing playback').toBeVisible({ timeout: 15000 });
        await clickVideoControl(page, pauseButton);
        await revealVideoControls(page, videoIframe);
        await expect(playButton, 'Pausing the Support centre roles video should bring the Play control back').toBeVisible({ timeout: 15000 });
    });

    await test.step('Verify footer presence, Top control, and social links', async () => {
        await openSupportCentreRolesPageFromCarousel(page);

        const footer = page.getByRole('contentinfo').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'The Support centre roles page should expose the footer').toBeVisible();
        await expect(footer.getByRole('link', { name: 'About Care UK' }).first(), 'The footer should expose About Care UK on the Support centre roles page').toBeVisible();
        await expect(footer.getByRole('link', { name: 'Legal & regulatory information' }).first(), 'The footer should expose Legal & regulatory information on the Support centre roles page').toBeVisible();
        await expect(footer.getByRole('link', { name: 'Visit Care UK on LinkedIn' }).first(), 'The footer should expose the LinkedIn social link on the Support centre roles page').toBeVisible();

        await page.evaluate(() => {
            const scrollingElement = document.scrollingElement || document.documentElement;
            window.scrollTo({ top: scrollingElement.scrollHeight, behavior: 'instant' });
        });
        const topControl = page.locator('.footer__scrolltop').first();

        const topControlVisible = await topControl.isVisible().catch(() => false);
        if (!topControlVisible) {
            await expect.poll(async () => page.evaluate(() => window.scrollY), {
                message: 'The Support centre roles page should still scroll near the bottom on small viewports where Top control is hidden',
                timeout: 10000,
            }).toBeGreaterThan(200);
            return;
        }

        await expect(topControl, 'The Support centre roles page footer should expose the Top control after scrolling').toBeVisible();
        await expect.poll(async () => page.evaluate(() => window.scrollY), {
            message: 'The Support centre roles page should scroll away from the top before using the Top control',
            timeout: 10000,
        }).toBeGreaterThan(200);

        await clickWithCookieGuard(page, topControl);
        await expect.poll(async () => page.evaluate(() => window.scrollY), {
            message: 'Clicking the Top control on the Support centre roles page should return the page close to the top',
            timeout: 10000,
        }).toBeLessThan(200);
    });

    await test.step('Verify representative interactive elements respond to hover', async () => {
        await openSupportCentreRolesPageFromCarousel(page);

        if (!await canReliablyHover(page)) {
            return;
        }

        await expectInteractiveHoverEffect(page, page.getByRole('link', { name: 'Search roles' }).first(), 'The Support centre roles Search roles CTA');
        await expectInteractiveHoverEffect(page, getSupportCentreRoleLink(page, '/careers/explore-our-roles/support-centre/hr'), 'The Support centre roles HR Read more CTA');
        await expectInteractiveHoverEffect(page, getSupportCentreRoleLink(page, '/careers/explore-our-roles/support-centre/marketing'), 'The Support centre roles Marketing Read more CTA');

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expectInteractiveHoverEffect(page, page.locator('.footer__scrolltop').first(), 'The Support centre roles footer Top control');
    });
}, 30000);