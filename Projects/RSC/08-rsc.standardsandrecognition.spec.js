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
// Coverage notes - Standards and recognition section (top nav "Standards and recognition")
// ============================================================================
// Scope: every page under the "Standards and recognition" mega-nav branch,
// discovered via direct DOM probing of the real meganav on both QA and Live
// (not guessed) - 8 top-level items, 3 with children (Professional awards,
// Prizes, Accreditation), one 3 levels deep in places. 28 unique pages total.
//
// Tests in this file:
//   1-28. Standards and Recognition - <Page> Traversal (one per STANDARDS_PAGES entry)
//      Title/H1/breadcrumb/footer/card-count - the standard page-chrome check
//      used across every project's menu-item specs.
//   29. Standards and Recognition - Accordion Functionality
//      Expands/collapses a sample of the Bootstrap-style accordion on
//      /standards-and-recognition/prizes/nomination-guidance-and-faqs
//      (31 real accordion items - the richest accordion page found in this
//      section, confirmed identically present on both QA and Live).
//
// No video test in this file - confirmed via a full scan of every page in
// this section that none of them embed a YouTube (or other) video.
//
// STRUCTURAL DRIFT confirmed 2026-07-21 (unlike every prior spec in this
// project, this section's H1 text is IDENTICAL on all 24 shared pages across
// both environments - zero content-drift regexes needed here): the
// "Accreditation" branch structurally diverges between environments, not
// just in wording:
//   - Live has "Accreditation of staff development scheme" (+ 2 children:
//     "Resources for accredited employers", "Case studies") and "Approved
//     training courses" - all 4 confirmed as genuine 404s on QA (not simply
//     unlinked - the URLs themselves don't resolve there).
//   - QA instead has an entirely different branch at a different URL,
//     "Company training accreditation" (+ several individual company
//     case-study pages: AstraZeneca, Domino Printing Sciences, Environment
//     Agency, National Nuclear Laboratory), and an extra "Media pack" page
//     under Degree accreditation, and a nested "Latest winners" page under
//     Prizes > Winners - none of which exist in Live's current menu, so none
//     of these QA-only extras are covered by this file (per the project's
//     "build to current Live content" convention) - they're pre-content-sync
//     artifacts expected to disappear once QA's structure catches up to
//     Live's.
// The 4 Live-only pages are gated per-test via a real `page.goto()` +
// `response.status() === 404` check (same technique as
// 06-rsc.publishing.spec.js's 3 Live-only pages), not a menu-visibility
// check, since they're identified by known URL rather than reached by
// clicking through a menu path.
//
// /standards-and-recognition/accreditation/degree-accreditation/find-accredited-courses
// is a large searchable course directory (500+ `.card` result cards, 3
// select2-hidden native `<select>` filters: Course Type/Organisation
// Country/Organisation) - confirmed via direct probe, but deep filter-
// interaction coverage was judged out of scope for this pass given its
// narrow, single-page nature; it gets the same standard page-chrome/footer/
// card-count check as every other page in this file, nothing more.
// ============================================================================

async function waitForAndAcceptCookieBanner(page) {
    const acceptButton = page.locator('#onetrust-accept-btn-handler').first();
    const bannerAppeared = await acceptButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (bannerAppeared) {
        await acceptButton.click({ timeout: 3000 }).catch(() => { });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    }
}

async function openPage(page, path) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => { });
    await waitForAndAcceptCookieBanner(page);
    return response;
}

async function expectPageChrome(page, { h1, breadcrumbParent }) {
    const pageHeading = page.locator('h1').first();
    await expect(pageHeading, `Page should show the "${h1}" H1`).toHaveText(h1);

    const breadcrumbNav = page.locator('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]').first();
    await expect(breadcrumbNav, 'Page should expose a breadcrumb trail').toBeVisible();

    if (breadcrumbParent) {
        await expect(breadcrumbNav, `Breadcrumb should include "${breadcrumbParent}" as a previous level`).toContainText(breadcrumbParent);
    }
}

async function verifyFooterVisible(page) {
    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer, 'Page should expose a visible footer at the bottom').toBeVisible();
}

