const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { LOGIN_PATH, DASHBOARD_PATH, SELECTORS: LOGIN_SELECTORS } = require('./login-helpers');

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
// Coverage notes - Non-Functional (security + accessibility) suite
// ============================================================================
// Adapted heavily from every other project's `NN-<project>.nonfunctional.spec.js` (e.g.
// `14-pbs.nonfunctional.spec.js`) - TFS's portal is a login-gated app, not an indexed public
// marketing site, so most of the usual SEO-oriented checks genuinely don't apply here and are
// deliberately OMITTED rather than forced in:
//   - No sitemap/robots.txt checks - confirmed 2026-09-23 `/robots.txt` returns 404 on the portal
//     (expected - this app isn't meant to be crawled/indexed at all).
//   - No canonical URL / hreflang / Open Graph / JSON-LD checks - none of these apply to an
//     authenticated account area a search engine will never see.
//   - No GTM/analytics-signal check - confirmed via `12-tfs.envcompare.spec.js`'s own exploration
//     that the portal loads ZERO GTM containers on either environment.
// What's covered instead: real, portal-specific security hardening and authorization checks, plus
// a full accessibility (axe-core) sweep across every portal page - the same "as complete as
// possible" spirit as every other project's version, just aimed at what's actually relevant here.
//
// **Several REAL, CONFIRMED findings surfaced while building this file - these tests are expected
// to show as findings until the app itself is hardened, they are not test bugs:**
//   1. **The Content-Security-Policy is extremely permissive on BOTH environments**
//      (`default-src *; connect-src *; font-src *; frame-src *; img-src * data:; media-src *;
//      object-src *; worker-src *;` - confirmed via a real response header fetch on QA and Live) -
//      a CSP this broad provides close to no protection against XSS/data-exfiltration, since almost
//      every directive allows loading from ANY origin. `script-src`/`style-src` are the only
//      meaningfully restricted directives.
//   2. **Several standard hardening headers are missing entirely on both environments**:
//      `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Strict-Transport-Security`,
//      `Permissions-Policy` - none of these were present on a real Dashboard response from either
//      QA or Live.
//   3. **The backend technology/version is disclosed via response headers** - QA's `Server` header
//      reads the exact software name AND version (`PAC 4.3.00.20190521`); Live's `X-Powered-By`
//      header reads `ASP.NET`. Both are information-disclosure findings (an easier target for an
//      attacker who knows exactly what's running).
//   4. **The `.AspNetCore.Session` cookie is missing the `Secure` flag** on both environments,
//      confirmed via a direct cookie inspection - inconsistent with `.AspNetCore.Identity.Application`
//      on the SAME response, which correctly has `Secure: true`. A cookie without `Secure` can, in
//      principle, be sent over a plain HTTP connection if one were ever available.
//   5. **The portal has NO footer/contentinfo landmark on any page** (confirmed via role inspection
//      on the Dashboard) - a real structural finding, though likely a deliberate design choice for a
//      logged-in dashboard rather than an oversight; documented rather than asserted as a defect,
//      the landmark test below only requires `main`/`banner`, not `contentinfo`.
//   5b. **Dashboard is the ONLY portal page with a `<main>`/role=main landmark - confirmed 2026-09-23
//      it's genuinely, consistently ABSENT on all 8 other portal pages** (Account Details, Invoices,
//      Site Locator, Transactions, Payments, Manage Cards, Additional Services, FAQs), verified with
//      a direct script check (not a timing artifact - the element simply never exists in the DOM on
//      those pages, confirmed even after full `networkidle`). This is a real, if inconsistent,
//      accessibility gap: every other page still needs a screen-reader user to be able to jump
//      straight to main content the way Dashboard's own page already allows. The landmark test below
//      deliberately keeps requiring `main` on every page (the correct WCAG expectation) rather than
//      weakening the check to match what currently exists - so 8 of the 9 "Verify landmarks on
//      <page>" steps are expected to fail until this is fixed, not because of a test bug.
//   6. **A "serious" (not "critical") axe color-contrast violation exists across the shared chrome**
//      on every portal page (20+ nodes on the Dashboard alone) - since every other project's
//      nonfunctional spec only fails on `impact === 'critical'`, this would otherwise go
//      unreported. This file deliberately widens the failure threshold to `['critical', 'serious']`
//      to surface it, documented here as a deliberate deviation from the usual convention.
//
// **What DOES work correctly, confirmed as a genuine pass, not assumed:** unauthenticated access to
// a portal page correctly redirects to `/portal/login?ReturnUrl=...` rather than leaking any
// content - checked directly with a fresh, logged-out context (same technique as
// `01-tfs.login.spec.js`'s own unauthenticated test).
//
// Test list:
// Security / authorization:
//   1. Unauthenticated access to portal pages redirects to login (one test per key page)
//   2. Security hardening headers are missing (documented finding, not a false pass)
//   3. Content-Security-Policy is present but dangerously permissive (documented finding)
//   4. Backend technology/version should not be disclosed via response headers (documented finding)
//   5. Session cookie should carry the Secure flag (documented finding)
//   6. No mixed-content HTTP assets on key portal pages
// Accessibility (one test per portal page, `['critical', 'serious']` axe impact threshold):
//   7-N. "Accessibility - <page> has no critical/serious axe violations"
//   Landmark structure (main + banner) exists on every portal page
//   Exactly one H1 exists on every portal page
//   Interactive controls expose accessible names (Dashboard)
//   Images have alt text or are explicitly decorative (Dashboard)
//   Form fields have associated labels (Login form + Account Details filter panel)
// ============================================================================

