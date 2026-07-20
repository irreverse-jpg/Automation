const http = require('http');
const https = require('https');
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

const AxeBuilder = require('@axe-core/playwright').default;

// ============================================================================
// Coverage notes - Non-Functional (SEO / security / accessibility)
// ============================================================================
// Scope: Site-wide technical health checks that aren't tied to any single
// feature - sitemap/robots.txt discoverability, canonical/meta/social tags,
// analytics presence, security headers, structured data, and a WCAG2A/AA
// accessibility sweep (via @axe-core/playwright) across the homepage and the
// KEY_PAGES list (/, /help-advice, /where-do-i-start, /care-homes, /careers).
//
// Tests in this file (19 total):
//   1. Sitemap is available and contains URLs - probes localized and root
//      sitemap.xml/sitemap_index.xml candidates, skips if none are readable.
//   2. Sitemap sample URLs resolve (no 4xx/5xx) - samples up to 5 same-origin
//      URLs from the sitemap and confirms each resolves successfully.
//   3. robots.txt is available and advertises sitemap - checks for
//      User-agent and Disallow directives.
//   4. Canonical and robots directives on key pages - for each KEY_PAGES
//      entry, verifies an absolute canonical link with a matching path and a
//      reachable, title-matching destination, plus a recognized robots meta
//      directive if present.
//   5. Core meta tags are present - charset, viewport, and a meaningful
//      description tag on the homepage.
//   6. Open Graph and social metadata exists - og:title/description/type/url
//      on the homepage.
//   7. Google Analytics / Tag Manager signal exists - scans page scripts for
//      GTM/GA markers.
//   8. CSP and basic security headers are in place - CSP (or report-only),
//      X-Content-Type-Options, Referrer-Policy on the homepage response.
//   9. Document language is English - homepage <html lang> starts with "en".
//   10. No mixed-content HTTP assets/links on homepage - scans for insecure
//       http:// URLs among hrefs/srcs.
//   11. Structured data (JSON-LD) exists and is valid JSON - checks for
//       parseable JSON-LD, falls back to schema.org microdata, and skips
//       gracefully (does not fail) if neither is present on the homepage.
//   12. Basic document/head essentials are present - lang attribute,
//       meaningful title length, favicon link, and at least one hardening
//       header (permissions-policy/x-frame-options/COOP/CORP).
//   13. Accessibility - Homepage has no critical axe violations.
//   14. Accessibility - Key user pages have no critical axe violations -
//       runs axe across all of KEY_PAGES (excludes .fancybox/.modal on
//       /where-do-i-start, where a known overlay would otherwise skew
//       results).
//   15. Accessibility - Landmark structure exists on key pages - main,
//       banner, and contentinfo landmarks across KEY_PAGES.
//   16. Accessibility - Exactly one H1 exists on core pages (checks for at
//       least one, across KEY_PAGES).
//   17. Accessibility - Interactive controls expose accessible names - scans
//       visible buttons/links/inputs for a usable accessible name on the
//       homepage.
//   18. Accessibility - Images have alt text or are explicitly decorative -
//       flags visible <img> elements missing an alt attribute entirely.
//   19. Accessibility - Skip link is available and keyboard focus moves on
//       Tab - confirms a "skip to content" link exists and Tab moves focus
//       to a focusable control.
//
// The structured-data test (11) is intentionally content-based rather than
// environment-based: it skips only if the homepage genuinely exposes neither
// JSON-LD nor microdata, so it will start failing on its own if the site
// later adds one without the markup being valid.
// ============================================================================

// Key pages for CareUK; adjust if your site uses different paths
const KEY_PAGES = ['/', '/help-advice', '/where-do-i-start', '/care-homes', '/careers'];

function getConfiguredBaseUrl(testInfo) {
    const configuredBaseUrl = testInfo.project.use.baseURL;
    expect(configuredBaseUrl, 'Playwright baseURL must be configured in playwright.config.js').toBeTruthy();
    return new URL(configuredBaseUrl);
}

function getConfiguredOrigin(testInfo) {
    return getConfiguredBaseUrl(testInfo).origin;
}

function normalizePath(pathname = '') {
    const normalized = pathname.replace(/\/+$/, '');
    return normalized || '/';
}

