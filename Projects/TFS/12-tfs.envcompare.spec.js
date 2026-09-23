const { test, expect, devices } = require('@playwright/test');
const { LOGIN_PATH, DASHBOARD_PATH, SELECTORS: LOGIN_SELECTORS, submitLogin } = require('./login-helpers');

// Captures the page's web address at the moment a test fails, so the
// findings report can tell teammates exactly where an issue was seen.
// Note: for the two-environment comparison tests below, this only reflects the
// PRIMARY environment (baseURL) page at the time of failure - check the
// assertion message itself (it names both environments) for which side an
// issue was actually seen on.
test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('failure-context', {
            body: JSON.stringify({
                environment: testInfo.project.use.baseURL || '',
                compareEnvironment: COMPARE_BASE_URL || '',
                viewport: testInfo.project.name,
            }),
            contentType: 'application/json',
        }).catch(() => {});
    }
});

// ============================================================================
// Coverage notes - two-environment discrepancy checks
// ============================================================================
// Scope: unlike every other spec in this project, this file doesn't test ONE environment - it
// DIFFS TWO of them (whichever `TFS_BASE_URL` points at, against `TFS_COMPARE_BASE_URL`). It
// mirrors the equivalent spec in every other project in this workspace (e.g.
// `13-pbs.envcompare.spec.js`), adapted for TFS's very different architecture: every other
// project's version diffs a PUBLIC marketing site (meganav, footer, GTM, robots.txt, sitemap,
// JSON-LD, og:image...); TFS has none of that to compare - QA has no public site at all (its
// domain root redirects straight to `/login`), and this project's entire established scope is the
// login-gated PORTAL, not Live's separate public marketing site at its domain root. So this file
// diffs the PORTAL instead: it logs into both environments for real and compares page titles,
// sidebar navigation, header chrome, session cookie shape, favicon, the login page's own fields,
// and a broken-image sweep across the portal's main pages.
//
// **Omitted checks, and why (matching the "no homepage carousel test" precedent in
// PBS's own envcompare spec - documented omissions, not silent gaps):**
//   - No meganav/footer/GTM/robots.txt/sitemap/JSON-LD/og:image checks - confirmed 2026-09-23 the
//     portal's own pages load ZERO GTM containers on either environment (checked via the
//     Dashboard's HTML on both QA and Live), and none of the rest apply to an authenticated,
//     non-indexed app the way they do to a public marketing site.
//   - No Analytics-container-must-not-be-shared check (the single most important test in every
//     other project's envcompare spec) - moot here since there's no GTM to compare in the first
//     place.
//
// **Opt-in by design**, same as every other project: every test in this file is skipped (via
// `test.skip` on the whole describe block) unless `TFS_COMPARE_BASE_URL` is set. Running `npm
// test` / CI normally will always show this file as skipped - that's expected, not a problem. See
// README.md "Comparing two environments" for how to actually run it.
//
// **Contact is a KNOWN, already-thoroughly-documented divergence, not treated as a defect here:**
// `11-tfs.contact.spec.js` already established that `/portal/contact` resolves to a completely
// different page on Live (a public marketing form) than on QA (the portal's own authenticated
// form) - see that file's own "Coverage notes" for the full story. This spec's Contact test
// confirms that divergence is still present (both sides land somewhere reachable, and they're
// still genuinely different destinations) rather than silently ignoring the page or wrongly
// asserting title parity against it.
//
// All checks here are gated to `desktop-chromium` only - confirmed throughout this project
// (`portal-helpers.js`) that this portal's DOM/structure is identical across viewports (only CSS
// positioning differs), so running a structural diff 3x would just waste time on an already
// occasional, opt-in spec. The login step in `beforeAll` is skipped outright for the other two
// projects for the same reason.
//
// Tests in this file:
//   1-N. "Environment Compare - Page title: <page>" - one test per portal page in
//        PORTAL_PAGES_TO_COMPARE, asserting the <title> is byte-identical on both environments.
//        Deliberately one test per page (not one test looping over all of them), matching every
//        other project's envcompare spec, so the findings spreadsheet gets one row per broken page.
//   Contact page shows the known, documented divergence - confirms both environments still
//        resolve Contact to genuinely different destinations, rather than asserting parity.
//   Sidebar navigation labels and order
//   Header controls order (account dropdown -> Log out -> logo)
//   Session cookie shape (name/SameSite/HttpOnly/Secure, NOT value - values are legitimately
//        environment-specific) - Live's extra `cf_clearance` (Cloudflare) cookie is documented as
//        an accepted, expected difference, not asserted equal.
//   Favicon path parity
//   Login page fields and controls parity
//   Broken images sweep across the portal's main pages
// ============================================================================

const COMPARE_BASE_URL = (process.env.TFS_COMPARE_BASE_URL || '').trim().replace(/\/+$/, '');