const KEY_PORTAL_PAGES = [
    { path: DASHBOARD_PATH, label: 'Dashboard' },
    { path: '/portal/account-details', label: 'Account Details' },
    { path: '/portal/invoices', label: 'Invoices' },
    { path: '/portal/site-locator', label: 'Site Locator' },
    { path: '/portal/transactions', label: 'Transactions' },
    { path: '/portal/payments', label: 'Payments' },
    { path: '/portal/manage-cards', label: 'Manage Cards' },
    { path: '/portal/additional-services', label: 'Additional Services' },
    { path: '/portal/faq', label: 'FAQs' },
];

// Site Locator's own page body is a third-party iframe (stationfinder.co.uk, see
// 05-tfs.sitelocator.spec.js) - axe-core still scans the main frame around it, but any violation
// INSIDE that iframe belongs to the third party, not TFS's own team, so it's excluded from the
// accessibility sweep specifically (still included in every other check in this file).
const A11Y_PAGES = KEY_PORTAL_PAGES.filter((p) => p.label !== 'Site Locator');

async function runAxe(page, path) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { });
    return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
}

test.describe('Security & Authorization', () => {
    // A fresh, logged-out context is needed for these - same technique as
    // 01-tfs.login.spec.js's own unauthenticated tests.
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const { path, label } of KEY_PORTAL_PAGES) {
        test(`Security - Unauthenticated access to ${label} redirects to login`, async ({ page, baseURL }) => {
            await page.goto(new URL(path, baseURL).toString(), { waitUntil: 'domcontentloaded' });

            const currentUrl = new URL(page.url());
            expect(currentUrl.pathname, `Unauthenticated access to ${path} should redirect to the login page, not leak the real page`).toBe(LOGIN_PATH);
            expect(currentUrl.searchParams.get('ReturnUrl'), `Login redirect should preserve where the user was trying to go (${path})`).toBe(path);
        });
    }
});

test('Security - Hardening headers are present', async ({ page, request }) => {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    const response = await request.get(DASHBOARD_PATH);
    const headers = response.headers();

    // Confirmed 2026-09-23 as a real, current gap on both QA and Live - every one of these is
    // currently MISSING. Using expect.soft so a future partial fix (e.g. just X-Frame-Options
    // added) shows exactly which headers are still missing, rather than one pass/fail blob.
    expect.soft(headers['x-content-type-options'], 'X-Content-Type-Options header should be present (currently missing - see this file\'s "Coverage notes")').toBeTruthy();
    expect.soft(headers['referrer-policy'], 'Referrer-Policy header should be present (currently missing - see this file\'s "Coverage notes")').toBeTruthy();
    expect.soft(headers['x-frame-options'], 'X-Frame-Options header should be present (currently missing - see this file\'s "Coverage notes")').toBeTruthy();
    expect.soft(headers['strict-transport-security'], 'Strict-Transport-Security header should be present (currently missing - see this file\'s "Coverage notes")').toBeTruthy();
    expect.soft(headers['permissions-policy'], 'Permissions-Policy header should be present (currently missing - see this file\'s "Coverage notes")').toBeTruthy();
});

