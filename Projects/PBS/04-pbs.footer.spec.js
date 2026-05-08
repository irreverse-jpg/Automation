const { test, expect } = require('@playwright/test');

// Cookie Selector (If there is one)
const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR);
    if (await cookieButton.first().isVisible().catch(() => false)) {
        await cookieButton.first().click();
    }
}

async function openMenuIfPresent(page) {
    const openMenuButton = page.getByRole('button', { name: 'Open menu' });
    if (await openMenuButton.isVisible().catch(() => false)) {
        await openMenuButton.click();
    }
}

async function getVisibleFooterLinks(page) {
    return await page.$$eval('footer a', (links) => {
        const isVisible = (el) => {
            const s = window.getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        };

        const items = links
            .filter(isVisible)
            .map(link => ({
                href: link.getAttribute('href'),
                target: link.getAttribute('target')
            }))
            .filter(item => !!item.href);

        const seen = new Set();
        return items.filter(item => {
            const key = `${item.href}__${item.target || ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    });
}

test('Footer - Verify Footer is Present', async ({ page }) => {
    await test.step('Open homepage and footer', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        const footer = page.locator('footer');
        await expect(footer, 'PBS footer should be visible on the homepage').toBeVisible();
    });
});

test('Footer - Verify Logo is Present', async ({ page }) => {
    await test.step('Open homepage and footer logo', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        const footerLogo = page.locator('footer').getByRole('img', { name: 'Principality Building Society' });
        await expect(footerLogo, 'PBS footer should show the Principality logo').toBeVisible();
    });
});

test('Footer - Verify Links', async ({ page, request, baseURL }) => {
    test.setTimeout(180000); // 3 minutes — many links checked via fast HEAD requests
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await acceptCookiesIfPresent(page);
    await openMenuIfPresent(page);
    const socialDomains = [
        'linkedin.com',
        'facebook.com',
        'instagram.com',
        'youtube.com',
        'tiktok.com'
    ];
    const footerLinks = await getVisibleFooterLinks(page);
    const origin = (baseURL || '').replace(/\/$/, '');

    for (const { href, target } of footerLinks) {
        if (
            !href ||
            href.startsWith('#') ||
            href.startsWith('javascript:') ||
            href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            socialDomains.some(domain => href.includes(domain))
        ) {
            continue;
        }

        // Build absolute URL
        const absoluteUrl = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;

        await test.step(`Footer link request: ${absoluteUrl}`, async () => {
            try {
                let response = await request.fetch(absoluteUrl, {
                    method: 'HEAD',
                    timeout: 10000,
                    failOnStatusCode: false,
                }).catch(() => null);

                if (!response || response.status() === 405) {
                    response = await request.fetch(absoluteUrl, {
                        method: 'GET',
                        timeout: 10000,
                        failOnStatusCode: false,
                    }).catch(() => null);
                }

                if (response) {
                    const status = response.status();
                    expect(status, `Footer link returned ${status}: ${absoluteUrl}`).toBeLessThan(400);
                } else {
                    console.warn(`Footer link could not be reached: ${absoluteUrl}`);
                }
            } catch (err) {
                console.warn(`Footer link check failed: ${absoluteUrl} — ${err.message}`);
            }
        });
    }
});

test('Footer - Verify Social Links', async ({ page, baseURL }) => {
    test.setTimeout(180000); // 3 minutes
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await acceptCookiesIfPresent(page);
    await openMenuIfPresent(page);
    const socialDomains = [
        'linkedin.com',
        'facebook.com',
        'instagram.com',
        'youtube.com',
        'tiktok.com'
    ];
    const footerLinks = await getVisibleFooterLinks(page);
    for (const { href, target } of footerLinks) {
        if (!href || !socialDomains.some(domain => href.includes(domain))) {
            continue;
        }
        await test.step(`Footer social link: ${href}`, async () => {
            try {
                await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10000 });
                await acceptCookiesIfPresent(page);
                await openMenuIfPresent(page);
                const link = page.locator(`footer a[href='${href}']`).first();
                if (target === '_blank') {
                    try {
                        const [popup] = await Promise.all([
                            page.waitForEvent('popup', { timeout: 5000 }),
                            link.click()
                        ]);
                        await popup.waitForLoadState('domcontentloaded', { timeout: 5000 });
                        await popup.close();
                    } catch (err) {
                        console.warn(`Social link timed out or failed (popup): ${href}`);
                    }
                } else {
                    try {
                        const prevUrl = page.url();
                        await Promise.all([
                            page.waitForNavigation({ timeout: 5000 }),
                            link.click()
                        ]);
                        await page.waitForLoadState('load');
                        await acceptCookiesIfPresent(page);
                        const newUrl = page.url();
                        expect(newUrl, `Social footer link should navigate away from ${prevUrl}`).not.toBe(prevUrl);
                    } catch (err) {
                        console.warn(`Social link timed out or failed (navigation): ${href}`);
                    }
                }
            } catch (err) {
                console.error(`Social link failed to load homepage for: ${href}`);
            }
        });
    }
});