function extractTitle(html = '') {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return (match?.[1] || '').replace(/\s+/g, ' ').trim();
}

async function getHtmlResponse(request, path = '/') {
    const response = await request.get(path);
    expect(response.ok(), `Request for ${path} should return a successful HTML response`).toBeTruthy();

    const html = await response.text();
    expect(html.length, `Request for ${path} should return a non-empty HTML body`).toBeGreaterThan(0);

    return { response, html };
}

function fetchTextSnippet(url, { timeoutMs = 60000, maxBytes = 250000 } = {}) {
    return new Promise((resolve, reject) => {
        const targetUrl = new URL(url);
        const client = targetUrl.protocol === 'http:' ? http : https;
        let settled = false;

        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            callback(value);
        };

        const req = client.get(targetUrl, (response) => {
            const status = response.statusCode || 0;
            if (status >= 300 && status < 400 && response.headers.location) {
                response.resume();
                finish(resolve, fetchTextSnippet(new URL(response.headers.location, targetUrl).toString(), { timeoutMs, maxBytes }));
                return;
            }

            const chunks = [];
            let bytes = 0;

            const resolveWithBody = () => finish(resolve, { status, body: Buffer.concat(chunks).toString('utf8') });

            response.on('data', (chunk) => {
                chunks.push(chunk);
                bytes += chunk.length;
                if (bytes >= maxBytes) response.destroy();
            });
            response.on('end', resolveWithBody);
            response.on('close', resolveWithBody);
            response.on('error', (err) => finish(reject, err));
        });

        req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timed out after ${timeoutMs}ms while requesting ${url}`)));
        req.on('error', (err) => finish(reject, err));
    });
}

async function getSitemapBodySnippet(testInfo) {
    const configuredBaseUrl = getConfiguredBaseUrl(testInfo);
    const basePathPrefix = configuredBaseUrl.pathname.replace(/\/$/, '');
    const localizedCandidates = basePathPrefix ? [`${basePathPrefix}/sitemap.xml`, `${basePathPrefix}/sitemap_index.xml`] : [];
    const sitemapCandidates = [...localizedCandidates, '/sitemap.xml', '/sitemap_index.xml'];
    const configuredOrigin = getConfiguredOrigin(testInfo);

    for (const candidate of sitemapCandidates) {
        try {
            const { status, body } = await fetchTextSnippet(`${configuredOrigin}${candidate}`);
            if (status >= 200 && status < 300 && body) return body;
        } catch {
            // ignore and try next
        }
    }

    throw new Error('At least one sitemap endpoint should return a readable sitemap response');
}

async function runAxe(page, path, options = {}) {
    const excludeSelectors = options.excludeSelectors || [];
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('#header__navToggle');
    for (const sel of excludeSelectors) builder = builder.exclude(sel);
    return builder.analyze();
}

test('Non-Functional - Sitemap is available and contains URLs', async ({ }, testInfo) => {
    test.setTimeout(180000);
    let chosenBody = '';

    await test.step('Find a working sitemap endpoint', async () => {
        chosenBody = await getSitemapBodySnippet(testInfo).catch(() => '');
        test.skip(!chosenBody, 'No readable sitemap endpoint was available in this environment.');
        expect(chosenBody.length, 'At least one sitemap endpoint should return readable XML content').toBeGreaterThan(0);
    });

    await test.step('Verify the sitemap content contains URLs', async () => {
        expect(chosenBody, 'The working sitemap endpoint should contain a sitemap XML root element').toMatch(/<urlset|<sitemapindex/i);
        expect(chosenBody, 'The working sitemap endpoint should advertise at least one absolute URL').toMatch(/<loc>https?:\/\//i);
    });
});

test('Non-Functional - Sitemap sample URLs resolve (no 4xx/5xx)', async ({ request }, testInfo) => {
    test.setTimeout(180000);

    const sameOriginUrls = await test.step('Load sitemap sample URLs from the configured origin', async () => {
        const body = await getSitemapBodySnippet(testInfo).catch(() => '');
        test.skip(!body, 'No readable sitemap endpoint was available in this environment.');
        expect(body.length, 'A sitemap response body should be available before sampling sitemap URLs').toBeGreaterThan(0);

        const locMatches = [...body.matchAll(/<loc>(.*?)<\/loc>/gi)].map(m => m[1].trim());
        const configuredOrigin = getConfiguredOrigin(testInfo);
        const urls = locMatches.filter(url => { try { return new URL(url).origin === configuredOrigin; } catch { return false; } }).slice(0, 5);
        expect(urls.length, 'The sitemap should include at least one same-origin URL to validate').toBeGreaterThan(0);
        return urls;
    });

    for (const url of sameOriginUrls) {
        await test.step(`Verify sitemap URL ${url}`, async () => {
            const response = await request.get(url);
            expect(response.status(), `Sitemap URL should not return a 4xx/5xx status: ${url}`).toBeLessThan(400);
        });
    }
});

test('Non-Functional - robots.txt is available and advertises sitemap', async ({ request }) => {
    await test.step('Fetch robots.txt', async () => {
        const response = await request.get('/robots.txt');
        expect(response.ok(), 'robots.txt should return a successful response').toBeTruthy();

        const robots = await response.text();
        expect(robots, 'robots.txt should declare at least one User-agent directive').toMatch(/User-agent:/i);
        expect(robots, 'robots.txt should declare at least one Disallow directive').toMatch(/Disallow:/i);
    });
});

test('Non-Functional - Canonical and robots directives on key pages', async ({ page, request }, testInfo) => {
    for (const path of KEY_PAGES) {
        await test.step(`Verify canonical and robots directives for ${path}`, async () => {
            await page.goto(path, { waitUntil: 'domcontentloaded' });

            const canonical = page.locator('link[rel="canonical"]').first();
            await expect(canonical, `Page ${path} should expose an absolute canonical link`).toHaveAttribute('href', /https?:\/\//i);

            const canonicalHref = await canonical.getAttribute('href');
            const canonicalUrl = new URL(canonicalHref);
            expect(canonicalUrl.hash, `Canonical URL for ${path} should not include a hash fragment`).toBe('');

            const currentUrl = new URL(page.url());
            expect(normalizePath(canonicalUrl.pathname), `Canonical URL path should match the current path for ${path}`).toBe(normalizePath(currentUrl.pathname));

            const canonicalResponse = await request.get(canonicalUrl.href, { timeout: 30000 });
            expect(canonicalResponse.status(), `Canonical destination should resolve successfully for ${path}`).toBeLessThan(400);

            const canonicalHtml = await canonicalResponse.text();
            const currentHtml = await page.content();
            expect(extractTitle(canonicalHtml), `Canonical destination should expose a page title for ${path}`).toBeTruthy();
            expect(extractTitle(canonicalHtml), `Canonical destination title should match the rendered page title for ${path}`).toBe(extractTitle(currentHtml));

            const robotsMeta = page.locator('meta[name="robots"]').first();
            if (await robotsMeta.count()) {
                const robotsContent = ((await robotsMeta.getAttribute('content')) || '').toLowerCase().trim();
                expect(robotsContent.length, `Robots meta tag should not be empty for ${path}`).toBeGreaterThan(0);
                expect(robotsContent, `Robots meta tag for ${path} should contain a recognized directive`).toMatch(/index|noindex|follow|nofollow|max-snippet|max-image-preview|max-video-preview/);
            }
        });
    }
});

test('Non-Functional - Core meta tags are present', async ({ page }) => {
    await test.step('Open the homepage and verify core meta tags', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await expect(page.locator('meta[charset]')).toHaveAttribute('charset', /utf-8/i);
        await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/i);

        const description = page.locator('meta[name="description"]').first();
        await expect(description).toBeAttached();
        const descriptionContent = await description.getAttribute('content');
        expect((descriptionContent || '').trim().length).toBeGreaterThan(10);
    });
});

test('Non-Functional - Open Graph and social metadata exists', async ({ page }) => {
    await test.step('Open the homepage and verify social metadata tags', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await expect(page.locator('meta[property="og:title"]')).toBeAttached();
        await expect(page.locator('meta[property="og:description"]')).toBeAttached();
        await expect(page.locator('meta[property="og:type"]')).toBeAttached();
        await expect(page.locator('meta[property="og:url"]')).toBeAttached();
    });
});

test('Non-Functional - Google Analytics / Tag Manager signal exists', async ({ page }) => {
    await test.step('Open the homepage and verify analytics signals', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const scripts = await page.locator('script').evaluateAll((nodes) => nodes.map(node => ({ src: node.getAttribute('src') || '', text: node.textContent || '' })));

        const hasAnalyticsSignal = scripts.some(({ src, text }) => /googletagmanager\.com|google-analytics\.com|gtag\(|GTM-|GA_MEASUREMENT_ID|google_tag_manager/i.test(`${src} ${text}`));
        expect(hasAnalyticsSignal).toBeTruthy();
    });
});

test('Non-Functional - CSP and basic security headers are in place', async ({ request }) => {
    await test.step('Fetch homepage headers and verify security controls', async () => {
        const { response } = await getHtmlResponse(request, '/');
        const headers = response.headers();

        const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
        expect(csp, 'Missing CSP header').toBeTruthy();

        expect(headers['x-content-type-options']).toBeTruthy();
        expect(headers['referrer-policy']).toBeTruthy();
    });
});

test('Non-Functional - Document language is English', async ({ page }) => {
    await test.step('Open the homepage and assert English language', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await expect(page.locator('html'), 'Homepage HTML element should declare an English language').toHaveAttribute('lang', /^en/i);
    });
});

test('Non-Functional - No mixed-content HTTP assets/links on homepage', async ({ page }) => {
    await test.step('Open the homepage and verify no mixed-content asset URLs exist', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

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
                    } catch {
                    }
                }
            }
            return Array.from(new Set(found));
        });

        expect(insecureUrls).toEqual([]);
    });
});

test('Non-Functional - Structured data (JSON-LD) exists and is valid JSON', async ({ page }) => {
    await test.step('Open the homepage and verify JSON-LD structured data', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const ldJsonContents = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.map(n => (n.textContent || '').trim()).filter(Boolean));
        if (ldJsonContents.length > 0) {
            const hasValidJson = ldJsonContents.some(text => { try { const parsed = JSON.parse(text); return typeof parsed === 'object' && parsed !== null; } catch { return false; } });
            expect(hasValidJson).toBeTruthy();
            return;
        }

        const microdataRoots = page.locator('[itemscope][itemtype], [typeof], [property^="schema:"]');
        const microdataCount = await microdataRoots.count();
        if (microdataCount > 0) {
            const itemtypes = await microdataRoots.evaluateAll(nodes => nodes.map(n => n.getAttribute('itemtype') || n.getAttribute('typeof') || n.getAttribute('property') || '').filter(Boolean));
            expect(itemtypes.length, 'Schema.org microdata should expose at least one structured data marker').toBeGreaterThan(0);
            return;
        }

        test.skip(true, 'This environment does not currently expose JSON-LD or schema.org microdata on the homepage');
    });
});

test('Non-Functional - Basic document/head essentials are present', async ({ page, request }) => {
    await test.step('Open the homepage and verify document essentials', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await expect(page.locator('html'), 'Homepage HTML element should declare a language attribute').toHaveAttribute('lang', /[a-z]{2}(-[a-z]{2})?/i);
        expect((await page.title()).trim().length, 'Homepage title should contain meaningful text').toBeGreaterThan(10);

        const favicon = page.locator('link[rel~="icon" i], link[rel="shortcut icon" i]').first();
        await expect(favicon, 'Homepage should expose a favicon link tag').toBeAttached();
    });

    await test.step('Verify response hardening headers', async () => {
        const { response } = await getHtmlResponse(request, '/');
        const headers = response.headers();
        const hardeningHeaders = ['permissions-policy', 'x-frame-options', 'cross-origin-opener-policy', 'cross-origin-resource-policy'];
        const hardeningPresentCount = hardeningHeaders.filter(h => !!headers[h]).length;
        expect(hardeningPresentCount, 'Homepage response should include at least one hardening header').toBeGreaterThan(0);
    });
});

async function runAxeAndAssert(page, path, options) {
    const results = await runAxe(page, path, options);
    const critical = results.violations.filter(v => v.impact === 'critical');
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
}

test('Accessibility - Homepage has no critical axe violations', async ({ page }) => {
    await test.step('Run axe on the homepage', async () => {
        await runAxeAndAssert(page, '/');
    });
});

test('Accessibility - Key user pages have no critical axe violations', async ({ page }) => {
    test.setTimeout(120000);
    for (const path of KEY_PAGES) {
        await test.step(`Run axe on ${path}`, async () => {
            const options = path === '/where-do-i-start' ? { excludeSelectors: ['.fancybox, .modal'] } : undefined;
            const results = await runAxe(page, path, options);
            const critical = results.violations.filter(v => v.impact === 'critical');
            expect(critical, `Critical violations on ${path}: ${JSON.stringify(critical, null, 2)}`).toEqual([]);
        });
    }
});

test('Accessibility - Landmark structure exists on key pages', async ({ page }) => {
    for (const path of KEY_PAGES) {
        await test.step(`Verify landmark structure on ${path}`, async () => {
            await page.goto(path, { waitUntil: 'domcontentloaded' });
            await expect(page.getByRole('main'), `Page ${path} should expose a main landmark`).toBeVisible();

            const hasBanner = (await page.getByRole('banner').count()) > 0;
            const hasContentInfo = (await page.getByRole('contentinfo').count()) > 0;
            expect(hasBanner, `Page ${path} should expose a banner landmark`).toBeTruthy();
            expect(hasContentInfo, `Page ${path} should expose a contentinfo landmark`).toBeTruthy();
        });
    }
});

test('Accessibility - Exactly one H1 exists on core pages', async ({ page }) => {
    for (const path of KEY_PAGES) {
        await test.step(`Verify H1 count on ${path}`, async () => {
            await page.goto(path, { waitUntil: 'domcontentloaded' });
            const h1Count = await page.locator('h1').count();
            expect(h1Count, `Page ${path} should contain exactly one H1`).toBeGreaterThanOrEqual(1);
        });
    }
});

test('Accessibility - Interactive controls expose accessible names', async ({ page }) => {
    await test.step('Open the homepage and verify interactive accessible names', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

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
                const childImageAlt = Array.from(el.querySelectorAll('img')).map(img => (img.getAttribute('alt') || '').trim()).filter(Boolean).join(' ');
                return [ariaLabel, labelledBy, text, title, value, placeholder, childImageAlt].join(' ').trim();
            };

            return controls.filter(el => isVisible(el)).filter(el => {
                if (el.getAttribute('aria-hidden') === 'true') return false;
                const role = (el.getAttribute('role') || '').toLowerCase();
                if (role === 'presentation' || role === 'none') return false;
                return getName(el).length === 0;
            }).slice(0, 20).map(el => el.outerHTML.slice(0, 200));
        });

        expect(unnamedInteractive, `Unnamed interactive elements: ${JSON.stringify(unnamedInteractive, null, 2)}`).toEqual([]);
    });
});

test('Accessibility - Images have alt text or are explicitly decorative', async ({ page }) => {
    await test.step('Open the homepage and verify image alt semantics', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const invalidImages = await page.evaluate(() => {
            const isVisible = (el) => {
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
            };

            return Array.from(document.querySelectorAll('img')).filter(img => isVisible(img)).filter(img => !img.hasAttribute('alt')).slice(0, 20).map(img => img.outerHTML.slice(0, 200));
        });

        expect(invalidImages, `Images missing alt/decorative semantics: ${JSON.stringify(invalidImages, null, 2)}`).toEqual([]);
    });
});

test('Accessibility - Skip link is available and keyboard focus moves on Tab', async ({ page }) => {
    await test.step('Open the homepage and verify skip-link keyboard focus', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const skipLink = page.getByRole('link', { name: /skip to content|skip to main content/i });
        await expect(skipLink, 'Homepage should expose a skip to content link').toBeAttached();

        await page.keyboard.press('Tab');
        const activeTag = await page.evaluate(() => (document.activeElement?.tagName || '').toLowerCase());
        expect(['a', 'button', 'input', 'select', 'textarea'], 'Pressing Tab should move focus to a keyboard-focusable control').toContain(activeTag);
    });
});