test('Security - Content-Security-Policy should not allow loading from any origin', async ({ page, request }) => {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    const response = await request.get(DASHBOARD_PATH);
    const csp = response.headers()['content-security-policy'];

    expect(csp, 'A Content-Security-Policy header should be present').toBeTruthy();

    // Confirmed 2026-09-23: the current policy genuinely uses `default-src *` and equally broad
    // wildcards on connect-src/font-src/frame-src/img-src/media-src/object-src/worker-src - this
    // assertion is expected to FAIL until the policy is tightened to specific, trusted origins.
    for (const directive of ['default-src', 'connect-src', 'font-src', 'frame-src', 'media-src', 'object-src', 'worker-src']) {
        expect.soft(csp, `CSP's "${directive}" directive should not be a bare wildcard (currently "${directive} *" - see this file's "Coverage notes")`).not.toMatch(new RegExp(`${directive}\\s+\\*(?:\\s|;|$)`));
    }
});

test('Security - Backend technology/version should not be disclosed via response headers', async ({ page, request }) => {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    const response = await request.get(DASHBOARD_PATH);
    const headers = response.headers();

    // Confirmed 2026-09-23: QA's own "Server" header reads "PAC 4.3.00.20190521" (exact software +
    // version) and Live's "X-Powered-By" reads "ASP.NET" - both expected to fail this check today.
    expect.soft(headers['x-powered-by'], `X-Powered-By header should not disclose backend technology (currently "${headers['x-powered-by'] || ''}" - see this file's "Coverage notes")`).toBeFalsy();
    expect.soft(headers['server'], `Server header should not disclose specific software/version (currently "${headers['server'] || ''}" - see this file's "Coverage notes")`).not.toMatch(/[\d.]{4,}/);
});

test('Security - Session cookie should carry the Secure flag', async ({ page, context }) => {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === '.AspNetCore.Session');

    expect(sessionCookie, 'The ".AspNetCore.Session" cookie should be set').toBeTruthy();
    // Confirmed 2026-09-23 on both QA and Live this cookie is missing the Secure flag, unlike
    // ".AspNetCore.Identity.Application" on the same response, which correctly has it - expected
    // to fail until fixed.
    expect(sessionCookie?.secure, 'The ".AspNetCore.Session" cookie should have the Secure flag set (currently missing - see this file\'s "Coverage notes")').toBe(true);
});