// ============================================================================
// Traversal - every page in the Standards and recognition mega-nav branch
// ============================================================================
const STANDARDS_PAGES = [
    { testName: "Standards and Recognition - Supporting Standards and Excellence Traversal", href: "/standards-and-recognition", h1: "Setting standards, celebrating excellence", breadcrumbParent: null },
    { testName: "Standards and Recognition - Professional Awards Traversal", href: "/standards-and-recognition/professional-awards", h1: "Professional awards", breadcrumbParent: null },
    { testName: "Standards and Recognition - Registered Science Technician Traversal", href: "/standards-and-recognition/professional-awards/registered-science-technician", h1: "Registered Science Technician (RSciTech)", breadcrumbParent: "Professional awards" },
    { testName: "Standards and Recognition - Registered Scientist Traversal", href: "/standards-and-recognition/professional-awards/registered-scientist", h1: "Registered Scientist (RSci)", breadcrumbParent: "Professional awards" },
    { testName: "Standards and Recognition - Chartered Chemist Traversal", href: "/standards-and-recognition/professional-awards/chartered-chemist", h1: "Chartered Chemist (CChem)", breadcrumbParent: "Professional awards" },
    { testName: "Standards and Recognition - Chartered Scientist Traversal", href: "/standards-and-recognition/professional-awards/chartered-scientist", h1: "Chartered Scientist (CSci)", breadcrumbParent: "Professional awards" },
    { testName: "Standards and Recognition - Chartered Environmentalist Traversal", href: "/standards-and-recognition/professional-awards/chartered-environmentalist", h1: "Chartered Environmentalist (CEnv)", breadcrumbParent: "Professional awards" },
    { testName: "Standards and Recognition - Chartered Environmentalist Profile Traversal", href: "/standards-and-recognition/professional-awards/chartered-environmentalist/profile-bart-kolodziejczyk", h1: "Chartered Environmentalist profile: Bart Kolodziejczyk", breadcrumbParent: "Chartered Environmentalist (CEnv)" },
    { testName: "Standards and Recognition - QP Pharmaceutical Traversal", href: "/standards-and-recognition/professional-awards/qp-pharmaceutical", h1: "Qualified Person in the Pharmaceutical Industry (QP)", breadcrumbParent: "Professional awards" },
    { testName: "Standards and Recognition - Mastership in Chemical Analysis Traversal", href: "/standards-and-recognition/professional-awards/mastership-in-chemical-analysis", h1: "Mastership in Chemical Analysis (MChemA)", breadcrumbParent: "Professional awards" },
    { testName: "Standards and Recognition - Specialist in Land Condition Traversal", href: "/standards-and-recognition/professional-awards/specialist-in-land-condition", h1: "Specialist in Land Condition (SiLC)", breadcrumbParent: "Professional awards" },
    { testName: "Standards and Recognition - Chartered Manager Traversal", href: "/standards-and-recognition/professional-awards/chartered-manager", h1: "Chartered Manager (CMgr)", breadcrumbParent: "Professional awards" },
    { testName: "Standards and Recognition - Prizes Traversal", href: "/standards-and-recognition/prizes", h1: "Prizes", breadcrumbParent: null },
    { testName: "Standards and Recognition - Nomination Guidance and FAQs Traversal", href: "/standards-and-recognition/prizes/nomination-guidance-and-faqs", h1: "Nomination guidance and FAQs", breadcrumbParent: "Prizes" },
    { testName: "Standards and Recognition - Winners Traversal", href: "/standards-and-recognition/prizes/winners", h1: "Prize winners", breadcrumbParent: "Prizes" },
    { testName: "Standards and Recognition - Accreditation Traversal", href: "/standards-and-recognition/accreditation", h1: "Get accredited", breadcrumbParent: null },
    // Live currently redirects this URL to the parent /accreditation page ("Get accredited") -
    // confirmed 2026-07-21, not a rate-limit artifact (redirect happens regardless of response
    // status) - QA renders it as its own standalone page. Accepting both H1s and skipping the
    // breadcrumbParent check (which differs once redirected) rather than treating Live's
    // redirect as a failure.
    { testName: "Standards and Recognition - Doctoral Training Accreditation Traversal", href: "/standards-and-recognition/accreditation/doctoral-training-accreditation", h1: /^(Doctoral training accreditation|Get accredited)$/, breadcrumbParent: null },
    { testName: "Standards and Recognition - Degree Accreditation Traversal", href: "/standards-and-recognition/accreditation/degree-accreditation", h1: "Degree accreditation", breadcrumbParent: "Accreditation" },
    { testName: "Standards and Recognition - Find Accredited Courses Traversal", href: "/standards-and-recognition/accreditation/degree-accreditation/find-accredited-courses", h1: "Find accredited courses", breadcrumbParent: "Degree accreditation" },
    { testName: "Standards and Recognition - Accreditation Testimonials Traversal", href: "/standards-and-recognition/accreditation/degree-accreditation/testimonials", h1: "Accreditation testimonials", breadcrumbParent: "Degree accreditation" },
    { testName: "Standards and Recognition - Outstanding Peer Reviewers Traversal", href: "/standards-and-recognition/outstanding-peer-reviewers", h1: "Outstanding peer reviewers", breadcrumbParent: null },
    { testName: "Standards and Recognition - Honorary Fellows Traversal", href: "/standards-and-recognition/honorary-fellows", h1: "Honorary fellows", breadcrumbParent: null },
    { testName: "Standards and Recognition - Chemical Landmarks Traversal", href: "/standards-and-recognition/chemical-landmarks-blue-plaque-scheme", h1: "Chemical Landmarks (RSC Blue Plaques)", breadcrumbParent: null },
    { testName: "Standards and Recognition - Librarian Spotlights Traversal", href: "/standards-and-recognition/librarian-spotlights", h1: "Librarian spotlights", breadcrumbParent: null },
    // Live-only pages (see STRUCTURAL DRIFT above) - gated via a real 404 check.
    { testName: "Standards and Recognition - Accreditation of Staff Development Scheme Traversal", href: "/standards-and-recognition/accreditation/accreditation-of-staff-development-scheme", h1: "Accreditation of staff development", breadcrumbParent: "Accreditation", liveOnly: true },
    // breadcrumbParent here is "Accreditation of staff development" (no trailing "scheme") -
    // matches the actual breadcrumb/H1 text on the parent page, confirmed 2026-07-21.
    { testName: "Standards and Recognition - Resources for Accredited Employers Traversal", href: "/standards-and-recognition/accreditation/accreditation-of-staff-development-scheme/resources-for-accredited-employers", h1: "Resources for accredited employers", breadcrumbParent: "Accreditation of staff development", liveOnly: true },
    { testName: "Standards and Recognition - Accreditation Case Studies Traversal", href: "/standards-and-recognition/accreditation/accreditation-of-staff-development-scheme/case-studies", h1: "Accreditation success stories", breadcrumbParent: "Accreditation of staff development", liveOnly: true },
    { testName: "Standards and Recognition - Approved Training Courses Traversal", href: "/standards-and-recognition/accreditation/approved-training-courses", h1: "Approved training courses", breadcrumbParent: "Accreditation", liveOnly: true },
];

