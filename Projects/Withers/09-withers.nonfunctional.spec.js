const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function getHtmlResponse(request, path = '/') {
    const response = await request.get(path);
    expect(response.ok()).toBeTruthy();

    const html = await response.text();
    expect(html.length).toBeGreaterThan(0);

    return { response, html };
}

function normalizePath(pathname = '') {
    const normalized = pathname.replace(/\/+$/, '');
    return normalized || '/';
}

test('Non-Functional - robots.txt is available', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.ok()).toBeTruthy();

    const robots = await response.text();
    expect(robots).toMatch(/User-agent:/i);
});

test('Non-Functional - Canonical URL is present and path-aligned', async ({ page, request }) => {
    await page.goto('/');

    const canonical = page.locator('link[rel="canonical"]').first();
    await expect(canonical).toHaveAttribute('href', /https?:\/\//i);

    const canonicalHref = await canonical.getAttribute('href');
    const canonicalUrl = new URL(canonicalHref);
    const currentUrl = new URL(page.url());

    expect(normalizePath(canonicalUrl.pathname)).toBe(normalizePath(currentUrl.pathname));

    const canonicalResponse = await request.get(canonicalUrl.href, { timeout: 30000 });
    expect(canonicalResponse.status()).toBeLessThan(400);
});

test('Non-Functional - Basic security headers exist', async ({ request }) => {
    const { response } = await getHtmlResponse(request, '/');
    const headers = response.headers();

    const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
    expect(csp, 'Missing CSP header').toBeTruthy();
    expect(headers['x-content-type-options']).toBeTruthy();
});

test('Non-Functional - Homepage has no critical axe violations', async ({ page }) => {
    await page.goto('/');

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    const criticalViolations = accessibilityScanResults.violations.filter(v => v.impact === 'critical');

    expect(criticalViolations).toEqual([]);
}, 60000);