test('Security - No mixed-content HTTP assets on key portal pages', async ({ page }) => {
    for (const { path, label } of KEY_PORTAL_PAGES) {
        await test.step(`Check ${label} for insecure http:// references`, async () => {
            await page.goto(path, { waitUntil: 'domcontentloaded' });

            const insecureUrls = await page.evaluate(() => {
                const attrs = ['href', 'src'];
                const candidates = Array.from(document.querySelectorAll('a[href], link[href], script[src], img[src], iframe[src]'));
                const found = [];
                for (const el of candidates) {
                    for (const attr of attrs) {
                        const raw = el.getAttribute(attr);
                        if (!raw) continue;
                        if (/^(mailto:|tel:|javascript:|#|\/)/i.test(raw)) continue;
                        if (/^\/\//.test(raw)) continue;
                        try {
                            const parsed = new URL(raw, window.location.origin);
                            if (parsed.protocol === 'http:') found.push(parsed.href);
                        } catch { }
                    }
                }
                return Array.from(new Set(found));
            });

            expect.soft(insecureUrls, `${label} should not reference any insecure http:// assets/links`).toEqual([]);
        });
    }
});

for (const { path, label } of A11Y_PAGES) {
    test(`Accessibility - ${label} has no critical or serious axe violations`, async ({ page }) => {
        const results = await runAxe(page, path);
        // Confirmed 2026-09-23: widened from the usual project convention of "critical only" to
        // include "serious" too, since a real, confirmed "serious" color-contrast violation exists
        // across this app's shared chrome (would otherwise never be reported) - see this file's
        // "Coverage notes" for the full explanation of this deliberate deviation.
        const notable = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
        expect(notable, `Critical/serious violations on ${label}: ${JSON.stringify(notable, null, 2)}`).toEqual([]);
    });
}

test('Accessibility - Landmark structure (main + banner) exists on every portal page', async ({ page }) => {
    // Confirmed 2026-09-23 the portal has NO footer/contentinfo landmark on any page (a real
    // structural finding, likely a deliberate design choice for a logged-in dashboard) - this check
    // only requires main + banner, not contentinfo, to avoid asserting for something not actually
    // expected to exist.
    for (const { path, label } of KEY_PORTAL_PAGES) {
        await test.step(`Verify landmarks on ${label}`, async () => {
            await page.goto(path, { waitUntil: 'domcontentloaded' });
            await expect(page.getByRole('main'), `${label} should expose a main landmark`).toBeVisible();
            const hasBanner = (await page.getByRole('banner').count()) > 0;
            expect(hasBanner, `${label} should expose a banner landmark`).toBeTruthy();
        });
    }
});

test('Accessibility - Exactly one H1 exists on every portal page', async ({ page }) => {
    for (const { path, label } of KEY_PORTAL_PAGES) {
        await test.step(`Verify H1 count on ${label}`, async () => {
            await page.goto(path, { waitUntil: 'domcontentloaded' });
            const h1Count = await page.locator('h1').count();
            expect(h1Count, `${label} should contain exactly one H1`).toBe(1);
        });
    }
});

test('Accessibility - Interactive controls expose accessible names', async ({ page }) => {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });

    const unnamedInteractive = await page.evaluate(() => {
        const isVisible = (el) => {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
        };
        const controls = Array.from(document.querySelectorAll('button, a[href], input, select, textarea'));
        const getName = (el) => {
            const ariaLabel = el.getAttribute('aria-label') || '';
            const labelledBy = el.getAttribute('aria-labelledby') || '';
            const text = (el.textContent || '').trim();
            const title = el.getAttribute('title') || '';
            const value = (el.getAttribute('value') || '').trim();
            const placeholder = (el.getAttribute('placeholder') || '').trim();
            const childImageAlt = Array.from(el.querySelectorAll('img')).map((img) => (img.getAttribute('alt') || '').trim()).filter(Boolean).join(' ');
            return [ariaLabel, labelledBy, text, title, value, placeholder, childImageAlt].join(' ').trim();
        };
        return controls
            .filter((el) => isVisible(el))
            .filter((el) => {
                if (el.getAttribute('aria-hidden') === 'true') return false;
                const role = (el.getAttribute('role') || '').toLowerCase();
                if (role === 'presentation' || role === 'none') return false;
                return getName(el).length === 0;
            })
            .slice(0, 20)
            .map((el) => el.outerHTML.slice(0, 200));
    });

    expect(unnamedInteractive, `Unnamed interactive elements: ${JSON.stringify(unnamedInteractive, null, 2)}`).toEqual([]);
});

test('Accessibility - Images have alt text or are explicitly decorative', async ({ page }) => {
    await page.goto(DASHBOARD_PATH, { waitUntil: 'domcontentloaded' });

    const invalidImages = await page.evaluate(() => {
        const isVisible = (el) => {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
        };
        return Array.from(document.querySelectorAll('img'))
            .filter((img) => isVisible(img))
            .filter((img) => !img.hasAttribute('alt'))
            .slice(0, 20)
            .map((img) => img.outerHTML.slice(0, 200));
    });

    expect(invalidImages, `Images missing alt/decorative semantics: ${JSON.stringify(invalidImages, null, 2)}`).toEqual([]);
});

test('Accessibility - Form fields have associated labels', async ({ page }) => {
    async function findUnlabeledFields(currentPage) {
        return currentPage.evaluate(() => {
            const fields = Array.from(document.querySelectorAll('input, select, textarea'));
            const hasAssociatedLabel = (el) => {
                const id = el.getAttribute('id');
                if (id && document.querySelector(`label[for="${id}"]`)) return true;
                if (el.closest('label')) return true;
                if ((el.getAttribute('aria-label') || '').trim().length) return true;
                if ((el.getAttribute('aria-labelledby') || '').trim().length) return true;
                return false;
            };
            return fields
                .filter((el) => el.getAttribute('type') !== 'hidden')
                .filter((el) => !hasAssociatedLabel(el))
                .slice(0, 20)
                .map((el) => el.outerHTML.slice(0, 200));
        });
    }

    await test.step('Login form fields are all labeled', async () => {
        await page.goto(LOGIN_PATH, { waitUntil: 'domcontentloaded' });
        const unlabeled = await findUnlabeledFields(page);
        expect(unlabeled, `Unlabeled fields on Login: ${JSON.stringify(unlabeled, null, 2)}`).toEqual([]);
    });

    await test.step('Account Details filter panel fields are all labeled', async () => {
        await page.goto('/portal/account-details', { waitUntil: 'domcontentloaded' });
        const unlabeled = await findUnlabeledFields(page);
        expect(unlabeled, `Unlabeled fields on Account Details: ${JSON.stringify(unlabeled, null, 2)}`).toEqual([]);
    });
});