for (const config of STANDARDS_PAGES) {
    test(config.testName, async ({ page }) => {
        test.setTimeout(60000);

        if (config.liveOnly) {
            const response = await test.step(`Open ${config.href} and check it exists on this environment`, async () => {
                return openPage(page, config.href);
            });
            test.skip(!response || response.status() === 404, 'This page does not exist yet on this environment - see STRUCTURAL DRIFT.');
        } else {
            await test.step(`Open ${config.href} and verify page chrome`, async () => {
                await openPage(page, config.href);
            });
        }

        await test.step('Verify page chrome (H1 and breadcrumb)', async () => {
            await expectPageChrome(page, { h1: config.h1, breadcrumbParent: config.breadcrumbParent });
        });

        await test.step('Verify the page exposes at least one content card', async () => {
            const cardCount = await page.locator('.card').count();
            expect(cardCount, `${config.href} should expose at least one content card`).toBeGreaterThan(0);
        });

        await test.step('Verify footer visibility', async () => {
            await verifyFooterVisible(page);
        });
    });
}

// ============================================================================
// Accordion functionality (Bootstrap-style accordion, same component used in
// 06-rsc.publishing.spec.js and 07-rsc.policyandcampaigning.spec.js -
// .accordion-item/.accordion-button/.accordion-collapse)
// ============================================================================
async function toggleBootstrapAccordionAndVerify(item, contextLabel) {
    const button = item.locator('.accordion-button').first();
    const body = item.locator('.accordion-collapse').first();

    await button.scrollIntoViewIfNeeded();
    const classBefore = await body.getAttribute('class');
    const wasExpanded = (classBefore || '').includes('show');

    await button.click();
    await expect.poll(async () => {
        const cls = await body.getAttribute('class');
        return (cls || '').includes('show');
    }, {
        message: `${contextLabel} should toggle its expanded state after clicking its header`,
        timeout: 8000,
    }).toBe(!wasExpanded);

    if (!wasExpanded) {
        await expect(body, `${contextLabel} should reveal visible content when expanded`).toBeVisible();
        const bodyText = (await body.innerText()).trim();
        expect(bodyText.length, `${contextLabel} should show non-empty content when expanded`).toBeGreaterThan(0);
    }

    // Restore original state so the page is left as found.
    await button.click();
    await expect.poll(async () => {
        const cls = await body.getAttribute('class');
        return (cls || '').includes('show');
    }, {
        message: `${contextLabel} should return to its original collapsed/expanded state`,
        timeout: 8000,
    }).toBe(wasExpanded);
}

test('Standards and Recognition - Accordion Functionality', async ({ page }) => {
    test.setTimeout(90000);

    await test.step('Open the Nomination guidance and FAQs page', async () => {
        await openPage(page, '/standards-and-recognition/prizes/nomination-guidance-and-faqs');
    });

    await test.step('Verify a sample of the real accordion items expand/collapse correctly', async () => {
        const items = page.locator('.accordion-item');
        const count = await items.count();
        expect(count, 'This page should expose a large number of real accordion items').toBeGreaterThan(10);

        const indexesToCheck = new Set([0, count - 1, Math.floor(count / 2)]);
        for (const index of indexesToCheck) {
            await toggleBootstrapAccordionAndVerify(items.nth(index), `Accordion item #${index + 1}`);
        }
    });
});