// A curated set of portal pages, pulled from the real paths already exercised by this project's
// own per-page spec files (01 through 11). Contact is deliberately excluded from this generic
// title-parity list - it has its own dedicated "known divergence" test below instead.
const PORTAL_PAGES_TO_COMPARE = [
    { path: '/portal/', label: 'Dashboard' },
    { path: '/portal/account-details', label: 'Account Details' },
    { path: '/portal/invoices', label: 'Invoices' },
    { path: '/portal/site-locator', label: 'Site Locator' },
    { path: '/portal/transactions', label: 'Transactions' },
    { path: '/portal/payments', label: 'Payments' },
    { path: '/portal/manage-cards', label: 'Manage Cards' },
    { path: '/portal/additional-services', label: 'Additional Services' },
    { path: '/portal/faq', label: 'FAQs' },
];

const CONTACT_PATH = '/portal/contact';
const LIVE_PUBLIC_CONTACT_PATH = '/contact/';

const KEY_PATHS_FOR_IMAGE_SWEEP = ['/portal/', '/portal/account-details', '/portal/manage-cards', '/portal/additional-services'];

function hostLabel(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        return url;
    }
}

function deviceOptionsForProject(projectName) {
    if (projectName === 'tablet-webkit') return { ...devices['iPad Pro 11'] };
    if (projectName === 'mobile-chromium') return { ...devices['Pixel 7'] };
    return { ...devices['Desktop Chrome'] };
}

// Logs into a given environment for real, in its own fresh context - each environment needs its
// own genuine login (raw `fetch()` can't be used the way other projects' envcompare specs do,
// since every portal page requires an authenticated session).
async function loginToEnv(browser, testInfo, baseUrl) {
    const context = await browser.newContext(deviceOptionsForProject(testInfo.project.name));
    const page = await context.newPage();
    // Generous timeouts throughout this function - confirmed 2026-09-23 that a genuinely
    // healthy login can still take up to ~20s under real, if unexplained, network/session
    // slowness seen intermittently in this project (unrelated to this spec's own code).
    await page.goto(new URL(LOGIN_PATH, baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await submitLogin(page, process.env.TFS_EMAIL, process.env.TFS_PASSWORD);
    await page.waitForURL((url) => url.pathname === DASHBOARD_PATH, { timeout: 45000 });
    await page.waitForLoadState('networkidle').catch(() => { });
    return { context, page };
}

async function getSidebarLabels(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('.sidebar__navLabel')).map((el) => el.textContent.trim()));
}

async function getHeaderOrderIsCorrect(page) {
    return page.evaluate(() => {
        const toggle = document.querySelector('.header .dropdown__toggle');
        const logout = document.querySelector('button.logout');
        const logo = document.querySelector('a.logo');
        if (!toggle || !logout || !logo) return false;
        const dropdownBeforeLogout = !!(toggle.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING);
        const logoutBeforeLogo = !!(logout.compareDocumentPosition(logo) & Node.DOCUMENT_POSITION_FOLLOWING);
        return dropdownBeforeLogout && logoutBeforeLogo;
    });
}

// Navigates both pages to the same relative path on their own environment, then waits for real
// network idle (not just `domcontentloaded`) on each - confirmed 2026-09-23 that a portal page's
// React-rendered content (like the sidebar) can still be mid-render when `domcontentloaded` fires,
// especially under the real, if unexplained, intermittent network slowness seen in this project -
// a bare `domcontentloaded` wait intermittently caught a page before ANY of its sidebar had
// mounted, producing a misleading "sidebar labels don't match" failure that was really a timing
// gap, not a real content difference.
async function gotoBoth(pageA, pageB, path, baseURL, compareBaseURL) {
    await Promise.all([
        pageA.goto(new URL(path, baseURL).toString(), { waitUntil: 'domcontentloaded' }),
        pageB.goto(new URL(path, compareBaseURL).toString(), { waitUntil: 'domcontentloaded' }),
    ]);
    await Promise.all([
        pageA.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { }),
        pageB.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { }),
    ]);
}

async function getFavicon(page) {
    return page.evaluate(() => {
        const link = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        return link ? link.getAttribute('href') : null;
    });
}

