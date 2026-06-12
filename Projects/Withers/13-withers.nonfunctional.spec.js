const http = require('http');
const https = require('https');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const KEY_PAGES = ['/', '/search', '/contact-us', '/insight', '/people', '/locations'];

function getConfiguredOrigin(testInfo) {
    const configuredBaseUrl = testInfo.project.use.baseURL;
    expect(configuredBaseUrl, 'Playwright baseURL must be configured in playwright.config.js').toBeTruthy();
    return new URL(configuredBaseUrl).origin;
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
            if (settled) {
                return;
            }
            settled = true;
            callback(value);
        };

        const request = client.get(targetUrl, (response) => {
            const status = response.statusCode || 0;

            if (status >= 300 && status < 400 && response.headers.location) {
                response.resume();
                finish(resolve, fetchTextSnippet(new URL(response.headers.location, targetUrl).toString(), { timeoutMs, maxBytes }));
                return;
            }

            const chunks = [];
            let bytes = 0;

            const resolveWithBody = () => {
                finish(resolve, {
                    status,
                    body: Buffer.concat(chunks).toString('utf8'),
                });
            };

            response.on('data', (chunk) => {
                chunks.push(chunk);
                bytes += chunk.length;

                if (bytes >= maxBytes) {
                    response.destroy();
                }
            });

            response.on('end', resolveWithBody);
            response.on('close', resolveWithBody);
            response.on('error', (error) => finish(reject, error));
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Timed out after ${timeoutMs}ms while requesting ${url}`));
        });

        request.on('error', (error) => finish(reject, error));
    });
}

async function getSitemapBodySnippet(testInfo) {
    const sitemapCandidates = ['/sitemap.xml', '/sitemap_index.xml'];
    const configuredOrigin = getConfiguredOrigin(testInfo);

    for (const candidate of sitemapCandidates) {
        try {
            const { status, body } = await fetchTextSnippet(`${configuredOrigin}${candidate}`);
            if (status >= 200 && status < 300 && body) {
                return body;
            }
        } catch {
        }
    }

    throw new Error('At least one sitemap endpoint should return a readable sitemap response');
}

async function runAxe(page, path) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    return new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .exclude('#header__navToggle')
        .analyze();
}

test('Non-Functional - Sitemap is Available and Contains URLs', async ({ }, testInfo) => {
    test.setTimeout(180000);
    let chosenBody = '';

    await test.step('Find a working sitemap endpoint', async () => {
        chosenBody = await getSitemapBodySnippet(testInfo);
        expect(chosenBody.length, 'At least one sitemap endpoint should return readable XML content').toBeGreaterThan(0);
    });

    await test.step('Verify the sitemap content contains URLs', async () => {
        expect(chosenBody, 'The working sitemap endpoint should contain a sitemap XML root element').toMatch(/<urlset|<sitemapindex/i);
        expect(chosenBody, 'The working sitemap endpoint should advertise at least one absolute URL').toMatch(/<loc>https?:\/\//i);
    });
});

test('Non-Functional - Sitemap Sample URLs Resolve (No 4xx/5xx)', async ({ request }, testInfo) => {
    const sameOriginUrls = await test.step('Load sitemap sample URLs from the configured origin', async () => {
        const body = await getSitemapBodySnippet(testInfo);

        expect(body.length, 'A sitemap response body should be available before sampling sitemap URLs').toBeGreaterThan(0);

        const locMatches = [...body.matchAll(/<loc>(.*?)<\/loc>/gi)].map(match => match[1].trim());
        const configuredOrigin = getConfiguredOrigin(testInfo);
        const urls = locMatches
            .filter((url) => {
                try {
                    return new URL(url).origin === configuredOrigin;
                } catch {
                    return false;
                }
            })
            .slice(0, 5);

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

test('Non-Functional - robots.txt is Available and Exposes Crawl Directives', async ({ request }) => {
    await test.step('Fetch robots.txt', async () => {
        const response = await request.get('/robots.txt');
        expect(response.ok(), 'robots.txt should return a successful response').toBeTruthy();

        const robots = await response.text();
        expect(robots, 'robots.txt should declare at least one User-agent directive').toMatch(/User-agent:/i);
        expect(robots, 'robots.txt should declare at least one crawl directive').toMatch(/Disallow:|Allow:/i);
    });
});

test('Non-Functional - Canonical and robots Directives on Key Pages', async ({ page, request }) => {
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

test('Non-Functional - Canonical URL is Present and Absolute', async ({ page, request }) => {
    await test.step('Open the homepage and inspect the canonical tag', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const canonical = page.locator('link[rel="canonical"]').first();
        await expect(canonical, 'Homepage should expose an absolute canonical link').toHaveAttribute('href', /https?:\/\//i);

        const canonicalHref = await canonical.getAttribute('href');
        expect(canonicalHref, 'Homepage canonical href should not be empty').toBeTruthy();

        const canonicalUrl = new URL(canonicalHref);
        expect(canonicalUrl.hash, 'Homepage canonical URL should not include a hash fragment').toBe('');

        const currentUrl = new URL(page.url());
        expect(normalizePath(canonicalUrl.pathname), 'Homepage canonical path should match the current homepage path').toBe(normalizePath(currentUrl.pathname));

        const canonicalResponse = await request.get(canonicalUrl.href, { timeout: 30000 });
        expect(canonicalResponse.status(), 'Homepage canonical destination should resolve successfully').toBeLessThan(400);
        const canonicalHtml = await canonicalResponse.text();

        const baseResponse = await request.get('/', { timeout: 30000 });
        expect(baseResponse.status(), 'Homepage base request should resolve successfully').toBeLessThan(400);
        const baseHtml = await baseResponse.text();

        expect(extractTitle(canonicalHtml), 'Homepage canonical destination should expose a title').toBeTruthy();
        expect(extractTitle(canonicalHtml), 'Homepage canonical destination title should match the homepage title').toBe(extractTitle(baseHtml));
    });
});

test('Non-Functional - Core Meta Tags Are Present', async ({ page }) => {
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

test('Non-Functional - Open Graph and Social Metadata Exists', async ({ page }) => {
    await test.step('Open the homepage and verify social metadata tags', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await expect(page.locator('meta[property="og:title"]')).toBeAttached();
        await expect(page.locator('meta[property="og:description"]')).toBeAttached();
        await expect(page.locator('meta[property="og:type"]')).toBeAttached();
        await expect(page.locator('meta[property="og:url"]')).toBeAttached();
    });
});

test('Non-Functional - Google Analytics / Tag Manager Signal Exists', async ({ page }) => {
    await test.step('Open the homepage and verify analytics signals', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const scripts = await page.locator('script').evaluateAll((nodes) =>
            nodes.map((node) => ({
                src: node.getAttribute('src') || '',
                text: node.textContent || '',
            }))
        );

        const hasAnalyticsSignal = scripts.some(({ src, text }) =>
            /googletagmanager\.com|google-analytics\.com|gtag\(|GTM-|GA_MEASUREMENT_ID|google_tag_manager/i.test(`${src} ${text}`)
        );

        expect(hasAnalyticsSignal).toBeTruthy();
    });
});

test('Non-Functional - CSP and Basic Security Headers Are in Place', async ({ request }) => {
    await test.step('Fetch homepage headers and verify security controls', async () => {
        const { response } = await getHtmlResponse(request, '/');
        const headers = response.headers();

        const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
        expect(csp, 'Missing CSP header').toBeTruthy();

        expect(headers['x-content-type-options']).toBeTruthy();
        expect(headers['referrer-policy']).toBeTruthy();
    });
});

test('Non-Functional - Language Signals Are Discoverable', async ({ page }) => {
    await test.step('Open the homepage and inspect language discovery signals', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const alternates = page.locator('link[rel="alternate"][hreflang]');
        const alternateCount = await alternates.count();

        if (alternateCount > 0) {
            const hrefLangs = await alternates.evaluateAll((nodes) =>
                nodes.map((node) => (node.getAttribute('hreflang') || '').toLowerCase())
            );
            expect(hrefLangs.some((lang) => lang.startsWith('en')), 'Alternate hreflang links should include an English entry').toBeTruthy();
            return;
        }

        await expect(page.locator('html'), 'Homepage should expose an html lang attribute when hreflang alternates are absent').toHaveAttribute('lang', /^en/i);

        const currentUrl = new URL(page.url());
        expect(currentUrl.pathname, 'Homepage path should expose an English locale segment when hreflang alternates are absent').toMatch(/^\/en(?:-[a-z]{2})?(?:\/|$)/i);
    });
});

test('Non-Functional - No Mixed-Content HTTP Assets/Links on Homepage', async ({ page }) => {
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

test('Non-Functional - Structured Data (JSON-LD) Exists and Is Valid JSON', async ({ page }) => {
    await test.step('Open the homepage and verify JSON-LD structured data', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const ldJsonContents = await page
            .locator('script[type="application/ld+json"]')
            .evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').trim()).filter(Boolean));

        expect(ldJsonContents.length).toBeGreaterThan(0);

        const hasValidJson = ldJsonContents.some((text) => {
            try {
                const parsed = JSON.parse(text);
                return typeof parsed === 'object' && parsed !== null;
            } catch {
                return false;
            }
        });

        expect(hasValidJson).toBeTruthy();
    });
});

test('Non-Functional - Basic Document/Head Essentials Are Present', async ({ page, request }) => {
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
        const hardeningHeaders = [
            'permissions-policy',
            'x-frame-options',
            'cross-origin-opener-policy',
            'cross-origin-resource-policy',
        ];
        const hardeningPresentCount = hardeningHeaders.filter((header) => !!headers[header]).length;
        expect(hardeningPresentCount, 'Homepage response should include at least one hardening header').toBeGreaterThan(0);
    });
});

test('Accessibility - Homepage Has No Critical Axe Violations', async ({ page }) => {
    await test.step('Run axe on the homepage', async () => {
        const results = await runAxe(page, '/');
        const critical = results.violations.filter((violation) => violation.impact === 'critical');
        expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
    });
}, 60000);

test('Accessibility - Key User Pages Have No Critical Axe Violations', async ({ page }) => {
    for (const path of KEY_PAGES) {
        await test.step(`Run axe on ${path}`, async () => {
            const results = await runAxe(page, path);
            const critical = results.violations.filter((violation) => violation.impact === 'critical');
            expect(critical, `Critical violations on ${path}: ${JSON.stringify(critical, null, 2)}`).toEqual([]);
        });
    }
});

test('Accessibility - Landmark Structure Exists on Key Pages', async ({ page }) => {
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

test('Accessibility - Exactly One H1 Exists on Core Pages', async ({ page }) => {
    for (const path of KEY_PAGES) {
        await test.step(`Verify H1 count on ${path}`, async () => {
            await page.goto(path, { waitUntil: 'domcontentloaded' });
            const h1Count = await page.locator('h1').count();

            if (h1Count <= 1) {
                expect(h1Count, `Page ${path} should contain exactly one H1 when no carousel exception applies`).toBe(1);
            } else {
                const heroCarousel = page.locator('.hero--carousel').first();
                const hasVisibleHeroCarousel = await heroCarousel.isVisible().catch(() => false);

                expect(hasVisibleHeroCarousel, `Page ${path} should only allow multiple H1 elements when a visible hero carousel is present`).toBeTruthy();
            }
        });
    }
});

test('Accessibility - Interactive Controls Expose Accessible Names', async ({ page }) => {
    await test.step('Open the homepage and verify interactive accessible names', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const unnamedInteractive = await page.evaluate(() => {
            const isVisible = (el) => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
            };

            const controls = Array.from(document.querySelectorAll('button, a[href], input, select, textarea'));

            const getName = (el) => {
                const ariaLabel = el.getAttribute('aria-label') || '';
                const labelledBy = el.getAttribute('aria-labelledby') || '';
                const text = (el.textContent || '').trim();
                const title = el.getAttribute('title') || '';
                const value = (el.getAttribute('value') || '').trim();
                const placeholder = (el.getAttribute('placeholder') || '').trim();
                const childImageAlt = Array.from(el.querySelectorAll('img'))
                    .map((img) => (img.getAttribute('alt') || '').trim())
                    .filter(Boolean)
                    .join(' ');
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
});

test('Accessibility - Images Have Alt Text or Are Explicitly Decorative', async ({ page }) => {
    await test.step('Open the homepage and verify image alt semantics', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const invalidImages = await page.evaluate(() => {
            const isVisible = (el) => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
            };

            return Array.from(document.querySelectorAll('img'))
                .filter((img) => isVisible(img))
                .filter((img) => !img.hasAttribute('alt'))
                .slice(0, 20)
                .map((img) => img.outerHTML.slice(0, 200));
        });

        expect(invalidImages, `Images missing alt/decorative semantics: ${JSON.stringify(invalidImages, null, 2)}`).toEqual([]);
    });
});

test('Accessibility - Form Fields Have Associated Labels on Contact Page', async ({ page }) => {
    await test.step('Open the contact page and verify field labels', async () => {
        await page.goto('/contact-us', { waitUntil: 'domcontentloaded' });

        const unlabeledFields = await page.evaluate(() => {
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
                .filter((el) => !['hidden', 'submit', 'button', 'image', 'reset'].includes((el.getAttribute('type') || '').toLowerCase()))
                .filter((el) => !hasAssociatedLabel(el))
                .slice(0, 20)
                .map((el) => el.outerHTML.slice(0, 200));
        });

        expect(unlabeledFields, `Unlabeled form fields: ${JSON.stringify(unlabeledFields, null, 2)}`).toEqual([]);
    });
});

test('Accessibility - Skip Link Is Available and Keyboard Focus Moves on Tab', async ({ page }) => {
    await test.step('Open the homepage and verify skip-link keyboard focus', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const skipLink = page.getByRole('link', { name: /skip to (?:main )?content/i });
        await expect(skipLink, 'Homepage should expose a skip to content link').toBeAttached();

        await page.keyboard.press('Tab');

        const activeTag = await page.evaluate(() => (document.activeElement?.tagName || '').toLowerCase());
        expect(activeTag, 'Pressing Tab from the homepage should focus a link first, typically the skip link').toBe('a');
    });
});