test.describe('Environment Comparison', () => {
    test.skip(!COMPARE_BASE_URL, 'Environment comparison spec only runs when TFS_COMPARE_BASE_URL is set alongside TFS_BASE_URL - see README.md "Comparing two environments". Skipped for normal single-environment runs.');

    let contextA;
    let pageA;
    let contextB;
    let pageB;

    test.beforeAll(async ({ browser }, testInfo) => {
        if (testInfo.project.name !== 'desktop-chromium') return;
        // Longer than the default 30s hook timeout, and the two logins run in parallel rather
        // than sequentially - confirmed 2026-09-23 a single login can genuinely take ~20s under
        // real intermittent slowness, which risks exceeding the default hook budget if done
        // one-after-another.
        test.setTimeout(90000);
        [{ context: contextA, page: pageA }, { context: contextB, page: pageB }] = await Promise.all([
            loginToEnv(browser, testInfo, testInfo.project.use.baseURL),
            loginToEnv(browser, testInfo, COMPARE_BASE_URL),
        ]);
    });

    test.afterAll(async () => {
        await contextA?.close();
        await contextB?.close();
    });

    for (const { path: pagePath, label } of PORTAL_PAGES_TO_COMPARE) {
        test(`Environment Compare - Page title: ${label}`, async ({ baseURL }, testInfo) => {
            test.skip(testInfo.project.name !== 'desktop-chromium', 'Page titles are device-independent - only needs to run once.');

            await gotoBoth(pageA, pageB, pagePath, baseURL, COMPARE_BASE_URL);

            const [titleA, titleB] = await Promise.all([pageA.title(), pageB.title()]);
            expect(titleA, `${pagePath} page title should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(titleB);
        });
    }

    test('Environment Compare - Contact page shows the known, documented divergence', async ({ browser, baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Navigation destination is device-independent - only needs to run once.');

        // Uses its own throwaway contexts rather than the shared pageA/pageB - navigating to
        // Contact can land on Live's completely separate public marketing site (a different app
        // entirely, no portal chrome), and confirmed 2026-09-23 that leaves the shared page in a
        // state where later tests (e.g. Sidebar navigation) can't find portal elements even after
        // navigating back to a portal URL. Keeping this test's navigation fully isolated avoids
        // disturbing every test that runs after it.
        const { context: contextC, page: pageC } = await loginToEnv(browser, testInfo, baseURL);
        const { context: contextD, page: pageD } = await loginToEnv(browser, testInfo, COMPARE_BASE_URL);

        await gotoBoth(pageC, pageD, CONTACT_PATH, baseURL, COMPARE_BASE_URL);

        const destinationA = new URL(pageC.url()).pathname;
        const destinationB = new URL(pageD.url()).pathname;

        await contextC.close();
        await contextD.close();

        // See 11-tfs.contact.spec.js's own "Coverage notes" for the full discovery story - one
        // environment's `/portal/contact` genuinely redirects to the public marketing page
        // (`/contact/`) instead of loading the portal's own form. This test confirms that
        // documented divergence is still present, rather than treating it as an unexpected defect.
        expect(destinationA === LIVE_PUBLIC_CONTACT_PATH || destinationB === LIVE_PUBLIC_CONTACT_PATH, `Exactly one environment should redirect Contact to the public marketing page (${hostLabel(baseURL)}: "${destinationA}", ${hostLabel(COMPARE_BASE_URL)}: "${destinationB}") - if NEITHER does, the known divergence documented in 11-tfs.contact.spec.js may have been resolved and that spec's Live-specific test path should be revisited`).toBe(true);
        expect(destinationA, `The two environments should still resolve Contact to genuinely different destinations (${hostLabel(baseURL)}: "${destinationA}" vs ${hostLabel(COMPARE_BASE_URL)}: "${destinationB}")`).not.toBe(destinationB);
    });

    test('Environment Compare - Sidebar navigation labels and order', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Sidebar structure is device-independent - only needs to run once.');

        await gotoBoth(pageA, pageB, DASHBOARD_PATH, baseURL, COMPARE_BASE_URL);

        const [labelsA, labelsB] = await Promise.all([getSidebarLabels(pageA), getSidebarLabels(pageB)]);
        expect(labelsA, `Sidebar navigation labels/order should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toEqual(labelsB);
    });

    test('Environment Compare - Header controls order', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Header structure is device-independent - only needs to run once.');

        await gotoBoth(pageA, pageB, DASHBOARD_PATH, baseURL, COMPARE_BASE_URL);

        const [orderCorrectA, orderCorrectB] = await Promise.all([getHeaderOrderIsCorrect(pageA), getHeaderOrderIsCorrect(pageB)]);
        expect(orderCorrectA, `Header should show dropdown before Log out before logo on ${hostLabel(baseURL)}`).toBe(true);
        expect(orderCorrectB, `Header should show dropdown before Log out before logo on ${hostLabel(COMPARE_BASE_URL)}`).toBe(true);
    });

    test('Environment Compare - Session cookie shape (name, SameSite, HttpOnly, Secure)', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Cookie shape is device-independent - only needs to run once.');

        const [cookiesA, cookiesB] = await Promise.all([contextA.cookies(), contextB.cookies()]);
        const labelA = hostLabel(baseURL);
        const labelB = hostLabel(COMPARE_BASE_URL);

        for (const cookieName of ['.AspNetCore.Identity.Application', '.AspNetCore.Session']) {
            const cookieA = cookiesA.find((c) => c.name === cookieName);
            const cookieB = cookiesB.find((c) => c.name === cookieName);

            expect.soft(!!cookieA, `"${cookieName}" cookie should be set on ${labelA}`).toBe(true);
            expect.soft(!!cookieB, `"${cookieName}" cookie should be set on ${labelB}`).toBe(true);

            if (cookieA && cookieB) {
                expect.soft(cookieA.sameSite, `"${cookieName}" SameSite policy should match between ${labelA} and ${labelB}`).toBe(cookieB.sameSite);
                expect.soft(cookieA.httpOnly, `"${cookieName}" HttpOnly flag should match between ${labelA} and ${labelB}`).toBe(cookieB.httpOnly);
                expect.soft(cookieA.secure, `"${cookieName}" Secure flag should match between ${labelA} and ${labelB}`).toBe(cookieB.secure);
            }
        }

        // Confirmed 2026-09-23: Live sets an additional `cf_clearance` (Cloudflare) cookie that QA
        // doesn't - an accepted, expected difference (Cloudflare fronts Live but not QA), not
        // asserted equal here, just noted for anyone reading a future diff of this test's output.
    });

    test('Environment Compare - Favicon path parity', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Favicon is device-independent - only needs to run once.');

        const [faviconA, faviconB] = await Promise.all([getFavicon(pageA), getFavicon(pageB)]);
        expect(faviconA, `Favicon path should match between ${hostLabel(baseURL)} and ${hostLabel(COMPARE_BASE_URL)}`).toBe(faviconB);
    });

    test('Environment Compare - Login page fields and controls parity', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Login form structure is device-independent - only needs to run once.');

        // A fresh, LOGGED-OUT context is needed here, since the login form itself is what's being
        // compared - opened via the same contexts' underlying browser rather than logging in again.
        const freshA = await contextA.browser().newContext(deviceOptionsForProject(testInfo.project.name));
        const freshB = await contextB.browser().newContext(deviceOptionsForProject(testInfo.project.name));
        const loginPageA = await freshA.newPage();
        const loginPageB = await freshB.newPage();

        await Promise.all([
            loginPageA.goto(new URL(LOGIN_PATH, baseURL).toString(), { waitUntil: 'domcontentloaded' }),
            loginPageB.goto(new URL(LOGIN_PATH, COMPARE_BASE_URL).toString(), { waitUntil: 'domcontentloaded' }),
        ]);

        // logoutButton is excluded - it's login-helpers.js's selector for the PORTAL's own logout
        // control (used by 01-tfs.login.spec.js's "Logging Out" test), not part of the unauthenticated
        // login FORM being compared here.
        const loginFormFields = Object.fromEntries(Object.entries(LOGIN_SELECTORS).filter(([name]) => name !== 'logoutButton'));
        for (const [name, selector] of Object.entries(loginFormFields)) {
            const [presentA, presentB] = await Promise.all([
                loginPageA.locator(selector).count(),
                loginPageB.locator(selector).count(),
            ]);
            expect.soft(presentA > 0, `Login field/control "${name}" should be present on ${hostLabel(baseURL)}`).toBe(true);
            expect.soft(presentB > 0, `Login field/control "${name}" should be present on ${hostLabel(COMPARE_BASE_URL)}`).toBe(true);
        }

        await freshA.close();
        await freshB.close();
    });

    test('Environment Compare - Broken images on key portal pages', async ({ baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'Broken images are device-independent - only needs to run once.');
        test.setTimeout(60000);

        async function sweep(page, base) {
            const results = [];
            for (const path of KEY_PATHS_FOR_IMAGE_SWEEP) {
                await page.goto(new URL(path, base).toString(), { waitUntil: 'load', timeout: 20000 }).catch(() => { });
                await page.waitForTimeout(500);
                const brokenImages = await page.evaluate(() => Array.from(document.querySelectorAll('img[src]'))
                    .filter((img) => img.complete && img.naturalWidth === 0 && !img.src.startsWith('data:'))
                    .length).catch(() => 0);
                results.push({ path, brokenImages });
            }
            return results;
        }

        const [resultsA, resultsB] = await Promise.all([sweep(pageA, baseURL), sweep(pageB, COMPARE_BASE_URL)]);

        for (let i = 0; i < KEY_PATHS_FOR_IMAGE_SWEEP.length; i += 1) {
            expect.soft(resultsA[i].brokenImages, `${resultsA[i].path} should have no broken images on ${hostLabel(baseURL)}`).toBe(0);
            expect.soft(resultsB[i].brokenImages, `${resultsB[i].path} should have no broken images on ${hostLabel(COMPARE_BASE_URL)}`).toBe(0);
        }
    });
});
